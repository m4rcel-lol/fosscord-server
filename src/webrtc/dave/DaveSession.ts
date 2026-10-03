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

import { Send, SendBinary } from "../util/Send";
import { VoiceOPCodes } from "../util/Constants";
import { WebRtcWebSocket } from "../util/WebRtcWebSocket";
import { CIPHERSUITE_P256_AES128GCM_SHA256_P256, ExternalSender, parseKeyPackageMessage, readCommitMessage, SenderType } from "./Mls";
import { TlsReader, tls } from "./Tls";

export const DAVE_PROTOCOL_VERSION = 1;
const TRANSITION_TIMEOUT = 3000;

interface PendingProposal {
    ref: Buffer;
    message: Buffer;
    userId: string;
    kind: "add" | "remove";
    leaf?: number;
    sentTo: Set<string>;
}

interface Transition {
    waiting: Set<string>;
    timer: NodeJS.Timeout;
}

const externalSender = new ExternalSender();
const transitionListeners: ((roomId: string) => void)[] = [];
const sessions = new Map<string, DaveSession>();

export class DaveSession {
    readonly groupId: Buffer;
    private readonly sockets = new Map<string, WebRtcWebSocket>();
    private readonly keyPackages = new Map<string, Buffer>();
    private leaves: (string | null)[] = [];
    private epoch = 0n;
    private established = false;
    private proposals: PendingProposal[] = [];
    private transitions = new Map<number, Transition>();
    private nextTransitionId = 1;

    private constructor(
        readonly roomId: string,
        channelId: string,
    ) {
        this.groupId = tls.u64(BigInt(channelId));
    }

    static get(roomId: string, channelId: string) {
        let session = sessions.get(roomId);
        if (!session) sessions.set(roomId, (session = new DaveSession(roomId, channelId)));
        return session;
    }

    static onTransitionExecuted(listener: (roomId: string) => void) {
        transitionListeners.push(listener);
    }

    static find(roomId?: string) {
        return roomId ? sessions.get(roomId) : undefined;
    }

    static count() {
        return sessions.size;
    }

    private log(message: string) {
        console.log(`[DAVE/${this.roomId}] ${message}`);
    }

    private members() {
        return this.leaves.flatMap((userId) => (userId && this.sockets.has(userId) ? [userId] : []));
    }

    private send(userId: string, op: VoiceOPCodes, payload: Buffer) {
        const socket = this.sockets.get(userId);
        if (socket) return SendBinary(socket, op, payload);
    }

    private sendJson(userId: string, op: VoiceOPCodes, d: unknown) {
        const socket = this.sockets.get(userId);
        if (socket) return Send(socket, { op, d });
    }

    async join(socket: WebRtcWebSocket) {
        this.sockets.set(socket.user_id, socket);
        await SendBinary(socket, VoiceOPCodes.MLS_EXTERNAL_SENDER_PACKAGE, externalSender.package);
    }

    rebind(userId: string, from: WebRtcWebSocket, to: WebRtcWebSocket) {
        if (this.sockets.get(userId) === from) this.sockets.set(userId, to);
    }

    async leave(userId: string, socket?: WebRtcWebSocket) {
        if (socket && this.sockets.get(userId) !== socket) return;
        this.sockets.delete(userId);
        this.keyPackages.delete(userId);

        for (const transition of this.transitions.values()) transition.waiting.delete(userId);
        this.flushTransitions();

        if (this.sockets.size === 0) {
            for (const transition of this.transitions.values()) clearTimeout(transition.timer);
            sessions.delete(this.roomId);
            return;
        }

        const revoked = this.proposals.filter((p) => p.kind === "add" && p.userId === userId);
        this.proposals = this.proposals.filter((p) => !revoked.includes(p));
        for (const proposal of revoked) for (const recipient of proposal.sentTo) await this.send(recipient, VoiceOPCodes.MLS_PROPOSALS, this.encodeRevoke([proposal.ref]));
        if (!this.established) return;

        if (this.members().length <= 1) await this.reset();
        await this.update();
    }

    private async reset() {
        const [sole] = this.members();
        this.log(`resetting group${sole ? `, sole member ${sole}` : ""}`);
        this.established = false;
        this.epoch = 0n;
        this.leaves = [];
        this.proposals = [];
        if (!sole) return;
        this.keyPackages.delete(sole);
        await this.sendJson(sole, VoiceOPCodes.DAVE_PROTOCOL_PREPARE_EPOCH, { protocol_version: DAVE_PROTOCOL_VERSION, epoch: 1 });
        await this.sendJson(sole, VoiceOPCodes.DAVE_PROTOCOL_PREPARE_TRANSITION, { protocol_version: DAVE_PROTOCOL_VERSION, transition_id: 0 });
    }

    async onKeyPackage(socket: WebRtcWebSocket, data: Buffer) {
        const keyPackage = parseKeyPackageMessage(data);
        if (keyPackage.cipherSuite !== CIPHERSUITE_P256_AES128GCM_SHA256_P256) throw new Error(`Unexpected ciphersuite ${keyPackage.cipherSuite}`);
        if (keyPackage.identity.length !== 8 || keyPackage.identity.readBigUInt64BE(0).toString() !== socket.user_id)
            throw new Error("Key package identity does not match the authenticated user");

        this.sockets.set(socket.user_id, socket);
        this.keyPackages.set(socket.user_id, keyPackage.raw);
        const stale = this.proposals.filter((p) => p.kind === "add" && p.userId === socket.user_id);
        this.proposals = this.proposals.filter((p) => !stale.includes(p));
        for (const proposal of stale) for (const recipient of proposal.sentTo) await this.send(recipient, VoiceOPCodes.MLS_PROPOSALS, this.encodeRevoke([proposal.ref]));
        await this.update();
    }

    private async update() {
        if (!this.established) {
            const proposed = new Set(this.proposals.map((p) => p.userId));
            for (const [userId, keyPackage] of this.keyPackages)
                if (!proposed.has(userId)) this.proposals.push({ ...externalSender.add(this.groupId, this.epoch, keyPackage), userId, kind: "add", sentTo: new Set() });

            for (const recipient of this.keyPackages.keys()) {
                const unsent = this.proposals.filter((p) => p.userId !== recipient && !p.sentTo.has(recipient));
                if (!unsent.length) continue;
                for (const proposal of unsent) proposal.sentTo.add(recipient);
                await this.send(recipient, VoiceOPCodes.MLS_PROPOSALS, this.encodeAppend(unsent));
            }
            return;
        }

        const fresh: PendingProposal[] = [];
        const proposedRemovals = new Set(this.proposals.filter((p) => p.kind === "remove").map((p) => p.leaf));
        const proposedAdds = new Set(this.proposals.filter((p) => p.kind === "add").map((p) => p.userId));

        this.leaves.forEach((userId, leaf) => {
            if (userId === null || proposedRemovals.has(leaf)) return;
            if (this.sockets.has(userId) && !this.keyPackages.has(userId)) return;
            fresh.push({ ...externalSender.remove(this.groupId, this.epoch, leaf), userId, kind: "remove", leaf, sentTo: new Set() });
        });

        for (const [userId, keyPackage] of this.keyPackages) {
            if (proposedAdds.has(userId)) continue;
            fresh.push({ ...externalSender.add(this.groupId, this.epoch, keyPackage), userId, kind: "add", sentTo: new Set() });
        }

        if (!fresh.length) return;
        this.proposals.push(...fresh);
        this.log(`proposing ${fresh.map((p) => `${p.kind} ${p.userId}`).join(", ")} at epoch ${this.epoch}`);
        const recipients = this.members();
        for (const proposal of fresh) for (const recipient of recipients) proposal.sentTo.add(recipient);
        await this.broadcast(recipients, this.encodeAppend(fresh));
    }

    async onCommitWelcome(socket: WebRtcWebSocket, data: Buffer) {
        const reader = new TlsReader(data);
        const commit = readCommitMessage(reader);
        const welcome = Buffer.from(reader.buffer.subarray(reader.offset));

        if (!commit.groupId.equals(this.groupId)) throw new Error("Commit is for another group");
        if (commit.epoch !== this.epoch) return this.log(`ignoring commit from ${socket.user_id} for epoch ${commit.epoch}, current epoch is ${this.epoch}`);
        if (commit.senderType !== SenderType.Member) throw new Error("Commit sender must be a member");
        if (this.established ? this.leaves[commit.senderIndex] !== socket.user_id : commit.senderIndex !== 0)
            throw new Error("Commit sender does not match the authenticated user");
        if (commit.inlineProposals > 0) throw new Error("Commit contains inline proposals");
        if (!this.established && this.leaves.length === 0 && this.keyPackages.has(socket.user_id) === false) throw new Error("Committer has no pending group");

        const referenced = commit.proposalRefs.map((ref) => this.proposals.find((p) => p.ref.equals(ref)));
        if (!referenced.length || referenced.some((p) => !p)) return this.log(`ignoring commit from ${socket.user_id} with unknown proposals`);
        const applied = referenced as PendingProposal[];

        const previousMembers = this.established ? this.members() : [socket.user_id];
        const leaves = this.established ? [...this.leaves] : [socket.user_id];
        for (const proposal of applied) if (proposal.kind === "remove") leaves[proposal.leaf!] = null;
        const added: string[] = [];
        for (const proposal of applied) {
            if (proposal.kind !== "add") continue;
            const blank = leaves.indexOf(null);
            if (blank === -1) leaves.push(proposal.userId);
            else leaves[blank] = proposal.userId;
            added.push(proposal.userId);
            this.keyPackages.delete(proposal.userId);
        }
        while (leaves.length && leaves[leaves.length - 1] === null) leaves.pop();

        if (!this.established) this.keyPackages.delete(socket.user_id);
        this.leaves = leaves;
        this.epoch += 1n;
        this.established = true;
        this.proposals = [];

        const transitionId = this.nextTransitionId;
        this.nextTransitionId = (this.nextTransitionId % 0xffff) + 1;
        this.log(`commit from ${socket.user_id} accepted, epoch ${this.epoch}, transition ${transitionId}, leaves [${leaves.join(", ")}]`);

        const waiting = new Set(this.members());
        this.transitions.set(transitionId, { waiting, timer: setTimeout(() => this.execute(transitionId), TRANSITION_TIMEOUT) });

        const announce = Buffer.concat([tls.u16(transitionId), commit.raw]);
        await this.broadcast(
            previousMembers.filter((userId) => this.sockets.has(userId) && !added.includes(userId)),
            announce,
            VoiceOPCodes.MLS_ANNOUNCE_COMMIT_TRANSITION,
        );
        if (welcome.length) await this.broadcast(added, Buffer.concat([tls.u16(transitionId), welcome]), VoiceOPCodes.MLS_WELCOME);

        await this.update();
    }

    async onReadyForTransition(userId: string, transitionId: number) {
        const transition = this.transitions.get(transitionId);
        if (!transition) return;
        transition.waiting.delete(userId);
        this.flushTransitions();
    }

    async onInvalidCommitWelcome(userId: string, transitionId: number) {
        this.log(`${userId} flagged transition ${transitionId} as invalid`);
        this.keyPackages.delete(userId);
        if (!this.established) return;
        if (this.leaves.includes(userId)) {
            const leaf = this.leaves.indexOf(userId);
            if (!this.proposals.some((p) => p.kind === "remove" && p.leaf === leaf)) {
                const proposal = { ...externalSender.remove(this.groupId, this.epoch, leaf), userId, kind: "remove" as const, leaf, sentTo: new Set<string>() };
                this.proposals.push(proposal);
                await this.broadcast(
                    this.members().filter((id) => id !== userId),
                    this.encodeAppend([proposal]),
                );
            }
        }
    }

    private flushTransitions() {
        for (const [id, transition] of this.transitions) if (transition.waiting.size === 0) this.execute(id);
    }

    private execute(transitionId: number) {
        const transition = this.transitions.get(transitionId);
        if (!transition) return;
        clearTimeout(transition.timer);
        this.transitions.delete(transitionId);
        for (const userId of this.members()) this.sendJson(userId, VoiceOPCodes.DAVE_PROTOCOL_EXECUTE_TRANSITION, { transition_id: transitionId });
        for (const listener of transitionListeners) listener(this.roomId);
    }

    private encodeAppend(proposals: PendingProposal[]) {
        return Buffer.concat([tls.u8(0), tls.vector(proposals.map((p) => p.message))]);
    }

    private encodeRevoke(refs: Buffer[]) {
        return Buffer.concat([tls.u8(1), tls.vector(refs.map((ref) => tls.opaque(ref)))]);
    }

    private async broadcast(userIds: string[], payload: Buffer, op = VoiceOPCodes.MLS_PROPOSALS) {
        await Promise.all(userIds.map((userId) => this.send(userId, op, payload)));
    }
}
