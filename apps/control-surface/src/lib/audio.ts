/**
 * Audio analysis layer — the bridge between real audio and the Neural Core.
 *
 * The analyzer runs over a Web Audio `AnalyserNode` (microphone or TTS output),
 * computes three spectral bands plus an overall amplitude, smooths everything
 * with attack/release meters, and maps it to a `NeuralAudioDrive` — the exact
 * knob set the Neural Core renderer understands. No raw audio value is ever
 * bound directly to rendering.
 */

import { NO_AUDIO_DRIVE, type NeuralAudioDrive } from './neural';

/** Normalized spectral summary of one audio window (all values 0..1). */
export interface AudioMetrics {
  amplitude: number;
  lowFrequency: number;
  midFrequency: number;
  highFrequency: number;
  speechDetected: boolean;
  /** Seconds since the last time speech was detected. */
  silenceDuration: number;
}

export const EMPTY_METRICS: AudioMetrics = {
  amplitude: 0,
  lowFrequency: 0,
  midFrequency: 0,
  highFrequency: 0,
  speechDetected: false,
  silenceDuration: Number.POSITIVE_INFINITY,
};

/**
 * Attack/release smoothing per the design rule: never bind raw audio values
 * to rendering. Quick attack (the core responds to a new sound), slower release
 * (it settles back organically instead of jittering).
 */
export class SmoothedMeter {
  private value = 0;

  constructor(
    private readonly attackSeconds: number = 0.12,
    private readonly releaseSeconds: number = 0.35,
  ) {}

  /** Feed a raw 0..1 target; returns the smoothed value. */
  push(target: number, dtSeconds: number): number {
    const clamped = Math.max(0, Math.min(1, target));
    const rate = clamped > this.value ? this.attackSeconds : this.releaseSeconds;
    const t = rate > 0 ? 1 - Math.exp(-dtSeconds / rate) : 1;
    this.value += (clamped - this.value) * t;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

/** Interpolates any value toward a target with exponential smoothing. */
export function approach(current: number, target: number, dtSeconds: number, ratePerSecond = 3): number {
  const t = 1 - Math.exp(-dtSeconds * ratePerSecond);
  return current + (target - current) * t;
}

/** Clamp + normalize a value into 0..1. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/* ------------------------------------------------------------------ */
/* AudioAnalyzer — real FFT data → smoothed metrics → NeuralAudioDrive */
/* ------------------------------------------------------------------ */

export interface AudioAnalyzerOptions {
  /** Analyser FFT size (power of two). Default 2048. */
  fftSize?: number;
  /** Analyser smoothing between windows. Default 0.85 (organic, not jittery). */
  smoothingTimeConstant?: number;
  /** Low/mid band split in Hz. Default 300. */
  lowCutHz?: number;
  /** Mid/high band split in Hz. Default 2400. */
  midCutHz?: number;
  /** Smoothed amplitude above this (0..1) counts as speech. Default 0.16. */
  speechThreshold?: number;
  attackSeconds?: number;
  releaseSeconds?: number;
}

/**
 * Turns a Web Audio AnalyserNode into continuously smoothed metrics.
 * Call `update(dt)` from your own render loop (the Neural Core does), or
 * `start(callback)` to run it on its own rAF loop.
 */
export class AudioAnalyzer {
  private readonly analyser: AnalyserNode;
  private readonly data: Uint8Array<ArrayBuffer>;
  private readonly lowCut: number;
  private readonly midCut: number;
  private readonly speechThreshold: number;

  private readonly amplitude = new SmoothedMeter(0.06, 0.28);
  private readonly low = new SmoothedMeter(0.09, 0.32);
  private readonly mid = new SmoothedMeter(0.09, 0.32);
  private readonly high = new SmoothedMeter(0.07, 0.26);

  private speech = false;
  private belowSpeechTimer = 0;
  private silenceDuration = Number.POSITIVE_INFINITY;

  constructor(analyser: AnalyserNode, options: AudioAnalyzerOptions = {}) {
    this.analyser = analyser;
    analyser.fftSize = options.fftSize ?? 2048;
    analyser.smoothingTimeConstant = options.smoothingTimeConstant ?? 0.85;
    this.data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    this.lowCut = Math.max(1, Math.floor((options.lowCutHz ?? 300) / binHz));
    this.midCut = Math.max(this.lowCut + 1, Math.floor((options.midCutHz ?? 2400) / binHz));
    this.speechThreshold = options.speechThreshold ?? 0.16;
    this.amplitude = new SmoothedMeter(options.attackSeconds ?? 0.06, options.releaseSeconds ?? 0.28);
    this.low = new SmoothedMeter(options.attackSeconds ?? 0.09, options.releaseSeconds ?? 0.32);
    this.mid = new SmoothedMeter(options.attackSeconds ?? 0.09, options.releaseSeconds ?? 0.32);
    this.high = new SmoothedMeter(options.attackSeconds ?? 0.07, options.releaseSeconds ?? 0.26);
  }

  /** Reads the latest FFT window, updates smoothed metrics, returns them. */
  update(dtSeconds: number): AudioMetrics {
    this.analyser.getByteFrequencyData(this.data);

    const range = this.analyser.maxDecibels - this.analyser.minDecibels;
    const normalize = (v: number) => clamp01((v - this.analyser.minDecibels) / range);

    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let peak = 0;
    const bins = this.data.length;
    for (let i = 0; i < bins; i++) {
      const norm = normalize(this.data[i]);
      if (norm > peak) peak = norm;
      if (i < this.lowCut) lowSum += norm;
      else if (i < this.midCut) midSum += norm;
      else highSum += norm;
    }
    const ampTarget = clamp01(peak * 1.35);
    const amp = this.amplitude.push(ampTarget, dtSeconds);
    const lowF = this.low.push(clamp01((lowSum / this.lowCut) * 1.9), dtSeconds);
    const midF = this.mid.push(clamp01((midSum / (this.midCut - this.lowCut)) * 1.9), dtSeconds);
    const highF = this.high.push(clamp01((highSum / (bins - this.midCut)) * 2.2), dtSeconds);

    /* Speech activity: sustained smoothed amplitude above threshold. */
    if (amp > this.speechThreshold) {
      this.belowSpeechTimer = 0;
      if (!this.speech) {
        this.speech = true;
        this.silenceDuration = 0;
      }
    } else {
      this.belowSpeechTimer += dtSeconds;
      if (this.speech && this.belowSpeechTimer > 0.55) {
        this.speech = false;
        this.belowSpeechTimer = 0;
      }
    }
    if (this.speech) this.silenceDuration = 0;
    else if (Number.isFinite(this.silenceDuration)) this.silenceDuration += dtSeconds;

    return {
      amplitude: amp,
      lowFrequency: lowF,
      midFrequency: midF,
      highFrequency: highF,
      speechDetected: this.speech,
      silenceDuration: this.silenceDuration,
    };
  }

  /**
   * Advances the analyzer and maps the fresh smoothed metrics onto the Neural
   * Core's audio knobs. Band-specific mapping per spec: amplitude → ring scale,
   * lows → inner blue energy, mids → ring deformation, highs → fine
   * strands/particles, speech → overall energy density.
   */
  toDrive(dtSeconds: number): NeuralAudioDrive {
    const { amplitude: amp, lowFrequency: low, midFrequency: mid, highFrequency: high, speechDetected: speech } =
      this.update(dtSeconds);
    return {
      scale: clamp01(amp * 1.5),
      inner: clamp01(low * 1.5 + amp * 0.25),
      deform: clamp01(mid * 1.45 + amp * 0.3),
      strand: clamp01(high * 1.6 + amp * 0.2),
      density: clamp01((amp + (speech ? 0.2 : 0)) * 1.25),
    };
  }

  /** Runs its own rAF loop; calls `onDrive` every frame with the smoothed drive. */
  start(onDrive: (drive: NeuralAudioDrive, dtSeconds: number) => void): () => void {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      onDrive(this.toDrive(dt), dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }

  reset(): void {
    this.amplitude.reset();
    this.low.reset();
    this.mid.reset();
    this.high.reset();
    this.speech = false;
    this.belowSpeechTimer = 0;
    this.silenceDuration = Number.POSITIVE_INFINITY;
  }
}

/**
 * A second smoothing layer over the drive itself, so even a jumpy spectrum
 * reaches the renderer as organic motion. `push` returns the smoothed drive.
 */
export class SmoothedDrive {
  private current: NeuralAudioDrive = { ...NO_AUDIO_DRIVE };

  push(target: NeuralAudioDrive, dtSeconds: number, ratePerSecond = 6): NeuralAudioDrive {
    const c = this.current;
    this.current = {
      scale: approach(c.scale, target.scale, dtSeconds, ratePerSecond),
      inner: approach(c.inner, target.inner, dtSeconds, ratePerSecond),
      deform: approach(c.deform, target.deform, dtSeconds, ratePerSecond),
      strand: approach(c.strand, target.strand, dtSeconds, ratePerSecond),
      density: approach(c.density, target.density, dtSeconds, ratePerSecond),
    };
    return this.current;
  }

  reset(): void {
    this.current = { ...NO_AUDIO_DRIVE };
  }
}

/* ------------------------------------------------------------------ */
/* Provider interfaces (Phase C implements these with real sources).  */
/* ------------------------------------------------------------------ */

export type MicState = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'error';

export interface IAudioInput {
  readonly state: MicState;
  /** Requests the microphone and starts streaming analysis. Resolves false when denied/unavailable. */
  start(): Promise<boolean>;
  stop(): void;
  /** Subscribes to a smoothed 0..1 level; returns an unsubscribe function. */
  onLevel(callback: (level: number) => void): () => void;
  /** Subscribes to speech-activity toggles (for wake word / VAD integration). */
  onSpeech(callback: (speaking: boolean) => void): () => void;
}

export interface ITtsProvider {
  readonly speaking: boolean;
  /** Synthesizes and plays; resolves when playback finishes or is cancelled. */
  speak(text: string): Promise<void>;
  stop(): void;
  /** Subscribes to a smoothed 0..1 playback level; returns an unsubscribe function. */
  onLevel(callback: (level: number) => void): () => void;
}
