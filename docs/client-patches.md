# Client patches

The test client is Discord's own web client, cached in `assets/cache` by `npm run generate:client`. We change it in three places, and almost everything belongs in the first one.

1. Vencord plugins in `client/plugins`. Vencord is built from a pinned commit and loaded before Discord's bundle, so its patcher rewrites webpack modules as they register. This is where Quests, ads, Nitro and Server Boost upsells, download prompts, the phone browser fixes in FosscordMobileWeb, which keep invite and template links in the browser instead of handing off to the Discord app and let Android browsers join voice, the data collection toggles, instance branding, the verified AI, OFFICIAL and SYSTEM name tags, the app component fixes in FosscordApps, the Go Live quality a browser stream announces to viewers, which FosscordGoLive takes from the capture constraints instead of the client's 4K 120 fps default, the Krisp noise cancellation model URLs, which FosscordCore points at this instance's `/krisp_browser_models` route instead of Discord's CDN, and the browser notification permission prompt, which FosscordNotifications shows when desktop notifications are turned on, and the Server Insights page, where FosscordInsights drops the 500 member minimum and the link to Discord's developer portal and adds charts for members, messages, voice, top channels and invites, are handled. FosscordModals puts the dimmed backdrop under everything else in its layer container, because a modal that is closed and reopened before its exit animation ends gets its backdrop mounted after the modal, where it would block every click. It lowers the backdrop rather than raising the modals, so the popouts opened from a modal, such as color pickers and dropdowns, stay on top of it.
2. Static rewrites in `scripts/client.js`. They run once over the cached files, and only cover what has to be fixed before any script runs: the `https:` to `location.protocol` URL fixes, the remote auth URL and the guard that stops Discord from deleting `window.localStorage`.
3. Plain scripts in `assets/client_patches`, injected in name order after Vencord. Only code that doesn't touch Discord's modules lives here: the e2ee loader, the Web Push subscriber described in [notifications.md](notifications.md) and the email verification and QR login pages.

## Building

`npm run build:vencord` runs `scripts/vencord.js`, which:

- checks out `commit` from `client/vencord.json` into `.vencord/src` (override with `VENCORD_DIR`),
- applies the source fixes in `client/vencord-patches/*.patch`,
- copies `client/plugins/*` into Vencord's `src/userplugins`,
- installs dependencies with Vencord's own pnpm (falling back to `corepack pnpm` or `npx pnpm`),
- builds the web target and writes `assets/vencord/vencord.js`, `vencord.css` and the Monaco files for the QuickCSS editor.

`npm run generate:client` runs it after downloading the client. Both `.vencord/` and `assets/vencord/` are gitignored. `src/bundle/TestClient.ts` serves `assets/vencord` and adds the script right after `GLOBAL_ENV`, so it runs before any Discord code. If the file is missing the client still loads, just without the plugins, and the server logs a warning. The page also leaves out Discord's Sentry bundle and its preload link. Vencord's NoTrack plugin would stop it anyway, but only by throwing an uncaught error on every load. `GLOBAL_ENV.WEBAUTHN_ORIGIN` is set to the page's hostname, which is the relying party ID the server uses for passkeys, so the client's passkey signal calls stop failing with a relying party mismatch.

The default set leaves out every plugin that talks to a third-party service on load or on use (ReviewDB, Decor, Translate, USRBG, ClearURLs, Dearrow and similar), so with the defaults the client only ever contacts this instance. `client/vencord-patches/no-donor-badges.patch` removes the one request core Vencord makes on its own, the donor badge list from `badges.vencord.dev`. `no-cloud.patch` drops the Cloud settings page and skips cloud settings sync on the web build, since it would talk to `api.vencord.dev` and OAuth against discord.com. `no-donate-card.patch` removes the donation and contributor cards from the Vencord settings tab, which also loaded their images from Discord's CDN. `instance-branding.patch` adds a `brand()` helper to `@utils/types` that swaps Discord for the instance name and Nitro for Premium. `definePlugin` and `definePluginSettings` run every plugin and option description through it, and so do the crash handler toasts and the hardcoded copy in the Vencord, Plugins and Themes tabs. The same patch hides FakeNitro, since every account already has Nitro. `who-reacted-real-channels.patch` stops WhoReacted from fetching reactors for messages outside a real channel, such as the Accessibility preview in channel 1337. `no-silenttype-command.patch` removes the `/silenttype` command that SilentTyping adds to the slash picker, so the picker only lists Discord's built-ins and app commands. Silent typing can still be toggled from the chat input context menu. A source patch must not add new files, because the build only resets tracked files before it applies the patches again.

`vencord.js` starts with a small script that seeds the default plugin set from the `plugins` and `settings` keys of `client/vencord.json`. A default is applied once per browser and recorded in the `FosscordVencordSeeded` localStorage key, so a user who turns a plugin off keeps it off, and a plugin added to the defaults later still reaches existing users. A plugin's default can also be an object of plugin settings, such as `{ "enabled": true, "isEnabled": false }`. Each distinct object is applied once, so changing it reaches existing users one more time. Our own plugins are `required`, so they can't be turned off.

To move to a newer Vencord, change `commit` in `client/vencord.json`, rebuild and run the check below.

## Adding a patch

Put it in the plugin that matches what it removes, or create `client/plugins/<name>/index.ts` with an AGPL header and `definePlugin({ name, description, authors: [FosscordAuthor], required: true, patches })`. Shared helpers are in `client/plugins/fosscordCore/shared.tsx`:

- `hideSetting(key)` hides a node of the settings layout by its `SettingsSections` key (`BILLING_SECTION`, `DATA_USAGE_STATISTICS_SETTING`, ...). Pass `{ replacesPredicate: true }` when the node already has a `usePredicate`.
- `hideNotices([...])` turns off notice bars by their `NoticeTypes` name.
- `redirectHome` and `redirectTo(path)` render a redirect, for routes that should not exist.

A patch has a `find`, a string or regex that picks the one module to patch, and one or more `{ match, replace }` replacements. Rules that keep patches working across Discord updates:

- Anchor on things Discord doesn't minify: enum and constant names (`.GUILD_BOOSTS`, `"nitro-tab-group"`), analytics names, route names, intl message hashes.
- Write minified identifiers as `\i`. Never put a minified name such as `tk.n` in a `find` string, use a regex `find` instead.
- A string `find` must only occur in the module you want. Vencord applies a patch to the first module that contains it and then drops the patch, so a second module with the same text makes the real target silently unpatched.
- Reference translated strings as `#{intl::KEY}`, or as `#{intl::HASH::raw}` when only the hash is known. Search `assets/cache` for the English text to find the hash.
- Never match hashed CSS class names like `container__5287f`. They change on every Discord build.
- Prefer removing an element where it is created, `null&&` in front of a `jsx(...)` call works well, over hiding it with CSS.

`npm run build:vencord` rebuilds, and with `NODE_ENV=development` the server reloads the page source on the next request. A patch whose `match` finds nothing logs `Patch by <plugin> had no effect` to the browser console.

## Checking patches after a Discord update

`npm run check:client` builds Vencord's reporter variant and runs `scripts/vencord-check.mjs`. It needs a running server (`ORIGIN`, default `http://localhost:$PORT`) and `playwright-core` (from the repo or `~/.cache/fosscord-tools`). The check opens `/login` in headless Chrome with the reporter build in place of the normal one. The reporter enables every Vencord plugin, loads every lazy chunk, runs every lazy webpack lookup and logs each patch that matched no module, had no effect or threw. The check script adds the one case the reporter skips, a patch marked `all` whose `find` matches no module at all.

The output groups problems into our plugins, upstream plugins in our default set and the other upstream plugins. It exits with code 1 when either of the first two groups has a problem or the reporter never finishes, so a Discord update that breaks a patch fails loudly. The full result is written to `assets/vencord/report.json`. A run takes one to four minutes.

Google Chrome 154 on macOS quits headless sessions after about 30 seconds. Point `CHROME_PATH` at another Chromium build, for example `CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"`.

On build 626571 (October 2026) with Vencord `7f0c10c`, every upstream patch and every one of ours matches. The one upstream failure was the `SettingsRouter` lookup, which still asked for `USER_SETTINGS_MODAL_KEY`. Discord no longer exports it, which broke `Ctrl+,` in WebKeybinds and the settings links in BetterSessions and Decor, so `client/vencord-patches/settings-router.patch` drops that key.

Build 627798 broke three more upstream lookups, and four patches in `client/vencord-patches` fix them:

- `sticker-paste-find.patch`. StickerPaste found its module by `.stickers,previewSticker:`, which now only occurs in Discord's sticker helper module, so its patch never reached the chat input function that decides whether a picked sticker is sent or attached. The find is now `isReplacement:null!=`, which only the chat input has. With the plugin on, picking a sticker attaches it to the message box instead of sending it.
- `role-color-member-list.patch`. Discord moved the member list role header out of the member list module into its own module, which renders the role icon, the role name and the member count as separate spans. RoleColorEverywhere now finds that module by its `"\xa0\u2014 "` separator and sets the role color on the header row, so the name and the count both take it. The thread member list still has the old inline header, and the plugin's `THREAD_BROWSER_PRIVATE` patch still colors that one.
- `better-role-context-member-list.patch`. BetterRoleContext lost its context menu on the same header. The reporter could not see this, because the old patch still matches the header of the thread member list. The new patch adds the menu to the server member list header as well.
- `user-profile-actions.patch`. Discord's profile modal module now only exports `openUserProfileModal`, and closing the modal is a `USER_PROFILE_MODAL_CLOSE` dispatch in another module. `UserProfileActions` now looks the module up by `openUserProfileModal` alone. `openUserProfile` in `@utils/discord` goes through it, and TypingTweaks and ServerInfo from the default set call that to open a profile.

The check now reports no failures on build 627798. RoleColorEverywhere, StickerPaste and BetterRoleContext stay out of the default set, because Discord shows none of these by itself: it doesn't color member list role headers or user mentions, and it sends a sticker as soon as it is picked from an empty message box.

## Branding

These `client.*` config keys control what the client shows in place of Discord's brand:

| Key            | Default      | Used for                                                                                                                                                                              |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instanceName` | `"Fosscord"` | Every translated string, the page title, the wordmark and the authenticator app issuer.                                                                                               |
| `icon`         | `null`       | Square icon on the Home button, the loading screen, the wordmark, the login QR code and the favicon. Falls back to `general.image`, then to the built-in vector of `assets/icon.png`. |
| `logo`         | `null`       | Wordmark on the login, register, OAuth and invite pages. Without it the wordmark is the icon followed by `instanceName`.                                                              |
| `helpUrl`      | `null`       | Where the `?` button and every Discord help center link go. Without it the button and standalone help links are hidden, and help links inside a sentence render as plain text.        |

`icon` and `logo` take an `http(s)` URL or a file path relative to the repository root, such as `assets/logo.png`. The server serves the icon at `/static/logo.png`, the path the status and admin pages already use, and the wordmark at `/static/wordmark`. It passes their URLs to the client as `GLOBAL_ENV.INSTANCE_ICON` and `INSTANCE_LOGO`, next to `INSTANCE_NAME` and `HELP_URL`. The page is rendered again when any of these change.

### Strings

`FosscordBranding` wraps every translation module in `brandMessages` (`client/plugins/fosscordBranding/messages.ts`), which walks the compiled message tree and rewrites only the text, never argument names, tag names or link targets. It replaces Discord with the instance name, Nitro with Premium, `discord.gg/` with this instance's `/invite/` URL and `discord.com` with its host. It handles the inflected forms the translations use: Finnish and Croatian case endings, Hungarian `Nitró` forms, Czech `Nitra` and `Nitru`, Turkish apostrophe suffixes, the Thai and Japanese transliterations and the uppercase `DISCORD`. It leaves the Crisis Text Line keyword (`Text DISCORD to 741741`) and email addresses such as `privacy@discord.com` alone. A few hardcoded strings outside the translations get their own patches: the document title, the platform name list and the `otpauth://` issuer used for authenticator apps. The OAuth consent page drops the joke scope Discord adds to the list at random, such as "Solve a mystery with Scooby and the gang", so it only lists the scopes the app asked for.

### Images

Some Discord logos are image files, not React components, so the server swaps them. `src/bundle/TestClient.ts` serves `/assets/favicon.ico` from the instance icon, and `BRANDED_ASSETS` replaces the wordmarks on the login, register and invite pages (`131c318dd45b7aa4.svg`, and `bbbc3d376d38e7bc.svg` in the narrow layout) and the logo in the centre of the login QR code (`dd05fd1ea37e7747.png`) with SVGs drawn from the instance icon and `client.instanceName`, or redirects to `client.logo` when it is set. The file names change when Discord updates the client, so after `npm run generate:client` open `/login` and check that both images still show the instance logo. The logo in the app itself, on the Home button, the Direct Messages title and the soundboard category, comes from `FosscordBranding`, which swaps the path of Discord's logo icon. The plugin also replaces the loading screen video with the instance icon. The home screen icons and the web app manifest come from the server too, see "Installing to the home screen" in `docs/deploy.md`.

### Default avatars

The client's `DEFAULT_AVATARS` point at `/embed/avatars/0.png` to `5.png` on this instance's CDN. `npm run build:src` runs `scripts/default-avatars.js`, which uses sharp to cut the instance icon out of six coloured squares and writes them to `dist/default-avatars`. It reads the icon from `DEFAULT_AVATAR_ICON`, then from `client.icon` or `general.image` in the file at `CONFIG_PATH` when that is a local path, then from `assets/icon.png`. Without sharp the CDN draws the same avatars as SVG.
