import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { RiRobotLine } from "react-icons/ri";

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L8.5 11.086l6.543-6.543a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LogoMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#111827" />
          <stop offset="1" stopColor="#4b5563" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#g)" />
      <path d="M8 16c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8h-3.5a1.5 1.5 0 01-1.5-1.5V19a3 3 0 01-3-3z" fill="white" />
    </svg>
  );
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  const location = useLocation();
  // If user is already on /signup, keep the flag so re-clicking still re-triggers focus.
  const signupHref = "/signup?highlight=email";

  return (
    <main className="relative min-h-dvh grid grid-cols-1 md:grid-cols-5 bg-white">
      {/* Left: hero (hidden on small screens) */}
      <section className="relative hidden md:block md:col-span-3">
        <div className="absolute inset-0 bg-[url('/auth-hero.jpg')] bg-cover bg-center" />
        <div className="absolute inset-0 bg-black/40" />

        {/* Header */}
        <div className="relative z-10 flex items-center gap-3 p-6">
          <RiRobotLine className="h-7 w-7 rounded-lg shadow-sm text-white" />
          <span className="text-white font-semibold tracking-tight">LexBot PRO • AI Search Engine</span>
        </div>

        {/* Value prop */}
        <div className="relative z-10 flex h-[calc(100%-64px)] items-end p-10">
          <div className="text-white space-y-4 max-w-xl">
            <h1 className="text-4xl font-semibold leading-tight drop-shadow">
              Smart answers from your own files.
            </h1>
            <p className="text-white/85">
              Upload your documents and chat with them — no setup, no tech skills. Get instant, audit-friendly answers that reference your sources.
            </p>

            <ul className="mt-2 space-y-2 text-sm text-white/90">
              <li className="flex items-start gap-2">
                <CheckIcon className="h-5 w-5 mt-0.5" />
                Free tier: <strong>50 messages</strong> &nbsp;•&nbsp; <strong>~75&nbsp;pages</strong> of uploads
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon className="h-5 w-5 mt-0.5" /> Strong multi-lingual, multi-domain capabilities.
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon className="h-5 w-5 mt-0.5" /> Easy to use. Private by default.
              </li>
            </ul>

            <div className="pt-2">
              <Link
                to={signupHref}
                className="inline-flex items-center justify-center rounded-xl bg-white/95 text-gray-900 px-4 py-2 font-medium shadow hover:bg-white focus:outline-none focus:ring-4 focus:ring-white/40"
                aria-describedby="cta-helper"
              >
                Create free account
              </Link>
              <span id="cta-helper" className="sr-only">
                Navigates to signup. The email field will be highlighted so you can start there.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Right: auth card */}
      <section className="md:col-span-2 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold">{title}</h2>
              {subtitle ? (
                <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
              ) : null}
            </div>
            {children}
          </div>
          <p className="mt-6 text-center text-xs text-gray-500">
            By continuing you agree to our{" "}
            <a href="/terms" className="underline underline-offset-2">Terms</a>{" "}
            and{" "}
            <a href="/privacy" className="underline underline-offset-2">Privacy Policy</a>.
          </p>
          <div className="mt-4 text-center text-xs text-gray-500">
            No credit card required • Cancel anytime
          </div>
        </div>
      </section>
    </main>
  );
}
