import { createAvatar } from "./main";
import type { AvatarState } from "./config/avatarConfig";
import type { MouthCue } from "./controllers/LipSyncController";
import type { AvatarApp } from "./render/AvatarApp";

declare global {
  interface Window {
    __MMMAvatar?: {
      attachStream: (stream: MediaStream) => Promise<void>;
      detachStream: () => void;
      setState: (state: AvatarState) => void;
      stopAudio: () => void;
    };
  }
}

async function boot(): Promise<void> {
  const stage = document.getElementById("stage")!;
  const app: AvatarApp = await createAvatar(stage);

  window.__MMMAvatar = {
    attachStream: (stream: MediaStream) => app.attachStream(stream),
    detachStream: () => app.detachStream(),
    setState: (state: AvatarState) => app.setState(state),
    stopAudio: () => app.stopAudio()
  };

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "avatar:setState" && typeof data.state === "string") {
      app.setState(data.state as AvatarState);
    }

    if (data.type === "avatar:playAudio" && typeof data.url === "string") {
      await app.playAudioUrl(data.url, data.cues as MouthCue[] | undefined);
    }

    if (data.type === "avatar:stopAudio") {
      app.stopAudio();
    }
  });

  window.parent?.postMessage({ type: "avatar:ready", state: app.getState() }, "*");
}

void boot();
