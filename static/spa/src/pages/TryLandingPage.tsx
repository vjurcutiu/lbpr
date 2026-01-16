// src/pages/TryLandingPage.tsx
import type { FormEvent } from "react";
import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  FileText,
  Lock,
  Shield,
  Sparkles,
  Upload,
  Wand2,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useAuthContext } from "@/features/auth/AuthProvider";
import {
  auth,
  signUpWithEmailPassword,
  sendVerificationEmail,
  loginWithGoogle,
} from "@/features/auth/firebase";
import { friendlyAuthMessage } from "@/features/auth/errorMessages";
import { trackSignupConversion } from "@/lib/gtag";

function safeDecode(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function titleCaseName(raw: string) {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#EA4335"
        d="M12 10.2v3.6h5.1c-.22 1.32-1.54 3.86-5.1 3.86-3.08 0-5.6-2.55-5.6-5.66S8.92 6.34 12 6.34c1.76 0 2.95.75 3.62 1.4l2.46-2.37C16.7 3.41 14.52 2.5 12 2.5 6.98 2.5 2.9 6.58 2.9 11.6S6.98 20.7 12 20.7c6.14 0 8.1-4.29 8.1-6.41 0-.43-.05-.71-.12-1.02H12z"
      />
    </svg>
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
      <CardHeader className="space-y-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
          {icon}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}

function SecurityRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Shield className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{body}</div>
        </div>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-2xl border bg-background p-5">
      <div className="text-sm font-semibold">{q}</div>
      <div className="mt-2 text-sm text-muted-foreground">{a}</div>
    </div>
  );
}

function SignupCard({
  refName,
  onSuccessNavigateTo = "/files",
}: {
  refName?: string;
  onSuccessNavigateTo?: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [redirectWhenAuthed, setRedirectWhenAuthed] = useState(false);

  useEffect(() => {
    if (redirectWhenAuthed && user) {
      navigate(onSuccessNavigateTo, { replace: true });
    }
  }, [redirectWhenAuthed, user, navigate, onSuccessNavigateTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const em = email.trim();
    if (!em) return setErr("Please enter your email.");
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords do not match.");

    setLoading(true);
    try {
      const cred = await signUpWithEmailPassword(em, pw);

      // This matches your existing SignupPage behavior.
      try {
        trackSignupConversion({ user_id: cred.user?.uid } as any);
      } catch {}

      await sendVerificationEmail();

      // After this, AuthProvider will log the user out (until verified), which is OK.
      setSent(true);
    } catch (e2: any) {
      console.warn("[auth:signup] Firebase error:", e2);
      setErr(friendlyAuthMessage(e2, "signup"));
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setErr(null);
    setGoogleLoading(true);
    try {
      const cred: any = await loginWithGoogle();
      const isNewUser = !!cred?.additionalUserInfo?.isNewUser;
      if (isNewUser) {
        try {
          trackSignupConversion({ user_id: cred?.user?.uid } as any);
        } catch {}
      }

      // Wait for AuthProvider cookie exchange + user load, then navigate.
      setRedirectWhenAuthed(true);
    } catch (e: any) {
      console.warn("[auth:signup:google] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "signup"));
    } finally {
      setGoogleLoading(false);
    }
  }

  if (user) {
    return (
      <Card className="rounded-2xl border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">You’re signed in</CardTitle>
          <p className="text-sm text-muted-foreground">
            Jump straight into the app.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild size="lg" className="w-full rounded-xl">
            <Link to={onSuccessNavigateTo}>
              Open app <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="signup" className="rounded-2xl border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">
          Start free{refName ? `, ${refName}` : ""}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          50 messages • ~75 pages of uploads • No credit card required
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {sent ? (
          <Alert className="rounded-xl">
            <AlertDescription className="text-sm">
              We sent a verification email to{" "}
              <span className="font-medium">{email.trim()}</span>. Click the link
              in your inbox (and spam folder), then sign in.
              <div className="mt-3 flex flex-col gap-2">
                <Button asChild variant="outline" className="w-full rounded-xl">
                  <Link to={`/login?returnTo=${encodeURIComponent(onSuccessNavigateTo)}`}>
                    I’ve verified — sign in
                  </Link>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-xl"
              onClick={onGoogle}
              disabled={googleLoading}
            >
              {googleLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                <>
                  <GoogleIcon className="h-4 w-4" />
                  Continue with Google
                </>
              )}
            </Button>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <form className="space-y-3" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-sm font-medium">Email</span>
                  <Input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">Password</span>
                  <Input
                    required
                    type="password"
                    autoComplete="off"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">Confirm password</span>
                  <Input
                    required
                    type="password"
                    autoComplete="off"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="Repeat password"
                  />
                </label>
              </div>

              {err ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                  {err}
                </div>
              ) : null}

              <Button type="submit" disabled={loading} className="w-full rounded-xl">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    Create account <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="text-xs text-muted-foreground">
                By continuing you agree to our{" "}
                <Link className="underline underline-offset-4 hover:text-foreground" to="/terms">
                  Terms
                </Link>{" "}
                and{" "}
                <Link className="underline underline-offset-4 hover:text-foreground" to="/privacy">
                  Privacy Policy
                </Link>
                .
              </div>

              <div className="text-sm text-center text-muted-foreground">
                Already have an account?{" "}
                <Link
                  to={`/login?returnTo=${encodeURIComponent(onSuccessNavigateTo)}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Sign in
                </Link>
              </div>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function TryLandingPage() {
  const [params] = useSearchParams();
  const refRaw = useMemo(() => safeDecode(params.get("ref") || ""), [params]);
  const refName = useMemo(() => titleCaseName(refRaw), [refRaw]);

  // Keep these for footer links / fallbacks
  const signupHref = "/signup?highlight=email";
  const loginHref = "/login";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">LexBot PRO</div>
              <div className="text-xs text-muted-foreground">AI Search Engine</div>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#features">
              Features
            </a>
            <a className="hover:text-foreground" href="#how">
              How it works
            </a>
            <a className="hover:text-foreground" href="#security">
              Security
            </a>
            <a className="hover:text-foreground" href="#faq">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="hidden rounded-full sm:inline-flex">
              <Link to={loginHref}>Sign in</Link>
            </Button>
            <Button asChild className="rounded-full">
              <a href="#signup">Start free</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-accent/10 to-background" />
        <div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-32 -bottom-40 h-96 w-96 rounded-full bg-accent/25 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-2 lg:items-start">
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full">
                Private by default
              </Badge>
              <Badge variant="secondary" className="rounded-full">
                Source-cited answers
              </Badge>
              <Badge variant="secondary" className="rounded-full">
                No setup
              </Badge>
            </div>

            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
              Smart answers from your own files.
            </h1>

            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Upload documents and ask questions in plain English. Get fast, audit-friendly
              answers that reference your sources.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-foreground" />
                <span>
                  Free tier: <span className="text-foreground">50 messages</span> &{" "}
                  <span className="text-foreground">~75 pages</span> of uploads
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-foreground" />
                <span>Strong multi-lingual, multi-domain capabilities</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-foreground" />
                <span>Simple flows. Clear controls. No hidden sharing.</span>
              </li>
            </ul>

            {refName ? (
              <div className="mt-6 rounded-2xl border bg-background/70 p-4 backdrop-blur">
                <div className="text-sm font-medium">Hi {refName} 👋</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  This link is personalized — start free on the right and try it with a real document.
                </div>
              </div>
            ) : null}
          </div>

          {/* Inline signup */}
          <div className="lg:pl-6">
            <SignupCard refName={refName || undefined} onSuccessNavigateTo="/files" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">
              Built for speed and clarity
            </h2>
            <p className="mt-2 text-muted-foreground">
              A clean workflow: upload → ask → get cited answers.
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <FeatureCard
              icon={<Upload className="h-5 w-5" />}
              title="Upload files"
              body="Bring PDFs, docs, and notes into one workspace."
            />
            <FeatureCard
              icon={<Sparkles className="h-5 w-5" />}
              title="Ask questions"
              body="Chat naturally. The assistant uses your content as context."
            />
            <FeatureCard
              icon={<FileText className="h-5 w-5" />}
              title="Get grounded answers"
              body="Responses are based on what’s in your documents."
            />
          </div>
        </div>
      </section>

      {/* How */}
      <section id="how" className="border-t bg-accent/20">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <p className="mt-2 text-muted-foreground">
              Three steps to get value fast.
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <Card className="rounded-2xl border bg-background shadow-sm">
              <CardHeader className="space-y-2">
                <div className="text-xs text-muted-foreground">Step 1</div>
                <CardTitle className="text-base">Create an account</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Start free — no credit card required.
              </CardContent>
            </Card>

            <Card className="rounded-2xl border bg-background shadow-sm">
              <CardHeader className="space-y-2">
                <div className="text-xs text-muted-foreground">Step 2</div>
                <CardTitle className="text-base">Upload a document</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Add your file and let LexBot PRO index it.
              </CardContent>
            </Card>

            <Card className="rounded-2xl border bg-background shadow-sm">
              <CardHeader className="space-y-2">
                <div className="text-xs text-muted-foreground">Step 3</div>
                <CardTitle className="text-base">Ask & get cited answers</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Get fast answers grounded in your content.
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Private by default
              </h2>
              <p className="mt-2 text-muted-foreground">
                Keep work organized, predictable, and controlled.
              </p>

              <div className="mt-6 grid gap-3">
                <SecurityRow
                  title="Organized files"
                  body="Group and manage documents in one workspace."
                />
                <SecurityRow
                  title="Grounded responses"
                  body="Answers are based on the files you upload."
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
                  <a href="#signup">
                    Create free account <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline" className="w-full rounded-xl">
                  <Link to="/login">I already have an account</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t bg-accent/20">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">FAQ</h2>
            <p className="mt-2 text-muted-foreground">The essentials, answered clearly.</p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <Faq
              q="What do I get on the free plan?"
              a="A lightweight plan to validate the workflow: 50 messages and ~75 pages of uploads, with no credit card required."
            />
            <Faq
              q="How are answers generated?"
              a="LexBot PRO uses your uploaded files to generate responses based on their content."
            />
            <Faq
              q="Does it work for multilingual documents?"
              a="Yes, LexBot PRO supports around ~100 languages, with near native fluency for up to 40 of them."
            />
            <Faq
              q="How do I start?"
              a="Create a free account, upload a file, and ask a question. You’ll get a clear answer based on your file."
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
              <a href="#signup">
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </a>
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
              <Link className="hover:text-foreground" to={signupHref}>
                Signup page
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
