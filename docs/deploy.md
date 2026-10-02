# Deploying

## Client assets

The bundled web client lives in `assets/cache` and is written by `npm run generate:client`. That command also runs `scripts/compress-client.js`, which writes a Brotli (quality 11) and a gzip copy of every JS, CSS, JSON, SVG and WASM file to `assets/cache_compressed`. The server picks the best encoding the browser accepts and falls back to compressing on the fly only for files that have no up-to-date copy.

If the cache was generated before the compression step existed, run it once by hand:

```sh
node scripts/compress-client.js
```

The script only recompresses files whose source changed, so rerunning it is cheap. `CLIENT_CACHE_PATH` and `CLIENT_COMPRESSED_PATH` override the input and output directories. The server reads `CLIENT_COMPRESSED_PATH` too.

With `NODE_ENV=production`, hashed asset names are served with `Cache-Control: public, max-age=31536000, immutable` and the HTML page with `no-cache` and an ETag. In development everything is `no-cache`.

## HTTPS and HTTP/2 without a proxy

Set `TLS_CERT` and `TLS_KEY` to PEM files to serve HTTPS with HTTP/2. By default HTTPS shares `PORT` with plain HTTP, and the server tells the two apart by the first byte of each connection. Set `HTTPS_PORT` to listen on a separate port instead. Gateway websockets keep working over both, because browsers open them as HTTP/1.1 upgrades.

```sh
TLS_CERT=/etc/ssl/fosscord.pem TLS_KEY=/etc/ssl/fosscord.key HTTPS_PORT=443 npm start
```

## Behind Caddy

Caddy gives HTTP/2 and HTTP/3 with automatic certificates. Its `reverse_proxy` passes websocket upgrades through, and `encode` skips responses that already carry a `Content-Encoding`, so the precompressed assets reach the browser as they are while API responses get compressed by Caddy.

```caddyfile
chat.example.com {
    encode zstd br gzip
    reverse_proxy localhost:3001
}
```

HTTP/3 needs UDP port 443 open in the firewall. Point `security.trustedProxies` in the config at Caddy's address so rate limits and sessions see the real client IP, and set the public endpoints (`api.endpointPublic`, `cdn.endpointPublic`, `gateway.endpointPublic`) to the `https://` and `wss://` URLs.
