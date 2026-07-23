import type { AvatarConfig, MouthViseme } from "../config/avatarConfig";
import type { AudioController } from "./AudioController";

export interface MouthCue {
  start: number;
  end: number;
  value: string;
}

export interface LipSyncWeights {
  closed: number;
  consonant: number;
  slightlyOpen: number;
  wideOpen: number;
  rounded: number;
  puckered: number;
}

const VISEMES: MouthViseme[] = ["closed", "consonant", "slightlyOpen", "wideOpen", "rounded", "puckered"];

/**
 * Supports timestamped Rhubarb mouth cues, with Web Audio amplitude/frequency fallback.
 * Cue times and playback share the AudioController's AudioContext clock.
 */
export class LipSyncController {
  weights: LipSyncWeights = {
    closed: 1,
    consonant: 0,
    slightlyOpen: 0,
    wideOpen: 0,
    rounded: 0,
    puckered: 0
  };

  private cues: MouthCue[] = [];
  private target: LipSyncWeights = { ...this.weights };
  private readonly cfg: AvatarConfig["mouth"];
  private readonly audioCfg: AvatarConfig["audio"];
  private readonly audio: AudioController;
  private useCues = false;

  constructor(cfg: AvatarConfig, audio: AudioController) {
    this.cfg = cfg.mouth;
    this.audioCfg = cfg.audio;
    this.audio = audio;
  }

  setRhubarbCues(cues: MouthCue[]): void {
    this.cues = cues.slice().sort((a, b) => a.start - b.start);
    this.useCues = this.cues.length > 0;
  }

  clearCues(): void {
    this.cues = [];
    this.useCues = false;
  }

  update(dtMs: number): void {
    if (this.useCues && this.audio.isPlaying) {
      this.targetFromCue(this.audio.playbackTime);
    } else if (this.audio.isPlaying) {
      this.targetFromAnalyser();
    } else {
      this.setTarget("closed");
    }

    const k = Math.min(1, dtMs / Math.max(1, this.cfg.blendMs));
    for (const key of VISEMES) {
      this.weights[key] += (this.target[key] - this.weights[key]) * k;
    }
  }

  private setTarget(viseme: MouthViseme): void {
    for (const key of VISEMES) this.target[key] = 0;
    this.target[viseme] = 1;
  }

  private targetFromCue(timeSec: number): void {
    let cue: MouthCue | null = null;
    for (const c of this.cues) {
      if (timeSec >= c.start && timeSec < c.end) {
        cue = c;
        break;
      }
    }
    if (!cue) {
      this.setTarget("closed");
      return;
    }
    const mapped = this.cfg.rhubarbMap[cue.value] || "closed";
    this.setTarget(mapped);
  }

  private targetFromAnalyser(): void {
    const amp = this.audio.getAmplitude();
    const centroid = this.audio.getSpectralCentroid();
    const { amplitudeClosed, amplitudeWide } = this.audioCfg;

    if (amp <= amplitudeClosed) {
      this.setTarget("closed");
      return;
    }

    const open = Math.min(1, (amp - amplitudeClosed) / (amplitudeWide - amplitudeClosed));
    for (const key of VISEMES) this.target[key] = 0;

    if (open < 0.2) {
      this.target.consonant = 1 - open / 0.2;
      this.target.slightlyOpen = open / 0.2;
    } else if (open < 0.55) {
      const u = (open - 0.2) / 0.35;
      this.target.slightlyOpen = 1 - u;
      if (centroid > 0.45) this.target.rounded = u;
      else this.target.wideOpen = u;
    } else {
      const u = (open - 0.55) / 0.45;
      if (centroid < 0.3) {
        this.target.puckered = u;
        this.target.rounded = 1 - u;
      } else {
        this.target.wideOpen = 0.4 + 0.6 * u;
        this.target.rounded = 1 - this.target.wideOpen;
      }
    }
  }
}
