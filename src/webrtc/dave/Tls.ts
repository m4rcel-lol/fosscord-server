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


export class TlsReader {
    offset = 0;

    constructor(readonly buffer: Buffer) {}

    get remaining() {
        return this.buffer.length - this.offset;
    }

    bytes(length: number) {
        if (length < 0 || this.offset + length > this.buffer.length) throw new Error("TLS read out of bounds");
        const out = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return out;
    }

    u8() {
        return this.bytes(1).readUInt8(0);
    }

    u16() {
        return this.bytes(2).readUInt16BE(0);
    }

    u32() {
        return this.bytes(4).readUInt32BE(0);
    }

    u64() {
        return this.bytes(8).readBigUInt64BE(0);
    }

    varint() {
        const first = this.buffer[this.offset];
        if (first === undefined) throw new Error("TLS read out of bounds");
        const prefix = first >> 6;
        if (prefix === 0) return this.u8() & 0x3f;
        if (prefix === 1) return this.u16() & 0x3fff;
        if (prefix === 2) return this.u32() & 0x3fffffff;
        throw new Error("Invalid MLS varint prefix");
    }

    opaque() {
        return this.bytes(this.varint());
    }

    vector<T>(read: (reader: TlsReader) => T) {
        const reader = new TlsReader(this.opaque());
        const items: T[] = [];
        while (reader.remaining > 0) items.push(read(reader));
        return items;
    }

    since(start: number) {
        return this.buffer.subarray(start, this.offset);
    }
}

export const tls = {
    u8: (value: number) => Buffer.from([value]),
    u16: (value: number) => {
        const out = Buffer.alloc(2);
        out.writeUInt16BE(value);
        return out;
    },
    u32: (value: number) => {
        const out = Buffer.alloc(4);
        out.writeUInt32BE(value);
        return out;
    },
    u64: (value: bigint) => {
        const out = Buffer.alloc(8);
        out.writeBigUInt64BE(value);
        return out;
    },
    varint: (value: number) => {
        if (value < 0x40) return Buffer.from([value]);
        if (value < 0x4000) return tls.u16(value | 0x4000);
        if (value < 0x40000000) return tls.u32((value | 0x80000000) >>> 0);
        throw new Error("Value too large for an MLS varint");
    },
    opaque: (data: Buffer | string) => {
        const bytes = typeof data === "string" ? Buffer.from(data) : data;
        return Buffer.concat([tls.varint(bytes.length), bytes]);
    },
    vector: (items: Buffer[]) => tls.opaque(Buffer.concat(items)),
};
