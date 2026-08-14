/**
 * KERAI Neural Core — one renderer, seven states, one parameter table.
 *
 * The visual target is a cinematic energy ring: a deep black void, blue inner
 * energy, violet transition bands, and magenta/pink hotspots flowing around an
 * organically deformed ring. Every state only moves the same knobs (radius,
 * circulation, deformation, brightness, bloom, hotspot energy, palette). Audio
 * is a live input that modulates the same knobs while LISTENING or SPEAKING.
 */

export type NeuralCoreState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'executing'
  | 'waitingApproval'
  | 'error';

/** How strongly each audio band drives the renderer (0..1 per band). */
export interface NeuralAudioDrive {
  /** Overall amplitude → ring scale. */
  scale: number;
  /** Low frequencies → deep blue inner energy. */
  inner: number;
  /** Mid frequencies → ring deformation. */
  deform: number;
  /** High frequencies → fine strands / particles. */
  strand: number;
  /** Speech activity → overall energy density. */
  density: number;
}

export const NO_AUDIO_DRIVE: NeuralAudioDrive = { scale: 0, inner: 0, deform: 0, strand: 0, density: 0 };

export interface NeuralParams {
  /** Base ring radius as a fraction of the canvas half-size. */
  radius: number;
  /** Breathing amplitude (fraction of half-size). */
  radiusPulse: number;
  /** Breathing frequency in Hz. */
  pulseSpeed: number;
  /** Circulation speed of the energy pattern (rad/s). */
  flowSpeed: number;
  /** 0..1 — how one-directional the flow is (executing = high). */
  directionalBias: number;
  /** Number of overlapping strands. */
  strandCount: number;
  /** Radial spread between strands (fraction of radius). */
  strandSpread: number;
  /** Radial deformation amplitude (fraction of radius). */
  deformation: number;
  /** Deformation propagation speed. */
  deformSpeed: number;
  /** Overall energy brightness (alpha multiplier). */
  brightness: number;
  /** Wide bloom intensity. */
  bloom: number;
  /** Deep-blue inner energy intensity. */
  innerEnergy: number;
  /** Particle count. */
  particleCount: number;
  /** 0..1 — radial spread of particles around the ring (fraction of radius). */
  particleSpread: number;
  /** 0..1 — how strongly particles follow the circulation. */
  particleFlow: number;
  /** Number of bright hotspots (0..2). */
  hotspots: number;
  /** Hotspot intensity. */
  hotspotIntensity: number;
  /** Audio drive weights. */
  audio: NeuralAudioDrive;
  /** Main hue (electric blue), transition hue (violet), hotspot hue (magenta). */
  hueMain: number;
  hueAlt: number;
  hueHot: number;
  /** Luminance of the fine core line. */
  luminance: number;
  /** 0..1 — error destabilization (spikes briefly, then settles). */
  chaos: number;
}

export const NEURAL_STATES: Record<NeuralCoreState, NeuralParams> = {
  /** Present but calm: low brightness, deep blue void, soft violet/pink highlights. */
  idle: {
    radius: 0.42,
    radiusPulse: 0.014,
    pulseSpeed: 0.12,
    flowSpeed: 0.32,
    directionalBias: 0.5,
    strandCount: 7,
    strandSpread: 0.11,
    deformation: 0.05,
    deformSpeed: 0.45,
    brightness: 0.5,
    bloom: 0.5,
    innerEnergy: 0.38,
    particleCount: 40,
    particleSpread: 0.2,
    particleFlow: 0.55,
    hotspots: 1,
    hotspotIntensity: 0.5,
    audio: NO_AUDIO_DRIVE,
    hueMain: 210,
    hueAlt: 272,
    hueHot: 325,
    luminance: 0.5,
    chaos: 0,
  },
  /** Live microphone: deformation, hotspots, and strand activity follow the voice. */
  listening: {
    radius: 0.44,
    radiusPulse: 0.03,
    pulseSpeed: 0.25,
    flowSpeed: 0.85,
    directionalBias: 0.55,
    strandCount: 9,
    strandSpread: 0.15,
    deformation: 0.16,
    deformSpeed: 1.4,
    brightness: 0.9,
    bloom: 0.8,
    innerEnergy: 0.6,
    particleCount: 70,
    particleSpread: 0.3,
    particleFlow: 0.8,
    hotspots: 2,
    hotspotIntensity: 0.9,
    audio: { scale: 1, inner: 1, deform: 1, strand: 1, density: 1 },
    hueMain: 210,
    hueAlt: 272,
    hueHot: 328,
    luminance: 0.85,
    chaos: 0,
  },
  /** Reasoning: tighter ring, slow internal circulation, restrained brightness. */
  thinking: {
    radius: 0.38,
    radiusPulse: 0.012,
    pulseSpeed: 0.18,
    flowSpeed: 0.55,
    directionalBias: 0.6,
    strandCount: 6,
    strandSpread: 0.1,
    deformation: 0.06,
    deformSpeed: 0.6,
    brightness: 0.6,
    bloom: 0.45,
    innerEnergy: 0.45,
    particleCount: 40,
    particleSpread: 0.18,
    particleFlow: 0.7,
    hotspots: 1,
    hotspotIntensity: 0.4,
    audio: NO_AUDIO_DRIVE,
    hueMain: 214,
    hueAlt: 268,
    hueHot: 322,
    luminance: 0.6,
    chaos: 0,
  },
  /** KERAI's own voice: flowing expansion, local bright spots, inner blue movement. */
  speaking: {
    radius: 0.45,
    radiusPulse: 0.04,
    pulseSpeed: 0.3,
    flowSpeed: 1.05,
    directionalBias: 0.6,
    strandCount: 9,
    strandSpread: 0.16,
    deformation: 0.18,
    deformSpeed: 1.6,
    brightness: 0.95,
    bloom: 0.85,
    innerEnergy: 0.65,
    particleCount: 80,
    particleSpread: 0.32,
    particleFlow: 0.85,
    hotspots: 2,
    hotspotIntensity: 1,
    audio: { scale: 1, inner: 1, deform: 1, strand: 1, density: 1 },
    hueMain: 208,
    hueAlt: 270,
    hueHot: 330,
    luminance: 0.9,
    chaos: 0,
  },
  /** Active mission: faster circulation, directional flow, no progress ring. */
  executing: {
    radius: 0.45,
    radiusPulse: 0.025,
    pulseSpeed: 0.28,
    flowSpeed: 1.25,
    directionalBias: 0.9,
    strandCount: 9,
    strandSpread: 0.14,
    deformation: 0.1,
    deformSpeed: 0.9,
    brightness: 0.85,
    bloom: 0.7,
    innerEnergy: 0.6,
    particleCount: 75,
    particleSpread: 0.28,
    particleFlow: 0.9,
    hotspots: 2,
    hotspotIntensity: 0.8,
    audio: { scale: 0.4, inner: 0.3, deform: 0.4, strand: 0.3, density: 0.3 },
    hueMain: 208,
    hueAlt: 272,
    hueHot: 326,
    luminance: 0.8,
    chaos: 0,
  },
  /** Waiting for the user: suspended movement, slow breathing, violet pulse. */
  waitingApproval: {
    radius: 0.4,
    radiusPulse: 0.02,
    pulseSpeed: 0.22,
    flowSpeed: 0.22,
    directionalBias: 0.5,
    strandCount: 5,
    strandSpread: 0.1,
    deformation: 0.04,
    deformSpeed: 0.3,
    brightness: 0.5,
    bloom: 0.4,
    innerEnergy: 0.36,
    particleCount: 24,
    particleSpread: 0.16,
    particleFlow: 0.4,
    hotspots: 1,
    hotspotIntensity: 0.45,
    audio: NO_AUDIO_DRIVE,
    hueMain: 262,
    hueAlt: 286,
    hueHot: 332,
    luminance: 0.5,
    chaos: 0,
  },
  /** Problem: brief destabilization, then settle into controlled low energy. */
  error: {
    radius: 0.39,
    radiusPulse: 0.018,
    pulseSpeed: 0.55,
    flowSpeed: 0.14,
    directionalBias: 0.5,
    strandCount: 5,
    strandSpread: 0.09,
    deformation: 0.12,
    deformSpeed: 1.1,
    brightness: 0.42,
    bloom: 0.38,
    innerEnergy: 0.3,
    particleCount: 18,
    particleSpread: 0.14,
    particleFlow: 0.4,
    hotspots: 1,
    hotspotIntensity: 0.35,
    audio: NO_AUDIO_DRIVE,
    hueMain: 220,
    hueAlt: 280,
    hueHot: 340,
    luminance: 0.45,
    chaos: 1,
  },
};

export const NEURAL_STATE_ORDER: NeuralCoreState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'executing',
  'waitingApproval',
  'error',
];

/** Display labels (used outside the animation — never inside it). */
export const NEURAL_STATE_LABEL: Record<NeuralCoreState, string> = {
  idle: 'KERAI is present',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  executing: 'Executing',
  waitingApproval: 'Waiting for approval',
  error: 'Encountered a problem',
};
