# Activities

Activities are embedded apps that run in an iframe inside a voice channel or a DM call. The client already ships the whole Discord flow: the shelf behind the rocket button in the call controls, the activity panel, the "Join Activity" tile and the postMessage RPC bridge the Embedded App SDK talks to. The server provides the data and hosts the apps.

## Hosting

The client loads an activity from `<application id>.<ACTIVITY_APPLICATION_HOST>`. On Discord that host is `discordsays.com`. Here `src/bundle/TestClient.ts` sets it to `client.activityApplicationHost` from the config, and when that is empty to `//<instance host>`, so the Whiteboard on `chat.example.com` loads from `https://1234567890123456789.chat.example.com`. That needs a wildcard DNS record and a wildcard certificate for the instance host. Set `client.activityApplicationHost` to something like `activities.example.com` to keep activities on their own domain instead.

In development `*.localhost` resolves to 127.0.0.1, so `http://<id>.fosscord.localhost:3202` works without any setup.

`src/api/activities/ActivityHost.ts` runs before everything else in the bundle. A request whose host is an application id followed by the activity host is answered from that application's URL mappings and never reaches the client or the API. The path is matched with and without Discord's `/.proxy` prefix, and the longest matching prefix wins:

- `builtin://<name>` targets serve one of the activities bundled with the server.
- `https://` targets are reverse proxied with the request method, headers, cookies and body. WebSocket upgrades are not proxied yet.

- Any other target is a domain, optionally with a path, and is reverse proxied over https. The proxy refuses targets that resolve to a private address.

The mappings live in `embedded_activities.url_mappings`.

## Your own activities

Developers turn activities on for their app in the developer portal at `/developers`, under Activities. That sets the `EMBEDDED` application flag (`1 << 17`), creates the `embedded_activities` row with `on_shelf` off and adds a `launch` primary entry point command. The same page edits the URL mappings, the supported platforms and the age gate. Turning activities off clears the flag and keeps the row, so the activity host and launches stop answering until it is turned on again.

An activity starts out unreleased. Only the owner and the app testers (Applications > App Testers, friends of the owner, up to 50) can start it, and it shows up in their shelf. Anyone in the channel can still join a running instance. Release to everyone sets `EMBEDDED_RELEASED` (`1 << 1`) and lets anyone start it from the entry point command. The global shelf stays curated: only rows with `on_shelf` appear there for everyone.

## API

| Route                                                                         | Use                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /activities/shelf`                                                       | Activity configs, applications and image assets for every row with `on_shelf`, plus the user's own and tested unreleased activities.                    |
| `GET`, `PATCH /applications/:id/embedded-activity-config`                     | Owner only. Reads and edits the activity config: supported platforms, orientation locks, age gate, preview asset.                                       |
| `GET`, `PUT /applications/:id/proxy-config`                                   | Owner only. Reads and replaces the URL mappings as `{ url_map: [{ prefix, target }] }`.                                                                 |
| `GET`, `POST`, `DELETE /oauth2/applications/:id/allowlist`                    | Owner only. App testers, added by username.                                                                                                             |
| `POST /applications/:id/proxy-tickets`                                        | A signed ticket for the user, valid for 12 hours. The client appends it to the iframe URL as `discord_proxy_ticket`.                                    |
| `POST /interactions`                                                          | Running a primary entry point command whose handler is `DISCORD_LAUNCH_ACTIVITY` starts the activity. This is how the client starts one from the shelf. |
| `POST /activities/:channel_id/:application_id`                                | Joins the running instance, which is how "Join Activity" works.                                                                                         |
| `POST /applications/:id/activities/:location_id/instances/:instance_id/leave` | Leaves it.                                                                                                                                              |
| `GET /applications/:id/activity-instances/:instance_id`                       | Bot token only. Lets an activity backend check who is in an instance.                                                                                   |
| `GET /oauth2/applications/:id/rpc`, `GET /oauth2/applications/:id/assets`     | Application details the RPC bridge and the shelf ask for. Assets combine the app's Rich Presence assets with the activity's own images.                 |

A bot can also answer an interaction with callback type 12 (`LAUNCH_ACTIVITY`) to start its activity for the user who ran the command.

Launching needs a voice state in the channel, and in guilds the `USE_EMBEDDED_ACTIVITIES` permission. There is one instance per application and channel. A user is in at most one instance at a time, and leaving the voice channel or closing the gateway removes them. The instance ends when the last participant leaves. Every change is sent as `EMBEDDED_ACTIVITY_UPDATE_V2` to the guild, or to the DM recipients, and `READY_SUPPLEMENTAL` lists the running instances of each guild. Startup removes participants whose voice state is gone or belongs to another session.

## Whiteboard

`src/api/activities/whiteboard.ts` and `assets/activities/whiteboard` are a small shared whiteboard, registered on first start as an application owned by the `official` system account, with a `launch` entry point command. Its page does the RPC handshake, then reads `instance_id` and `discord_proxy_ticket` from its URL and talks to its own backend under `/.proxy/api`. The backend checks the ticket and that the user is a participant, streams strokes and cursors with server-sent events, and forgets a board once its instance ends. Boards live in the memory of the process that serves the activity host.

## Not done yet

- The RPC `AUTHORIZE` and `AUTHENTICATE` commands need OAuth2 access tokens: a code grant without a redirect URI, `POST /oauth2/token` and bearer tokens with scopes on `GET /oauth2/@me`. Until then activities only get the handshake and the commands that need no scope.
- An owner-facing endpoint to enable an application as an activity and edit its URL mappings, with checks that keep proxy targets off private addresses.
- Proxying WebSocket upgrades to external targets.
