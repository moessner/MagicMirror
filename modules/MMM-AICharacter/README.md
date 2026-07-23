# MMM-AICharacter

Hands-free holographic AI companion for [MagicMirror²](https://magicmirror.builders).

Speak a wake word (default **hey mirror**), ask a question, and the avatar answers aloud with low-latency **OpenAI Realtime** speech-to-speech (ChatGPT Live–style). No buttons — designed for a mirror kiosk.

The full-screen WebGL avatar (PixiJS + TypeScript) lives in [`avatar/`](./avatar/) — see [`avatar/LAYER_PLAN.md`](./avatar/LAYER_PLAN.md) and [`avatar/README.md`](./avatar/README.md).

## Features

- Holographic source-plate avatar with blink, hair wind, scanlines, particles, lip-sync
- OpenAI Realtime WebRTC session (mic → model → natural voice audio)
- Wake-word gate (local short STT) so the always-on mirror stays private until addressed
- Server VAD turn-taking + native barge-in
- Streaming captions from Realtime transcripts
- Analyser-driven lip sync from the live remote audio stream

## Requirements

- MagicMirror² with Node `>= 22.21.1`
- Microphone permission in the browser / Electron kiosk
- Environment variable: `OPENAI_API_KEY`
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

Add to `config/config.js`:

```javascript
// Example module entry for config/config.js
const aiCharacterModule = {
  module: "MMM-AICharacter",
  position: "middle_center",
  config: {
    wakeWord: "hey mirror", // set "" for always-open live mode
    wakeAliases: [], // optional extra phrases accepted as wake
    realtimeModel: "gpt-realtime",
    voice: "sage",
    transcriptionModel: "gpt-4o-mini-transcribe",
    voiceLang: "en-US",
    characterName: "Pixel",
    systemPrompt: "You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences).",
    postSpeakListenMs: 8000,
    wakeSilenceMs: 550,
    vadThreshold: 0.015,
    avatarPath: "/MMM-AICharacter/avatar-app/embed.html"
  }
};
```

| Option | Default | Notes |
|--------|---------|--------|
| `wakeWord` | `"hey mirror"` | Empty string disables wake gating (always live) |
| `wakeAliases` | `[]` | Extra accepted phrases; built-in fuzzy aliases also cover common STT mishears |
| `realtimeModel` | `"gpt-realtime"` | OpenAI Realtime speech-to-speech model |
| `voice` | `"sage"` | Realtime output voice (`sage`, `marin`, `cedar`, etc.) |
| `transcriptionModel` | `"gpt-4o-mini-transcribe"` | Used for wake-word STT + Realtime input captions |
| `postSpeakListenMs` | `8000` | Follow-up window without repeating the wake word |
| `wakeSilenceMs` | `550` | End-of-clip silence for wake-word detection only |
| `vadThreshold` | `0.015` | Local mic loudness gate for starting a wake clip |

Start MagicMirror with the OpenAI key available to the process:

```bash
export OPENAI_API_KEY="…"
npm run server
# or Electron: npm start
```

## Hands-free flow

1. Module opens a Realtime WebRTC session (mic muted to OpenAI until wake).
2. Say the wake word (default `hey mirror`).
3. Speak naturally; server VAD ends your turn and the model answers with live audio.
4. Captions stream while the avatar lip-syncs to the remote voice.
5. For ~8s after a reply, you can ask a follow-up without repeating the wake word.
6. Interrupt anytime by speaking over the reply (Realtime barge-in).

## Notes

- API keys stay on the host: the browser receives only short-lived ephemeral Realtime client secrets.
- Conversation audio no longer uses the browser Web Speech API.
- Allow microphone access for the MagicMirror page / Electron kiosk.
- Server mode (`npm run server`) needs a browser that can access the mic on the page origin (HTTPS or localhost).
