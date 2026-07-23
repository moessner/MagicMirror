import { createAvatar } from "./main";
import type { AvatarState } from "./config/avatarConfig";
import type { MouthCue } from "./controllers/LipSyncController";
import {
  DEFAULT_VOICE_PREVIEW_TEXT,
  REALTIME_VOICES,
  isRealtimeVoice
} from "./voicePreview";

async function boot(): Promise<void> {
  const stage = document.getElementById("stage")!;
  const statusEl = document.getElementById("status")!;
  const cuesEl = document.getElementById("cues") as HTMLTextAreaElement;
  const audioInput = document.getElementById("audioFile") as HTMLInputElement;
  const voiceSelect = document.getElementById("voiceSelect") as HTMLSelectElement;
  const voicePreviewText = document.getElementById("voicePreviewText") as HTMLInputElement;
  const previewVoiceBtn = document.getElementById("previewVoice") as HTMLButtonElement;

  const app = await createAvatar(stage);
  statusEl.textContent = `state: ${app.getState()}`;

  for (const voice of REALTIME_VOICES) {
    const option = document.createElement("option");
    option.value = voice;
    option.textContent = voice === "marin" || voice === "cedar" ? `${voice} ★` : voice;
    voiceSelect.appendChild(option);
  }
  voiceSelect.value = "marin";
  voicePreviewText.value = DEFAULT_VOICE_PREVIEW_TEXT;

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-state]"));
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const state = button.dataset.state as AvatarState;
      app.setState(state);
      buttons.forEach((b) => b.classList.toggle("active", b === button));
      statusEl.textContent = `state: ${state}`;
    });
  }

  function parseCues(): MouthCue[] | undefined {
    const raw = cuesEl.value.trim();
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as MouthCue[];
      statusEl.textContent = `loaded ${parsed.length} mouth cues`;
      return parsed;
    } catch {
      statusEl.textContent = "Invalid Rhubarb JSON — using analyser fallback";
      return undefined;
    }
  }

  audioInput.addEventListener("change", async () => {
    const file = audioInput.files?.[0];
    if (!file) return;
    await app.playAudioFile(file, parseCues());
    statusEl.textContent = `playing: ${file.name}`;
  });

  document.getElementById("stopAudio")!.addEventListener("click", () => {
    app.stopAudio();
    app.setState("idle");
    statusEl.textContent = "state: idle";
  });

  let previewObjectUrl: string | null = null;
  previewVoiceBtn.addEventListener("click", async () => {
    const voice = voiceSelect.value;
    const text = voicePreviewText.value.trim() || DEFAULT_VOICE_PREVIEW_TEXT;
    if (!isRealtimeVoice(voice)) {
      statusEl.textContent = "Pick a Realtime voice first";
      return;
    }

    previewVoiceBtn.disabled = true;
    statusEl.textContent = `Generating ${voice}…`;
    try {
      const response = await fetch("/api/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice, text })
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const err = (await response.json()) as { error?: string };
          if (err.error) detail = err.error;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(blob);
      await app.playAudioUrl(previewObjectUrl, parseCues());
      statusEl.textContent = `preview: ${voice}`;
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : "Voice preview failed";
      app.setState("error");
    } finally {
      previewVoiceBtn.disabled = false;
    }
  });

  window.setInterval(() => {
    if (previewVoiceBtn.disabled) return;
    statusEl.textContent = `state: ${app.getState()} | audio: ${app.audio.isPlaying ? "on" : "off"} | voice: ${voiceSelect.value}`;
  }, 400);
}

void boot();
