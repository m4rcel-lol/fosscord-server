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

import path from "node:path";
import express, { NextFunction, Request, Response, Router } from "express";
import { In } from "typeorm";
import { ActivityInstanceParticipant, ActivityInstances, User } from "@spacebar/database";
import { Config } from "@spacebar/util";
import { ACTIVITY_ASSETS, BuiltinActivity, readProxyTicket } from "./common";

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 900;
const MAX_BOARD_POINTS = 200_000;
const MAX_STROKE_POINTS = 4_000;
const MAX_BATCH_POINTS = 512;
const ACCESS_TTL = 5_000;

interface Stroke {
    id: string;
    user_id: string;
    color: string;
    size: number;
    points: number[];
}

interface Viewer {
    res: Response;
    client: string;
}

interface Board {
    strokes: Stroke[];
    viewers: Set<Viewer>;
    points: number;
}

const boards = new Map<string, Board>();
const access = new Map<string, number>();

const boardFor = (instanceId: string) => {
    let board = boards.get(instanceId);
    if (!board) boards.set(instanceId, (board = { strokes: [], viewers: new Set(), points: 0 }));
    return board;
};

const broadcast = (instanceId: string, event: string, data: unknown, exceptClient?: string) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const viewer of boards.get(instanceId)?.viewers ?? []) if (viewer.client !== exceptClient) viewer.res.write(payload);
};

const people = async (instanceId: string) => {
    const rows = await ActivityInstances.participants(instanceId);
    const users = rows.length ? await User.find({ where: { id: In(rows.map((r) => r.user_id)) }, select: { id: true, username: true, global_name: true, avatar: true } }) : [];
    const cdn = (Config.get().cdn.endpointPublic ?? "").replace(/\/$/, "");
    return rows.flatMap((row) => {
        const user = users.find((u) => u.id === row.user_id);
        if (!user) return [];
        const avatar = user.avatar
            ? `${cdn}/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=64`
            : `${cdn}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
        return [{ id: user.id, name: user.global_name || user.username, avatar }];
    });
};

ActivityInstances.onChange((instance, participants) => {
    if (!boards.has(instance.id)) return;
    if (participants.length) {
        void people(instance.id).then((list) => broadcast(instance.id, "people", list));
        return;
    }
    broadcast(instance.id, "ended", {});
    for (const viewer of boards.get(instance.id)!.viewers) viewer.res.end();
    boards.delete(instance.id);
});

const authorize = async (req: Request, res: Response, next: NextFunction) => {
    const applicationId = res.locals.applicationId as string;
    const ticket = readProxyTicket(req.get("x-proxy-ticket") ?? req.query.ticket, applicationId);
    if (!ticket) return res.status(401).json({ message: "Invalid proxy ticket" });
    const instance = await ActivityInstances.find(applicationId, req.params.instance_id as string);
    if (!instance) return res.status(404).json({ message: "Unknown activity instance" });
    const key = `${instance.id}:${ticket.uid}`;
    if ((access.get(key) ?? 0) < Date.now()) {
        if (!(await ActivityInstanceParticipant.exists({ where: { instance_id: instance.id, user_id: ticket.uid } })))
            return res.status(403).json({ message: "You are not in this activity" });
        access.set(key, Date.now() + ACCESS_TTL);
    }
    res.locals.userId = ticket.uid;
    res.locals.instanceId = instance.id;
    res.locals.client = String(req.get("x-client-id") ?? req.query.client ?? "");
    next();
};

const validPoints = (points: unknown): points is number[] =>
    Array.isArray(points) &&
    points.length > 0 &&
    points.length % 2 === 0 &&
    points.length <= MAX_BATCH_POINTS * 2 &&
    points.every((value, i) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= (i % 2 ? BOARD_HEIGHT : BOARD_WIDTH));

const api = Router({ mergeParams: true });
const json = express.json({ limit: "64kb" });

api.get("/instances/:instance_id/events", authorize, async (req: Request, res: Response) => {
    const { instanceId, userId, client } = res.locals as { instanceId: string; userId: string; client: string };
    const board = boardFor(instanceId);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const viewer = { res, client };
    board.viewers.add(viewer);
    res.write(`event: hello\ndata: ${JSON.stringify({ you: userId, width: BOARD_WIDTH, height: BOARD_HEIGHT, strokes: board.strokes, people: await people(instanceId) })}\n\n`);
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => {
        clearInterval(keepAlive);
        board.viewers.delete(viewer);
        broadcast(instanceId, "cursor", { user_id: userId, x: null, y: null });
    });
});

api.post("/instances/:instance_id/strokes", json, authorize, (req: Request, res: Response) => {
    const { instanceId, userId, client } = res.locals as { instanceId: string; userId: string; client: string };
    const { id, color, size, points } = req.body ?? {};
    if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id) || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return res.sendStatus(400);
    if (typeof size !== "number" || size < 1 || size > 64 || !validPoints(points)) return res.sendStatus(400);

    const board = boardFor(instanceId);
    let stroke = board.strokes.findLast((s) => s.id === id && s.user_id === userId);
    if (!stroke) board.strokes.push((stroke = { id, user_id: userId, color, size, points: [] }));
    if (stroke.points.length + points.length > MAX_STROKE_POINTS * 2 || board.points + points.length / 2 > MAX_BOARD_POINTS) return res.sendStatus(413);
    const rounded = points.map((value) => Math.round(value * 10) / 10);
    stroke.points.push(...rounded);
    board.points += rounded.length / 2;
    broadcast(instanceId, "points", { id, user_id: userId, color: stroke.color, size: stroke.size, points: rounded }, client);
    res.sendStatus(204);
});

api.post("/instances/:instance_id/cursor", json, authorize, (req: Request, res: Response) => {
    const { instanceId, userId, client } = res.locals as { instanceId: string; userId: string; client: string };
    const { x, y } = req.body ?? {};
    const visible = typeof x === "number" && typeof y === "number" && x >= 0 && x <= BOARD_WIDTH && y >= 0 && y <= BOARD_HEIGHT;
    broadcast(instanceId, "cursor", { user_id: userId, x: visible ? x : null, y: visible ? y : null }, client);
    res.sendStatus(204);
});

api.post("/instances/:instance_id/undo", authorize, (req: Request, res: Response) => {
    const { instanceId, userId } = res.locals as { instanceId: string; userId: string };
    const board = boardFor(instanceId);
    const index = board.strokes.findLastIndex((s) => s.user_id === userId);
    if (index === -1) return res.sendStatus(204);
    const [stroke] = board.strokes.splice(index, 1);
    board.points -= stroke.points.length / 2;
    broadcast(instanceId, "remove", { id: stroke.id, user_id: userId });
    res.sendStatus(204);
});

api.post("/instances/:instance_id/clear", authorize, (req: Request, res: Response) => {
    const { instanceId, userId } = res.locals as { instanceId: string; userId: string };
    const board = boardFor(instanceId);
    board.strokes = [];
    board.points = 0;
    broadcast(instanceId, "clear", { user_id: userId });
    res.sendStatus(204);
});

const router = Router();
router.use("/api", api);
router.use(express.static(path.join(ACTIVITY_ASSETS, "whiteboard"), { index: "index.html", maxAge: 0, setHeaders: (res) => res.set("Cache-Control", "no-cache") }));

export const whiteboard: BuiltinActivity = {
    key: "whiteboard",
    name: "Whiteboard",
    description: "Sketch together on a shared board. Everyone in the call draws on the same page, live.",
    tags: ["drawing", "creative"],
    shelfRank: 1,
    icon: "icon.png",
    assets: [
        { name: "embedded_cover", file: "cover.png" },
        { name: "embedded_background", file: "cover.png" },
    ],
    router,
};
