# pion-sfu

Selective forwarding unit for voice, video and Go Live, vendored from [spacebarchat/pion-webrtc](https://github.com/spacebarchat/pion-webrtc) (AGPL-3.0). The voice gateway in `src/webrtc` talks to it over a unix socket.

Build it with Go 1.24 or newer:

```sh
cd extra/pion-sfu && go build -o pion-sfu .
```

Then point the server at the binary in `.env`:

```sh
PION_SFU_BIN=/path/to/extra/pion-sfu/pion-sfu
WRTC_PUBLIC_IP=203.0.113.10
WRTC_PORT_MIN=5000
```

The server starts the SFU itself, restarts it if it exits, and connects to it on `/tmp/spacebar-sfu-<WRTC_PORT_MIN>.sock` (override with `PION_SFU_IPC`). Media uses a single UDP port, `WRTC_PORT_MIN`. Set `PION_SFU_VERBOSE=1` to print the SFU log with pion debug output.

Changes from upstream: the IPC socket path is a flag (`-ipc`) so several servers can run on one machine, and pion logging defaults to warnings.
