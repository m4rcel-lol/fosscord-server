# Deploying

## Docker Compose

`docker-compose.yml` and `Dockerfile` at the repository root run a complete public instance on one Linux host. There are five services:

| Service    | Image                                        | What it does                                                                                                                     |
| ---------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:18-alpine`                         | The database.                                                                                                                    |
| `client`   | `fosscord-server`, built from `Dockerfile`   | Runs before the server starts. Downloads the Discord web client into the `client` volume when it is empty, then exits.           |
| `sfu`      | `fosscord-sfu`, the Go stage of `Dockerfile` | The pion SFU from `extra/pion-sfu`. It carries voice, video and Go Live media on a single UDP port.                              |
| `server`   | `fosscord-server`                            | The bundle: API, CDN, gateway, voice gateway and the web client, all on port 3001 inside the compose network.                    |
| `caddy`    | `caddy:2-alpine`                             | Terminates TLS with automatic certificates, serves HTTP/1.1, HTTP/2 and HTTP/3, compresses responses and proxies the websockets. |

Only Caddy and the SFU publish ports. The server and Postgres are reachable inside the compose network and nowhere else.

### Before you start

- A Linux host with Docker Engine and the compose plugin.
- A DNS record for the instance's domain pointing at the host. Caddy asks Let's Encrypt for a certificate when it starts and keeps retrying until the record resolves.
- These ports open in the firewall: 80/tcp for the ACME challenge and the HTTPS redirect, 443/tcp, 443/udp for HTTP/3, and the voice port, 50000/udp unless you change `WRTC_PORT`.

### First start

```sh
git clone <this repository> fosscord && cd fosscord
cp .env.example .env
$EDITOR .env
docker compose up -d --build
```

On the first start the `client` service runs `scripts/client.js`, `scripts/e2ee-anchors.js`, `scripts/clan-badges.js` and `scripts/compress-client.js`, the same steps `npm run generate:client` runs. Vencord, the last step of `npm run generate:client`, is built into the image instead, from the pinned commit in `client/vencord.json` and the plugins in `client/plugins`. The download is about 300 MB and 12,000 files, and compressing them takes another minute. Nothing from Discord ends up in the image or in git. Follow it with:

```sh
docker compose logs -f client
```

The server starts when the client service has exited, and Caddy starts when the server answers `/api/ping`. `docker compose ps` shows every service as `healthy` once the instance is up. Open `https://<DOMAIN>/register` to make the first account.

When `docker compose` runs from a checkout that also has a development `.env`, pass the production file explicitly with `docker compose --env-file prod.env ...`, because compose reads `.env` from the project directory by default.

### Environment

Every variable lives in `.env`. `.env.example` lists all of them.

| Variable                                             | Required | Meaning                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                                             | yes      | Host name the instance is served on, such as `chat.example.com`. Caddy requests the certificate for it and the server builds every public URL from it.                                                                                                                     |
| `POSTGRES_PASSWORD`                                  | yes      | Password of the `fosscord` database user. It goes into a connection URL, so stick to letters and digits, `openssl rand -hex 24` for example. Postgres only reads it when the volume is empty, so changing it later also needs `ALTER USER` inside Postgres.                |
| `WRTC_PUBLIC_IP`                                     | yes      | Public IPv4 address clients send voice and video to. The SFU announces it in its ICE candidates. Behind NAT, use the outside address and forward the voice port to the host.                                                                                               |
| `WRTC_PORT`                                          | no       | UDP port for all media, 50000 by default. It is published on the host under the same number, because the SFU announces the port it listens on.                                                                                                                             |
| `INSTANCE_NAME`                                      | no       | Name shown in the client, emails, the developer portal and the status page. Sets `general.instanceName` and `client.instanceName`.                                                                                                                                         |
| `CADDY_GLOBAL_OPTIONS`                               | no       | One line added to Caddy's global options block. `local_certs` makes Caddy sign the certificate with its own CA, for testing without a public domain. `email you@example.com` sets the ACME account email.                                                                  |
| `TRUSTED_PROXIES`                                    | no       | Express `trust proxy` value for `security.trustedProxies`. The default, `uniquelocal`, trusts the private ranges Docker networks use, so the server reads the client address Caddy puts in `X-Forwarded-For`.                                                              |
| `CAP_INSTANCE_URL`, `CAP_SITE_KEY`, `CAP_SECRET_KEY` | no       | A [Cap Standalone](https://capjs.js.org/guide/standalone/) server, the site key and its secret. With all three set, registration asks for a Cap captcha. The server verifies at `<CAP_INSTANCE_URL>/<CAP_SITE_KEY>/siteverify`, and the browser has to reach the same URL. |
| `SMTP_HOST`                                          | no       | Turns on email through SMTP. Without it the instance sends no email, and signup only needs a username and a password.                                                                                                                                                      |
| `SMTP_PORT`                                          | no       | 465 when `SMTP_SECURE=true`, otherwise 587.                                                                                                                                                                                                                                |
| `SMTP_SECURE`                                        | no       | `true` for implicit TLS, usually on port 465.                                                                                                                                                                                                                              |
| `SMTP_STARTTLS`                                      | no       | Without `SMTP_SECURE`, the connection requires STARTTLS unless this is `false`.                                                                                                                                                                                            |
| `SMTP_USERNAME`, `SMTP_PASSWORD`                     | no       | SMTP login.                                                                                                                                                                                                                                                                |
| `EMAIL_FROM`                                         | no       | Sender address. Defaults to `noreply@<DOMAIN>`.                                                                                                                                                                                                                            |
| `CLIENT_CONCURRENCY`                                 | no       | Parallel downloads when the client service fetches the web client, 8 by default.                                                                                                                                                                                           |
| `LOG_REQUESTS`                                       | no       | Status codes the server logs requests for, `500,501` by default.                                                                                                                                                                                                           |
| `REVISION`, `REVISION_TIME`                          | no       | Commit hash and commit time in Unix seconds, written to `.rev` in the image so the server reports which commit it runs. Fill them with `git rev-parse HEAD` and `git log -1 --format=%ct`.                                                                                 |

### Configuration file

The server keeps its configuration in `/data/state/config.json` in the `state` volume. Before every start, `scripts/docker-configure.js` writes the values that come from the environment into it: the public endpoints for the API, CDN and gateway, the voice region endpoint `<DOMAIN>/voice`, the trusted proxies, and, when their variables are set, the instance name, Cap and SMTP. Everything else in the file stays as you or the admin panel left it. To change another setting, edit the file and restart the server:

```sh
docker run --rm -it -v fosscord_state:/state alpine vi /state/config.json
docker compose restart server
```

Unsetting `CAP_*` or `SMTP_*` later leaves the old values in the file, so turn those off in the admin panel or in the file.

### Data

| Volume                       | Holds                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `postgres`                   | The database.                                                                |
| `state`                      | `config.json` and `jwt.key`, the key pair that signs session tokens.         |
| `storage`                    | Everything the CDN stores: attachments, avatars, icons, emojis and stickers. |
| `client`                     | The downloaded web client and its Brotli and gzip copies. It can be rebuilt. |
| `sfu`                        | The unix socket the server and the SFU talk over.                            |
| `caddy_data`, `caddy_config` | Certificates, the ACME account and Caddy's internal CA.                      |

Losing `state` signs every user out and rotates the secrets in the config. Back up `postgres`, `state` and `storage` together:

```sh
docker compose exec -T postgres pg_dump -U fosscord fosscord | gzip > fosscord-$(date +%F).sql.gz
docker run --rm -v fosscord_state:/state -v fosscord_storage:/storage -v "$PWD":/backup alpine \
    tar czf /backup/fosscord-files-$(date +%F).tar.gz /state /storage
```

Compose prefixes volume names with the project name, `fosscord` here, set by `name:` in `docker-compose.yml`.

### Updating

```sh
git pull
REVISION=$(git rev-parse HEAD) REVISION_TIME=$(git log -1 --format=%ct) docker compose build
docker compose up -d
```

Migrations run when the server starts. The web client in the `client` volume stays the same across updates, because the client service only downloads it when the volume is empty.

### Updating the web client

```sh
docker compose run --rm client client --force
docker compose restart server
```

This fetches whatever build discord.com serves at that moment. Our Vencord plugins and `client/e2ee` find their targets in Discord's code by pattern, and `docs/client-patches.md` names the build they were last checked against. A newer build can break some of them. The client service prints a warning when the e2ee anchors are missing, and the e2ee plugin then refuses to send in encrypted channels. To run exactly the client you tested in development, copy your local cache into the volume instead of fetching:

```sh
docker compose stop server
docker run --rm -v fosscord_client:/data/client alpine rm -rf /data/client/cache /data/client/cache_compressed
docker run --rm -v fosscord_client:/data/client -v "$PWD/assets/cache":/src:ro alpine cp -a /src/. /data/client/cache/
docker run --rm -v fosscord_client:/data/client alpine chown -R 1000:1000 /data/client
docker compose run --rm client
docker compose up -d
```

Without `--force`, the client service keeps the files it finds and only writes the missing compressed copies.

### Voice and video

The server talks to the SFU over `/run/sfu/sfu.sock` in the shared `sfu` volume. If the SFU restarts, the server closes the voice connections of the calls that were running with code 4015, the code Discord uses for a crashed voice server, and reconnects to the new SFU. The SFU accepts one server connection, so leave `THREADS` unset in the server environment.

Clients send media straight to `WRTC_PUBLIC_IP:WRTC_PORT` over UDP, so that address has to be reachable from the internet. There is no TURN server, so a client behind a firewall that blocks outgoing UDP cannot join calls.

### Trying it locally

Caddy's internal CA and a made-up domain are enough to run the whole stack on one machine:

```sh
cat > local.env <<EOF
DOMAIN=fosscord.test
POSTGRES_PASSWORD=local
WRTC_PUBLIC_IP=127.0.0.1
CADDY_GLOBAL_OPTIONS=local_certs
EOF
docker compose --env-file local.env up -d --build --wait
docker compose --env-file local.env cp caddy:/data/caddy/pki/authorities/local/root.crt caddy-root.crt
curl --cacert caddy-root.crt --resolve fosscord.test:443:127.0.0.1 https://fosscord.test/api/ping
```

For a browser, add `127.0.0.1 fosscord.test` to `/etc/hosts` and trust `caddy-root.crt`, or start Chromium with `--host-resolver-rules="MAP fosscord.test 127.0.0.1" --ignore-certificate-errors`.

This setup was tested on Docker Desktop for macOS, once with build 626571 copied into the client volume and once with build 627798 fetched by the client service. On both, these worked through Caddy over HTTP/2: signup over the API, login on the real login page, a DM sent from the client and received by a second user's raw gateway websocket, the same message read back over the API, and a voice call between two browsers through the SFU container with audio received on both sides. An attachment uploaded through Caddy came back from the CDN byte for byte. `/api/ping` also answered over HTTP/3, and Caddy advertised `h3` in `Alt-Svc`. Restarting the SFU container made the server log the lost socket and reconnect within a few seconds.

## Client assets

The bundled web client lives in `assets/cache` and is written by `npm run generate:client`. That command also runs `scripts/compress-client.js`, which writes a Brotli (quality 11) and a gzip copy of every JS, CSS, JSON, SVG and WASM file to `assets/cache_compressed`. The server picks the best encoding the browser accepts and falls back to compressing on the fly only for files that have no up-to-date copy.

If the cache was generated before the compression step existed, run it once by hand:

```sh
node scripts/compress-client.js
```

`node scripts/client.js --missing` keeps the cached `index.html` and only downloads assets the cached build references but the cache lacks, such as the WebAssembly modules webpack loads by hash (`<hash>.module.wasm`). Run it when `assets/cacheMisses` lists files the client asked for and the server had to fetch from Discord.

The compression script only recompresses files whose source changed, so rerunning it is cheap. `CLIENT_CACHE_PATH` and `CLIENT_COMPRESSED_PATH` override the input and output directories. The server reads `CLIENT_COMPRESSED_PATH` too.

With `NODE_ENV=production`, hashed asset names are served with `Cache-Control: public, max-age=31536000, immutable` and the HTML page with `no-cache` and an ETag. In development everything is `no-cache`.

## Phones and tablets

The official Discord apps for Android and iOS can't be pointed at another server, so on a phone people use the instance in the browser. The web client has a phone layout of its own and switches to it when the user agent belongs to a phone or tablet. The server and channel lists sit in a drawer behind the menu button, settings open full screen, and the message box has a send button. On Android it's a plain text area and on iOS the usual rich editor. Login, registration, invites and server templates all fit the screen.

We checked build 627798 in a 390 by 844 touch viewport with Android Chrome, Samsung Internet and iOS Safari user agents. A tap on the message box focused it, typed text went in and the send button posted it. The drawer, settings and the friends list opened, a voice channel joined and connected, a signed-in user accepted an invite and stayed in the browser, and a signed-out user got the register form on the invite page.

The stock client sent phones to the Discord app in two places, and `FosscordMobileWeb` (`client/plugins/fosscordMobileWeb`) fixes both:

- Invite and template links rendered a page whose only button opened `discordapp.onelink.me`, which hands off to the Discord app or the app store. The plugin renders the invite and template pages desktop browsers get, so the invite is accepted and the server is created right in the browser. Below 486 pixels it also stacks the two columns of the template page.
- Discord enables voice only for browsers its browser detection names Chrome, Firefox, Opera, Safari or Microsoft Edge. On Android that library reports `Chrome Mobile`, `Firefox Mobile`, `Opera Mobile` or `Samsung Internet`, so a tap on a voice channel did nothing. The plugin drops the ` Mobile` suffix and treats Samsung Internet as the Chrome version in its user agent. iOS Safari already passed.

`FosscordNoAppUpsells` removes the download prompts on every platform, phones included.

The server also rewrites Discord's viewport tag to add `interactive-widget=resizes-content`. With it, Chrome and Firefox on Android shrink the page when the on-screen keyboard opens instead of sliding it up, so the channel header stays visible above the message box. Safari ignores the key. Headless browsers have no on-screen keyboard, so we haven't tested this part.

### Installing to the home screen

The client page links `/manifest.webmanifest`, which has the instance name from `client.instanceName`, `/app` as the start page, `display: standalone` and icons at 192 and 512 pixels. `/assets/pwa/icon-180.png`, `icon-192.png` and `icon-512.png` draw the instance icon (`client.icon`, then `general.image`, then `assets/icon.png`) at 62% of the width on `#121214`, the colour of the client's title bar. The margin keeps the icon inside the circle Android crops maskable icons to, so the manifest offers the same images for both the `any` and `maskable` purposes. iOS takes the 180 pixel version from the `apple-touch-icon` link and the name from `apple-mobile-web-app-title`. The server draws the icons with jimp, an optional dependency, and keeps them in memory per icon and size. An icon jimp can't read, such as an SVG or WebP file, falls back to `assets/icon.png`.

Browsers only offer to install a site served over HTTPS or from localhost. Chrome's DevTools protocol reported no installability errors for this manifest. In Chrome or Samsung Internet on Android, open the browser menu and choose "Add to Home screen" or "Install app". On iOS, tap Share in Safari and choose "Add to Home Screen". The installed app opens without browser chrome and needs a connection, because there's no service worker cache for offline use.

## HTTPS and HTTP/2 without a proxy

Set `TLS_CERT` and `TLS_KEY` to PEM files to serve HTTPS with HTTP/2. By default HTTPS shares `PORT` with plain HTTP, and the server tells the two apart by the first byte of each connection. Set `HTTPS_PORT` to listen on a separate port instead. Gateway websockets keep working over both, because browsers open them as HTTP/1.1 upgrades.

```sh
TLS_CERT=/etc/ssl/fosscord.pem TLS_KEY=/etc/ssl/fosscord.key HTTPS_PORT=443 npm start
```

## Behind Caddy

Caddy gives HTTP/2 and HTTP/3 with automatic certificates. Its `reverse_proxy` passes websocket upgrades through, and `encode` skips responses that already carry a `Content-Encoding`, so the precompressed Brotli assets reach the browser as they are while Caddy compresses API responses with zstd or gzip. Stock Caddy has no Brotli encoder, and `encode br` fails to load without the `caddy-cbrotli` plugin.

```caddyfile
chat.example.com {
    encode zstd gzip
    reverse_proxy localhost:3001
}
```

`docker/Caddyfile` is the configuration the compose stack uses. It also keeps websockets on `/`, `/voice` and `/remote-auth` open for five minutes when Caddy reloads its configuration.

HTTP/3 needs UDP port 443 open in the firewall. Point `security.trustedProxies` in the config at Caddy's address and set `security.forwardedFor` to `X-Forwarded-For`, so rate limits, sessions and the gateway see the real client IP. Set the public endpoints (`api.endpointPublic`, `cdn.endpointPublic`, `gateway.endpointPublic`) to the `https://` and `wss://` URLs, and the voice region endpoint in `regions.available` to `<domain>/voice`.
