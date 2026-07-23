# MMM-AICharacter

Hands-free pixelated AI companion for [MagicMirror²](https://magicmirror.builders).

Speak a wake word (default **hey mirror**), ask a question, and Pixel answers aloud. No buttons — designed for a mirror kiosk.

## Features

- Continuous microphone listening with wake-word gating
- Silence-based end of turn (~1.5s)
- Barge-in while the character is speaking
- Pixelated humanoid with idle / listening / thinking / speaking animations
- Streaming replies via Vercel AI Gateway (`streamText`)

## Requirements

- MagicMirror² with Node `>= 22.21.1`
- Microphone permission in the browser / Electron kiosk
- Environment variable: `AI_GATEWAY_API_KEY`

## Install

```bash
cd ~/MagicMirror/modules
git clone <this-repo-path-or-copy> MMM-AICharacter
cd MMM-AICharacter
npm install --omit=dev
```

When developing from this repository, the module already lives at `modules/MMM-AICharacter/`.

## Configuration

Add to `config/config.js`:

```javascript
// Example module entry for config/config.js
const aiCharacterModule = {
  module: "MMM-AICharacter",
  position: "middle_center",
  config: {
    wakeWord: "hey mirror",
    model: "google/gemini-2.5-flash",
    voiceLang: "en-US",
    characterName: "Pixel",
    systemPrompt: "You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences).",
    maxHistory: 10,
    silenceMs: 1500,
    postSpeakListenMs: 8000,
    enableTTS: true
  }
};
```

Start MagicMirror with the gateway key available to the process:

```bash
export AI_GATEWAY_API_KEY="…"
npm run server
# or Electron: npm start
```

## Hands-free flow

1. Module continuously listens.
2. Say the wake word (default `hey mirror`).
3. Ask your question; after a short silence, the turn is sent.
4. Captions stream while Pixel speaks the reply.
5. For ~8s after a reply, you can ask a follow-up without repeating the wake word.
6. Interrupt anytime by speaking over the reply (barge-in).

## Notes

- API keys must stay in the host environment — never put `AI_GATEWAY_API_KEY` in client config.
- Web Speech API support varies; Chromium / Electron works best.
- Server mode (`npm run server`) needs a browser that can access the mic on the page origin.
