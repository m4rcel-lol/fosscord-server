/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/


import crypto from "node:crypto";
import { TlsReader, tls } from "./Tls";

export const MLS_VERSION_10 = 1;
export const CIPHERSUITE_P256_AES128GCM_SHA256_P256 = 2;

export enum WireFormat {
    PublicMessage = 1,
    PrivateMessage = 2,
    Welcome = 3,
    GroupInfo = 4,
    KeyPackage = 5,
}

export enum SenderType {
    Member = 1,
    External = 2,
    NewMemberProposal = 3,
    NewMemberCommit = 4,
}

export enum ContentType {
    Application = 1,
    Proposal = 2,
    Commit = 3,
}

export enum ProposalType {
    Add = 1,
    Update = 2,
    Remove = 3,
}

export interface KeyPackage {
    raw: Buffer;
    cipherSuite: number;
    identity: Buffer;
    signatureKey: Buffer;
}

export interface CommitMessage {
    raw: Buffer;
    groupId: Buffer;
    epoch: bigint;
    senderType: SenderType;
    senderIndex: number;
    proposalRefs: Buffer[];
    inlineProposals: number;
}

const readCredential = (reader: TlsReader) => {
    const type = reader.u16();
    if (type !== 1) throw new Error(`Unsupported MLS credential type ${type}`);
    return reader.opaque();
};

const readLeafNode = (reader: TlsReader) => {
    reader.opaque();
    const signatureKey = reader.opaque();
    const identity = readCredential(reader);
    for (let i = 0; i < 5; i++) reader.opaque();
    const source = reader.u8();
    if (source === 1) reader.bytes(16);
    else if (source === 3) reader.opaque();
    else if (source !== 2) throw new Error(`Invalid leaf node source ${source}`);
    reader.opaque();
    reader.opaque();
    return { signatureKey, identity };
};

export const readKeyPackage = (reader: TlsReader): KeyPackage => {
    const start = reader.offset;
    const version = reader.u16();
    if (version !== MLS_VERSION_10) throw new Error(`Unsupported MLS version ${version}`);
    const cipherSuite = reader.u16();
    reader.opaque();
    const { signatureKey, identity } = readLeafNode(reader);
    reader.opaque();
    reader.opaque();
    return { raw: Buffer.from(reader.since(start)), cipherSuite, identity, signatureKey };
};

export const parseKeyPackageMessage = (data: Buffer) => {
    const reader = new TlsReader(data);
    if (data.readUInt16BE(0) === MLS_VERSION_10 && data.readUInt16BE(2) === WireFormat.KeyPackage) reader.bytes(4);
    return readKeyPackage(reader);
};

const readProposalOrRef = (reader: TlsReader) => {
    const type = reader.u8();
    if (type === 2) return { ref: Buffer.from(reader.opaque()) };
    if (type !== 1) throw new Error(`Invalid ProposalOrRef type ${type}`);
    const proposalType = reader.u16();
    if (proposalType === ProposalType.Add) readKeyPackage(reader);
    else if (proposalType === ProposalType.Remove) reader.u32();
    else throw new Error(`Unsupported inline proposal type ${proposalType}`);
    return { inline: proposalType };
};

export const readCommitMessage = (reader: TlsReader): CommitMessage => {
    const start = reader.offset;
    const version = reader.u16();
    const wireFormat = reader.u16();
    if (version !== MLS_VERSION_10 || wireFormat !== WireFormat.PublicMessage) throw new Error("Commit must be an MLS 1.0 PublicMessage");

    const groupId = Buffer.from(reader.opaque());
    const epoch = reader.u64();
    const senderType = reader.u8() as SenderType;
    const senderIndex = senderType === SenderType.Member || senderType === SenderType.External ? reader.u32() : -1;
    reader.opaque();
    const contentType = reader.u8();
    if (contentType !== ContentType.Commit) throw new Error(`Expected a commit, got content type ${contentType}`);

    const proposals = reader.vector(readProposalOrRef);
    if (reader.u8() === 1) {
        readLeafNode(reader);
        reader.opaque();
    }

    reader.opaque();
    reader.opaque();
    if (senderType === SenderType.Member) reader.opaque();

    return {
        raw: Buffer.from(reader.since(start)),
        groupId,
        epoch,
        senderType,
        senderIndex,
        proposalRefs: proposals.flatMap((p) => (p.ref ? [p.ref] : [])),
        inlineProposals: proposals.filter((p) => p.inline).length,
    };
};

const refHash = (label: string, value: Buffer) => crypto.createHash("sha256").update(Buffer.concat([tls.opaque(label), tls.opaque(value)])).digest();

export const keyPackageRef = (keyPackage: Buffer) => refHash("MLS 1.0 KeyPackage Reference", keyPackage);

export class ExternalSender {
    readonly privateKey: crypto.KeyObject;
    readonly publicKey: Buffer;
    readonly identity = Buffer.from("spacebar-voice-gateway");

    constructor() {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        const jwk = publicKey.export({ format: "jwk" });
        this.privateKey = privateKey;
        this.publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
    }

    get package() {
        return Buffer.concat([tls.opaque(this.publicKey), tls.u16(1), tls.opaque(this.identity)]);
    }

    private sign(label: string, content: Buffer) {
        return crypto.sign("sha256", Buffer.concat([tls.opaque(`MLS 1.0 ${label}`), tls.opaque(content)]), this.privateKey);
    }

    proposal(groupId: Buffer, epoch: bigint, proposal: Buffer) {
        const content = Buffer.concat([
            tls.opaque(groupId),
            tls.u64(epoch),
            tls.u8(SenderType.External),
            tls.u32(0),
            tls.opaque(Buffer.alloc(0)),
            tls.u8(ContentType.Proposal),
            proposal,
        ]);
        const wireFormat = tls.u16(WireFormat.PublicMessage);
        const auth = tls.opaque(this.sign("FramedContentTBS", Buffer.concat([tls.u16(MLS_VERSION_10), wireFormat, content])));
        return {
            message: Buffer.concat([tls.u16(MLS_VERSION_10), wireFormat, content, auth]),
            ref: refHash("MLS 1.0 Proposal Reference", Buffer.concat([wireFormat, content, auth])),
        };
    }

    add(groupId: Buffer, epoch: bigint, keyPackage: Buffer) {
        return this.proposal(groupId, epoch, Buffer.concat([tls.u16(ProposalType.Add), keyPackage]));
    }

    remove(groupId: Buffer, epoch: bigint, leafIndex: number) {
        return this.proposal(groupId, epoch, Buffer.concat([tls.u16(ProposalType.Remove), tls.u32(leafIndex)]));
    }
}
