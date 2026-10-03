<p align="center">
  <img width="100" src="assets/icon.png" />
</p>
<h1 align="center">Fosscord</h1>

Fosscord is a self-hosted server that speaks Discord's API and gateway. It serves the official Discord web client from a local copy, with Vencord loaded in front of it, and rebrands that client as your instance. The instance's name, icon and wordmark replace Discord's, and Nitro is called Premium. People sign up on your server, log in with the real Discord UI and use it the way they use Discord, without a Discord account.

The server is a fork of [Spacebar server](https://github.com/spacebarchat/server), written in TypeScript on Express 5, TypeORM and PostgreSQL. Voice and video go through a pion SFU written in Go. The client the server tracks is Discord web build 627798.

## What works

[docs/parity.md](docs/parity.md) lists 143 Discord features and what this server does with each one, checked against a running instance with the real client on 2026-10-03.

| Status      | Count | Meaning                                                    |
| ----------- | ----: | ---------------------------------------------------------- |
| working     |   123 | Checked through the API or by driving the client in Brave. |
| partial     |     7 | The core works, and the note says what is missing.         |
| not started |     2 | The client has it and the server doesn't answer it.        |
| excluded    |    11 | Left out on purpose, see the next section.                 |

Accounts, profiles, friends, DMs and group DMs, messages, threads and forums, servers with roles, permissions, AutoMod, onboarding and insights, voice and video with Go Live and DAVE encryption, bots, slash commands, OAuth2 apps, activities, settings sync and the admin dashboard all work.

The partial features need something from outside the server. SMS, connections, linked roles, Spotify and the GIF picker need provider credentials the operator adds. Game detection only works in the desktop app, and the explicit media filter saves its setting but nothing scans attachments. The two features not started, local RPC rich presence and Clips, both need the desktop app.

`scripts/dev/parity-probe.mjs` repeats the API side of the checklist. On a seeded dev server it runs 152 checks, and the GitHub connection is skipped when no provider is configured.

## What is different from Discord

- There are no Quests, Orbs, ads, sponsored content, download-the-app prompts or upsells. The Vencord plugins in `client/plugins` remove them from the client.
- Every account has Premium (Nitro) and every server is boost level 3 with 33 boosts. Nothing can be bought, and every Shop item is free.
- DMs and group DMs can be end-to-end encrypted. The design is in [docs/e2ee.md](docs/e2ee.md).
- Signing up needs only a username and a password. Email and date of birth are optional, and the operator can put a [Cap](https://capjs.js.org) captcha in front of registration, login and password reset.
- The instance has its own status page at `/status`, an admin dashboard at `/admin` and Web Push notifications for users with no tab open.

## Development

You need Node.js 26, PostgreSQL (17 is what we run) and, for voice and video, Go 1.24 or newer. The browser scripts below use `playwright-core` and Google Chrome or another Chromium build.

```sh
npm ci
npm run generate:client
scripts/dev/worktree-setup.sh 3001 fosscord
```

`npm ci` installs the dependencies and applies the fixes in `patches/`. `npm run generate:client` downloads the Discord web client into `assets/cache`, compresses it and builds Vencord with our plugins into `assets/vencord`. The download is about 300 MB. Building Vencord needs pnpm, and the script falls back to `corepack pnpm` or `npx pnpm` when `pnpm` isn't installed.

`worktree-setup.sh <port> <database>` does the rest. It writes `.env` and `config.json`, builds `extra/pion-sfu` when Go is installed, drops and creates the database as your system user on the local Postgres, builds the server, starts it and seeds two accounts with a DM and a server. It overwrites an existing `.env` and `config.json`. In a git worktree it also symlinks `node_modules` and `assets/cache` from the main checkout, so a worktree starts without its own install or download. Then open `http://fosscord.localhost:3001` and log in as `tester@fosscord.test` or `friend@fosscord.test`. The seed script writes their passwords to `scripts/dev/.test-account`.

To open the admin dashboard as the seeded user, give it the operator right:

```sh
psql fosscord -c "update users set rights = '1' where username = 'tester'"
```

### Scripts

| Command                                              | What it does                                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:src`                                  | Compiles `src` to `dist` and draws the default avatars.                                                                                                                                                     |
| `npm run build`                                      | `build:src`, then regenerates `assets/schemas.json` and `assets/openapi.json`.                                                                                                                              |
| `npm run build:vencord`                              | Rebuilds `assets/vencord` after a change to `client/plugins`, `client/vencord-patches` or `client/vencord.json`.                                                                                            |
| `npm run build:e2ee`                                 | Bundles `client/e2ee` into `assets/public/e2ee`.                                                                                                                                                            |
| `PORT=3001 scripts/dev/restart.sh`                   | Stops whatever listens on the port, starts the built server in the background and waits for `/api/ping`. `SERVER_LOG` sets the log file.                                                                    |
| `DB_NAME=fosscord PORT=3001 scripts/dev/reset-db.sh` | Stops the server and recreates the database. Start the server again to run the migrations.                                                                                                                  |
| `PORT=3001 node scripts/dev/seed.mjs`                | Registers the test accounts, a DM and a server with a few messages.                                                                                                                                         |
| `PORT=3001 node scripts/dev/parity-probe.mjs`        | Runs the parity checks against the API. A word after it runs only the checks whose name contains it, but many checks reuse what earlier ones created, so a filtered run can fail where the full run passes. |
| `PORT=3001 node scripts/dev/e2ee-test.mjs`           | Drives several browser profiles through encrypted DMs, key backup, recovery codes and device approval. Takes about five minutes.                                                                            |
| `PORT=3001 node scripts/dev/voice-probe.mjs`         | Joins two browsers to a voice channel and prints the audio each side sent and received. `--browser <path>` picks the browser.                                                                               |
| `PORT=3001 node scripts/dev/probe.mjs <path>`        | Opens a client page as the test user and prints its text, console errors and failed requests. `--shot <file>` saves a screenshot and `--as friend` switches account.                                        |
| `PORT=3001 npm run check:client`                     | Builds Vencord's reporter and checks that every patch still finds its target in the cached client. The first run checks out Vencord into `.vencord`, about 300 MB.                                          |

The browser scripts load `playwright-core` from `~/.cache/fosscord-tools`. Install it there once:

```sh
npm install --prefix ~/.cache/fosscord-tools playwright-core
```

`e2ee-test.mjs` and `check:client` use Google Chrome unless `CHROME_PATH` names another Chromium build. Recent Chrome releases on macOS quit headless sessions after about 30 seconds, and Brave works:

```sh
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" PORT=3001 node scripts/dev/e2ee-test.mjs
```

`scripts/dev` also has load and scale tests (`scale-*.mjs`, `seed-scale.mjs`, `seed-large.mjs`, `gateway-bench.mjs`, `perf.mjs`), a test bot and an OAuth2 example app.

## Deploying

[docs/deploy.md](docs/deploy.md) covers production. `docker-compose.yml` runs PostgreSQL, the server, the SFU and Caddy for TLS on one Linux host, and a one-shot service downloads the web client into a volume on the first start. The same guide covers updating, backups, the phone layout and running behind your own proxy.

## Configuration

`CONFIG_PATH` in `.env` points the server at a JSON file. The server fills in every missing key with its default and writes the file back, so you only need to set what you change. With `CONFIG_PATH` unset the configuration lives in the database. The admin dashboard edits the same values. These keys are specific to this project:

| Key                              | What it controls                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.instanceName`            | The name that replaces Discord in every string, the page title and the wordmark. `Fosscord` by default.                                                                                                                                                                                                                                                                                                        |
| `client.icon`, `client.logo`     | Square icon and wordmark, as a URL or a path relative to the repository root. The icon falls back to `general.image`, then `assets/icon.png`.                                                                                                                                                                                                                                                                  |
| `client.helpUrl`                 | Where help links go. Without it the help button is hidden.                                                                                                                                                                                                                                                                                                                                                     |
| `client.experiments`             | Map from client experiment name to the variant to assign.                                                                                                                                                                                                                                                                                                                                                      |
| `client.activityApplicationHost` | Host activities load from, see [docs/activities.md](docs/activities.md).                                                                                                                                                                                                                                                                                                                                       |
| `security.captcha`               | Set `enabled: true`, `service: "cap"`, `instance` to the URL of a Cap Standalone server and `sitekey` and `secret` to its keys. The server verifies at `<instance>/<sitekey>/siteverify`. Registration then asks for a captcha, and `login.requireCaptcha` and `passwordReset.requireCaptcha` add it to login and password reset. `service` also accepts `hcaptcha` and `recaptcha`, which need no `instance`. |
| `limits.rate`                    | Rate limits, on by default. `ip`, `global`, `error` and `identify` are instance-wide, and `routes` has a bucket per route group, each with a `count`, a `window` in seconds and an optional separate `GET` or `bot` count. Buckets are stored in Postgres.                                                                                                                                                     |
| `limits.e2ee`                    | Envelope size and device count caps, the pending device lifetime, and hourly limits for device registrations, device updates and key queries.                                                                                                                                                                                                                                                                  |
| `security.webPush`               | Web Push on or off, and the VAPID keys, which the server generates on first start.                                                                                                                                                                                                                                                                                                                             |
| `guild.safety`                   | Harmful link domains and the thresholds for join, DM and mention raid detection.                                                                                                                                                                                                                                                                                                                               |
| `integrations.gifs.klipy`        | The Klipy API key behind the GIF picker.                                                                                                                                                                                                                                                                                                                                                                       |

[docs/client-patches.md](docs/client-patches.md) has more on the branding keys and [docs/deploy.md](docs/deploy.md) on the environment variables.

## The Discord client

This repository holds no Discord code. `npm run generate:client` downloads the web client from discord.com to `assets/cache` on your own machine, and the Docker setup downloads it into a volume on the first start. `assets/cache`, `assets/cache_compressed` and `assets/vencord` are listed in `.gitignore` and `.dockerignore`. Discord owns that code, so don't commit it, publish it or put it in an image. Our changes live in this repository as Vencord plugins, a few string rewrites in `scripts/client.js` and the scripts in `assets/client_patches`, and they are applied to each local copy.

## Architecture

| Part              | Where                                        | What it does                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API               | `src/api`                                    | The REST API under `/api/v9`, plus the admin, status, developer portal and legal pages.                                                                                                                               |
| Gateway           | `src/gateway`                                | The websocket that sends events to clients.                                                                                                                                                                           |
| CDN               | `src/cdn`                                    | Attachments, avatars, icons, emojis and stickers.                                                                                                                                                                     |
| Voice gateway     | `src/webrtc`                                 | Discord's voice websocket protocol, including DAVE. It sends media setup to the SFU over a unix socket.                                                                                                               |
| SFU               | `extra/pion-sfu`                             | A Go selective forwarding unit, vendored from spacebarchat/pion-webrtc. It carries voice, video and Go Live on one UDP port. The server starts it when `PION_SFU_BIN` is set.                                         |
| Bundle            | `src/bundle`                                 | Runs all of the above in one process on one port, with the voice gateway under `/voice` unless `WRTC_WS_PORT` gives it its own port. It can also serve HTTPS and HTTP/2 itself.                                       |
| Web client server | `src/bundle/TestClient.ts`                   | Serves the cached client with precompressed files, sets `GLOBAL_ENV` to this instance, injects Vencord and the client patch scripts, and swaps Discord's images for the instance's.                                   |
| Vencord layer     | `client/plugins`, `client/vencord-patches`   | Vencord is built from a pinned commit with our source patches and plugins. The plugins strip upsells and tracking, apply the branding, and fix the parts of the client that assume discord.com.                       |
| E2EE client       | `client/e2ee`, `client/plugins/fosscordE2ee` | The encryption code, bundled with esbuild and loaded by `assets/client_patches/10-e2ee-loader.js`. It hooks the client's message pipeline, and the plugin adds the lock button, safety numbers and the settings page. |
| Shared code       | `src/util`, `src/database`, `src/schemas`    | Config, entities, migrations and the request and response schemas the API validates against.                                                                                                                          |

`extra/admin-api`, a C# admin API, and the Nix files are inherited from Spacebar. Nothing in the Docker or development setup uses them, and the admin dashboard at `/admin` talks to the API in `src/api`.

## Contributing

Read [CONTRIBUTING.MD](CONTRIBUTING.MD) for the branch and commit conventions and the checks to run before you push.

## License

AGPL-3.0-only, see [COPYING](COPYING). The code from before the fork is by Spacebar and its contributors.
