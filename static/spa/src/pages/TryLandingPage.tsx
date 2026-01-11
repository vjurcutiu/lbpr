import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  FileSearch,
  Lock,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * /try?ref=<name>
 * - Keeps copy professional + conversion-focused.
 * - Uses the app palette via CSS variables (bg-background, text-foreground, primary/accent).
 */
export default function TryLandingPage() {
  const [params] = useSearchParams();

  const refName = useMemo(() => {
    const raw = params.get("ref") ?? "";
    const decoded = safeDecode(raw).trim();

    // Keep diacritics; remove control chars; limit length.
    const cleaned = decoded.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 40);

    // Title-case-ish for Latin scripts; otherwise leave as-is.
    return toTitleLike(cleaned);
  }, [params]);

  const signupHref = useMemo(() => {
    const ref = params.get("ref");
    const q = new URLSearchParams();
    q.set("highlight", "email");
    if (ref) q.set("ref", ref);
    return `/signup?${q.toString()}`;
  }, [params]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Wand2 className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">LexBot PRO</div>
              <div className="text-xs text-muted-foreground">AI Search Engine</div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <a href="#how">How it works</a>
            </Button>
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <a href="#security">Security</a>
            </Button>
            <Button asChild>
              <Link to={signupHref}>
                Create free account <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-accent blur-3xl opacity-70" />
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl opacity-70" />
          <div className="absolute left-1/2 top-[14rem] h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl opacity-70" />
        </div>

        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Smart answers from your own files
                </Badge>
                <Badge className="rounded-full">Free forever plan</Badge>
              </div>

              <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                {refName ? (
                  <>
                    Hello <span className="text-primary">{refName}</span>.{" "}
                    <span className="text-muted-foreground">
                      Turn your documents into instant answers.
                    </span>
                  </>
                ) : (
                  <>
                    Turn your documents into{" "}
                    <span className="text-primary">instant</span> answers.
                  </>
                )}
              </h1>

              <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Upload PDFs, notes, policies, research, or client files. Ask questions in plain
                language. Get reliable, audit‑friendly answers that reference the exact passages
                used.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="rounded-xl">
                  <Link to={signupHref}>
                    Start free — no card needed <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-xl">
                  <a href="#how">See how it works</a>
                </Button>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <MiniStat icon={<BadgeCheck className="h-4 w-4" />} title="Cited answers" desc="Every response points to sources." />
                <MiniStat icon={<FileSearch className="h-4 w-4" />} title="Fast retrieval" desc="Search across many files in seconds." />
                <MiniStat icon={<Lock className="h-4 w-4" />} title="Private by default" desc="Designed for sensitive documents." />
              </div>
            </div>

            {/* Right hero card */}
            <Card className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/60 to-transparent" />
              <CardHeader className="relative">
                <CardTitle className="text-xl">What you can do in 2 minutes</CardTitle>
                <p className="text-sm text-muted-foreground">
                  A quick, realistic workflow — no setup, no “prompt engineering”.
                </p>
              </CardHeader>
              <CardContent className="relative space-y-4">
                <StepRow
                  n="1"
                  icon={<BookOpen className="h-4 w-4" />}
                  title="Upload a document"
                  body="PDFs, notes, docs — drag & drop."
                />
                <StepRow
                  n="2"
                  icon={<FileSearch className="h-4 w-4" />}
                  title="Ask a specific question"
                  body="“What are the key obligations in section 4?”"
                />
                <StepRow
                  n="3"
                  icon={<BadgeCheck className="h-4 w-4" />}
                  title="Get a cited answer"
                  body="Answer + links to the exact pages/lines used."
                />

                <div className="mt-6 rounded-xl border bg-background p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">Free forever</div>
                      <div className="text-sm text-muted-foreground">
                        50 messages • ~75 pages of uploads • No credit card required
                      </div>
                    </div>
                    <Button asChild className="rounded-xl">
                      <Link to={signupHref}>Try it</Link>
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  By continuing you agree to our Terms and Privacy Policy.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Social proof / outcomes */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-4 md:grid-cols-3">
          <OutcomeCard
            title="Answer faster"
            body="Stop re-reading long files. Ask, verify, and move on."
          />
          <OutcomeCard
            title="Stay audit‑friendly"
            body="Source references help you trust and defend outputs."
          />
          <OutcomeCard
            title="Work across languages"
            body="Multi‑lingual queries and documents (where supported by your model setup)."
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t bg-accent/30">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <p className="mt-2 text-muted-foreground">
              A simple flow that matches how professionals actually work with documents.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <FeatureCard
              icon={<BookOpen className="h-5 w-5" />}
              title="Bring your own files"
              body="Upload policies, research, notes, memos, contracts, manuals, and more."
            />
            <FeatureCard
              icon={<FileSearch className="h-5 w-5" />}
              title="Ask natural questions"
              body="From quick lookups to deep comparisons — in plain language."
            />
            <FeatureCard
              icon={<BadgeCheck className="h-5 w-5" />}
              title="Get answers with sources"
              body="See where each claim comes from, so you can validate quickly."
            />
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card className="rounded-2xl border bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Example questions</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Useful prompts that map to real tasks.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ExamplePrompt>“Summarize the key requirements and cite each section.”</ExamplePrompt>
                <ExamplePrompt>“What changed between version A and B?”</ExamplePrompt>
                <ExamplePrompt>“List risks, mitigation steps, and where they appear.”</ExamplePrompt>
                <ExamplePrompt>“Extract deadlines and obligations into bullet points.”</ExamplePrompt>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Designed for clarity</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Professional output over “chatty” output.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <Bullet
                  title="Structured responses"
                  body="Clean headings, bullets, and actionable takeaways."
                />
                <Bullet
                  title="Source references"
                  body="Quickly verify by jumping to the relevant parts."
                />
                <Bullet
                  title="Private by default"
                  body="Your files stay within your workspace and access controls."
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Security & privacy</h2>
              <p className="mt-3 text-muted-foreground">
                Built for work where documents matter. Keep control over what you upload and who can
                access it.
              </p>

              <div className="mt-6 space-y-4">
                <SecurityRow
                  title="Private workspaces"
                  body="Keep documents separated by project or client."
                />
                <SecurityRow
                  title="Citations reduce hallucinations"
                  body="It’s easier to verify when every claim has a source."
                />
                <SecurityRow
                  title="Principle of least surprise"
                  body="Simple flows. Clear controls. No hidden sharing."
                />
              </div>
            </div>

            <Card className="rounded-2xl border bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Ready to try?</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Create an account and upload your first document in minutes.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border bg-background p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-foreground">
                      <Lock className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">No credit card required</div>
                      <div className="text-sm text-muted-foreground">
                        Start on the free plan and upgrade only if you need more.
                      </div>
                    </div>
                  </div>
                </div>
                <Button asChild size="lg" className="w-full rounded-xl">
                  <Link to={signupHref}>
                    Create free account <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full rounded-xl">
                  <Link to="/signin">I already have an account</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t bg-accent/20">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">FAQ</h2>
            <p className="mt-2 text-muted-foreground">
              The essentials, answered clearly.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <Faq
              q="What do I get on the free plan?"
              a="A lightweight plan to validate the workflow: 50 messages and ~75 pages of uploads, with no credit card required."
            />
            <Faq
              q="Will I see where answers come from?"
              a="Yes — LexBot PRO is designed to reference the exact source passages used, so you can verify quickly."
            />
            <Faq
              q="Does it work for multilingual documents?"
              a="The UI supports multilingual usage. Actual performance depends on your configured model and content."
            />
            <Faq
              q="How do I start?"
              a="Create a free account, upload a file, and ask a question. You’ll get an answer with citations."
            />
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl border bg-background p-6 sm:flex-row sm:items-center">
            <div>
              <div className="text-lg font-semibold">Try it with a real document</div>
              <div className="mt-1 text-sm text-muted-foreground">
                The fastest way to know if it fits your workflow.
              </div>
            </div>
            <Button asChild size="lg" className="rounded-xl">
              <Link to={signupHref}>
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Wand2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">LexBot PRO</div>
                <div className="text-xs text-muted-foreground">AI Search Engine</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <a className="hover:text-foreground" href="#how">
                How it works
              </a>
              <a className="hover:text-foreground" href="#security">
                Security
              </a>
              <Link className="hover:text-foreground" to="/privacy">
                Privacy
              </Link>
              <Link className="hover:text-foreground" to="/terms">
                Terms
              </Link>
            </div>
          </div>

          <div className="mt-6 text-xs text-muted-foreground">
            © {new Date().getFullYear()} LexBot PRO. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function MiniStat({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </div>
        <div className="text-sm font-medium">{title}</div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{desc}</div>
    </div>
  );
}

function StepRow({
  n,
  icon,
  title,
  body,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-background p-4">
      <div className="mt-0.5 flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
          {n}
        </div>
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}

function OutcomeCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="rounded-2xl border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="rounded-2xl border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
          {icon}
        </div>
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </CardHeader>
      <CardContent className="pt-0" />
    </Card>
  );
}

function ExamplePrompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-background p-3">
      <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function Bullet({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-foreground">
        <BadgeCheck className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}

function SecurityRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Lock className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <Card className="rounded-2xl border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{q}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{a}</CardContent>
    </Card>
  );
}

function safeDecode(v: string) {
  try {
    return decodeURIComponent(v.replace(/\+/g, "%20"));
  } catch {
    return v;
  }
}

function toTitleLike(v: string) {
  if (!v) return v;
  // If it looks like a normal "name", title-case spaces/hyphens.
  if (/^[\p{L}\p{M}\s'.-]+$/u.test(v) && v.length <= 40) {
    return v
      .split(/(\s+|-)/)
      .map((part) => {
        if (part.trim() === "" || part === "-") return part;
        const first = part.slice(0, 1);
        const rest = part.slice(1);
        return first.toLocaleUpperCase() + rest.toLocaleLowerCase();
      })
      .join("");
  }
  return v;
}
