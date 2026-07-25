export type AvatarState = "dormant" | "materializing" | "idle" | "listening" | "thinking" | "speaking" | "error" | "dematerializing";

export type MouthViseme = "closed" | "consonant" | "slightlyOpen" | "wideOpen" | "rounded" | "puckered";

/** Normalized rectangle in source image space (0–1). */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HairRegionConfig {
  id: string;
  /** Approximate ROI covering this hair group */
  rect: NormRect;
  amplitude: number;
  speed: number;
  phase: number;
}

export interface AvatarConfig {
  background: string;
  assets: {
    source: string;
    eyesClosed: string;
    mouth: Record<MouthViseme, string>;
  };
  eyes: {
    left: NormRect;
    right: NormRect;
    blinkMinMs: number;
    blinkMaxMs: number;
    blinkCloseMs: number;
    blinkHoldMs: number;
    blinkOpenMs: number;
    doubleBlinkChance: number;
    idleGazeAmplitude: number;
    idleGazeSpeed: number;
  };
  mouth: {
    roi: NormRect;
    blendMs: number;
    /** Rhubarb cue → viseme */
    rhubarbMap: Record<string, MouthViseme>;
  };
  hair: {
    regions: HairRegionConfig[];
    displacementScale: number;
    noiseSize: number;
  };
  hologram: {
    scanlineOpacity: number;
    scanlineSpeed: number;
    lumaPulseAmount: number;
    lumaPulseSpeed: number;
    glitchChancePerSecond: number;
    glitchDurationMs: number;
    particleCount: number;
  };
  states: Record<
    AvatarState,
    {
      opacity: number;
      tint: number;
      lumaBoost: number;
    }
  >;
  audio: {
    fftSize: number;
    smoothing: number;
    amplitudeClosed: number;
    amplitudeWide: number;
  };
}

export const avatarConfig: AvatarConfig = {
  background: "#000000",
  assets: {
    source: "./assets/source.png",
    eyesClosed: "./assets/eyes/closed.png",
    mouth: {
      closed: "./assets/mouth/closed.png",
      consonant: "./assets/mouth/consonant.png",
      slightlyOpen: "./assets/mouth/slightly-open.png",
      wideOpen: "./assets/mouth/wide-open.png",
      rounded: "./assets/mouth/rounded.png",
      puckered: "./assets/mouth/puckered.png"
    }
  },
  eyes: {
    left: { x: 0.28, y: 0.34, w: 0.16, h: 0.08 },
    right: { x: 0.56, y: 0.34, w: 0.16, h: 0.08 },
    blinkMinMs: 4000,
    blinkMaxMs: 9000,
    blinkCloseMs: 90,
    blinkHoldMs: 40,
    blinkOpenMs: 140,
    doubleBlinkChance: 0.18,
    idleGazeAmplitude: 2.5,
    idleGazeSpeed: 0.35
  },
  mouth: {
    roi: { x: 0.36, y: 0.52, w: 0.28, h: 0.14 },
    blendMs: 70,
    rhubarbMap: {
      X: "closed",
      A: "consonant",
      B: "slightlyOpen",
      C: "wideOpen",
      D: "wideOpen",
      E: "rounded",
      F: "rounded",
      G: "puckered",
      H: "wideOpen"
    }
  },
  hair: {
    displacementScale: 18,
    noiseSize: 256,
    regions: [
      { id: "crown", rect: { x: 0.25, y: 0.02, w: 0.5, h: 0.18 }, amplitude: 0.55, speed: 0.22, phase: 0.0 },
      { id: "leftFront", rect: { x: 0.02, y: 0.12, w: 0.28, h: 0.45 }, amplitude: 1.0, speed: 0.38, phase: 1.2 },
      { id: "rightFront", rect: { x: 0.7, y: 0.12, w: 0.28, h: 0.45 }, amplitude: 0.95, speed: 0.34, phase: 2.1 },
      { id: "leftFall", rect: { x: 0.0, y: 0.4, w: 0.26, h: 0.55 }, amplitude: 1.25, speed: 0.28, phase: 0.6 },
      { id: "rightFall", rect: { x: 0.74, y: 0.4, w: 0.26, h: 0.55 }, amplitude: 1.15, speed: 0.31, phase: 2.7 }
    ]
  },
  hologram: {
    scanlineOpacity: 0.08,
    scanlineSpeed: 28,
    lumaPulseAmount: 0.045,
    lumaPulseSpeed: 0.7,
    glitchChancePerSecond: 0.08,
    glitchDurationMs: 90,
    particleCount: 48
  },
  states: {
    dormant: { opacity: 0, tint: 0x6ec8ff, lumaBoost: 0 },
    materializing: { opacity: 1, tint: 0xa8f0ff, lumaBoost: 0.15 },
    idle: { opacity: 1, tint: 0xffffff, lumaBoost: 0 },
    listening: { opacity: 1, tint: 0xd7f4ff, lumaBoost: 0.06 },
    thinking: { opacity: 1, tint: 0xc9b6ff, lumaBoost: 0.1 },
    speaking: { opacity: 1, tint: 0xffffff, lumaBoost: 0.08 },
    error: { opacity: 1, tint: 0xff8ad8, lumaBoost: 0.12 },
    dematerializing: { opacity: 0, tint: 0x6ec8ff, lumaBoost: 0.2 }
  },
  audio: {
    fftSize: 2048,
    smoothing: 0.75,
    amplitudeClosed: 0.02,
    amplitudeWide: 0.28
  }
};
