#!/usr/bin/env bash
# Idempotent Cursor Cloud / local bootstrap for MagicMirror + MMM-AICharacter.
# Config is tracked at config/config.js; secrets come from Cursor / env vars.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Prefer the nvm Node required by package.json engines / .npmrc engine-strict.
if [[ -x "$HOME/.nvm/versions/node/v22.22.2/bin/node" ]]; then
	export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
fi

echo "[install] node=$(node -v) npm=$(npm -v)"

if [[ ! -f config/config.js ]]; then
	echo "[install] ERROR: config/config.js missing from the repo checkout" >&2
	exit 1
fi

npm install --no-audit --no-fund --no-update-notifier --omit=dev

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
