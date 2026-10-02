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

const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const multiply = (x: number, y: number) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
};

const divisor = (degree: number) => {
    const result = new Array<number>(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            result[j] = multiply(result[j], root);
            if (j + 1 < degree) result[j] ^= result[j + 1];
        }
        root = multiply(root, 0x02);
    }
    return result;
};

const remainder = (data: number[], div: number[]) => {
    const result = new Array<number>(div.length).fill(0);
    for (const b of data) {
        const factor = b ^ (result.shift() as number);
        result.push(0);
        div.forEach((coef, i) => (result[i] ^= multiply(coef, factor)));
    }
    return result;
};

const rawModules = (ver: number) => {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const align = Math.floor(ver / 7) + 2;
        result -= (25 * align - 10) * align - 55;
        if (ver >= 7) result -= 36;
    }
    return result;
};

const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - EC_PER_BLOCK[ver] * BLOCKS[ver];

const alignmentPositions = (ver: number, size: number) => {
    if (ver === 1) return [];
    const count = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
};

export const qrMatrix = (text: string) => {
    const bytes = [...new TextEncoder().encode(text)];
    let ver = 1;
    while (ver <= 10 && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
    if (ver > 10) throw new Error("Text too long for a QR code");
    const capacity = dataCodewords(ver) * 8;
    const bits: number[] = [];
    const push = (value: number, length: number) => {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(4, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data: number[] = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

    const blockCount = BLOCKS[ver];
    const ecLength = EC_PER_BLOCK[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const short = blockCount - (raw % blockCount);
    const shortLength = Math.floor(raw / blockCount);
    const div = divisor(ecLength);
    const blocks: number[][] = [];
    for (let i = 0, k = 0; i < blockCount; i++) {
        const chunk = data.slice(k, k + shortLength - ecLength + (i < short ? 0 : 1));
        k += chunk.length;
        const ec = remainder(chunk, div);
        if (i < short) chunk.push(0);
        blocks.push([...chunk, ...ec]);
    }
    const codewords: number[] = [];
    for (let i = 0; i < blocks[0].length; i++)
        blocks.forEach((block, j) => {
            if (i !== shortLength - ecLength || j >= short) codewords.push(block[i]);
        });

    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    const set = (x: number, y: number, dark: boolean) => {
        modules[y][x] = dark;
        reserved[y][x] = true;
    };
    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    const finder = (cx: number, cy: number) => {
        for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || x >= size || y < 0 || y >= size) continue;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                set(x, y, dist !== 2 && dist !== 4);
            }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    const align = alignmentPositions(ver, size);
    align.forEach((ax, i) =>
        align.forEach((ay, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }),
    );
    const mask = 0;
    const formatData = mask;
    let rem = formatData;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((formatData << 10) | rem) ^ 0x5412;
    const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(format, i));
    set(8, 7, bit(format, 6));
    set(8, 8, bit(format, 7));
    set(7, 8, bit(format, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i));
    set(8, size - 8, true);
    if (ver >= 7) {
        let vrem = ver;
        for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
        const info = (ver << 12) | vrem;
        for (let i = 0; i < 18; i++) {
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            set(a, b, bit(info, i));
            set(b, a, bit(info, i));
        }
    }

    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++)
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (reserved[y][x]) continue;
                const dark = index < codewords.length * 8 && bit(codewords[index >>> 3], 7 - (index & 7));
                index++;
                modules[y][x] = dark !== ((x + y) % 2 === 0);
            }
    }
    return modules;
};

export const qrSvg = (text: string, label: string) => {
    const modules = qrMatrix(text);
    const size = modules.length + 8;
    let path = "";
    modules.forEach((row, y) =>
        row.forEach((dark, x) => {
            if (dark) path += `M${x + 4} ${y + 4}h1v1h-1z`;
        }),
    );
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
};
