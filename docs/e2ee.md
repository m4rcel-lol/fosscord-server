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

A new device registers as pending. Peers only encrypt to it after an existing device signs it (QR or short-code link over the gateway) or after the user restores the identity key from a recovery phrase.

The server rejects a send with `409 E2EE_DEVICE_MISMATCH` when the envelope skips an active device of any recipient, including the sender's own other devices. The client then refetches keys and re-encrypts before the UI sees a failure. This check only catches mistakes, the server is never trusted with confidentiality.

Safety numbers use Signal's numeric fingerprint (60 digits plus a QR code). A changed identity key blocks sending in that DM until the user acknowledges it, and a verified contact drops back to unverified.

New devices can't read older messages until phase 3 adds an opt-in key backup: a backup keypair derived from the recovery phrase with Argon2id, and every content key wrapped to it and uploaded.

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

## What it doesn't protect

The server ships the client JavaScript, so a malicious operator can ship a client that leaks keys. That is the limit of any E2EE on the web. Publishing the patch bundle hash and a pinning extension or desktop wrapper reduce it. Metadata is visible to the server: who talks to whom, when, sizes, reactions and read state. Contacts are trusted on first use until their safety numbers are compared. Discord's own analytics and Sentry code runs in the same page, so their payloads need auditing to keep plaintext out.

## Phases

0. Spikes: hook proof of concept with armored content, and a WebCrypto/HPKE proof of concept across Chrome, Firefox and Safari.
1. MVP for DMs and group DMs: server data, server API, message pipeline, client crypto core, client hooks, client UI.
2. Encrypted attachments and device linking.
3. Recovery phrase, key backup and history on new devices.
4. Hardening: React-level UI patches, bundle hash pinning, analytics audit, fuzzing, a cross-browser test matrix.
5. MLS for group DMs, then opt-in encrypted guild channels.
