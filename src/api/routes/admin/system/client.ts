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

import fs from "node:fs/promises";
import path from "node:path";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ASSETS_FOLDER, Config } from "@spacebar/util";

const router = Router({ mergeParams: true });

const CACHE = path.join(ASSETS_FOLDER, "cache");
const COMPRESSED = process.env.CLIENT_COMPRESSED_PATH ? path.resolve(process.env.CLIENT_COMPRESSED_PATH) : path.join(ASSETS_FOLDER, "cache_compressed");
const VENCORD = path.join(ASSETS_FOLDER, "vencord");
const PATCHES = path.join(ASSETS_FOLDER, "client_patches");

const stat = (file: string) => fs.stat(file).catch(() => null);
const readText = (file: string) => fs.readFile(file, "utf8").catch(() => null);
const readJson = async <T>(file: string) => {
    const text = await readText(file);
    try {
        return text ? (JSON.parse(text) as T) : null;
    } catch {
        return null;
    }
};
const countFiles = (dir: string) =>
    fs.readdir(dir).then(
        (files) => files.length,
        () => null,
    );

type VencordBuild = { commit: string; version: string; plugins: string[]; builtAt: string };
type PatchReport = {
    outcome: string;
    origin: string;
    seconds: number;
    badPatches: { plugin: string; type: string; module: string; match: string; error?: string }[];
    badFinds: string[];
    badStarts: { plugin: string; error: string }[];
    errors: string[];
    unmatchedAllPatches: { plugin: string; find: string }[];
    meta: { buildNumber?: number; buildHash?: string } | null;
};

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Client cache, Vencord build and patch check status" }), async (req: Request, res: Response) => {
    const [indexStat, html, cacheFiles, compressedFiles, failures, misses, build, buildStat, reporter, report, reportStat, vencordStat, patches, vencordConfig] = await Promise.all(
        [
            stat(path.join(CACHE, "index.html")),
            readText(path.join(CACHE, "index.html")),
            countFiles(CACHE),
            countFiles(COMPRESSED),
            readText(path.join(ASSETS_FOLDER, "cacheFailures")),
            readText(path.join(ASSETS_FOLDER, "cacheMisses")),
            readJson<VencordBuild>(path.join(VENCORD, "build.json")),
            stat(path.join(VENCORD, "build.json")),
            readJson<VencordBuild>(path.join(VENCORD, "reporter.json")),
            readJson<PatchReport>(path.join(VENCORD, "report.json")),
            stat(path.join(VENCORD, "report.json")),
            stat(path.join(VENCORD, "vencord.js")),
            fs.readdir(PATCHES).then(
                (files) => files.filter((f) => f.endsWith(".js")).sort(),
                () => [],
            ),
            readJson<{ plugins?: Record<string, boolean | { enabled?: boolean }> }>(path.join(ASSETS_FOLDER, "..", "client", "vencord.json")),
        ],
    );

    const missList = [
        ...new Set(
            (misses ?? "")
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
        ),
    ];
    const failureList = (failures ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
    const buildNumber = html?.match(/"BUILD_NUMBER":"(\d+)"/)?.[1] ?? null;
    const ours = new Set((build?.plugins ?? []).map((p) => p.toLowerCase()));
    const enabled = new Set(
        Object.entries(vencordConfig?.plugins ?? {}).flatMap(([name, value]) => ((typeof value === "boolean" ? value : value?.enabled) ? [name.toLowerCase()] : [])),
    );
    const group = (plugin: string) => (ours.has(plugin.toLowerCase()) ? "fosscord" : enabled.has(plugin.toLowerCase()) ? "enabled" : "upstream");

    res.json({
        client: {
            enabled: Config.get().client.useTestClient,
            present: !!indexStat,
            build_number: buildNumber ? Number(buildNumber) : null,
            version_hash: html?.match(/"VERSION_HASH":"(\w+)"/)?.[1] ?? null,
            generated_at: indexStat?.mtime.toISOString() ?? null,
            files: cacheFiles,
            compressed_files: compressedFiles,
            failures: { count: failureList.length, items: failureList.slice(0, 50) },
            misses: { count: missList.length, items: missList.slice(-50).reverse() },
            patches,
        },
        vencord: {
            present: !!vencordStat,
            size: vencordStat?.size ?? null,
            commit: build?.commit ?? null,
            version: build?.version ?? null,
            plugins: build?.plugins ?? [],
            built_at: build?.builtAt ?? buildStat?.mtime.toISOString() ?? null,
            reporter_built_at: reporter?.builtAt ?? null,
        },
        patch_check: report
            ? {
                  outcome: report.outcome,
                  checked_at: reportStat?.mtime.toISOString() ?? null,
                  seconds: report.seconds,
                  build_number: report.meta?.buildNumber ?? null,
                  build_hash: report.meta?.buildHash ?? null,
                  bad_patches: report.badPatches.map((p) => ({ ...p, group: group(p.plugin) })),
                  bad_starts: report.badStarts.map((p) => ({ ...p, group: group(p.plugin) })),
                  bad_finds: report.badFinds,
                  unmatched_all_patches: report.unmatchedAllPatches,
                  errors: [...new Set(report.errors)],
              }
            : null,
    });
});

export default router;
