# Notifications

The Discord client decides on its own whether a message shows a desktop notification, plays a sound or adds a badge. The server's part is to send the data that decision reads, to keep the notification settings and read states in sync between sessions, and to reach users who have no tab open. That last part, Web Push, is our own addition, since Discord's web client has no push support.

## Desktop notifications

`MESSAGE_CREATE` carries `mentions`, `mention_roles`, `mention_everyone`, `flags` and the author's `member`, which is everything the client's notification check reads. It also needs the user's notification settings from `READY` and `USER_GUILD_SETTINGS_UPDATE`.

On the web the client starts with desktop notifications set to "never". Turning on Settings > Notifications > Enable Desktop Notifications only flips that setting. Build 627798 never calls `Notification.requestPermission`, so a browser that hadn't granted the permission before would stay silent. The `FosscordNotifications` plugin patches the client's `setDesktopType` action to ask for the permission inside that click.

## Notification settings

Server settings live in `members.settings`. DM and group DM settings (`guild_id` `null`, sent to `PATCH /users/@me/guilds/@me/settings`) live in `users.private_channel_settings`. Both routes accept partial channel overrides such as `{ "muted": true, "mute_config": {...} }` or `{ "collapsed": true }`, and fill in the missing fields. Updates take a row lock, because the client fires several bulk `PATCH /users/@me/guilds/settings` requests at once when the notification modal changes more than one field.

`message_notifications: 3` means "use the server default". New members get 3, and a migration moved members who never touched their settings to 3. The client doesn't resolve 3 at the server level and would show no radio button selected, so every entry the server sends replaces 3 with the guild's `default_message_notifications`. `READY` leaves out guilds whose settings were never changed (`version` 0). The client then falls back to the guild's live default, which is what Discord does.

`mobile_push` ("Mobile Push Notifications" in the server notification modal) has no mobile app behind it here. It turns Web Push on or off for that server.

## Mention counts and badges

`read_states.mention_count` is what `READY` hands the client for its red badges, so it has to agree with what the client counts live. A message counts as a mention for a user when:

- it's a DM or group DM they're in,
- it mentions them directly,
- it mentions a role they have and they haven't turned on `suppress_roles`,
- it's `@everyone`, or `@here` while they have a connected session, and they haven't turned on `suppress_everyone`.

The author is never counted, nor are users who blocked or ignored the author or who can't view the channel. In threads, `@everyone` and `@here` only reach thread members, and private threads only count their members. Everything else, such as muted channels hiding their badge, is the client's job.

## Inbox

The Mentions tab reads `GET /users/@me/mentions`. It skips the user's own messages, respects channel overwrites and private thread membership, and leaves out mentions dismissed with `DELETE /users/@me/mentions/:message_id`. Dismissals are stored in `mention_dismissals` and sent to the user's other sessions as `RECENT_MENTION_DELETE`.

The Unreads tab is built by the client from read states and needs nothing extra. The For You tab isn't part of this client build: the endpoint table lists `/users/@me/notification-center/items`, but no code requests it, so the server doesn't implement it.

## Read states across sessions

Acking a channel (`POST /channels/:id/messages/:message_id/ack` or `POST /read-states/ack-bulk`) sends `MESSAGE_ACK` to every session of the user, so opening a channel in one browser clears its unread marker and badge in the others. "Mark as unread" sends `manual: true` with the mention count to restore, and the other sessions get the same values.

## Threads and message requests

Thread notification levels are the thread member `flags` (`ALL_MESSAGES` 2, `ONLY_MENTIONS` 4, `NO_MESSAGES` 8), set with `PATCH /channels/:id/thread-members/@me/settings` and sent back as `THREAD_MEMBER_UPDATE`. A joined thread without an explicit level follows its parent channel, and threads the user hasn't joined never notify.

A DM from someone who isn't a friend lands in Message Requests. The client counts it on the Message Requests row and never shows a desktop notification for it, and Web Push skips it too.

## Web Push

Discord's web client has no service worker and no push hook, so two pieces outside the client add one:

- `assets/client_patches/75-web-push.js` runs on every page. Once the user is logged in and the browser has granted notification permission, it registers `/notifications-sw.js` with the scope `/notifications-sw/`, so it doesn't replace the e2ee service worker at `/`, subscribes with the instance's VAPID key and sends the subscription to `POST /users/@me/devices` as `{ "provider": "webpush", "token": "<subscription JSON>" }`. It runs again when the permission changes or the stored token changes, and it unsubscribes after a logout.
- `assets/public/notifications/sw.js` shows the notification and, on click, focuses an open tab and tells it to navigate to the message, or opens a new one.

`GET /users/@me/devices/web-push` returns `{ enabled, public_key }`. The device row is tied to the session that registered it, so logging out or removing the session from Devices deletes it. `POST /users/@me/devices` also stores the `gcm` and `apns` tokens mobile clients send, without delivering anything to them.

Every new message runs through `dispatchMessagePush` after `MESSAGE_CREATE` goes out. It only looks at users who have a Web Push device and belong to the channel's guild or DM, then drops:

- users with a connected gateway session, since their open tab shows a desktop notification already,
- users whose status is Do Not Disturb,
- messages sent with `@silent` and ephemeral messages,
- message requests, blocked or ignored authors and channels the user can't view,
- servers with `mobile_push` turned off.

What's left follows the same rules as the client. A DM always notifies unless it's muted, and a muted DM still notifies on a direct mention. In servers, a channel or category override takes precedence over the server level, which takes precedence over the server default. "All messages" notifies for everything unless something in that chain is muted, "Only @mentions" notifies for mentions (as defined above), and "Nothing" never notifies. Threads use the thread member flags first.

The payload is about 400 bytes of JSON: `title` ("name (#channel, Server)" or the sender's name for DMs), `body` with mentions and custom emoji turned into text, the sender's avatar as `icon`, the channel id as `tag` and the message URL. It's encrypted with `aes128gcm` (RFC 8291) and signed with a VAPID JWT (RFC 8292), both done with `node:crypto`. A `404` or `410` from the push service deletes the device.

### Configuration

| Key                                | Default   | Meaning                                                                                                                           |
| ---------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `security.webPush.enabled`         | `true`    | Turns Web Push off without touching the stored devices.                                                                           |
| `security.webPush.vapidPublicKey`  | generated | P-256 public key, base64url. Generated on first start and written to the config. Changing it makes every browser subscribe again. |
| `security.webPush.vapidPrivateKey` | generated | The matching private key.                                                                                                         |
| `security.webPush.subject`         | `null`    | VAPID contact, a `mailto:` or `https:` URL. Defaults to `mailto:push@<api host>`. Set a real address on a public instance.        |

Push endpoints have to be public `https` URLs. `security.allowPrivateNetworkRequests` lifts that, which the local test needs.

### Browser support

Browsers only allow push on `https` origins and on `localhost`. Chrome, Edge and Firefox work out of the box. Brave needs "Use Google services for push messaging" turned on in its privacy settings, otherwise subscribing fails with "push service error". Safari on macOS works from version 16. On iOS, push only works after the site is added to the home screen.

### Testing

`PORT=<port> node scripts/dev/notifications-test.mjs` checks mention counts, DM settings, mention dismissal and Web Push against a running dev server. For the push part it starts a fake push service on `127.0.0.1`, decrypts what the server sends and checks the VAPID signature, so the config needs `security.allowPrivateNetworkRequests: true`. Without it the push part is skipped.
