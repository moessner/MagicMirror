import type { AvatarConfig, HairRegionConfig } from "../config/avatarConfig";

export interface HairMotionSample {
  id: string;
  offsetX: number;
  offsetY: number;
  skew: number;
}

/** Per-region organic wind offsets for hair sprites / displacement UVs. */
export class HairController {
  private readonly regions: HairRegionConfig[];
  private time = 0;

  constructor(cfg: AvatarConfig["hair"]) {
    this.regions = cfg.regions;
  }

  update(dtMs: number): HairMotionSample[] {
    this.time += dtMs / 1000;
    return this.regions.map((region) => {
      const t = this.time * region.speed + region.phase;
      const offsetX = Math.sin(t) * 6 * region.amplitude + Math.sin(t * 2.3) * 2.2 * region.amplitude;
      const offsetY = Math.cos(t * 0.85 + 0.4) * 3.5 * region.amplitude;
      const skew = Math.sin(t * 1.4 + 0.8) * 0.012 * region.amplitude;
      return { id: region.id, offsetX, offsetY, skew };
    });
  }
}
