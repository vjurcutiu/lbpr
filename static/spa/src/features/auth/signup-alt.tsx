import { Link, useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";

function titleCaseName(raw: string) {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function TryLandingPage() {
  const [params] = useSearchParams();
  const refRaw = params.get("ref") || "";
  const refName = titleCaseName(refRaw);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-2">
        {/* Left: Brand hero */}
        <section className="relative overflow-hidden border-b lg:border-b-0 lg:border-r">
          {/* Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-accent/20 to-secondary/40" />
          <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
          <div className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-accent/35 blur-3xl" />

          <div className="relative flex h-full flex-col justify-between p-8 sm:p-10">
            <div className="flex items-center gap-2 text-sm font-medium">
              <div className="grid size-9 place-items-center rounded-xl bg-background/70 ring-1 ring-border shadow-sm backdrop-blur">
                <div className="size-4 rounded-sm bg-primary" />
              </div>
              <span>LexBot PRO • AI Search Engine</span>
            </div>

            <div className="max-w-xl pb-10">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Smart answers from your own files.
              </h1>

              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                Upload your documents and chat with them — no setup, no tech skills.
                Get instant, audit-friendly answers that reference your sources.
              </p>

              <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 text-foreground" />
                  <span>
                    Free tier: <span className="text-foreground">50 messages</span> &{" "}
                    <span className="text-foreground">~75 pages</span> of uploads
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 text-foreground" />
                  <span>Strong multi-lingual, multi-domain capabilities</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 text-foreground" />
                  <span>Easy to use. Private by default.</span>
                </li>
              </ul>

              <div className="mt-7">
                <Button asChild className="rounded-full bg-background text-foreground hover:bg-background/90">
                  <Link to="/signup?highlight=email">Create free account</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Personalized invite */}
        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="card card-lg p-8 sm:p-9">
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight">
                  {refName ? `Hello ${refName}` : "Hello"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Create an account and try LexBot PRO on your own documents.
                </p>
              </div>

              <div className="mt-6 grid gap-3">
                <Button
                  asChild
                  size="lg"
                  className="w-full rounded-xl bg-black text-white hover:bg-black/90"
                >
                  <Link to="/signup?highlight=email">Start free</Link>
                </Button>

                <Button asChild size="lg" variant="outline" className="w-full rounded-xl">
                  <Link to="/login">I already have an account</Link>
                </Button>
              </div>

              <div className="mt-5 text-center text-xs text-muted-foreground">
                Free forever plan • 50 messages • ~75 pages of uploads • No credit card required
              </div>
            </div>

            <div className="mt-6 text-center text-xs text-muted-foreground">
              By continuing you agree to our{" "}
              <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
                Privacy Policy
              </Link>.
            </div>

            <div className="mt-2 text-center text-xs text-muted-foreground">
              No credit card required • Cancel anytime
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
