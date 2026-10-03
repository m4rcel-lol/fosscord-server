# Contributing

Fosscord is a fork of [Spacebar server](https://github.com/spacebarchat/server). Changes made here stay here. A fix meant for Spacebar itself goes to their repository, under their own contribution rules.

Start with [README.md](README.md) for the development setup. [docs/parity.md](docs/parity.md) lists what still needs work, in its partial and not started rows.

## Branches

Branch off `main` and keep one topic per branch. To work on several things at once, give each one its own git worktree, port and database:

```sh
git worktree add ../fosscord-voice -b voice-reconnect
cd ../fosscord-voice
scripts/dev/worktree-setup.sh 3240 fosscord_voice
```

The setup script links `node_modules` and `assets/cache` from the main checkout, so a worktree needs no install or client download. `assets/vencord` is gitignored and not linked. Copy it from the main checkout, or run `npm run build:vencord` if you change the plugins. When the branch is done, stop its server and drop its database with `dropdb fosscord_voice`.

## Commits

Commit as you go, in small steps. The subject line is a lowercase [conventional commit](https://www.conventionalcommits.org), in the imperative, with an optional scope and no trailing period. There is no body.

```
fix(e2ee): keep the nonce on nonce-bound encrypted messages and clear stale client tokens in the test
feat(e2ee): store a sealed contact verification list with the key backup
perf(bans): batch bulk bans and paginate the ban list with one joined query
docs(parity): mark member applications and reporting as working, probe join requests
```

The types in use are `feat`, `fix`, `perf`, `docs`, `test`, `chore`, `build` and `refactor`.

The pre-commit hook runs lint-staged. For staged JavaScript and TypeScript files it runs `npm run build:src`, ESLint and `prettier --write`, so a commit that doesn't compile is refused. When a file in `src/schemas` changes, it also regenerates `assets/schemas.json` and `assets/openapi.json` and stages them. Branches that run in parallel would all conflict on `assets/openapi.json`, so a worktree branch shouldn't carry a regenerated copy. If the hook staged one, put back the version from `main` with `git checkout main -- assets/openapi.json` and commit that before merging. After merging, regenerate it on `main` with `npm run build` and a `chore: regenerate schemas and openapi after merges` commit.

## Code style

- Prettier formats with `.prettierrc.json`, which sets 4-space indents and a 180 character line width. ESLint uses `eslint.config.mjs`.
- Every new source file starts with the AGPL header. Copy it from any file in `src`.
- No code comments. Name things so the code reads without them.
- Migrations go in `src/database/migration/postgres`. Each one has to be idempotent (`IF NOT EXISTS`, `IF EXISTS`, or a check before the change) and have a timestamp later than every existing migration, made unique with a random suffix, such as `1791514025449`. A fresh database runs the migrations in timestamp order, so don't touch a table that a migration with a later timestamp creates. Test a new migration on a fresh database with `worktree-setup.sh`, which drops and recreates it.
- Client changes go into a Vencord plugin in `client/plugins` whenever possible. [docs/client-patches.md](docs/client-patches.md) has the rules for patches that survive Discord updates.
- After a change to `client/e2ee`, run `npm run build:e2ee` and commit `assets/public/e2ee` with it. Build from the main checkout or a worktree with its own `node_modules`, because a symlinked `node_modules` changes the path comments esbuild writes into the bundle.
- Never commit `assets/cache`, `assets/cache_compressed`, `assets/vencord` or `.vencord`. They hold Discord's code or builds made from it.
- When a feature's status changes, update its row in `docs/parity.md`. Docs use plain sentences and say what happens, with numbers where there are numbers.

## Before you push

Build, lint and format the files you touched:

```sh
npm run build:src
npm run lint
npx prettier --check src/bundle/TestClient.ts docs/parity.md
```

`npx prettier --check .` currently fails on 22 existing files, so check the files you changed instead of the whole tree.

Restart your dev server on the new build and run the parity probe against it. It should end with no failures:

```sh
PORT=3001 SERVER_LOG=$PWD/server.log scripts/dev/restart.sh
PORT=3001 node scripts/dev/parity-probe.mjs
```

Rate limits are stored in the database, so running the probes over and over can hit them. Clear them between runs:

```sh
psql fosscord -c "delete from rate_limits"
```

Run the end-to-end encryption test when you change messages, channels, sessions, the gateway or anything under `client/e2ee`, `client/plugins/fosscordE2ee` or the `e2ee` routes. It takes about five minutes and clears the rate limits itself:

```sh
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" PORT=3001 node scripts/dev/e2ee-test.mjs
```

Run the client check when you change `client/plugins`, `client/vencord-patches` or `client/vencord.json`, and after downloading a new Discord build. It exits with code 1 when one of our patches, or an upstream plugin we turn on by default, no longer matches the client:

```sh
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" PORT=3001 npm run check:client
```

For voice and video changes, run `PORT=3001 node scripts/dev/voice-probe.mjs` and check that both users report audio packets in each direction. It needs the SFU, which `worktree-setup.sh` builds when Go is installed.
