import type { AvatarConfig } from "../config/avatarConfig";

export type BlinkPhase = "open" | "closing" | "closed" | "opening";

/**
 * Schedules natural blinks with occasional double-blinks.
 * `lid` is 0 (open) → 1 (fully closed) for gradual eyelid wipes.
 */
export class BlinkController {
  lid = 0;
  gazeX = 0;
  gazeY = 0;

  private phase: BlinkPhase = "open";
  private phaseElapsed = 0;
  private nextBlinkIn = 0;
  private doublePending = false;
  private readonly cfg: AvatarConfig["eyes"];

  constructor(cfg: AvatarConfig["eyes"]) {
    this.cfg = cfg;
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const span = this.cfg.blinkMaxMs - this.cfg.blinkMinMs;
    this.nextBlinkIn = this.cfg.blinkMinMs + Math.random() * span;
  }

  update(dtMs: number): void {
    const t = performance.now() / 1000;
    this.gazeX = Math.sin(t * this.cfg.idleGazeSpeed) * this.cfg.idleGazeAmplitude;
    this.gazeY = Math.sin(t * this.cfg.idleGazeSpeed * 0.7 + 1.3) * this.cfg.idleGazeAmplitude * 0.45;

    if (this.phase === "open") {
      this.nextBlinkIn -= dtMs;
      if (this.nextBlinkIn <= 0) {
        this.phase = "closing";
        this.phaseElapsed = 0;
        this.doublePending = Math.random() < this.cfg.doubleBlinkChance;
      }
      return;
    }

    this.phaseElapsed += dtMs;

    if (this.phase === "closing") {
      const u = Math.min(1, this.phaseElapsed / this.cfg.blinkCloseMs);
      this.lid = easeInOut(u);
      if (u >= 1) {
        this.phase = "closed";
        this.phaseElapsed = 0;
      }
      return;
    }

    if (this.phase === "closed") {
      this.lid = 1;
      if (this.phaseElapsed >= this.cfg.blinkHoldMs) {
        this.phase = "opening";
        this.phaseElapsed = 0;
      }
      return;
    }

    if (this.phase === "opening") {
      const u = Math.min(1, this.phaseElapsed / this.cfg.blinkOpenMs);
      this.lid = 1 - easeInOut(u);
      if (u >= 1) {
        this.lid = 0;
        if (this.doublePending) {
          this.doublePending = false;
          this.phase = "closing";
          this.phaseElapsed = 0;
        } else {
          this.phase = "open";
          this.scheduleNext();
        }
      }
    }
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
