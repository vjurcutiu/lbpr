import { useEffect, useRef } from "react";
import "./AuthSignalBackground.css";

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

export default function AuthSignalBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
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
    let isCompactMode = false;
    let shouldDrawConnections = true;
    let observer: IntersectionObserver | null = null;

    const saveData =
      typeof navigator !== "undefined" && "connection" in navigator
        ? Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
        : false;
    const lowCpuDevice =
      typeof navigator !== "undefined" &&
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency <= 4;

    const palette = {
      trail: "rgba(86, 160, 255, 0.2)",
      point: "rgba(198, 234, 255, 0.82)",
      pulse: "rgba(136, 236, 255, 1)",
      bright: "rgba(246, 251, 255, 1)",
    };

    const buildParticles = () => {
      const density = isCompactMode ? 0.00004 : 0.000108;
      const total = Math.max(68, Math.round(width * height * density));
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
          size: 0.75 + Math.random() * 2.05,
          signal: Math.random() * 0.16,
        };
      });
    };

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      isCompactMode = width < 840 || coarsePointerQuery.matches || saveData || lowCpuDevice;
      shouldDrawConnections = !isCompactMode && !reduceMotionQuery.matches;
      dpr = Math.min(window.devicePixelRatio || 1, isCompactMode ? 1.25 : 2);

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
      const amplitude = height * (0.042 + channel * 0.009);
      return (
        base +
        Math.sin(normalizedX * 8.6 + time * 0.55 + channel * 1.35) * amplitude +
        Math.cos(normalizedX * 13.2 - time * 0.35 + channel * 2.1) * amplitude * 0.46
      );
    };

    const drawSignalBands = (time: number) => {
      context.save();
      context.globalCompositeOperation = "screen";

      const totalChannels = isCompactMode ? 2 : 3;

      for (let channel = 0; channel < totalChannels; channel += 1) {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, `rgba(112, 176, 255, ${0.072 + channel * 0.016})`);
        gradient.addColorStop(0.5, `rgba(126, 234, 255, ${0.14 + channel * 0.024})`);
        gradient.addColorStop(1, `rgba(148, 128, 255, ${0.072 + channel * 0.016})`);

        context.beginPath();
        for (let x = 0; x <= width; x += isCompactMode ? 22 : 14) {
          const y = getSignalY(x, time, channel);
          if (x === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.strokeStyle = gradient;
        context.lineWidth = 1.35 + channel * 0.4;
        context.shadowBlur = 22 + channel * 7;
        context.shadowColor = `rgba(132, 210, 255, ${0.18 + channel * 0.048})`;
        context.stroke();
      }

      context.restore();
    };

    const drawConnections = () => {
      if (!shouldDrawConnections) {
        return;
      }

      const maxDistance = width < 768 ? 56 : 72;
      const maxDistanceSq = maxDistance * maxDistance;
      const stride = width < 768 ? 3 : 2;

      context.save();
      context.globalCompositeOperation = "screen";

      for (let i = 0; i < particles.length; i += stride) {
        const particleA = particles[i];
        if (particleA.signal < 0.32) continue;

        for (let j = i + stride; j < Math.min(i + 18, particles.length); j += stride) {
          const particleB = particles[j];
          const dx = particleA.x - particleB.x;
          const dy = particleA.y - particleB.y;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq > maxDistanceSq || particleB.signal < 0.34) continue;

          const distance = Math.sqrt(distanceSq);
          const alpha = (1 - distance / maxDistance) * Math.min(particleA.signal, particleB.signal) * 0.38;
          context.strokeStyle = `rgba(156, 220, 255, ${alpha})`;
          context.lineWidth = 0.75;
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
      signalTime += delta * (reduceMotionQuery.matches ? 0.004 : isCompactMode ? 0.008 : 0.012);

      pointer.x += (pointer.targetX - pointer.x) * 0.11;
      pointer.y += (pointer.targetY - pointer.y) * 0.11;
      pointer.intensity += ((pointer.active ? 1 : 0) - pointer.intensity) * 0.07;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(4, 8, 18, 0.16)";
      context.fillRect(0, 0, width, height);

      drawSignalBands(signalTime);

      for (const particle of particles) {
        const orbitX = Math.cos(signalTime * 1.1 + particle.phase) * particle.drift * 12;
        const orbitY = Math.sin(signalTime * 0.9 + particle.phase * 1.2) * particle.drift * 16;

        particle.x += (particle.seedX + orbitX - particle.x) * 0.016 + particle.vx * delta;
        particle.y += (particle.seedY + orbitY - particle.y) * 0.016 + particle.vy * delta;

        if (particle.x < -40) particle.x = width + 40;
        if (particle.x > width + 40) particle.x = -40;
        if (particle.y < -40) particle.y = height + 40;
        if (particle.y > height + 40) particle.y = -40;

        const pointerDx = pointer.x - particle.x;
        const pointerDy = pointer.y - particle.y;
        const pointerDistance = Math.sqrt(pointerDx * pointerDx + pointerDy * pointerDy) || 1;
        const pointerForce = shouldDrawConnections ? clamp(1 - pointerDistance / 190, 0, 1) * pointer.intensity : 0;
        const signalY = getSignalY(particle.x, signalTime, 1.1);
        const signalDistance = Math.abs(particle.y - signalY);
        const signalForce = clamp(1 - signalDistance / 42, 0, 1);
        particle.signal += (Math.max(signalForce, pointerForce) - particle.signal) * 0.08;

        if (pointerForce > 0.01) {
          const repel = easeOutCubic(pointerForce) * 0.95;
          particle.x -= (pointerDx / pointerDistance) * repel * delta * 2.2;
          particle.y -= (pointerDy / pointerDistance) * repel * delta * 2.2;
        }

        const radius = particle.size + particle.signal * 1.8;
        const alpha = 0.22 + particle.signal * 0.78;

        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fillStyle = particle.signal > 0.6 ? palette.pulse : palette.point;
        context.globalAlpha = alpha;
        context.shadowBlur = particle.signal > 0.36 ? 18 : 0;
        context.shadowColor = particle.signal > 0.36 ? palette.bright : palette.trail;
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
      pointer.targetY = height * 0.36;
    };

    const handleVisibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(rafId);
      } else {
        lastTime = performance.now();
        rafId = window.requestAnimationFrame(animate);
      }
    };

    if (!coarsePointerQuery.matches) {
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerleave", handlePointerLeave);
    }

    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        if (entry.isIntersecting && !document.hidden) {
          window.cancelAnimationFrame(rafId);
          lastTime = performance.now();
          rafId = window.requestAnimationFrame(animate);
        } else {
          window.cancelAnimationFrame(rafId);
        }
      },
      { threshold: 0.08 },
    );

    observer.observe(container);
    document.addEventListener("visibilitychange", handleVisibility);
    handlePointerLeave();
    rafId = window.requestAnimationFrame(animate);

    return () => {
      resizeObserver.disconnect();
      observer?.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="auth-signal-bg" ref={containerRef} aria-hidden="true">
      <div className="auth-signal-bg__backdrop" />
      <canvas className="auth-signal-bg__canvas" ref={canvasRef} />
      <div className="auth-signal-bg__glow auth-signal-bg__glow--one" />
      <div className="auth-signal-bg__glow auth-signal-bg__glow--two" />
      <div className="auth-signal-bg__noise" />
      <div className="auth-signal-bg__veil" />
    </div>
  );
}
