import type { AvatarConfig, AvatarState } from "../config/avatarConfig";

export interface StateFrame {
  state: AvatarState;
  opacity: number;
  tint: number;
  lumaBoost: number;
  busy: boolean;
}

/**
 * Avatar lifecycle / interaction state machine with eased transitions.
 */
export class StateController {
  state: AvatarState = "dormant";
  private fromOpacity = 0;
  private toOpacity = 0;
  private opacity = 0;
  private tint = 0xffffff;
  private lumaBoost = 0;
  private transitionMs = 0;
  private transitionElapsed = 0;
  private transitioning = false;
  private readonly cfg: AvatarConfig["states"];

  constructor(cfg: AvatarConfig["states"]) {
    this.cfg = cfg;
    const initial = cfg.dormant;
    this.opacity = initial.opacity;
    this.tint = initial.tint;
    this.lumaBoost = initial.lumaBoost;
  }

  setState(next: AvatarState, transitionMs = 650): void {
    if (next === this.state && !this.transitioning) return;
    const target = this.cfg[next];
    this.fromOpacity = this.opacity;
    this.toOpacity = target.opacity;
    this.tint = target.tint;
    this.lumaBoost = target.lumaBoost;
    this.state = next;
    this.transitionMs = transitionMs;
    this.transitionElapsed = 0;
    this.transitioning = true;
  }

  update(dtMs: number): StateFrame {
    if (this.transitioning) {
      this.transitionElapsed += dtMs;
      const u = Math.min(1, this.transitionElapsed / Math.max(1, this.transitionMs));
      const e = u * u * (3 - 2 * u);
      this.opacity = this.fromOpacity + (this.toOpacity - this.fromOpacity) * e;
      if (u >= 1) this.transitioning = false;
    }

    return {
      state: this.state,
      opacity: this.opacity,
      tint: this.tint,
      lumaBoost: this.lumaBoost,
      busy: this.transitioning
    };
  }
}
