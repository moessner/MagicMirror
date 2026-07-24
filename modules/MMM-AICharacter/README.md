# MMM-AICharacter

Hands-free holographic AI companion for [MagicMirror²](https://magicmirror.builders).

Speak a configurable wake word (default **alexa**), ask a question, and the avatar answers aloud with low-latency **OpenAI Realtime** speech-to-speech (ChatGPT Live–style). No buttons — designed for a mirror kiosk.

The full-screen WebGL avatar (PixiJS + TypeScript) lives in [`avatar/`](./avatar/) — see [`avatar/LAYER_PLAN.md`](./avatar/LAYER_PLAN.md) and [`avatar/README.md`](./avatar/README.md).

## Features

- Holographic source-plate avatar with blink, hair wind, scanlines, particles, lip-sync
- OpenAI Realtime WebRTC session (mic → model → natural voice audio)
- Wake-word gate (local short STT) so the always-on mirror stays private until addressed
- Server VAD turn-taking + native barge-in
- Streaming captions from Realtime transcripts
- Analyser-driven lip sync from the live remote audio stream
- Tools: weather (`get_weather`), Tagesschau news (`get_news`), Google Calendar ICS (`get_calendar`)

## Requirements

- MagicMirror² with Node `>= 22.21.1`
- Microphone permission in the browser / Electron kiosk
- Environment variable: `OPENAI_API_KEY`
- Optional: `SECRET_GCAL_ICS_URL` (Google Calendar private iCal URL)
- Network access from the browser to `api.openai.com` (WebRTC)

## Install

```bash
cd modules/MMM-AICharacter
npm install --omit=dev
cd avatar && npm install && npm run build
```

## Avatar development

```bash
cd modules/MMM-AICharacter/avatar
npm run dev
```

Open http://localhost:5173 for state buttons and test-audio lip sync.

## Configuration

Minimal mirror layout (clock + Tagesschau newsfeed + this module) — see [`config/config.js`](../../config/config.js):

```javascript
{
  module: "MMM-AICharacter",
  position: "middle_center",
  config: {
    wakeWord: "alexa",
    wakeAliases: ["hey pixel"],
    realtimeModel: "gpt-realtime",
    voice: "sage",
    transcriptionModel: "gpt-4o-mini-transcribe",
    voiceLang: "de-DE",
    characterName: "Pixel",
    systemPrompt:
      "You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). When asked about weather or the forecast, call get_weather, then summarize from the tool result — never invent numbers. When asked about news or Schlagzeilen, call get_news, then summarize from the tool result — never invent headlines. When asked about the calendar, schedule, or Termine, call get_calendar, then summarize from the tool result — never invent events.",
    postSpeakListenMs: 8000,
    wakeSilenceMs: 550,
    vadThreshold: 0.015,
    appearOnWake: true,
    lat: null,
    lon: null,
    units: "metric",
    showWeatherCard: true,
    showNewsCard: true,
    showCalendarCard: true,
    newsLimit: 5,
    newsFeeds: [
      { title: "Tagesschau", url: "https://www.tagesschau.de/xml/rss2/" }
    ],
    calendars: [
      { name: "Google", url: "${SECRET_GCAL_ICS_URL}" }
    ],
    calendarMaximumEntries: 8,
    calendarMaximumNumberOfDays: 365,
    avatarPath: "/MMM-AICharacter/avatar-app/embed.html"
  }
}
```

| Option | Default | Notes |
|--------|---------|--------|
| `wakeWord` | `"alexa"` | Any phrase; empty string disables wake gating (always live) |
| `wakeAliases` | `[]` | Extra accepted phrases; built-in fuzzy aliases also cover common STT mishears |
| `realtimeModel` | `"gpt-realtime"` | OpenAI Realtime speech-to-speech model |
| `voice` | `"sage"` | Realtime output voice (`sage`, `marin`, `cedar`, etc.) |
| `transcriptionModel` | `"gpt-4o-mini-transcribe"` | Used for wake-word STT + Realtime input captions |
| `postSpeakListenMs` | `8000` | Follow-up window without repeating the wake word |
| `wakeSilenceMs` | `550` | End-of-clip silence for wake-word detection only |
| `vadThreshold` | `0.015` | Local mic loudness gate for starting a wake clip |
| `appearOnWake` | `true` | Materialize on wake, dematerialize when the follow-up window ends |
| `lat` / `lon` | `null` | Fallback coordinates when geolocation is denied or unavailable |
| `units` | `"metric"` | `"metric"` (°C, km/h) or `"imperial"` (°F, mph) |
| `showWeatherCard` | `true` | Show a compact weather card under captions while Pixel answers |
| `showNewsCard` | `true` | Show a compact Schlagzeilen card under captions while Pixel answers |
| `showCalendarCard` | `true` | Show a compact Termine card under captions while Pixel answers |
| `newsLimit` | `5` | Max headlines shown / returned to the model |
| `newsFeeds` | Tagesschau RSS | Array of `{ title, url }` RSS/Atom feeds (no API key) |
| `calendars` | `[]` | Array of `{ name, url }` ICS feeds (Google secret iCal URL) |
| `calendarMaximumEntries` | `8` | Max events returned to the model / card |
| `calendarMaximumNumberOfDays` | `365` | How far ahead to look for events |

## Secrets & Cursor Cloud

MagicMirror does **not** load a full remote `config.js` from Cursor. Use this split:

| Piece | Where | Notes |
|-------|--------|--------|
| Modules, layout, placeholders | [`config/config.js.sample`](../../config/config.js.sample) (git) | Copied to gitignored `config/config.js` by [`.cursor/install.sh`](../../.cursor/install.sh) on every cloud agent install |
| API key / private ICS URL | Cursor environment **Secrets** | `OPENAI_API_KEY`, `SECRET_GCAL_ICS_URL` become env vars; referenced as `${SECRET_GCAL_ICS_URL}` in config |
| Optional local overrides | `config/config.env` (gitignored) | Same var names; process env wins over `config.env` |

Recommended setup:

1. Edit the **sample** when you want every future agent to share the same layout (then commit).
2. In the [Cursor Cloud environment](https://cursor.com/dashboard?tab=cloud-agents) → **Secrets**, add:
   - `OPENAI_API_KEY` (Runtime Secret)
   - `SECRET_GCAL_ICS_URL` (Runtime Secret) — Google Calendar **Secret address in iCal format**
3. Ensure the environment runs `bash .cursor/install.sh` (via committed [`.cursor/environment.json`](../../.cursor/environment.json) or the dashboard Update command).
4. In config, keep `hideConfigSecrets: true` so `SECRET_*` values are redacted for the browser and restored only in node helpers.

You **cannot** store an entire `config.js` body as one Cursor secret and have MagicMirror read it automatically. Closest alternative: a custom bootstrap that writes a file from `process.env` before start — unnecessary if you use the sample + `${SECRET_*}` pattern above.

```bash
export OPENAI_API_KEY="…"
export SECRET_GCAL_ICS_URL="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
npm run server
# or Electron: npm start
```

## Hands-free flow

1. Module opens a Realtime WebRTC session (mic muted to OpenAI until wake). The hologram stays hidden.
2. Say the wake word (default `alexa`, configurable via `wakeWord`) — the character materializes.
3. Speak naturally; server VAD ends your turn and the model answers with live audio.
4. Captions stream while the avatar lip-syncs to the remote voice.
5. Ask about the weather — Pixel calls the `get_weather` tool (Open-Meteo), shows a compact weather card, and speaks a short summary.
6. Ask for news / Schlagzeilen — Pixel calls `get_news` (RSS), shows a headlines card, and speaks a short summary.
7. Ask about the calendar / Termine — Pixel calls `get_calendar` (ICS), shows an events card, and speaks a short summary.
8. For ~8s after a reply, you can ask a follow-up without repeating the wake word.
9. After that window, the character (and weather/news/calendar card) dematerialize until the next wake word.
10. Interrupt anytime by speaking over the reply (Realtime barge-in).

## Weather tool

- Location prefers **browser geolocation** when the user asks without naming a place.
- If geo is denied/unavailable, the module uses config `lat` / `lon`.
- Named places (`"Berlin"`, `"Munich"`) are geocoded via Open-Meteo; no weather API key required.
- Forecast data is fetched in the module’s node helper and returned to the Realtime session as a function tool result.

## News / Schlagzeilen tool

- Default feed is **Tagesschau** RSS (`https://www.tagesschau.de/xml/rss2/`); no news API key required.
- Configure additional feeds with `newsFeeds`, and cap count with `newsLimit`.
- Optional topic keywords from the model filter titles/summaries; if nothing matches, latest headlines are returned with a note.
- Only one tool card (weather, news, or calendar) is shown at a time.

## Calendar / Termine tool

- Uses Google Calendar’s **private ICS URL** (Settings → calendar → Integrate calendar → Secret address in iCal format). No Google OAuth required.
- Configure one or more feeds with `calendars: [{ name, url }]`. Prefer `${SECRET_GCAL_ICS_URL}` so the secret stays out of git and the browser.
- Events are parsed with MagicMirror’s iCal utilities (recurrence supported) and returned via `get_calendar`.
- This is independent of the default `calendar` UI module — you do not need that module on the mirror for Pixel to answer schedule questions.

## Notes

- API keys stay on the host: the browser receives only short-lived ephemeral Realtime client secrets.
- Conversation audio no longer uses the browser Web Speech API.
- Allow microphone access for the MagicMirror page / Electron kiosk.
- Server mode (`npm run server`) needs a browser that can access the mic on the page origin (HTTPS or localhost).
