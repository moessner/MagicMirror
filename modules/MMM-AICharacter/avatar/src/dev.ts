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
  const stopAudioBtn = document.getElementById("stopAudio")!;

  const app = await createAvatar(stage);
  // Dev page shows the character immediately; the MagicMirror embed stays dormant until wake.
  app.setState("materializing");
  window.setTimeout(() => app.setState("idle"), 1150);
  statusEl.textContent = `state: ${app.getState()}`;

  for (const voice of REALTIME_VOICES) {
    const option = document.createElement("option");
    option.value = voice;
    option.textContent = voice === "marin" || voice === "cedar" ? `${voice} ★` : voice;
    voiceSelect.appendChild(option);
  }
  voiceSelect.value = "sage";
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

  let previewObjectUrl: string | null = null;
  let previewBusy = false;
  let activePreviewVoice = "";
  const previewAudioEl = document.createElement("audio");
  previewAudioEl.preload = "auto";
  previewAudioEl.style.display = "none";
  document.body.appendChild(previewAudioEl);

  previewAudioEl.addEventListener("playing", () => {
    app.setState("speaking");
  });
  previewAudioEl.addEventListener("ended", () => {
    app.detachStream();
    app.setState("idle");
    activePreviewVoice = "";
  });

  function stopPreviewPlayback (): void {
    previewAudioEl.pause();
    previewAudioEl.removeAttribute("src");
    previewAudioEl.load();
    app.stopAudio();
    activePreviewVoice = "";
  }

  audioInput.addEventListener("change", async () => {
    const file = audioInput.files?.[0];
    if (!file) return;
    stopPreviewPlayback();
    await app.playAudioFile(file, parseCues());
    statusEl.textContent = `playing: ${file.name}`;
  });

  stopAudioBtn.addEventListener("click", () => {
    stopPreviewPlayback();
    app.setState("idle");
    statusEl.textContent = "state: idle";
  });

  previewVoiceBtn.addEventListener("click", async () => {
    const voice = voiceSelect.value;
    const text = voicePreviewText.value.trim() || DEFAULT_VOICE_PREVIEW_TEXT;
    if (!isRealtimeVoice(voice)) {
      statusEl.textContent = "Pick a Realtime voice first";
      return;
    }

    // Unlock AudioContext during the user gesture (before await gaps).
    await app.audio.resume();
    previewBusy = true;
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

      const data = await response.arrayBuffer();
      if (data.byteLength < 100) throw new Error("Voice preview returned empty audio.");

      const blob = new Blob([data], { type: "audio/mpeg" });
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(blob);

      stopPreviewPlayback();
      previewAudioEl.src = previewObjectUrl;
      previewAudioEl.currentTime = 0;

      // Tap the element for analyser lip-sync; element itself is the audible path.
      await app.audio.resume();
      await app.attachMediaElement(previewAudioEl);
      await previewAudioEl.play();
      activePreviewVoice = voice;
      statusEl.textContent = `preview: ${voice} (${Math.round(data.byteLength / 1024)} KB)`;
      // Keep preview status visible briefly before the idle ticker resumes.
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    } catch (error) {
      console.error("Voice preview failed", error);
      statusEl.textContent = error instanceof Error ? error.message : "Voice preview failed";
      app.setState("error");
    } finally {
      previewBusy = false;
      previewVoiceBtn.disabled = false;
    }
  });

  window.setInterval(() => {
    if (previewBusy) return;
    const elementPlaying = !previewAudioEl.paused && !previewAudioEl.ended && previewAudioEl.currentTime > 0;
    const audioOn = app.audio.isPlaying || elementPlaying;
    const voiceLabel = activePreviewVoice || voiceSelect.value;
    statusEl.textContent = `state: ${app.getState()} | audio: ${audioOn ? "on" : "off"} | voice: ${voiceLabel}`;
  }, 400);
}

void boot();
