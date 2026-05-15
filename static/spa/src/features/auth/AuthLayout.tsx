import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RiRobotLine } from "react-icons/ri";

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#040914] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(69,125,255,0.12),transparent_36%),linear-gradient(180deg,#050a15_0%,#040914_52%,#050912_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />
      <div className="pointer-events-none absolute -left-16 top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-indigo-500/15 blur-3xl" />

      <section className="relative flex min-h-dvh items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="mx-auto mb-5 inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition hover:bg-white/12"
          >
            <RiRobotLine className="h-5 w-5 text-cyan-200" />
            <span>Lexbot Pro</span>
          </Link>

          <div className="rounded-[2rem] border border-white/14 bg-white/92 p-6 text-slate-950 shadow-[0_30px_100px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-8">
            <div className="mb-6 space-y-2 text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
              {subtitle ? <p className="text-sm leading-6 text-slate-600">{subtitle}</p> : null}
            </div>

            {children}
          </div>

          <p className="mt-5 text-center text-xs text-white/70">
            By continuing, you agree to our{" "}
            <a href="/terms" className="underline decoration-white/30 underline-offset-4 transition hover:text-white hover:decoration-white/60">
              Terms
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline decoration-white/30 underline-offset-4 transition hover:text-white hover:decoration-white/60">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
