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

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
    const data = (() => {
        try {
            return event.data?.json() ?? {};
        } catch {
            return { body: event.data?.text() };
        }
    })();
    event.waitUntil(
        self.registration.showNotification(data.title || "New message", {
            body: data.body || "",
            icon: data.icon,
            badge: "/static/logo.png",
            tag: data.tag,
            renotify: !!data.tag,
            timestamp: Date.now(),
            data: { url: data.url || "/channels/@me" },
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = new URL(event.notification.data?.url || "/channels/@me", self.location.origin);
    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const open = windows.find((client) => new URL(client.url).origin === url.origin);
            if (!open) return self.clients.openWindow(url.href);
            open.postMessage({ type: "fosscord-notification-click", path: url.pathname });
            return open.focus();
        })(),
    );
});
