import { createAvatar } from "./main";
import type { AvatarState } from "./config/avatarConfig";
import type { MouthCue } from "./controllers/LipSyncController";

async function boot(): Promise<void> {
  const stage = document.getElementById("stage")!;
  const statusEl = document.getElementById("status")!;
  const cuesEl = document.getElementById("cues") as HTMLTextAreaElement;
  const audioInput = document.getElementById("audioFile") as HTMLInputElement;

  const app = await createAvatar(stage);
  statusEl.textContent = `state: ${app.getState()}`;

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

  window.setInterval(() => {
    statusEl.textContent = `state: ${app.getState()} | audio: ${app.audio.isPlaying ? "on" : "off"}`;
  }, 400);
}

void boot();
