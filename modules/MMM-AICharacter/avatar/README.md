# Holographic AI Avatar

Full-screen WebGL avatar built from the holographic source plate. PixiJS + TypeScript.

## Layer plan

See [LAYER_PLAN.md](./LAYER_PLAN.md) for masks, ROIs, visemes, and hair regions.

## Setup

```bash
cd modules/MMM-AICharacter/avatar
npm install
npm run dev      # http://localhost:5173 — state buttons + test audio
npm run build    # outputs to public/avatar-app for MagicMirror
```

## Development page

`npm run dev` opens a black full-screen stage with:

- Buttons for every avatar state
- Test audio file input (Web Audio lip-sync fallback)
- Optional Rhubarb Lip Sync JSON textarea

## Rhubarb cues

Paste JSON like:

```json
[
  { "start": 0.0, "end": 0.12, "value": "X" },
  { "start": 0.12, "end": 0.28, "value": "B" },
  { "start": 0.28, "end": 0.5, "value": "C" }
]
```

Playback time and cue times share the same `AudioContext` clock.

## MagicMirror embed

After `npm run build`, the module iframe loads `/MMM-AICharacter/avatar-app/embed.html`.

Parent → iframe messages:

```js
iframe.contentWindow.postMessage({ type: "avatar:setState", state: "listening" }, "*");
iframe.contentWindow.postMessage({ type: "avatar:playAudio", url: "/path/to.wav", cues }, "*");
iframe.contentWindow.postMessage({ type: "avatar:stopAudio" }, "*");
```

## Controllers

| Controller           | Role                                                   |
| -------------------- | ------------------------------------------------------ |
| `BlinkController`    | Slow blinks, double blinks, idle gaze                  |
| `HairController`     | Multi-region wind offsets                              |
| `HologramController` | Scanlines, particles, luma pulse, rare glitches        |
| `AudioController`    | Shared AudioContext clock                              |
| `LipSyncController`  | Rhubarb cues + analyser fallback, interpolated visemes |
| `StateController`    | dormant → … → dematerializing                          |

Animation knobs live in `src/config/avatarConfig.ts`.
