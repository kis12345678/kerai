"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

// Electric-cyan family, per the OpenJarvis design system — states are distinguished by
// brightness/pulse, not hue shifts.
const STATE_COLOR: Record<OrbState, [number, number, number]> = {
  idle: [34, 211, 238], // dim cyan
  listening: [103, 232, 249], // cyan-300 — "actively capturing your command"
  thinking: [34, 211, 238], // electric cyan
  speaking: [165, 243, 252], // cyan-200, brightest
};

const STATE_INTENSITY: Record<OrbState, number> = {
  idle: 0.35,
  listening: 0.75,
  thinking: 0.9,
  speaking: 1,
};

/**
 * A self-contained canvas particle sphere — no animation library, just requestAnimationFrame.
 * Renders orbiting rings of particles plus radiating spokes around a glowing core, colored and
 * pulsed by `state`. Reacts to real app state (voice mode, busy, speaking), not decoration.
 */
export function AiOrb({ state, size = 120 }: { state: OrbState; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const coreRadius = size * 0.08;
    const maxRadius = size * 0.42;

    const rings = Array.from({ length: 3 }, (_, i) => ({
      radius: maxRadius * (0.55 + i * 0.22),
      tilt: (i * Math.PI) / 3.2,
      speed: 0.15 + i * 0.08,
      particles: 14 + i * 6,
    }));

    const spokes = Array.from({ length: 10 }, (_, i) => ({
      angle: (i / 10) * Math.PI * 2,
      length: maxRadius * (0.55 + Math.random() * 0.45),
    }));

    let raf = 0;
    let t = 0;
    let prevTime = performance.now();

    function frame(now: number) {
      const dt = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      t += dt;

      const s = stateRef.current;
      const [r, g, b] = STATE_COLOR[s];
      const baseIntensity = STATE_INTENSITY[s];
      // Idle breathes slowly; active states pulse faster and more sharply.
      const pulseSpeed = s === "idle" ? 1.2 : s === "listening" ? 3 : 5;
      const pulse = 0.75 + 0.25 * Math.sin(t * pulseSpeed);
      const intensity = baseIntensity * pulse;

      ctx!.clearRect(0, 0, size, size);

      // Radiating spokes
      ctx!.save();
      ctx!.translate(cx, cy);
      for (const spoke of spokes) {
        const angle = spoke.angle + t * 0.1;
        const len = spoke.length * (0.85 + 0.15 * Math.sin(t * 2 + spoke.angle * 3));
        const grad = ctx!.createLinearGradient(0, 0, Math.cos(angle) * len, Math.sin(angle) * len);
        grad.addColorStop(0, `rgba(${r},${g},${b},${0.5 * intensity})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(0, 0);
        ctx!.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
        ctx!.stroke();
      }
      ctx!.restore();

      // Orbiting particle rings
      for (const ring of rings) {
        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(ring.tilt);
        ctx!.scale(1, 0.42);
        for (let i = 0; i < ring.particles; i++) {
          const angle = (i / ring.particles) * Math.PI * 2 + t * ring.speed * (s === "idle" ? 1 : 2.2);
          const x = Math.cos(angle) * ring.radius;
          const y = Math.sin(angle) * ring.radius;
          const depth = (Math.sin(angle) + 1) / 2; // 0..1, dimmer on the "far" side
          const alpha = (0.25 + 0.55 * depth) * intensity;
          ctx!.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx!.beginPath();
          ctx!.arc(x, y, 1 + depth * 1.2, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.restore();
      }

      // Glowing core
      const coreGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 3.2 * (0.8 + 0.3 * pulse));
      coreGrad.addColorStop(0, `rgba(255,255,255,${0.9 * intensity})`);
      coreGrad.addColorStop(0.25, `rgba(${r},${g},${b},${0.85 * intensity})`);
      coreGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx!.fillStyle = coreGrad;
      ctx!.beginPath();
      ctx!.arc(cx, cy, coreRadius * 3.2, 0, Math.PI * 2);
      ctx!.fill();

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="pointer-events-none"
      aria-hidden="true"
    />
  );
}
