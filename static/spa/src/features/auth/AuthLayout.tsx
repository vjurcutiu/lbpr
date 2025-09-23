import type { ReactNode } from "react";

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="min-h-dvh grid grid-cols-1 md:grid-cols-5">
      {/* Left: hero (hidden on small screens) */}
      <section className="relative hidden md:block md:col-span-3">
        <div className="absolute inset-0 bg-[url('/auth-hero.jpg')] bg-cover bg-center" />
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative z-10 flex h-full items-end p-10">
          <div className="text-white space-y-2">
            <h1 className="text-3xl font-semibold drop-shadow">Your RAG chat, refined.</h1>
            <p className="text-white/80 max-w-lg">
              Index files, chat with context, ship faster. Sign in to get going.
            </p>
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
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </section>
    </main>
  );
}
