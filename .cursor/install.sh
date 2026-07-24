#!/usr/bin/env bash
# Idempotent Cursor Cloud / local bootstrap for MagicMirror + MMM-AICharacter.
# Reproducible config = config/config.js.sample (git) + Cursor Secrets (env vars).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Prefer the nvm Node required by package.json engines / .npmrc engine-strict.
if [[ -x "$HOME/.nvm/versions/node/v22.22.2/bin/node" ]]; then
	export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
fi

echo "[install] node=$(node -v) npm=$(npm -v)"

# Root app deps (skip if already present and lockfile unchanged — npm is still idempotent).
npm install --no-audit --no-fund --no-update-notifier --omit=dev

# Always materialize runtime config from the tracked sample so every cloud agent
# gets the same modules/layout. Secrets stay out of git via ${SECRET_*} + env.
mkdir -p config
cp -f config/config.js.sample config/config.js
echo "[install] wrote config/config.js from config.js.sample"

# Third-party module deps are not covered by the root package.json.
if [[ -f modules/MMM-AICharacter/package.json ]]; then
	(
		cd modules/MMM-AICharacter
		npm install --no-audit --no-fund --no-update-notifier --omit=dev
		if [[ -f avatar/package.json ]]; then
			cd avatar
			npm install --no-audit --no-fund --no-update-notifier
			npm run build
		fi
	)
	echo "[install] MMM-AICharacter deps + avatar build ready"
fi

echo "[install] done — ensure Cursor Secrets include OPENAI_API_KEY and SECRET_GCAL_ICS_URL"
