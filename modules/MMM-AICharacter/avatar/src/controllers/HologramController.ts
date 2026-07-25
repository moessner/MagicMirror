import type { AvatarConfig } from "../config/avatarConfig";

export interface HologramFrame {
  scanOffset: number;
  luma: number;
  glitchActive: boolean;
  glitchOffsetX: number;
  particles: Array<{ x: number; y: number; a: number }>;
}

export class HologramController {
  private time = 0;
  private glitchLeft = 0;
  private readonly particles: Array<{ x: number; y: number; speed: number; phase: number }>;
  private readonly cfg: AvatarConfig["hologram"];

  constructor(cfg: AvatarConfig["hologram"]) {
    this.cfg = cfg;
    this.particles = Array.from({ length: cfg.particleCount }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.03 + Math.random() * 0.08,
      phase: Math.random() * Math.PI * 2
    }));
  }

  update(dtMs: number): HologramFrame {
    this.time += dtMs / 1000;
    const dt = dtMs / 1000;

    if (this.glitchLeft > 0) {
      this.glitchLeft -= dtMs;
    } else if (Math.random() < this.cfg.glitchChancePerSecond * dt) {
      this.glitchLeft = this.cfg.glitchDurationMs;
    }

    for (const p of this.particles) {
      p.y -= p.speed * dt;
      p.x += Math.sin(this.time * 1.5 + p.phase) * 0.01 * dt;
      if (p.y < 0) {
        p.y = 1;
        p.x = Math.random();
      }
    }

    return {
      scanOffset: (this.time * this.cfg.scanlineSpeed) % 100,
      luma: 1 + Math.sin(this.time * this.cfg.lumaPulseSpeed) * this.cfg.lumaPulseAmount,
      glitchActive: this.glitchLeft > 0,
      glitchOffsetX: this.glitchLeft > 0 ? (Math.random() - 0.5) * 18 : 0,
      particles: this.particles.map((p) => ({
        x: p.x,
        y: p.y,
        a: 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 3 + p.phase))
      }))
    };
  }
}
