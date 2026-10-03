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

import FormData from "form-data";
import { HTTPError } from "lambert-server/HTTPError";
import { InternalCdnAttachment } from "@spacebar/util/dtos/MessageOptions";
import { Config } from "./Config";

export async function uploadFile(
    path: string,
    // These are the only props we use, don't need to enforce the full type.
    file?: Pick<Express.Multer.File, "mimetype" | "originalname" | "buffer">,
): Promise<InternalCdnAttachment> {
    if (!file?.buffer) throw new HTTPError("Missing file in body");

    const form = new FormData();
    form.append("file", file.buffer, {
        contentType: file.mimetype,
        filename: file.originalname,
    });

    const response = await fetch(`${Config.get().cdn.endpointPrivate?.replace(/\/+$/, "")}${path}`, {
        headers: {
            signature: Config.get().security.requestSignature,
            ...form.getHeaders(),
        },
        method: "POST",
        body: form.getBuffer(),
    });
    const result = (await response.json()) as InternalCdnAttachment;

    if (response.status !== 200) throw result;
    return result;
}

type DeclaredAttachment = {
    id?: string | number;
    filename?: string;
    title?: string;
    description?: string;
    duration_secs?: number;
    waveform?: string;
    is_spoiler?: boolean;
};

export async function uploadMessageFiles<T extends object>(
    path: string,
    files: Pick<Express.Multer.File, "fieldname" | "mimetype" | "originalname" | "buffer">[],
    declared: T[] = [],
) {
    const isStub = (attachment: object) => !("url" in attachment) && !("uploaded_filename" in attachment);
    const stubs = declared.filter(isStub) as DeclaredAttachment[];
    const uploaded: (InternalCdnAttachment & Omit<DeclaredAttachment, "id" | "is_spoiler"> & { flags?: number })[] = [];
    for (const [index, file] of files.entries()) {
        const slot = /(\d+)\]?$/.exec(file.fieldname)?.[1] ?? String(index);
        const meta = stubs.find((stub) => String(stub.id) === slot);
        const result = await uploadFile(path, file);
        if (!meta) {
            uploaded.push(result);
            continue;
        }
        uploaded.push({
            ...result,
            filename: meta.filename || result.filename,
            title: meta.title,
            description: meta.description,
            duration_secs: meta.duration_secs,
            waveform: meta.waveform,
            flags: meta.is_spoiler || (meta.filename || result.filename).startsWith("SPOILER_") ? 1 << 3 : undefined,
        });
    }
    return [...declared.filter((attachment) => !isStub(attachment)), ...uploaded];
}

export async function handleFile(path: string, body?: string): Promise<string | undefined> {
    if (!body || !body.startsWith("data:")) return undefined;
    try {
        const mimetype = body.split(":")[1].split(";")[0];
        const buffer = Buffer.from(body.split(",")[1], "base64");

        const { id } = await uploadFile(path, {
            buffer,
            mimetype,
            originalname: "banner",
        });
        return id;
    } catch (error) {
        console.error(error);
        throw new HTTPError(`Internal CDN error: Invalid response from POST $CDN${path}: ${(error as Error).message}`);
    }
}

export async function deleteFile(path: string) {
    const response = await fetch(`${Config.get().cdn.endpointPrivate?.replace(/\/+$/, "")}${path}`, {
        headers: {
            signature: Config.get().security.requestSignature,
        },
        method: "DELETE",
    });
    const result = await response.json();

    if (response.status !== 200) throw result;
    return result;
}
