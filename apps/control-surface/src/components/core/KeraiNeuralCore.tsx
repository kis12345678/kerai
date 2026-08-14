import { useEffect, useRef } from 'react';
import { approach, SmoothedDrive, SmoothedMeter } from '../../lib/audio';
import {
  NEURAL_STATE_LABEL,
  NEURAL_STATES,
  NO_AUDIO_DRIVE,
  type NeuralAudioDrive,
  type NeuralCoreState,
  type NeuralParams,
} from '../../lib/neural';

/**
 * KERAI Neural Core — the cinematic, procedural energy ring.
 *
 * One renderer, one engine: every state is a row in the parameter table in
 * lib/neural.ts and the engine interpolates smoothly between rows. The canvas
 * draws the reference's visual language natively — a deep luminous void, blue
 * inner energy, blue→violet flowing strands, magenta hotspots, layered bloom,
 * motion trails and drifting wisps — with procedural radial deformation so the
 * circumference is never the same geometry twice. Real audio (microphone or
 * TTS, Phase C) arrives as a `NeuralAudioDrive` and modulates the same knobs;
 * `audioLevel` is the simple 0..1 fallback.
 *
 * Rendering lives entirely outside React's render cycle: React only passes
 * state + audio; a self-owned rAF loop draws, and the effect is disposed on
 * unmount (buffers are recreated only on resize/DPR change).
 */

export interface KeraiNeuralCoreProps {
  state?: NeuralCoreState;
  /**
   * Normalized 0..1 live audio level — the simple fallback used until Phase C
   * wires the microphone/TTS. Prefer `drive` when spectral data is available.
   */
  audioLevel?: number;
  /** Full spectral audio drive (already smoothed) from the AudioAnalyzer. */
  drive?: NeuralAudioDrive;
  /** CSS size in pixels; omit to fill the parent container (responsive). */
  size?: number;
  label?: string;
  className?: string;
}

const TWO_PI = Math.PI * 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle into [-π, π]. */
function wrapAngle(a: number): number {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  return a;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${Math.round(((h % 360) + 360) % 360)} ${Math.round(clamp01(s) * 100)}% ${Math.round(clamp01(l) * 100)}% / ${clamp01(a)})`;
}

/** Golden-ratio pseudo-random in 0..1 for stable, evenly spread seeds. */
function seed(i: number): number {
  return (i * 0.6180339887498949) % 1;
}

export function KeraiNeuralCore({
  state = 'idle',
  audioLevel = 0,
  drive,
  size,
  label,
  className,
}: KeraiNeuralCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ state, audioLevel, drive });
  propsRef.current = { state, audioLevel, drive };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motionScale = reducedMotion ? 0.3 : 1;

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = true;
    let hidden = document.hidden;
    let lastTime = performance.now();
    let elapsed = 0;
    let prevState: NeuralCoreState = propsRef.current.state;
    let chaosSpike = 0;

    /* Interpolated runtime params — start at the idle row, approach targets. */
    const current: NeuralParams = { ...NEURAL_STATES.idle };
    const levelMeter = new SmoothedMeter(0.08, 0.28);
    const driveSmoother = new SmoothedDrive();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // sharp on high-DPI, bounded for perf
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    /* Re-resolve when the device pixel ratio changes (monitor move / zoom). */
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDprChange = () => resize();
    if (dprQuery.addEventListener) dprQuery.addEventListener('change', onDprChange);

    const onVisibility = () => {
      hidden = document.hidden;
      if (hidden) {
        cancelAnimationFrame(raf);
      } else {
        lastTime = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const frame = (now: number) => {
      if (!running || hidden) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += dt;

      const { state: st, audioLevel: level, drive: rawDrive } = propsRef.current;

      /* State transitions: error destabilizes briefly, then settles into a
         controlled low-energy state (per design — never a red alarm ring). */
      if (st !== prevState) {
        prevState = st;
        chaosSpike = st === 'error' ? 1 : 0;
      }
      if (st === 'error') chaosSpike = Math.max(0, chaosSpike - dt * 0.9);

      /* Smooth the incoming audio (attack/release) and the spectral drive. */
      const audio = levelMeter.push(level, dt);
      const raw: NeuralAudioDrive = rawDrive ?? {
        scale: audio,
        inner: audio * 0.8,
        deform: audio,
        strand: audio * 0.85,
        density: audio * 0.7,
      };
      const audible = st === 'listening' || st === 'speaking';
      const target = NEURAL_STATES[st];
      const driveSmoothed = driveSmoother.push(audible ? raw : NO_AUDIO_DRIVE, dt, audible ? 6 : 3);

      /* Interpolate every numeric knob toward the state's row. */
      const approachKey = (key: Exclude<keyof NeuralParams, 'audio'>, rate = 2.5) => {
        current[key] = approach(current[key], target[key], dt, rate);
      };
      approachKey('radius');
      approachKey('radiusPulse');
      approachKey('pulseSpeed');
      approachKey('flowSpeed');
      approachKey('directionalBias');
      approachKey('strandCount', 1.8);
      approachKey('strandSpread');
      approachKey('deformation');
      approachKey('deformSpeed');
      approachKey('brightness');
      approachKey('bloom');
      approachKey('innerEnergy');
      approachKey('particleCount', 1.8);
      approachKey('particleFlow');
      approachKey('hotspots', 1.8);
      approachKey('hotspotIntensity');
      approachKey('hueMain', 1.5);
      approachKey('hueAlt', 1.5);
      approachKey('hueHot', 1.5);
      approachKey('luminance');
      approachKey('chaos', 1.2);

      draw(context, width, height, current, elapsed, motionScale, driveSmoothed, chaosSpike);
      raf = requestAnimationFrame(frame);
    };

    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (dprQuery.removeEventListener) dprQuery.removeEventListener('change', onDprChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size ?? '100%', height: size ?? '100%' }}
      role="img"
      aria-label={label ?? NEURAL_STATE_LABEL[state]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

interface StrandPoint {
  theta: number;
  x: number;
  y: number;
  hue: number;
  light: number;
  alpha: number;
}

const STRAND_SAMPLES = 72;

function buildStrand(
  p: NeuralParams,
  t: number,
  cx: number,
  cy: number,
  baseRadius: number,
  motionScale: number,
  drive: NeuralAudioDrive,
  chaos: number,
  strandIndex: number,
  strandCount: number,
  hotspotAngles: number[],
): StrandPoint[] {
  const flow = t * p.flowSpeed * motionScale;
  const wave = t * p.deformSpeed * motionScale * TWO_PI;
  const phase = (strandIndex / strandCount) * TWO_PI;

  /* Per-strand personality: radius spread, direction, speed, brightness. */
  const spread = (strandIndex / Math.max(1, strandCount - 1) - 0.5) * 2;
  const radiusFactor = 1 + spread * p.strandSpread * 0.9;
  const direction = strandIndex % 2 === 0 ? 1 : -0.72;
  const speedMul = 0.85 + 0.3 * seed(strandIndex * 3 + 1);
  const depth = 1 - 0.14 * Math.abs(spread); // inner strands read closer/brighter
  const jitter = chaos > 0.02 ? Math.sin(t * 26 + strandIndex * 7.3) * 0.35 * chaos : 0;

  /* Four-octave layered radial deformation — the circumference never repeats. */
  const deform = p.deformation * (1 + drive.deform * 1.5 + chaos * 2.2) * motionScale;

  const points: StrandPoint[] = [];
  for (let i = 0; i < STRAND_SAMPLES; i++) {
    const theta = (i / STRAND_SAMPLES) * TWO_PI;
    const octaves =
      0.35 * Math.sin(theta * 3 + wave * 0.7 + phase * 1.3 + jitter * 4) +
      0.3 * Math.sin(theta * 5 - wave * 1.1 + phase * 1.7 + jitter * 3) +
      0.25 * Math.sin(theta * 8 + wave * 0.4 + phase * 2.3) +
      0.1 * Math.sin(theta * 13 - wave * 0.8 + phase * 0.6);
    const radius =
      baseRadius * radiusFactor * (1 + deform * octaves) * (1 + chaos * 0.035 * Math.sin(t * 23 + theta));

    /* Color flow: electric blue → violet undulating around the ring, with
       magenta pulling in near hotspots and at the bright moving energy. */
    const blend = 0.5 + 0.5 * Math.sin(theta * 1.6 + flow * 0.5 * direction * speedMul + phase);
    let hue = lerp(p.hueMain, p.hueAlt, blend);
    let sat = 0.72 + 0.18 * blend;
    let light = p.luminance * 0.18 + 0.55 + 0.09 * blend;

    let hot = 0;
    for (const a of hotspotAngles) {
      const dist = Math.abs(wrapAngle(theta - a));
      hot = Math.max(hot, Math.pow(1 - Math.min(1, dist / 0.75), 2));
    }
    const hotStrength = hot * p.hotspotIntensity * (0.6 + 0.4 * drive.strand);
    if (hotStrength > 0.01) {
      hue = lerp(hue, p.hueHot, clamp01(hotStrength * 0.85));
      light += hotStrength * 0.16;
      sat = Math.min(1, sat + hotStrength * 0.15);
    }

    const bright = 0.5 + 0.5 * Math.sin(theta * 3 + flow * 1.4 + phase * 2.1);
    const alpha = p.brightness * depth * (0.3 + 0.7 * bright) * (0.72 + 0.28 * drive.strand);

    const wobble = 1 + 0.03 * Math.sin(theta * 7 + t * 1.1 * motionScale + strandIndex);
    points.push({
      theta,
      x: cx + Math.cos(theta + flow * 0.06 * direction) * radius * wobble,
      y: cy + Math.sin(theta + flow * 0.06 * direction) * radius * wobble * 0.965,
      hue,
      light,
      alpha,
    });
  }
  return points;
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  p: NeuralParams,
  t: number,
  motionScale: number,
  drive: NeuralAudioDrive,
  chaos: number,
): void {
  /* Motion trails — fade the previous frame instead of clearing. */
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0, 0, 0, ${motionScale < 1 ? 0.5 : 0.24})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';

  const cx = width / 2;
  const cy = height / 2;
  const half = Math.min(width, height) / 2;

  /* Breathing + audio scale (only driven while listening/speaking). */
  const breathe = p.radiusPulse * Math.sin(t * TWO_PI * p.pulseSpeed * motionScale);
  let baseRadius = half * (p.radius + breathe) * (1 + drive.scale * 0.085);
  if (chaos > 0.02) baseRadius *= 1 + chaos * 0.04 * Math.sin(t * 18);

  const brightness = p.brightness * (1 + drive.density * 0.5) * (1 - chaos * 0.16 * (0.5 + 0.5 * Math.sin(t * 41)));
  const strandCount = Math.max(2, Math.round(p.strandCount));
  const flow = t * p.flowSpeed * motionScale;

  /* Moving hotspots — the brightest point travels around the ring. */
  const hotspotCount = Math.max(0, Math.round(p.hotspots));
  const hotspotAngles: number[] = [];
  const hotspotStrengths: number[] = [];
  for (let k = 0; k < hotspotCount; k++) {
    const direction = k % 2 === 0 ? 1 : -0.7;
    const angle = k * Math.PI + flow * 0.9 * direction + Math.sin(t * 0.31 + k * 2.4) * 0.55 * motionScale;
    hotspotAngles.push(angle);
    hotspotStrengths.push(
      p.hotspotIntensity * brightness * (0.7 + 0.3 * Math.sin(t * 1.1 + k * 3.1)) * (1 + drive.strand * 0.5),
    );
  }

  /* Layer 5 — outer bloom / halo (wide, soft, hue of the ring). */
  if (p.bloom > 0.01) {
    /* Annular halo — transparent at the center so the void stays deep black,
       peaking just outside the ring and fading wide. */
    const halo = ctx.createRadialGradient(cx, cy, baseRadius * 0.25, cx, cy, baseRadius * 2.15);
    const haloHue = lerp(p.hueMain, p.hueAlt, 0.45);
    halo.addColorStop(0, hsla(haloHue, 0.75, 0.6, 0));
    halo.addColorStop(0.3, hsla(haloHue, 0.75, 0.6, p.bloom * brightness * 0.05 * (1 + drive.density * 0.7)));
    halo.addColorStop(0.45, hsla(haloHue, 0.8, 0.62, p.bloom * brightness * 0.11 * (1 + drive.density * 0.7)));
    halo.addColorStop(0.8, hsla(p.hueMain, 0.8, 0.55, p.bloom * brightness * 0.03));
    halo.addColorStop(1, hsla(p.hueMain, 0.8, 0.5, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
  }

  /* Layer 2 — deep blue inner energy (a dim volumetric interior, never a solid fill). */
  const innerIntensity = p.innerEnergy * brightness * (1 + drive.inner * 1.4) * (1 - chaos * 0.3);
  if (innerIntensity > 0.01) {
    /* Deep blue energy hugging the ring's interior — the ramp starts well
       outside the void so the center stays dark and dimensional. */
    const inner = ctx.createRadialGradient(cx, cy, baseRadius * 0.6, cx, cy, baseRadius * 1.08);
    inner.addColorStop(0, hsla(224, 0.85, 0.5, 0));
    inner.addColorStop(0.55, hsla(p.hueMain, 0.8, 0.52, innerIntensity * 0.32));
    inner.addColorStop(1, hsla(p.hueMain, 0.85, 0.6, 0));
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 1.08, 0, TWO_PI);
    ctx.fill();

    /* A slow internal circulation blob gives the void depth and dimension. */
    const swirlAngle = flow * 0.28 + Math.sin(t * 0.22 * motionScale) * 1.2;
    const swirlR = baseRadius * (0.5 + 0.1 * Math.sin(t * 0.17 * motionScale));
    const blob = ctx.createRadialGradient(
      cx + Math.cos(swirlAngle) * swirlR,
      cy + Math.sin(swirlAngle) * swirlR * 0.9,
      0,
      cx + Math.cos(swirlAngle) * swirlR,
      cy + Math.sin(swirlAngle) * swirlR * 0.9,
      baseRadius * 0.55,
    );
    blob.addColorStop(0, hsla(p.hueAlt, 0.85, 0.58, innerIntensity * 0.14 * (1 + drive.inner)));
    blob.addColorStop(1, hsla(p.hueMain, 0.8, 0.55, 0));
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 1.06, 0, TWO_PI);
    ctx.fill();
  }

  /* Layer 3 + 4 — the flowing energy strands. */
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let s = 0; s < strandCount; s++) {
    const points = buildStrand(p, t, cx, cy, baseRadius, motionScale, drive, chaos, s, strandCount, hotspotAngles);

    /* Medium glow pass — one soft stroke under the fine segments. */
    const glowHue = lerp(p.hueMain, p.hueAlt, s / strandCount);
    ctx.strokeStyle = hsla(glowHue, 0.8, 0.58, 0.05 * brightness * (1 + drive.strand * 0.6));
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y);
      else ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    /* Fine energy segments — each carries its own color/light along the ring. */
    const widthMul = 1.15 + 0.5 * Math.abs(s / strandCount - 0.5) * 2; // outer strands slightly wider
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const next = points[(i + 1) % points.length];
      ctx.strokeStyle = hsla(pt.hue, 0.72 + 0.18 * (pt.light - 0.5), pt.light, pt.alpha);
      ctx.lineWidth = 1.35 * widthMul * (0.65 + 0.55 * pt.light);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
  }

  /* Layer 3 core — the sharp luminous energy line riding the primary strand. */
  {
    const corePoints = buildStrand(p, t, cx, cy, baseRadius, motionScale, drive, chaos, 0, strandCount, hotspotAngles);
    ctx.strokeStyle = hsla(p.hueMain, 1, 0.9, 0.4 * brightness * (1 + drive.strand * 0.7) * (1 - chaos * 0.5));
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < corePoints.length; i++) {
      if (i === 0) ctx.moveTo(corePoints[i].x, corePoints[i].y);
      else ctx.lineTo(corePoints[i].x, corePoints[i].y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /* Hotspot bloom — localized bright energy, strongest near the moving point. */
  for (let k = 0; k < hotspotAngles.length; k++) {
    const a = hotspotAngles[k];
    const strength = hotspotStrengths[k] ?? 0;
    if (strength <= 0.01) continue;
    const wob = 1 + 0.05 * Math.sin(t * 0.7 + k * 2.1);
    const hx = cx + Math.cos(a) * baseRadius * wob;
    const hy = cy + Math.sin(a) * baseRadius * wob * 0.965;
    const bloomR = baseRadius * 0.42;
    const bloom = ctx.createRadialGradient(hx, hy, 0, hx, hy, bloomR);
    bloom.addColorStop(0, hsla(p.hueHot, 0.95, 0.72, strength * 0.32));
    bloom.addColorStop(0.5, hsla(lerp(p.hueHot, p.hueAlt, 0.4), 0.9, 0.6, strength * 0.1));
    bloom.addColorStop(1, hsla(p.hueHot, 0.9, 0.6, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(hx, hy, bloomR, 0, TWO_PI);
    ctx.fill();

    /* White-hot core of the hotspot — the brightest point on the ring. */
    ctx.fillStyle = hsla(lerp(p.hueHot, 0, 0.35), 0.9, 0.92, strength * 0.5);
    ctx.beginPath();
    ctx.arc(hx, hy, 1.6 + strength * 1.6, 0, TWO_PI);
    ctx.fill();
  }

  /* Layer 6 — orbiting ember particles (subtle, hue-matched, flow-following). */
  const particleCount = Math.round(p.particleCount);
  const particleFlow = p.particleFlow;
  for (let i = 0; i < particleCount; i++) {
    const s = seed(i);
    const direction = i % 2 === 0 ? 1 : -1;
    const angle =
      s * TWO_PI + flow * direction * (0.35 + 0.65 * particleFlow) * (0.6 + 0.8 * s) + Math.sin(t * 0.9 + s * 13) * 0.2;
    const radius =
      baseRadius * (0.52 + p.particleSpread * (0.35 + 0.65 * s)) * (1 + 0.07 * Math.sin(t * 1.3 * motionScale + s * 11));
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.96;
    const twinkle = 0.5 + 0.5 * Math.sin(t * 1.9 * motionScale + s * 12.7);
    const alpha = brightness * (0.14 + 0.5 * twinkle * (0.5 + 0.5 * s)) * (0.7 + 0.3 * drive.strand);
    const size = 0.8 + 1.5 * s * (1 + drive.strand * 0.8);
    ctx.fillStyle = hsla(lerp(p.hueMain, p.hueHot, s), 0.85, 0.62 + 0.2 * s, alpha);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TWO_PI);
    ctx.fill();
  }

  /* Layer 6 — occasional wisps: short curved energy trails near the ring. */
  const wispCount = 6;
  for (let i = 0; i < wispCount; i++) {
    const s = seed(i * 7 + 2);
    const envelope = Math.max(0, Math.sin(t * 0.4 * motionScale + s * TWO_PI * 3));
    const alpha = brightness * envelope * envelope * 0.4 * (0.6 + 0.4 * drive.strand);
    if (alpha <= 0.01) continue;
    const angle = s * TWO_PI + flow * 0.35 * (s % 2 === 0 ? 1 : -1);
    const radius = baseRadius * (1.02 + ((s * 7) % 5) * 0.05) * (1 + drive.scale * 0.04);
    const wispLen = 0.3 + s * 0.22;
    const startA = angle - wispLen / 2;
    const endA = angle + wispLen / 2;
    const outCurve = 0.25 + s * 0.3;
    const wx = cx + Math.cos(startA) * radius;
    const wy = cy + Math.sin(startA) * radius * 0.965;
    const ex = cx + Math.cos(endA) * radius;
    const ey = cy + Math.sin(endA) * radius * 0.965;
    const mx = cx + Math.cos(angle) * radius * (1 + outCurve);
    const my = cy + Math.sin(angle) * radius * 0.965 * (1 + outCurve);
    ctx.strokeStyle = hsla(lerp(p.hueAlt, p.hueHot, s), 0.9, 0.68, alpha);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}
