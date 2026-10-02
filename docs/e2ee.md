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
- On a new browser, logging in fetches the backup, unseals the secret, restores the identity key, signs the new device and decrypts the history. There are no prompts.
- A password change reseals the backup secret under the new password with a fresh salt. The backup keypair stays, so no content key needs resealing. If the browser doing the change doesn't hold the secret, it unseals it with the old password first.
- If a device holds the secret and logs in with a password that doesn't open the backup, it reseals the backup with that password, since the login just proved it's correct.

Users from before the backup existed have an identity key that WebCrypto created as non-extractable, so it can't be put in a backup. On the next login the device holding it creates a new identity key, signs a rotation statement with the old one, re-signs all devices that the old key had signed, and then creates the backup. Peers accept a rotation signed by the identity key they already trust without a safety number warning and keep the verified state. Other devices of the same user follow the rotation the same way.

### Recovery-code mode

In the encryption settings panel the backup can switch to a recovery code: 32 characters from Crockford's base32 alphabet, about 160 bits, shown once in groups of four. The secret is then sealed under HKDF-SHA256 of the code, and the password no longer opens it. A new browser shows the unlock dialog after login and asks for the code. Switching back to the password asks for it and checks it with a throwaway login before resealing.

### Approving from another device

A locked device sends `E2EE_LINK_REQUEST` through `POST /users/@me/e2ee/link`, which the server relays to the user's own sessions only. The exchange commits to the new device's ephemeral key before the approver reveals its own, so the server can't grind a matching code:

1. The new device sends a request with its name and the SHA-256 of an ephemeral X25519 public key.
2. Each online device that holds the backup secret answers with its own ephemeral public key.
3. The new device takes the first answer and reveals its public key. The approver checks it against the commitment.
4. Both sides show a six-digit code computed from the request id and both public keys. The approver shows "New login on Chrome on macOS" with Approve and Deny.
5. Approve seals the backup secret with AES-GCM under HKDF of the X25519 shared secret. The new device unseals it and continues as if it had entered the password.

The new device repeats its request every 10 seconds for 5 minutes, so a device that comes online later still gets the prompt.

### What the user sees

Messages that are waiting for keys show "Decrypting…" and fill in on their own through a local `MESSAGE_UPDATE` once the keys arrive. A message this browser can't decrypt shows "Sent before this browser was set up" with an Unlock button that opens the unlock dialog: the password or recovery code field, plus the approval status and code. A locked browser still never sends plaintext into an encrypted conversation. The send fails with a banner that has the same Unlock button.

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

The AEAD additional data binds the channel id, the sender, the sender device and the nonce, so a ciphertext can't be moved to another channel or replayed. Attachments get their own keys and upload as opaque `.bin` files. A service worker serves the decrypted bytes on a virtual path, because Discord's image components append query strings that break `blob:` URLs. Encrypted messages never get link embeds. Reactions, pins, typing, read states and reply structure stay in plaintext.

## Client integration

A small loader in `assets/client_patches/10-e2ee-loader.js` pushes a fake chunk into `webpackChunkdiscord_app` to get the bundle's module require, then finds modules by shape and never by numeric id, since ids change every build:

- the Flux dispatcher, through `addInterceptor`, for history, pins, search and mention loads,
- the gateway socket's `getDispatchHandler`, wrapping the `preload` step of `MESSAGE_CREATE` and `MESSAGE_UPDATE`. The socket only flushes events whose preload has finished, so async decryption can't reorder messages, and notifications see plaintext,
- the HTTP client object with `get`, `post`, `put`, `patch` and `del`, to decrypt REST responses,
- the message queue's `drain`, to encrypt sends and edits.

The heavy code is bundled with esbuild into `assets/public/e2ee/e2ee.js`. When the loader can't find a hook it shows an "E2EE unavailable in this client build" banner and refuses to send in encrypted channels. It never falls back to plaintext. `scripts/e2ee-anchors.js` checks the anchor strings after every `npm run generate:client`.

The UI adds a lock on decrypted messages, a lock button in the DM header that turns encryption on (one way, so it can't be downgraded), safety numbers with a verify button, key-change banners and a device settings panel.

## Server work

- Entities `E2eeIdentity` and `E2eeDevice`, a channel encryption state, and a nullable `encrypted` jsonb column on messages, plus a migration.
- Routes under `users/@me/e2ee` for the identity, devices and prekeys, `POST /e2ee/keys/query` limited to users who share a channel or relationship, and `PUT /channels/:id/e2ee`.
- `handleMessage` validates envelopes. It checks the shape, a 64 KiB size limit, that the sender device belongs to the sender and isn't revoked, and that no recipient device is missing. Then it forces the fallback content, empty embeds and the suppress-embeds flag. It also rejects plaintext sends into encrypted channels, and rejects forwards, polls, stickers and components there.
- Gateway events `E2EE_DEVICES_UPDATE`, `E2EE_IDENTITY_UPDATE`, `CHANNEL_E2EE_UPDATE` and `E2EE_LINK_REQUEST`/`E2EE_LINK_RESPONSE`.
- Rate limits for key queries, device registration and prekey rotation.
- `E2eeKeyBackup` and `E2eeBackupKey`, with `GET`, `PUT` and `PATCH /users/@me/e2ee/backup`, `POST /users/@me/e2ee/backup/keys` and `POST /users/@me/e2ee/backup/keys/query`. All of them only touch the caller's own rows. Uploads are capped at 100 keys a request and only accepted for encrypted messages in the caller's channels. `PUT /users/@me/e2ee/identity` accepts a rotation when it's signed by the current identity key.

## What it doesn't protect

The server ships the client JavaScript, so a malicious operator can ship a client that leaks keys. That is the limit of any E2EE on the web. Publishing the patch bundle hash and a pinning extension or desktop wrapper reduce it. Metadata is visible to the server: who talks to whom, when, sizes, reactions and read state. Contacts are trusted on first use until their safety numbers are compared. Discord's own analytics and Sentry code runs in the same page, so their payloads need auditing to keep plaintext out.

Password mode trades some of that protection for convenience. Whoever holds a copy of the database has the salt and the sealed secret, so they can guess passwords offline, at the cost of one 64 MiB Argon2id run per guess. A weak or reused password makes the encryption about as strong as that password. Recovery-code mode avoids this, because 160 random bits can't be guessed, but losing the code and every signed-in device means losing the history. The backup secret also sits in each unlocked browser's IndexedDB, so malware with access to the profile can read it there.

## Phases

0. Spikes: hook proof of concept with armored content, and a WebCrypto/HPKE proof of concept across Chrome, Firefox and Safari.
1. MVP for DMs and group DMs: server data, server API, message pipeline, client crypto core, client hooks, client UI.
2. Encrypted attachments and device linking.
3. Key backup with password and recovery-code modes, device approval and history on new devices. Done.
4. Hardening: React-level UI patches, bundle hash pinning, analytics audit, fuzzing, a cross-browser test matrix.
5. MLS for group DMs, then opt-in encrypted guild channels.
