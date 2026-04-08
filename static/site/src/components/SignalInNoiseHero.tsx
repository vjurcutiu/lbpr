import { useEffect, useMemo, useRef } from 'react';
import './SignalInNoiseHero.css';

export type HeroMetric = {
  value: string;
  label: string;
};

type SignalInNoiseHeroProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;
  metrics?: HeroMetric[];
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
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

const defaultMetrics: HeroMetric[] = [
  { value: 'Minutes', label: 'from upload to answer' },
  { value: 'Hybrid', label: 'retrieval pipeline' },
  { value: 'Ops-ready', label: 'telemetry and limits' },
];

export function SignalInNoiseHero({
  eyebrow = 'Signal systems',
  title = 'Turn ambient noise into usable signal',
  description = 'A premium, mouse-reactive hero that reveals structure inside moving data. Built for technical products that need to feel deliberate, not decorative.',
  primaryCtaLabel = 'Start now',
  secondaryCtaLabel = 'See how it works',
  metrics = defaultMetrics,
  onPrimaryClick,
  onSecondaryClick,
}: SignalInNoiseHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const titleParts = useMemo(() => {
    const words = title.split(' ');
    if (words.length < 4) {
      return { leading: title, trailing: '' };
    }

    return {
      leading: words.slice(0, -2).join(' '),
      trailing: words.slice(-2).join(' '),
    };
  }, [title]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
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

    const palette = {
      trail: 'rgba(71, 138, 255, 0.13)',
      point: 'rgba(175, 222, 255, 0.6)',
      pulse: 'rgba(120, 229, 255, 0.95)',
      bright: 'rgba(238, 247, 255, 0.98)',
    };

    const buildParticles = () => {
      const isCompact = width < 768;
      const density = isCompact ? 0.000065 : 0.0001;
      const total = Math.round(width * height * density);
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
          size: 0.65 + Math.random() * 1.85,
          signal: Math.random() * 0.12,
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
      const normalizedX = x / width;
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
      context.globalCompositeOperation = 'screen';

      for (let channel = 0; channel < 3; channel += 1) {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, `rgba(102, 166, 255, ${0.05 + channel * 0.012})`);
        gradient.addColorStop(0.5, `rgba(115, 228, 255, ${0.1 + channel * 0.02})`);
        gradient.addColorStop(1, `rgba(136, 115, 255, ${0.05 + channel * 0.012})`);

        context.beginPath();
        for (let x = 0; x <= width; x += 14) {
          const y = getSignalY(x, time, channel);
          if (x === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.strokeStyle = gradient;
        context.lineWidth = 1.2 + channel * 0.35;
        context.shadowBlur = 18 + channel * 6;
        context.shadowColor = `rgba(118, 196, 255, ${0.12 + channel * 0.04})`;
        context.stroke();
      }

      context.restore();
    };

    const drawConnections = () => {
      const maxDistance = width < 768 ? 56 : 72;
      const maxDistanceSq = maxDistance * maxDistance;
      const stride = width < 768 ? 3 : 2;

      context.save();
      context.globalCompositeOperation = 'screen';

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
          const alpha = (1 - distance / maxDistance) * Math.min(particleA.signal, particleB.signal) * 0.28;
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
      signalTime += delta * (reduceMotionQuery.matches ? 0.004 : 0.012);

      pointer.x += (pointer.targetX - pointer.x) * 0.11;
      pointer.y += (pointer.targetY - pointer.y) * 0.11;
      pointer.intensity += ((pointer.active ? 1 : 0) - pointer.intensity) * 0.07;

      context.clearRect(0, 0, width, height);

      context.fillStyle = 'rgba(4, 8, 18, 0.16)';
      context.fillRect(0, 0, width, height);

      drawSignalBands(signalTime);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
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
        const pointerForce = clamp(1 - pointerDistance / 190, 0, 1) * pointer.intensity;
        const signalY = getSignalY(particle.x, signalTime, 1.1);
        const signalDistance = Math.abs(particle.y - signalY);
        const signalForce = clamp(1 - signalDistance / 42, 0, 1);
        particle.signal += (Math.max(signalForce, pointerForce) - particle.signal) * 0.08;

        if (pointerForce > 0.01) {
          const repel = easeOutCubic(pointerForce) * 0.95;
          particle.x -= (pointerDx / pointerDistance) * repel * delta * 2.2;
          particle.y -= (pointerDy / pointerDistance) * repel * delta * 2.2;
        }

        const radius = particle.size + particle.signal * 1.6;
        const alpha = 0.14 + particle.signal * 0.72;

        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fillStyle = particle.signal > 0.6 ? palette.pulse : palette.point;
        context.globalAlpha = alpha;
        context.shadowBlur = particle.signal > 0.42 ? 14 : 0;
        context.shadowColor = particle.signal > 0.42 ? palette.bright : palette.trail;
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

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);
    document.addEventListener('visibilitychange', handleVisibility);
    handlePointerLeave();
    rafId = window.requestAnimationFrame(animate);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section className="signal-hero" ref={containerRef}>
      <div className="signal-hero__backdrop" />
      <canvas className="signal-hero__canvas" ref={canvasRef} aria-hidden="true" />
      <div className="signal-hero__glow" />
      <div className="signal-hero__noise" />

      <div className="signal-hero__inner">
        <div className="signal-hero__content">
          <div className="signal-hero__eyebrow">{eyebrow}</div>
          <h1 className="signal-hero__title">
            {titleParts.leading}
            {titleParts.trailing ? <span className="signal-hero__highlight">{titleParts.trailing}</span> : null}
          </h1>
          <p className="signal-hero__description">{description}</p>

          <div className="signal-hero__actions">
            <button className="signal-hero__button signal-hero__button--primary" type="button" onClick={onPrimaryClick}>
              {primaryCtaLabel}
            </button>
            <button className="signal-hero__button signal-hero__button--secondary" type="button" onClick={onSecondaryClick}>
              {secondaryCtaLabel}
            </button>
          </div>

          <div className="signal-hero__metrics" role="list" aria-label="Marketing highlights">
            {metrics.map((metric) => (
              <div className="signal-hero__metric" key={`${metric.value}-${metric.label}`} role="listitem">
                <span className="signal-hero__metric-value">{metric.value}</span>
                <span className="signal-hero__metric-label">{metric.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="signal-hero__aside" aria-hidden="true" />
      </div>
    </section>
  );
}
