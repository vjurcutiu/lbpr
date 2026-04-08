import { useEffect, useMemo, useRef } from "react";
import "./AuthSignalPanel.css";

export type AuthSignalMetric = {
  value: string;
  label: string;
};

type AuthSignalPanelProps = {
  eyebrow: string;
  title: string;
  description: string;
  metrics: AuthSignalMetric[];
  caption?: string;
};

type Particle = {
  seedX: number;
  seedY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  drift: number;
  phase: number;
  size: number;
  signal: number;
};

type PointerState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  active: boolean;
  intensity: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

export default function AuthSignalPanel({
  eyebrow,
  title,
  description,
  metrics,
  caption = "Upload noisy source material, retrieve the right context, and answer with a trail your team can trust.",
}: AuthSignalPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const titleParts = useMemo(() => {
    const words = title.split(" ");
    if (words.length < 4) {
      return { leading: title, trailing: "" };
    }

    return {
      leading: words.slice(0, -2).join(" "),
      trailing: words.slice(-2).join(" "),
    };
  }, [title]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer: PointerState = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      active: false,
      intensity: 0,
    };

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let rafId = 0;
    let particles: Particle[] = [];
    let signalTime = 0;
    let lastTime = performance.now();

    const buildParticles = () => {
      const density = 0.000075;
      const total = Math.max(48, Math.round(width * height * density));
      particles = Array.from({ length: total }, () => {
        const seedX = Math.random() * width;
        const seedY = Math.random() * height;
        return {
          seedX,
          seedY,
          x: seedX,
          y: seedY,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          drift: 0.2 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
          size: 0.65 + Math.random() * 1.7,
          signal: Math.random() * 0.14,
        };
      });
    };

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      buildParticles();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const getSignalY = (x: number, time: number, channel: number) => {
      const normalizedX = width === 0 ? 0 : x / width;
      const base = height * (0.28 + channel * 0.18);
      const amplitude = height * (0.038 + channel * 0.01);
      return (
        base +
        Math.sin(normalizedX * 8.2 + time * 0.54 + channel * 1.2) * amplitude +
        Math.cos(normalizedX * 12.8 - time * 0.34 + channel * 2.1) * amplitude * 0.44
      );
    };

    const drawSignalBands = (time: number) => {
      context.save();
      context.globalCompositeOperation = "screen";

      for (let channel = 0; channel < 3; channel += 1) {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, `rgba(99, 162, 255, ${0.04 + channel * 0.014})`);
        gradient.addColorStop(0.5, `rgba(120, 229, 255, ${0.11 + channel * 0.018})`);
        gradient.addColorStop(1, `rgba(137, 115, 255, ${0.045 + channel * 0.012})`);

        context.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const y = getSignalY(x, time, channel);
          if (x === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.strokeStyle = gradient;
        context.lineWidth = 1.15 + channel * 0.35;
        context.shadowBlur = 20 + channel * 6;
        context.shadowColor = `rgba(120, 196, 255, ${0.14 + channel * 0.05})`;
        context.stroke();
      }

      context.restore();
    };

    const drawConnections = () => {
      const maxDistance = 72;
      const maxDistanceSq = maxDistance * maxDistance;

      context.save();
      context.globalCompositeOperation = "screen";

      for (let i = 0; i < particles.length; i += 2) {
        const particleA = particles[i];
        if (particleA.signal < 0.3) continue;

        for (let j = i + 2; j < Math.min(i + 18, particles.length); j += 2) {
          const particleB = particles[j];
          const dx = particleA.x - particleB.x;
          const dy = particleA.y - particleB.y;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq > maxDistanceSq || particleB.signal < 0.3) continue;

          const distance = Math.sqrt(distanceSq);
          const alpha = (1 - distance / maxDistance) * Math.min(particleA.signal, particleB.signal) * 0.26;
          context.strokeStyle = `rgba(136, 205, 255, ${alpha})`;
          context.lineWidth = 0.65;
          context.beginPath();
          context.moveTo(particleA.x, particleA.y);
          context.lineTo(particleB.x, particleB.y);
          context.stroke();
        }
      }

      context.restore();
    };

    const animate = (now: number) => {
      const delta = Math.min((now - lastTime) / 16.6667, 2.2);
      lastTime = now;
      signalTime += delta * (reduceMotionQuery.matches ? 0.003 : 0.011);

      pointer.x += (pointer.targetX - pointer.x) * 0.1;
      pointer.y += (pointer.targetY - pointer.y) * 0.1;
      pointer.intensity += ((pointer.active ? 1 : 0) - pointer.intensity) * 0.07;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(4, 8, 18, 0.12)";
      context.fillRect(0, 0, width, height);

      drawSignalBands(signalTime);

      for (const particle of particles) {
        const orbitX = Math.cos(signalTime * 1.1 + particle.phase) * particle.drift * 12;
        const orbitY = Math.sin(signalTime * 0.9 + particle.phase * 1.2) * particle.drift * 15;

        particle.x += (particle.seedX + orbitX - particle.x) * 0.016 + particle.vx * delta;
        particle.y += (particle.seedY + orbitY - particle.y) * 0.016 + particle.vy * delta;

        if (particle.x < -40) particle.x = width + 40;
        if (particle.x > width + 40) particle.x = -40;
        if (particle.y < -40) particle.y = height + 40;
        if (particle.y > height + 40) particle.y = -40;

        const pointerDx = pointer.x - particle.x;
        const pointerDy = pointer.y - particle.y;
        const pointerDistance = Math.sqrt(pointerDx * pointerDx + pointerDy * pointerDy) || 1;
        const pointerForce = clamp(1 - pointerDistance / 180, 0, 1) * pointer.intensity;
        const signalY = getSignalY(particle.x, signalTime, 1.1);
        const signalDistance = Math.abs(particle.y - signalY);
        const signalForce = clamp(1 - signalDistance / 44, 0, 1);
        particle.signal += (Math.max(signalForce, pointerForce) - particle.signal) * 0.08;

        if (pointerForce > 0.01) {
          const repel = easeOutCubic(pointerForce) * 0.9;
          particle.x -= (pointerDx / pointerDistance) * repel * delta * 2.1;
          particle.y -= (pointerDy / pointerDistance) * repel * delta * 2.1;
        }

        const radius = particle.size + particle.signal * 1.55;
        const alpha = 0.18 + particle.signal * 0.7;

        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fillStyle = particle.signal > 0.6 ? "rgba(120, 229, 255, 0.95)" : "rgba(175, 222, 255, 0.62)";
        context.globalAlpha = alpha;
        context.shadowBlur = particle.signal > 0.42 ? 14 : 0;
        context.shadowColor = particle.signal > 0.42 ? "rgba(238, 247, 255, 0.98)" : "rgba(71, 138, 255, 0.13)";
        context.fill();
      }

      context.globalAlpha = 1;
      context.shadowBlur = 0;
      drawConnections();
      rafId = window.requestAnimationFrame(animate);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      pointer.targetX = event.clientX - bounds.left;
      pointer.targetY = event.clientY - bounds.top;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
      pointer.targetX = width * 0.68;
      pointer.targetY = height * 0.32;
    };

    const handleVisibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(rafId);
      } else {
        lastTime = performance.now();
        rafId = window.requestAnimationFrame(animate);
      }
    };

    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibility);
    handlePointerLeave();
    rafId = window.requestAnimationFrame(animate);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section className="auth-signal" ref={containerRef}>
      <div className="auth-signal__backdrop" />
      <canvas ref={canvasRef} className="auth-signal__canvas" aria-hidden="true" />
      <div className="auth-signal__noise" />
      <div className="auth-signal__glow" />

      <div className="auth-signal__content">
        <div className="auth-signal__eyebrow">{eyebrow}</div>
        <h1 className="auth-signal__title">
          {titleParts.leading}
          {titleParts.trailing ? <span>{titleParts.trailing}</span> : null}
        </h1>
        <p className="auth-signal__description">{description}</p>

        <div className="auth-signal__metrics" role="list" aria-label="Product highlights">
          {metrics.map((metric) => (
            <div className="auth-signal__metric" key={`${metric.value}-${metric.label}`} role="listitem">
              <span className="auth-signal__metric-value">{metric.value}</span>
              <span className="auth-signal__metric-label">{metric.label}</span>
            </div>
          ))}
        </div>

        <p className="auth-signal__caption">{caption}</p>
      </div>
    </section>
  );
}
