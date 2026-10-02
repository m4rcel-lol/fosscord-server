# Client patches

The test client is Discord's own web client, cached in `assets/cache` by `npm run generate:client`. We change it in three places, and almost everything belongs in the first one.

1. Vencord plugins in `client/plugins`. Vencord is built from a pinned commit and loaded before Discord's bundle, so its patcher rewrites webpack modules as they register. This is where Quests, ads, Nitro and Server Boost upsells, download prompts, the data collection toggles, instance branding and the verified AI tag are handled.
2. Static rewrites in `scripts/client.js`. They run once over the cached files, and only cover what has to be fixed before any script runs: the `https:` to `location.protocol` URL fixes, the remote auth URL and the guard that stops Discord from deleting `window.localStorage`.
3. Plain scripts in `assets/client_patches`, injected in name order after Vencord. Only code that doesn't touch Discord's modules lives here: the e2ee loader and the email verification and QR login pages.

## Building

`npm run build:vencord` runs `scripts/vencord.js`, which:

- checks out `commit` from `client/vencord.json` into `.vencord/src` (override with `VENCORD_DIR`),
- applies the source fixes in `client/vencord-patches/*.patch`,
- copies `client/plugins/*` into Vencord's `src/userplugins`,
- installs dependencies with Vencord's own pnpm (falling back to `corepack pnpm` or `npx pnpm`),
- builds the web target and writes `assets/vencord/vencord.js`, `vencord.css` and the Monaco files for the QuickCSS editor.

`npm run generate:client` runs it after downloading the client. Both `.vencord/` and `assets/vencord/` are gitignored. `src/bundle/TestClient.ts` serves `assets/vencord` and adds the script right after `GLOBAL_ENV`, so it runs before any Discord code. If the file is missing the client still loads, just without the plugins, and the server logs a warning.

The default set leaves out every plugin that talks to a third-party service on load or on use (ReviewDB, Decor, Translate, USRBG, ClearURLs, Dearrow and similar), so with the defaults the client only ever contacts this instance. `client/vencord-patches/no-donor-badges.patch` removes the one request core Vencord makes on its own, the donor badge list from `badges.vencord.dev`.

`vencord.js` starts with a small script that seeds the default plugin set from the `plugins` and `settings` keys of `client/vencord.json`. A default is applied once per browser and recorded in the `FosscordVencordSeeded` localStorage key, so a user who turns a plugin off keeps it off, and a plugin added to the defaults later still reaches existing users. Our own plugins are `required`, so they can't be turned off.

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

## Branded images

Some Discord logos are image files, not React components, so the server swaps them. `src/bundle/TestClient.ts` serves `/assets/favicon.ico` from `general.image` or `assets/icon.png`, and `BRANDED_ASSETS` replaces the wordmark on the login, register and invite pages (`131c318dd45b7aa4.svg`) and the logo in the centre of the login QR code (`dd05fd1ea37e7747.png`) with SVGs drawn from the instance logo and `client.instanceName`. The file names change when Discord updates the client, so after `npm run generate:client` open `/login` and check that both images still show the instance logo. The logo in the app itself, on the Home button, the Direct Messages title and the soundboard category, comes from the `FosscordBranding` plugin, which swaps the path of Discord's logo icon.
