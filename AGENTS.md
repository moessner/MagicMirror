# AGENTS.md

## Cursor Cloud specific instructions

This is **MagicMirror²**, a modular smart-mirror platform. It runs either as a plain
Node HTTP server (view in a browser) or as an Electron desktop app. All commands are in
`package.json` `scripts`; standard usage is documented at <https://docs.magicmirror.builders>.

### Node version (important gotcha)

`package.json` requires Node `>=22.21.1 <23 || >=24` and `.npmrc` sets `engine-strict=true`,
so `npm install` **hard-fails** on the default system Node (`v22.14.0` at `/exec-daemon/node`).
A compatible Node (`v22.22.2`) is provided via `nvm` and is put ahead of `/exec-daemon` on
`PATH` through a line in `~/.bashrc` (marker `MM_NODE_PATH`). Login/interactive shells and the
startup update script pick this up automatically. If you ever land on `v22.14.0`, run
`export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"` before using npm/node.

### Config

**Reproducible layout (git):** [`config/config.js.sample`](config/config.js.sample) — clock, Tagesschau
newsfeed, MMM-AICharacter, `${SECRET_GCAL_ICS_URL}` placeholders. This is the
canonical config for every Cursor Cloud agent.

**Secrets (Cursor dashboard, not git):** add Runtime Secrets on the
[Cloud Agents environment](https://cursor.com/dashboard/cloud-agents):
`OPENAI_API_KEY`, `SECRET_GCAL_ICS_URL` (Google private iCal URL). MagicMirror
substitutes `${…}` at load time; with `hideConfigSecrets: true` they stay off
the browser wire.

**Do not** put a full `config.js` body in a Cursor secret. Cursor injects env
vars, not arbitrary files. The split above is the supported pattern.

Bootstrap (also run by [`.cursor/install.sh`](.cursor/install.sh) / `environment.json`):

```sh
bash .cursor/install.sh
# or manually:
cp -f config/config.js.sample config/config.js
node --run config:check
```

Third-party module deps are **not** installed by the root `npm install` alone.
The install script also runs:

```sh
cd modules/MMM-AICharacter && npm install --omit=dev
cd avatar && npm install && npm run build
```

Without that, the node helper fails with `Cannot find package 'ai'`.

### Running the app

- Browser/server mode (no display needed): `node ./serveronly` serves the mirror on
  `http://localhost:8080`. This is the easiest way to demo/verify the UI.
- Electron app mode: `node --run start` (Wayland via `--ozone-platform=wayland`). Needs a
  Wayland compositor + display env (see below). The Electron binary is not fetched during
  `npm install`; it downloads on first `electron` run (or `npx install-electron`).

### Tests

- `node --run test:unit` — pure Node unit tests, no display required.
- `node --run test:e2e` — Playwright (headless Chromium), no display required.
- `node --run test:electron` — launches Electron; **requires a running Wayland compositor**.
- `node --run test` runs all three; `node --run test:lint` runs eslint + prettier.

### Electron / Wayland requirement (non-obvious)

Electron tests and the Electron app need the `labwc` Wayland compositor (a system package,
`sudo apt-get install -y labwc`; not part of `npm install`) plus a headless session:

```sh
mkdir -p /tmp/xdg-runtime && chmod 700 /tmp/xdg-runtime
export XDG_RUNTIME_DIR=/tmp/xdg-runtime
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman labwc &   # start once
export WAYLAND_DISPLAY=wayland-0
```

Then run `node --run test:electron` (or `node --run start`) in that same environment.
Electron also needs `libnss3` and `libasound2t64` (present by default here).

### Notes

- Vitest is capped at a single worker; suites bind to port `8080`, so don't run the server on
  8080 at the same time as `test:e2e`/`test:electron`.
