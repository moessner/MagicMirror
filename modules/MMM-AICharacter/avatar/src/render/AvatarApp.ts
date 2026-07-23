import { Application, Assets, Container, Graphics, Sprite, Filter, GlProgram } from "pixi.js";
import { avatarConfig, type AvatarState, type MouthViseme, type NormRect } from "../config/avatarConfig";
import { AudioController } from "../controllers/AudioController";
import { BlinkController } from "../controllers/BlinkController";
import { HairController } from "../controllers/HairController";
import { HologramController } from "../controllers/HologramController";
import { LipSyncController, type MouthCue } from "../controllers/LipSyncController";
import { StateController } from "../controllers/StateController";

const VISEMES: MouthViseme[] = ["closed", "consonant", "slightlyOpen", "wideOpen", "rounded", "puckered"];

const scanlineFrag = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uOffset;
uniform float uOpacity;

void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  float line = step(0.55, fract((vTextureCoord.y * 420.0) + uOffset * 0.01));
  c.rgb *= 1.0 - line * uOpacity;
  finalColor = c;
}
`;

const scanlineVert = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;

export class AvatarApp {
  readonly audio: AudioController;
  readonly lipSync: LipSyncController;
  readonly states: StateController;

  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private faceRoot = new Container();
  private baseSprite!: Sprite;
  private mouthSprites = new Map<MouthViseme, Sprite>();
  private eyesClosed!: Sprite;
  private eyeMask!: Graphics;
  private hairSprites: Array<{ sprite: Sprite; id: string }> = [];
  private particleGfx!: Graphics;
  private scanFilter!: Filter;
  private blink: BlinkController;
  private hair: HairController;
  private hologram: HologramController;
  private lastTs = 0;
  private sourceW = 1;
  private sourceH = 1;
  private running = false;
  private baseX = 0;
  private baseY = 0;

  constructor() {
    this.audio = new AudioController(avatarConfig.audio.fftSize, avatarConfig.audio.smoothing);
    this.lipSync = new LipSyncController(avatarConfig, this.audio);
    this.states = new StateController(avatarConfig.states);
    this.blink = new BlinkController(avatarConfig.eyes);
    this.hair = new HairController(avatarConfig.hair);
    this.hologram = new HologramController(avatarConfig.hologram);
  }

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const app = new Application();
    await app.init({
      background: avatarConfig.background,
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1)
    });
    host.innerHTML = "";
    host.appendChild(app.canvas);
    this.app = app;

    const sourceTex = await Assets.load(avatarConfig.assets.source);
    const eyesClosedTex = await Assets.load(avatarConfig.assets.eyesClosed);
    this.sourceW = sourceTex.width;
    this.sourceH = sourceTex.height;

    this.baseSprite = new Sprite(sourceTex);
    this.faceRoot.addChild(this.baseSprite);

    for (const region of avatarConfig.hair.regions) {
      const sprite = new Sprite(sourceTex);
      const mask = new Graphics();
      this.drawNormRect(mask, region.rect, this.sourceW, this.sourceH);
      sprite.addChild(mask);
      sprite.mask = mask;
      this.faceRoot.addChild(sprite);
      this.hairSprites.push({ sprite, id: region.id });
    }

    for (const viseme of VISEMES) {
      const tex = await Assets.load(avatarConfig.assets.mouth[viseme]);
      const sprite = new Sprite(tex);
      const mask = new Graphics();
      this.drawNormRect(mask, avatarConfig.mouth.roi, this.sourceW, this.sourceH);
      sprite.addChild(mask);
      sprite.mask = mask;
      sprite.alpha = viseme === "closed" ? 1 : 0;
      this.faceRoot.addChild(sprite);
      this.mouthSprites.set(viseme, sprite);
    }

    this.eyesClosed = new Sprite(eyesClosedTex);
    this.eyeMask = new Graphics();
    this.eyesClosed.addChild(this.eyeMask);
    this.eyesClosed.mask = this.eyeMask;
    this.eyesClosed.alpha = 0;
    this.faceRoot.addChild(this.eyesClosed);

    this.particleGfx = new Graphics();
    this.faceRoot.addChild(this.particleGfx);

    this.scanFilter = new Filter({
      glProgram: new GlProgram({ vertex: scanlineVert, fragment: scanlineFrag }),
      resources: {
        scanUniforms: {
          uOffset: { value: 0, type: "f32" },
          uOpacity: { value: avatarConfig.hologram.scanlineOpacity, type: "f32" }
        }
      }
    });
    this.faceRoot.filters = [this.scanFilter];

    app.stage.addChild(this.faceRoot);
    this.layout();
    window.addEventListener("resize", () => this.layout());

    this.running = true;
    this.lastTs = performance.now();
    app.ticker.add(() => this.tick());
    this.states.setState("materializing", 1100);
    window.setTimeout(() => this.states.setState("idle", 700), 1150);
  }

  setState(state: AvatarState): void {
    const slow = state === "materializing" || state === "dematerializing" ? 1200 : 500;
    this.states.setState(state, slow);
  }

  getState(): AvatarState {
    return this.states.state;
  }

  setRhubarbCues(cues: MouthCue[]): void {
    this.lipSync.setRhubarbCues(cues);
  }

  async playAudioUrl(url: string, cues?: MouthCue[]): Promise<void> {
    await this.audio.resume();
    const buffer = await this.audio.loadUrl(url);
    if (cues) this.lipSync.setRhubarbCues(cues);
    else this.lipSync.clearCues();
    this.setState("speaking");
    this.audio.playBuffer(buffer, () => this.setState("idle"));
  }

  async playAudioFile(file: File, cues?: MouthCue[]): Promise<void> {
    await this.audio.resume();
    const buffer = await this.audio.loadFile(file);
    if (cues) this.lipSync.setRhubarbCues(cues);
    else this.lipSync.clearCues();
    this.setState("speaking");
    this.audio.playBuffer(buffer, () => this.setState("idle"));
  }

  async playAudioBuffer(data: ArrayBuffer, cues?: MouthCue[]): Promise<void> {
    await this.audio.resume();
    const buffer = await this.audio.loadArrayBuffer(data);
    if (cues) this.lipSync.setRhubarbCues(cues);
    else this.lipSync.clearCues();
    this.setState("speaking");
    this.audio.playBuffer(buffer, () => this.setState("idle"));
  }

  stopAudio(): void {
    this.audio.stop();
    this.audio.detachMediaStream();
    this.lipSync.clearCues();
  }

  async attachStream(stream: MediaStream): Promise<void> {
    await this.audio.resume();
    this.lipSync.clearCues();
    this.audio.attachMediaStream(stream);
  }

  async attachMediaElement(element: HTMLMediaElement): Promise<void> {
    await this.audio.resume();
    this.lipSync.clearCues();
    this.audio.attachMediaElement(element);
  }

  detachStream(): void {
    this.audio.detachMediaStream();
    this.lipSync.clearCues();
  }

  destroy(): void {
    this.running = false;
    this.audio.stop();
    this.audio.detachMediaStream();
    this.app?.destroy(true);
    this.app = null;
  }

  private layout(): void {
    if (!this.app) return;
    const viewW = this.app.screen.width;
    const viewH = this.app.screen.height;
    const scale = Math.min(viewW / this.sourceW, viewH / this.sourceH);
    this.faceRoot.scale.set(scale);
    this.baseX = (viewW - this.sourceW * scale) / 2;
    this.baseY = (viewH - this.sourceH * scale) / 2;
    this.faceRoot.position.set(this.baseX, this.baseY);
  }

  private drawNormRect(g: Graphics, rect: NormRect, w: number, h: number): void {
    g.clear();
    g.rect(rect.x * w, rect.y * h, rect.w * w, rect.h * h);
    g.fill(0xffffff);
  }

  private updateEyeMask(lid: number): void {
    this.eyeMask.clear();
    if (lid <= 0.01) {
      this.eyesClosed.alpha = 0;
      return;
    }
    this.eyesClosed.alpha = 1;
    for (const roi of [avatarConfig.eyes.left, avatarConfig.eyes.right]) {
      const x = roi.x * this.sourceW;
      const y = roi.y * this.sourceH;
      const w = roi.w * this.sourceW;
      const h = roi.h * this.sourceH * lid;
      this.eyeMask.rect(x, y, w, h);
    }
    this.eyeMask.fill(0xffffff);
  }

  private tick(): void {
    if (!this.running || !this.app) return;
    const now = performance.now();
    const dt = Math.min(50, now - this.lastTs);
    this.lastTs = now;

    this.blink.update(dt);
    this.lipSync.update(dt);
    const hairMotion = this.hair.update(dt);
    const holo = this.hologram.update(dt);
    const state = this.states.update(dt);

    this.updateEyeMask(this.blink.lid);
    this.faceRoot.position.set(this.baseX + this.blink.gazeX + holo.glitchOffsetX, this.baseY + this.blink.gazeY);

    for (const { sprite, id } of this.hairSprites) {
      const sample = hairMotion.find((m) => m.id === id);
      if (!sample) continue;
      sprite.x = sample.offsetX;
      sprite.y = sample.offsetY;
      sprite.skew.x = sample.skew;
    }

    for (const viseme of VISEMES) {
      const sprite = this.mouthSprites.get(viseme);
      if (sprite) sprite.alpha = this.lipSync.weights[viseme];
    }

    const uniforms = this.scanFilter.resources.scanUniforms.uniforms as {
      uOffset: number;
      uOpacity: number;
    };
    uniforms.uOffset = holo.scanOffset;

    this.particleGfx.clear();
    for (const p of holo.particles) {
      this.particleGfx.circle(p.x * this.sourceW, p.y * this.sourceH, 1.2);
      this.particleGfx.fill({ color: 0xa8f0ff, alpha: p.a * state.opacity });
    }

    this.faceRoot.alpha = state.opacity;
    this.faceRoot.tint = state.tint;
    this.baseSprite.alpha = Math.min(1, holo.luma + state.lumaBoost);
  }
}
