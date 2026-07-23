import { AvatarApp } from "./render/AvatarApp";
import type { AvatarState } from "./config/avatarConfig";
import type { MouthCue } from "./controllers/LipSyncController";

export type { AvatarState, MouthCue };
export { AvatarApp };
export { avatarConfig } from "./config/avatarConfig";

declare global {
  interface Window {
    HologramAvatar: {
      create: (host: HTMLElement) => Promise<AvatarApp>;
      AvatarApp: typeof AvatarApp;
    };
  }
}

export async function createAvatar(host: HTMLElement): Promise<AvatarApp> {
  const app = new AvatarApp();
  await app.mount(host);
  return app;
}

window.HologramAvatar = {
  create: createAvatar,
  AvatarApp
};
