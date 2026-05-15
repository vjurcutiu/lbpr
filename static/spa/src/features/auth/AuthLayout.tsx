import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RiRobotLine } from "react-icons/ri";
import AuthSignalBackground from "./AuthSignalBackground";

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#040914] text-white">
      <AuthSignalBackground />

      <section className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="mx-auto mb-5 inline-flex items-center gap-3 rounded-full border border-white/12 bg-slate-950/35 px-4 py-2 text-sm font-medium text-white/90 shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-white/12"
          >
            <RiRobotLine className="h-5 w-5 text-cyan-200" />
            <span>Lexbot Pro</span>
          </Link>

          <div className="rounded-[2rem] border border-white/18 bg-white/94 p-6 text-slate-950 shadow-[0_30px_100px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:p-8">
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
