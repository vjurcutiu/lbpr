import { Link, useSearchParams } from "react-router-dom";

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
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <div className="card p-8 card-lg">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {refName ? `Hello ${refName}` : "Hello"}
            </h1>

            <span className="pill px-3 py-1 text-xs text-muted-foreground">
              LexBot PRO
            </span>
          </div>

          <p className="mt-3 text-muted-foreground">
            Upload your documents and chat with them. Get fast, source-cited answers —
            private by default.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Link
              to="/signup?highlight=email"
              className="inline-flex items-center justify-center rounded-xl bg-black text-white px-4 py-2 font-medium shadow-sm hover:opacity-90"
            >
              Start free
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2 hover:bg-accent/50"
            >
              I already have an account
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-medium">Easy</div>
              <div className="text-xs text-muted-foreground mt-1">
                No setup — upload and ask.
              </div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-medium">Audit-friendly</div>
              <div className="text-xs text-muted-foreground mt-1">
                Answers reference sources.
              </div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-medium">Private</div>
              <div className="text-xs text-muted-foreground mt-1">
                Your files stay yours.
              </div>
            </div>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Tip: share links like <code className="px-1">/try?ref=stefan</code>.
          </p>
        </div>
      </div>
    </main>
  );
}
