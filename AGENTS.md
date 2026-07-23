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

Runtime config lives in `config/config.js` (gitignored). Create it once from the sample:
`cp config/config.js.sample config/config.js`. To reach the server from the VM browser, set
`address: "0.0.0.0"` and `ipWhitelist: []` in that file. Validate with `node --run config:check`.

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
