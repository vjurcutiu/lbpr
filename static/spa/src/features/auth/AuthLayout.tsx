import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { RiRobotLine } from "react-icons/ri";
import AuthSignalPanel, { type AuthSignalMetric } from "./AuthSignalPanel";

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

type AuthMarketingContent = {
  eyebrow: string;
  headline: string;
  description: string;
  metrics: AuthSignalMetric[];
  chips: string[];
};

function getAuthMarketingContent(pathname: string): AuthMarketingContent {
  if (pathname.startsWith("/signup")) {
    return {
      eyebrow: "Start free",
      headline: "Turn business content into clear answers",
      description:
        "Create your workspace, upload docs, audio, or images, and get clear answers with links back to the original source.",
      metrics: [
        { value: "50", label: "messages to start" },
        { value: "~75", label: "pages of uploads included" },
        { value: "No card", label: "required on the free plan" },
      ],
      chips: ["Easy setup", "Answers with sources", "Private by default"],
    };
  }

  if (pathname.startsWith("/phone")) {
    return {
      eyebrow: "Fast access",
      headline: "Get back to your workspace quickly",
      description:
        "Use a one-time code for quick access to your files, chats, and the latest answers in your workspace.",
      metrics: [
        { value: "1 code", label: "to unlock your workspace" },
        { value: "Files", label: "chat and uploads stay in sync" },
        { value: "Live", label: "same account, same data" },
      ],
      chips: ["Low friction", "Verified access", "Same workspace"],
    };
  }

  return {
    eyebrow: "Welcome back",
    headline: "Get back to the answers in your workspace",
    description:
      "Pick up where you left off with file search, source-backed answers, OCR, transcription, and uploads in one place.",
    metrics: [
      { value: "Files", label: "upload, organize, and search" },
      { value: "Fast", label: "answers across your content" },
      { value: "Cited", label: "answers tied back to sources" },
    ],
    chips: ["Source-backed", "Easy to use", "Private by default"],
  };
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  const location = useLocation();
  const content = getAuthMarketingContent(location.pathname);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#040914] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(69,125,255,0.14),transparent_34%),linear-gradient(180deg,#050a15_0%,#040914_45%,#050912_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />
      <div className="pointer-events-none absolute -left-16 top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-indigo-500/15 blur-3xl" />

      <div className="relative grid min-h-dvh grid-cols-1 md:grid-cols-12">
        <section className="hidden md:col-span-7 md:flex md:p-6 lg:p-8">
          <div className="flex w-full flex-col gap-6">
            <Link to="/" className="inline-flex w-fit items-center gap-3 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition hover:bg-white/10">
              <RiRobotLine className="h-5 w-5 text-cyan-200" />
              <span>Lexbot Pro</span>
              <span className="text-white/45">/</span>
              <span className="text-white/65">Answers grounded in your business content</span>
            </Link>
            <AuthSignalPanel
              eyebrow={content.eyebrow}
              title={content.headline}
              description={content.description}
              metrics={content.metrics}
            />
          </div>
        </section>

        <section className="relative flex items-center justify-center p-4 sm:p-6 md:col-span-5 md:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <Link to="/" className="mb-5 inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-md md:hidden">
              <RiRobotLine className="h-5 w-5 text-cyan-200" />
              <span>Lexbot Pro</span>
            </Link>

            <div className="rounded-[2rem] border border-white/14 bg-white/92 p-6 text-slate-950 shadow-[0_30px_100px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-8">
              <div className="mb-6 space-y-4">
                <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  {content.eyebrow}
                </div>
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h2>
                  {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {content.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[0.72rem] font-medium text-slate-600"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>

              {children}
            </div>

            <div className="mt-5 space-y-3 text-center text-xs text-white/70">
              <p>
                By continuing you agree to our{" "}
                <a href="/terms" className="underline decoration-white/30 underline-offset-4 transition hover:text-white hover:decoration-white/60">
                  Terms
                </a>{" "}
                and{" "}
                <a href="/privacy" className="underline decoration-white/30 underline-offset-4 transition hover:text-white hover:decoration-white/60">
                  Privacy Policy
                </a>
                .
              </p>
              <p>No credit card required on the free plan.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
