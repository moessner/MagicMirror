/**
 * Shared AudioContext clock for playback + lip-sync analysis.
 */
export class AudioController {
  readonly context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private mediaElementSource: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode;
  private gain: GainNode;
  private freqData: Uint8Array<ArrayBuffer>;
  private timeData: Uint8Array<ArrayBuffer>;
  private startedAt = 0;
  private playing = false;
  private streamAttached = false;
  private onEnded: (() => void) | null = null;

  constructor(fftSize = 2048, smoothing = 0.75) {
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = smoothing;
    this.gain = this.context.createGain();
    this.gain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  /** AudioContext current time — use for cue scheduling. */
  get currentTime(): number {
    return this.context.currentTime;
  }

  get isPlaying(): boolean {
    return this.playing || this.streamAttached;
  }

  /**
   * Tap a live MediaStream (e.g. WebRTC remote audio) for analyser lip-sync.
   * Playback stays on the caller's <audio> element; this path is silent.
   */
  attachMediaStream(stream: MediaStream): void {
    this.stop();
    this.detachMediaStream();
    void this.resume();
    // Mute Web Audio speakers while the HTMLAudioElement plays the remote stream.
    try {
      this.analyser.disconnect(this.context.destination);
    } catch {
      // already disconnected
    }
    this.streamSource = this.context.createMediaStreamSource(stream);
    this.streamSource.connect(this.analyser);
    this.streamAttached = true;
    this.startedAt = this.context.currentTime;
  }

  detachMediaStream(): void {
    if (this.streamSource) {
      try {
        this.streamSource.disconnect();
      } catch {
        // ignore
      }
      this.streamSource = null;
    }
    if (this.mediaElementSource) {
      try {
        this.mediaElementSource.disconnect();
      } catch {
        // ignore
      }
      // MediaElementAudioSourceNode is permanently bound to its element; keep the node.
    }
    if (this.streamAttached) {
      try {
        this.analyser.connect(this.context.destination);
      } catch {
        // already connected
      }
    }
    this.streamAttached = false;
  }

  /**
   * Route an HTMLMediaElement through the analyser for lip-sync + audible output.
   * Creating a MediaElementSource redirects element output into the Web Audio graph,
   * so the analyser must stay connected to the destination.
   */
  attachMediaElement(element: HTMLMediaElement): void {
    this.stop();
    if (this.streamSource) {
      try {
        this.streamSource.disconnect();
      } catch {
        // ignore
      }
      this.streamSource = null;
    }
    void this.resume();
    if (!this.mediaElementSource) {
      this.mediaElementSource = this.context.createMediaElementSource(element);
    }
    try {
      this.mediaElementSource.disconnect();
    } catch {
      // first connect
    }
    this.mediaElementSource.connect(this.analyser);
    try {
      this.analyser.connect(this.context.destination);
    } catch {
      // already connected
    }
    this.streamAttached = true;
    this.startedAt = this.context.currentTime;
  }

  async loadUrl(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return this.context.decodeAudioData(buf.slice(0));
  }

  async loadFile(file: File): Promise<AudioBuffer> {
    const buf = await file.arrayBuffer();
    return this.context.decodeAudioData(buf.slice(0));
  }

  async loadArrayBuffer(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.context.decodeAudioData(data.slice(0));
  }

  playBuffer(buffer: AudioBuffer, onEnded?: () => void): void {
    this.stop();
    this.onEnded = onEnded || null;
    const src = this.context.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.onended = () => {
      this.playing = false;
      this.source = null;
      if (this.onEnded) this.onEnded();
    };
    this.source = src;
    this.startedAt = this.context.currentTime;
    this.playing = true;
    src.start(0);
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
    // Keep live stream taps unless explicitly detached.
  }

  /** Seconds since this clip started, in AudioContext time. */
  get playbackTime(): number {
    if (!this.playing) return 0;
    return Math.max(0, this.context.currentTime - this.startedAt);
  }

  getAmplitude(): number {
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.timeData.length);
  }

  /** Spectral centroid proxy in 0–1 for rounded vs open mouths. */
  getSpectralCentroid(): number {
    this.analyser.getByteFrequencyData(this.freqData);
    let weighted = 0;
    let total = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      const mag = this.freqData[i];
      weighted += i * mag;
      total += mag;
    }
    if (total <= 0) return 0;
    return weighted / total / this.freqData.length;
  }
}
