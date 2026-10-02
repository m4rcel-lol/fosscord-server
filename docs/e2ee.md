# End-to-end encrypted messages

Discord has no encrypted text, only DAVE for voice and video. This is the plan for adding our own, DMs and group DMs first, guild channels later.

## Protocol

The MVP uses a sealed box per recipient device. For every message the sending client:

1. generates a random 256-bit content key and encrypts the payload once with AES-256-GCM,
2. wraps the content key to each recipient device's signed X25519 prekey with HPKE base mode (DHKEM X25519, HKDF-SHA256, AES-256-GCM),
3. signs the envelope with its Ed25519 device key.

Everything runs on WebCrypto with non-extractable keys in IndexedDB. HPKE comes from `@hpke/core` and `@hpke/dhkem-x25519` (MIT). If they refuse non-extractable keys, HPKE base mode is about 100 lines on top of WebCrypto and gets checked against the RFC 9180 test vectors.

The MVP has no per-message forward secrecy. Weekly prekey rotation with old private prekeys deleted after 30 days gives a coarse version of it. The upgrade path is MLS (RFC 9420) through `ts-mls` (MIT, pure TypeScript) behind envelope version 2, used first for group DMs and then guild channels. The MVP's identity and device keys become the MLS credentials, so verification carries over. We skip a Signal-style double ratchet because guild channels would need a second protocol anyway.

## Keys

- User identity key, Ed25519, one per user. It signs device records, and safety numbers are computed over it, so verifying a contact once covers all their devices.
- Device signing key, Ed25519, one per browser profile.
- Signed prekey, X25519, rotated every 7 days.

A new device registers as pending. Peers only encrypt to it once the identity key signs it. The new device gets the identity key from the key backup, unlocked by the account password, by a recovery code, or by another device approving it over the gateway. The next section covers all three.

The server ties each device to the session that registered it, and the client re-links its stored device to the current session every time it loads. Logging a session out, whether from that browser, from Logged-in Devices or through a password change, revokes the devices that no longer belong to a live session, so senders stop wrapping keys to them.

The server rejects a send with `409 E2EE_DEVICE_MISMATCH` when the envelope skips an active device of any recipient, including the sender's own other devices. The client then refetches keys and re-encrypts before the UI sees a failure. This check only catches mistakes, the server is never trusted with confidentiality.

Safety numbers use Signal's numeric fingerprint (60 digits plus a QR code). A changed identity key blocks sending in that DM until the user acknowledges it, and a verified contact drops back to unverified.

## Key backup and new devices

Every browser profile and origin is its own device. Without a backup, a new device can't sign itself and can't read anything sent before it existed. The key backup fixes both, and it's on by default.

The device that holds the identity key creates a random 32-byte backup secret and an X25519 backup keypair. The server stores one `E2eeKeyBackup` row per user:

- the identity private key and the backup private key, each sealed with AES-256-GCM under a key derived from the backup secret with HKDF,
- the backup public key, signed by the identity key so peers can check it,
- the backup secret itself, sealed under a key derived from the password or the recovery code, with the KDF name, its parameters and a random 16-byte salt,
- a version number, so two devices can't overwrite each other's changes.

Content keys reach the backup in two ways. Every new envelope carries a `backup` list with the content key sealed to each member's backup public key, covered by the envelope signature. For older messages, a device that can read a message uploads its content key sealed to its own backup key into `E2eeBackupKey`, one row per user and message id. The sealed key is bound to the user, the message id and the envelope signature, so an edit invalidates the old row. When a device first gets the backup key it walks the history of every encrypted conversation once and uploads what's missing.

### Password mode

This is the default. The client patch hooks `POST /auth/login`, `POST /auth/register` and `PATCH /users/@me` in the HTTP client, so it sees the password before it leaves the browser and uses it only after the server accepts it. It derives a 32-byte key with Argon2id from `hash-wasm` (64 MiB, 3 iterations, parallelism 1) and the salt in the backup row. Nothing derived from the password goes to the server, only the sealed secret.

- After the first login, the device creates the identity and the backup in one go.
- A device that holds the identity but never saw the password, such as a session from before the backup existed or a QR login, doesn't create a backup without a sealed secret. It shows a notice above the composer in encrypted conversations and a field in Settings > Encryption that ask for the password, checks it with `POST /users/@me/e2ee/password`, and then creates or seals the backup.
- On a new browser, logging in fetches the backup, unseals the secret, restores the identity key, signs the new device and decrypts the history. There are no prompts.
- A password change reseals the backup secret under the new password with a fresh salt. The backup keypair stays, so no content key needs resealing. If the browser doing the change doesn't hold the secret, it unseals it with the old password first.
- If a device holds the secret and logs in with a password that doesn't open the backup, it reseals the backup with that password, since the login just proved it's correct.

Users from before the backup existed have an identity key that WebCrypto created as non-extractable, so it can't be put in a backup. On the next login the device holding it creates a new identity key, signs a rotation statement with the old one, re-signs all devices that the old key had signed, and then creates the backup. Peers accept a rotation signed by the identity key they already trust without a safety number warning and keep the verified state. Other devices of the same user follow the rotation the same way.

### Recovery-code mode

In Settings > Encryption the backup can switch to a recovery code: 32 characters from Crockford's base32 alphabet, about 160 bits, shown once as a grid of four-character groups. The code only replaces the password lock after the user clicks "I saved it", and the dialog can't be closed with Escape or a backdrop click while the code is on screen. The secret is then sealed under HKDF-SHA256 of the code, and the password no longer opens it. A new browser shows the unlock dialog after login and asks for the code. Switching back to the password asks for it and checks it with `POST /users/@me/e2ee/password` before resealing, which works for accounts without an email.

### Resetting encryption

When the recovery code is lost and no other browser can approve a new one, the unlock dialog and the settings page offer "Reset encryption". After a warning and the account password, the browser generates a new identity key and calls `POST /users/@me/e2ee/reset` with the password and the new public key. The server checks the password, revokes every device, deletes the backup and the stored message keys and stores the new identity in one request, so another online device can't race it with an identity of its own. The browser wipes its local keys, signs a new device and creates a new password-mode backup. Old messages stay unreadable everywhere, other browsers of the user need approval again, and contacts see a safety number change.

### Approving from another device

A locked device sends `E2EE_LINK_REQUEST` through `POST /users/@me/e2ee/link`, which the server relays to the user's own sessions only. The exchange commits to the new device's ephemeral key before the approver reveals its own, so the server can't grind a matching code:

1. The new device sends a request with its name and the SHA-256 of an ephemeral X25519 public key.
2. Each online device that holds the backup secret answers with its own ephemeral public key. Tabs of one browser share the device, so only one of them answers: the tabs elect a leader with the Web Locks API and talk over a `BroadcastChannel`. The leader does the key exchange and the other tabs show the same prompt and code, forwarding Approve and Deny to it.
3. The new device takes the first answer and reveals its public key. The approver checks it against the commitment.
4. Both sides show a six-digit code computed from the request id and both public keys. The approver shows "New login on Chrome on macOS" with Approve and Deny.
5. Approve seals the backup secret with AES-GCM under HKDF of the X25519 shared secret. The new device unseals it and continues as if it had entered the password. Deny revokes the pending device on the server.

The new device repeats its request every 10 seconds for 5 minutes, so a device that comes online later still gets the prompt. It sends one request per browser, from the leader tab. When it unlocks another way, the user clicks "Not now" or the tab closes, it sends a `cancel` stage, a keepalive `fetch` on `pagehide` in the last case, and the prompt disappears on every other device.

### Devices

Every device row remembers the session that registered it, and `GET /users/@me/e2ee?device_id=` updates it when the same browser signs in again. The state endpoint adds the session's last activity and location to the user's own devices. Removing a device in the settings asks for confirmation, revokes it and logs its session out. A browser that finds its own device revoked deletes its identity key, backup secret, device key and prekeys, so it has to go through the password, the recovery code or an approval again. Pending devices are revoked once their session is gone or after 7 days.

The settings are in User Settings, under Encryption, next to Data & Privacy, and also open from the safety numbers dialog.

### What the user sees

Messages that are waiting for keys show "Decrypting…" and fill in on their own through a local `MESSAGE_UPDATE` once the keys arrive. On a locked browser a message shows "Unlock this browser to read this message", and on an unlocked browser that lacks the key it shows "Sent before this browser was set up". Both have a button that opens the unlock dialog: the password or recovery code field, the approval status and code, and the reset link. A locked browser never sends plaintext into an encrypted conversation. Pressing Enter keeps the text in the composer, opens the unlock dialog and shows a notice above the composer. Notices sit in one bar above the composer, the way Discord shows slowmode, and only one shows at a time. Closing the unlock dialog with Not now or Escape stops it from opening on its own in that browser for seven days. The Unlock buttons, the composer notice and the Unlock this browser button in the encryption settings still open it.

## Message format

Encrypted messages carry a new `encrypted` field. `content` holds a fallback string the server writes itself, so mentions, search and push notifications never see plaintext.

```json
{
  "content": "🔒 Encrypted message",
  "nonce": "...",
  "flags": 4,
  "encrypted": {
    "v": 1,
    "alg": "x25519-hpke-aes256gcm-ed25519",
    "sender_device": "...",
    "iv": "...",
    "ct": "...",
    "keys": [{ "user_id": "...", "device_id": "...", "prekey_id": 3, "enc": "...", "wrapped": "..." }],
    "sig": "..."
  }
}
```

The AEAD additional data binds the channel id, the sender, the sender device and the nonce, so a ciphertext can't be moved to another channel or replayed. Encrypted messages never get link embeds. Reactions, pins, typing, read states and reply structure stay in plaintext.

The encrypted payload is JSON with `content` and, when the message has them, `attachments` and `stickers`. Polls and clips aren't encrypted, so the attach menu disables "Create Poll" and clips in an encrypted DM and the server rejects them there.

### Attachments

Files go through Discord's normal cloud upload flow, and the client rewrites each step in the HTTP client hook:

1. `POST /channels/:id/attachments` gets a random `.bin` file name, the ciphertext size, `application/octet-stream` as the content type and no `X-Discord-Original-MD5` header. The client remembers the upload by its `upload_url` and `upload_filename`.
2. The `PUT` to the upload URL carries the file encrypted with a fresh AES-256-GCM key and nonce. The file is cut into 64 KiB chunks, each sealed with the nonce XORed with the chunk index and an AAD that names the index and marks the last chunk, so chunks can't be reordered or dropped. Before encrypting, the client reads the width and height of images and the size and duration of videos.
3. The message send replaces each attachment with `{ id, filename, uploaded_filename }`, where `filename` is the `.bin` name. The real file name, content type, size, dimensions, alt text, spoiler flag, voice message duration and waveform, and the key and nonce go into the encrypted payload. Stickers move from `sticker_ids` into the payload as `{ id, name, format_type }`.

The server only accepts attachments in an encrypted channel when the stored name matches `[a-z0-9]+.bin`, the content type is `application/octet-stream`, there are no dimensions and the request carries no alt text, title, waveform, duration, spoiler or clip fields. It answers anything else with `E2EE_PLAINTEXT_ATTACHMENT`.

After decrypting a message, the client matches each payload entry to the server attachment with the same `.bin` name and rewrites the attachment with the real metadata and a virtual URL, `/e2ee/attachments/<channel>/<attachment>/<name>`, as both `url` and `proxy_url`. A service worker registered at `/e2ee-sw.js` with root scope answers those URLs. On a miss it asks the open tabs over a `MessageChannel` for the real CDN URL and the key, downloads the ciphertext, decrypts it and keeps up to 256 MiB of plaintext in memory. It ignores the query strings Discord appends, answers `Range` requests so videos and voice messages can seek, and serves only images, video, audio and PDF with their own type. Text types are served as `text/plain`, everything else as an `application/octet-stream` download, and every response carries `nosniff` and a sandboxing CSP, so a hostile file can't run script on the instance's origin. Discord asks for video thumbnails with `?format=`, and the worker answers those with the first frame, which the tab that asked renders on a canvas. Encryption waits for the worker to control the page, for up to 8 seconds, before it reports ready. The server answers `/e2ee/attachments/*` with a 404, so a page without the worker shows a broken file instead of the app.

Edits keep the attachments of the decrypted original in the new payload. Removing one attachment sends a `PATCH` with only the kept attachment ids and `.bin` names and re-encrypts the payload without the removed entry. A message whose decrypted content is empty, such as a sticker or a voice message, is refreshed through Vencord's `updateMessage` after a local `MESSAGE_UPDATE`, because Discord's partial message update ignores empty content and sticker changes.

Search in an encrypted DM never reaches the server. The client answers `GET /channels/:id/messages/search` and `POST /channels/:id/messages/search/tabs` itself from the decrypted copies of the last 1000 messages, matching every word of the query and the author filter.

## Client integration

A small loader in `assets/client_patches/10-e2ee-loader.js` pushes a fake chunk into `webpackChunkdiscord_app` to get the bundle's module require, then finds modules by shape and never by numeric id, since ids change every build:

- the Flux dispatcher, through `addInterceptor`, for history, pins, search and mention loads,
- the gateway socket's `getDispatchHandler`, wrapping the `preload` step of `MESSAGE_CREATE` and `MESSAGE_UPDATE`. The socket only flushes events whose preload has finished, so async decryption can't reorder messages, and notifications see plaintext,
- the HTTP client object with `get`, `post`, `put`, `patch` and `del`, to decrypt REST responses,
- the message queue's `drain`, to encrypt sends and edits.

The heavy code is bundled with esbuild into `assets/public/e2ee/e2ee.js`. The `fosscordE2ee` Vencord plugin connects it to Discord's own UI: a pre-send hook that keeps a refused message in the composer, the attach menu changes, a message re-render hook for decrypted messages, and the Encryption page in User Settings. When the loader can't find a hook it shows an "E2EE unavailable in this client build" banner and refuses to send in encrypted channels. It never falls back to plaintext. `scripts/e2ee-anchors.js` checks the anchor strings after every `npm run generate:client`.

The UI adds a lock after each decrypted message, a lock button in the DM header that turns encryption on (one way, so it can't be downgraded) and shows a check once every member is verified, safety numbers with a QR code and a verify button, key-change notices, and an Encryption page in User Settings for the key backup, the recovery code and the device list.

## Server work

- Entities `E2eeIdentity` and `E2eeDevice`, a channel encryption state, and a nullable `encrypted` jsonb column on messages, plus a migration.
- Routes under `users/@me/e2ee` for the identity, devices and prekeys, `POST /e2ee/keys/query` limited to users who share a channel or relationship, and `PUT /channels/:id/e2ee`.
- `handleMessage` validates envelopes. It checks the shape, a 64 KiB size limit, that the sender device belongs to the sender and isn't revoked, and that no recipient device is missing. Then it forces the fallback content, empty embeds and the suppress-embeds flag. It also rejects plaintext sends into encrypted channels, and rejects forwards, polls, plaintext stickers, attachments that aren't opaque `.bin` files, and components there.
- Gateway events `E2EE_DEVICES_UPDATE`, `E2EE_IDENTITY_UPDATE`, `CHANNEL_E2EE_UPDATE` and `E2EE_LINK_REQUEST`/`E2EE_LINK_RESPONSE`.
- `POST /users/@me/e2ee/password` to check the account password and `POST /users/@me/e2ee/reset` to start over with a new identity. `PUT /channels/:id/e2ee` answers `E2EE_RECIPIENT_NO_DEVICES` with the `user_ids` that have no active device, so the client can name them.
- Rate limits for key queries, device registration, prekey rotation, password checks and resets.
- `E2eeKeyBackup` and `E2eeBackupKey`, with `GET`, `PUT` and `PATCH /users/@me/e2ee/backup`, `POST /users/@me/e2ee/backup/keys` and `POST /users/@me/e2ee/backup/keys/query`. All of them only touch the caller's own rows. Uploads are capped at 100 keys a request and only accepted for encrypted messages in the caller's channels. `PUT /users/@me/e2ee/identity` accepts a rotation when it's signed by the current identity key.

## What it doesn't protect

The server ships the client JavaScript, so a malicious operator can ship a client that leaks keys. That is the limit of any E2EE on the web. Publishing the patch bundle hash and a pinning extension or desktop wrapper reduce it. Metadata is visible to the server: who talks to whom, when, sizes, reactions and read state. For files that includes the number of attachments, each ciphertext size, which is the file size plus 16 bytes per 64 KiB, and the voice message flag. Sticker images still load from the instance's CDN, so the server sees which sticker a client renders. Contacts are trusted on first use until their safety numbers are compared. Discord's own analytics and Sentry code runs in the same page, so their payloads need auditing to keep plaintext out.

Password mode trades some of that protection for convenience. Whoever holds a copy of the database has the salt and the sealed secret, so they can guess passwords offline, at the cost of one 64 MiB Argon2id run per guess. A weak or reused password makes the encryption about as strong as that password. Recovery-code mode avoids this, because 160 random bits can't be guessed, but losing the code and every signed-in device means losing the history. The backup secret also sits in each unlocked browser's IndexedDB, so malware with access to the profile can read it there.

## Phases

0. Spikes: hook proof of concept with armored content, and a WebCrypto/HPKE proof of concept across Chrome, Firefox and Safari.
1. MVP for DMs and group DMs: server data, server API, message pipeline, client crypto core, client hooks, client UI.
2. Device linking and encrypted attachments, stickers and voice messages. Done.
3. Key backup with password and recovery-code modes, device approval and history on new devices. Done.
4. Hardening: React-level UI patches, bundle hash pinning, analytics audit, fuzzing, a cross-browser test matrix.
5. MLS for group DMs, then opt-in encrypted guild channels.
