/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors

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

const os = require("os");
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(4, os.availableParallelism()));

const path = require("path");
const zlib = require("zlib");
const fs = require("fs/promises");
const { promisify } = require("util");

const SOURCE = path.resolve(process.env.CLIENT_CACHE_PATH || path.join(__dirname, "..", "assets", "cache"));
const TARGET = path.resolve(process.env.CLIENT_COMPRESSED_PATH || path.join(__dirname, "..", "assets", "cache_compressed"));
const COMPRESSIBLE = /\.(js|css|json|svg|wasm)$/;
const MIN_SIZE = 256;

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const encoders = {
    br: (buf, name) =>
        brotli(buf, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
                [zlib.constants.BROTLI_PARAM_LGWIN]: buf.length > 1 << 22 ? 24 : 22,
                [zlib.constants.BROTLI_PARAM_MODE]: name.endsWith(".wasm") ? zlib.constants.BROTLI_MODE_GENERIC : zlib.constants.BROTLI_MODE_TEXT,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
            },
        }),
    gz: (buf) => gzip(buf, { level: zlib.constants.Z_BEST_COMPRESSION, memLevel: 9 }),
};

const fresh = async (source, target) => {
    const stat = await fs.stat(target).catch(() => null);
    return stat && stat.mtimeMs >= Math.floor(source.mtimeMs);
};

const write = async (target, data, mtime) => {
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.utimes(tmp, mtime, mtime);
    await fs.rename(tmp, target);
};

(async () => {
    const started = Date.now();
    await fs.mkdir(TARGET, { recursive: true });
    const names = (await fs.readdir(SOURCE)).filter((x) => COMPRESSIBLE.test(x));
    const wanted = new Set(names.flatMap((x) => Object.keys(encoders).map((ext) => `${x}.${ext}`)));

    let removed = 0;
    for (const name of await fs.readdir(TARGET)) {
        if (wanted.has(name)) continue;
        await fs.rm(path.join(TARGET, name), { force: true });
        removed++;
    }

    const totals = { files: 0, skipped: 0, written: 0, raw: 0, br: 0, gz: 0 };
    const report = () =>
        process.stdout.write(
            `\r${totals.files}/${names.length} files, ${totals.written} written, ${totals.skipped} up to date, ${(totals.raw / 1048576).toFixed(1)} MB -> br ${(totals.br / 1048576).toFixed(1)} MB, gz ${(totals.gz / 1048576).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)}s   `,
        );
    const timer = setInterval(report, 1000);

    const work = async (name) => {
        const source = path.join(SOURCE, name);
        const stat = await fs.stat(source);
        if (stat.size < MIN_SIZE) return;
        let buf = null;
        for (const [ext, encode] of Object.entries(encoders)) {
            const target = path.join(TARGET, `${name}.${ext}`);
            if (await fresh(stat, target)) {
                totals.skipped++;
                totals[ext] += (await fs.stat(target)).size;
                continue;
            }
            buf ??= await fs.readFile(source);
            const out = await encode(buf, name);
            totals[ext] += Math.min(out.length, buf.length);
            if (out.length >= buf.length) {
                await fs.rm(target, { force: true });
                continue;
            }
            await write(target, out, stat.mtime);
            totals.written++;
        }
        totals.raw += stat.size;
    };

    const largestFirst = await Promise.all(names.map(async (name) => [name, (await fs.stat(path.join(SOURCE, name))).size]));
    largestFirst.sort((a, b) => b[1] - a[1]);
    const ordered = largestFirst.map(([name]) => name);

    await Promise.all(
        Array.from({ length: Number(process.env.UV_THREADPOOL_SIZE) }, async () => {
            for (let name = ordered.shift(); name; name = ordered.shift()) {
                await work(name).catch((e) => console.error(`\n${name}: ${e.message}`));
                totals.files++;
            }
        }),
    );

    clearInterval(timer);
    report();
    console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s, removed ${removed} stale files, output in ${TARGET}`);
})();
