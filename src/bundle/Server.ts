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

import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import cluster from "node:cluster";
import morgan from "morgan";
import express from "express";
import { green, bold } from "picocolors";
import { SpacebarServer } from "@spacebar/api";
import { CDNServer } from "@spacebar/cdn";
import { initDatabase } from "@spacebar/database";
import { clearCallStateOnStartup, GatewayServer } from "@spacebar/gateway";
import { Config } from "@spacebar/util";
import { WebrtcServer } from "@spacebar/webrtc";
import { ProcessLifecycle } from "../util/util/ProcessLifecycle";
import { Monitoring } from "../util/monitoring/Monitoring";
import TestClient, { TestClientAssets } from "./TestClient";
import { ActivityHost } from "@spacebar/api/activities/ActivityHost";

const app = express();
const server = http.createServer();
const port = Number(process.env.PORT) || 3001;
// without WRTC_WS_PORT the voice gateway shares PORT under /voice, so the whole instance is one port
const wrtcWsPort = Number(process.env.WRTC_WS_PORT) || undefined;
const production = process.env.NODE_ENV == "development" ? false : true;
server.on("request", app);

const api = new SpacebarServer({ server, port, production, app });
const cdn = new CDNServer({ server, port, production, app });
const gateway = new GatewayServer({ server, port, production, app });
const webrtc = new WebrtcServer({
    server: undefined,
    port: wrtcWsPort ?? port,
    production,
    noServer: !wrtcWsPort,
});
if (!wrtcWsPort) gateway.upgradeRoutes.set("/voice", (request, socket, head) => webrtc.handleUpgrade(request, socket, head));

ProcessLifecycle.eventEmitter.on("stopping", async () => {
    await gateway.stop();
    await cdn.stop();
    await api.stop();
    await webrtc.stop();
    server.close();
});

async function main() {
    await Monitoring.init();
    Monitoring.attach(app);
    app.use(ActivityHost);
    TestClientAssets(app);
    await initDatabase();
    await Config.init();

    const logRequests = process.env["LOG_REQUESTS"] != undefined;
    if (logRequests) {
        app.use(
            morgan("combined", {
                skip: (req, res) => {
                    let skip = !(process.env["LOG_REQUESTS"]?.includes(res.statusCode.toString()) ?? false);
                    if (process.env["LOG_REQUESTS"]?.charAt(0) == "-") skip = !skip;
                    return skip;
                },
            }),
        );
    }

    if (Config.get().client.useTestClient) app.get("/", (req, res) => res.redirect("/app"));

    // before the port opens, since the gateway and voice sockets are served from the moment it does
    await clearCallStateOnStartup();
    await new Promise((resolve) => void server.listen({ port }, () => resolve(undefined)));
    const httpsPort = Number(process.env.HTTPS_PORT) || port;
    if (process.env.TLS_CERT && process.env.TLS_KEY) {
        const bridge = (expressProto: object, nodeProto: object) =>
            Object.create(Object.create(nodeProto, Object.getOwnPropertyDescriptors(Object.getPrototypeOf(expressProto))), Object.getOwnPropertyDescriptors(expressProto));
        const http2App = Object.create(app, {
            request: { value: bridge(app.request, http2.Http2ServerRequest.prototype) },
            response: { value: bridge(app.response, http2.Http2ServerResponse.prototype) },
        });
        const secure = http2.createSecureServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY), allowHTTP1: true });
        secure.on("request", (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => {
            if (req.httpVersionMajor !== 2) return app(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
            req.headers.host ??= req.headers[":authority"];
            (app as unknown as { handle: (this: object, req: unknown, res: unknown) => void }).handle.call(http2App, req, res);
        });
        secure.on("upgrade", (req, socket, head) => server.emit("upgrade", req, socket, head));

        if (httpsPort === port) {
            const plain = server.listeners("connection")[0] as (socket: net.Socket) => void;
            server.removeAllListeners("connection");
            server.on("connection", (socket: net.Socket) => {
                socket.setTimeout(10000, () => socket.destroy());
                socket.once("data", (head: Buffer) => {
                    socket.setTimeout(0);
                    socket.pause();
                    socket.unshift(head);
                    if (head[0] === 0x16) secure.emit("connection", socket);
                    else plain.call(server, socket);
                    process.nextTick(() => socket.resume());
                });
            });
        } else await new Promise((resolve) => void secure.listen({ port: httpsPort }, () => resolve(undefined)));
        console.log(`[Server] ${green(`Serving HTTPS with HTTP/2 on port ${bold(httpsPort)}`)}`);
    }
    await Promise.all([api.start(), cdn.start(), gateway.start(), webrtc.start()]);
    TestClient(app);

    if (fs.existsSync("/proc/self/comm")) fs.writeFileSync("/proc/self/comm", `spacebar-bundle-${cluster.worker ? cluster.worker.id : port}`);
    process.title = `sb-bundle-${cluster.worker ? cluster.worker.id : port}`;

    console.log(`[Server] ${green(`Listening on port ${bold(port)}`)}`);
}

main().catch(console.error);
