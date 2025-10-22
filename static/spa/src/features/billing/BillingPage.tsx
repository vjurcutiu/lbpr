// features/billing/BillingPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadActiveProducts,
  startCheckout,
  openBillingPortal,
  observeSubscriptions,
  getBillingTraceId,
  type Product,
  type Subscription,
  type Price,
} from "./api";
import { Button } from "@/components/ui/button";
import { getJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { Check, Crown, MessageSquare, UploadCloud, AlertTriangle, Loader2, Info } from "lucide-react";

/* ------------------------------- Types ------------------------------- */
type LimitsResp = {
  plan: "FREE" | "PRO";
  window: string; // YYYYMM
  caps: { messages: number; upload_tokens: number };
  usage: { messages: number; upload_tokens: number };
};

/* ------------------------------ Helpers ----------------------------- */
function fmtInt(n?: number) {
  try { return new Intl.NumberFormat().format(n ?? 0); } catch { return String(n ?? 0); }
}

function formatMoney(amount?: number, currency?: string) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(amount / 100);
  } catch {
    return `€${(amount / 100).toFixed(0)}`;
  }
}

/** Robust conversion of Stripe/Firestore timestamp-ish values → millis. */
function toMillis(t: any): number | null {
  if (t == null) return null;
  // Firestore Timestamp
  if (typeof t === "object") {
    // Has toDate(): Firestore Timestamp
    if (typeof (t as any).toDate === "function") {
      try { return (t as any).toDate().getTime(); } catch { /* noop */ }
    }
    // { seconds: number } (Firebase extension occasionally sets this shape)
    if (typeof (t as any).seconds === "number") {
      return Math.round((t as any).seconds * 1000);
    }
  }
  if (typeof t === "number") {
    // Heuristic: seconds vs ms
    return t < 4e10 ? Math.round(t * 1000) : Math.round(t);
  }
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n)) return n < 4e10 ? Math.round(n * 1000) : Math.round(n);
  }
  return null;
}

function asDate(t: any): Date | null {
  const ms = toMillis(t);
  return ms ? new Date(ms) : null;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d.toLocaleDateString();
  }
}

/* ------------------------------ Component ------------------------------ */
export default function BillingPage() {
  const { user, loading: authLoading } = useAuthContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [limits, setLimits] = useState<LimitsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // NEW: show spinner on Pro card actions (subscribe/manage)
  const [btnLoading, setBtnLoading] = useState<null | "subscribe" | "manage">(null);

  // Mount diag
  useEffect(() => {
    console.info(`[billing][${getBillingTraceId()}] BillingPage:mounted`, {
      uid: user?.uid || null,
      portalTestUrl: (import.meta as any).env?.VITE_STRIPE_PORTAL_TEST_URL || null,
    });
  }, []);

  // Load products
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const prods = await loadActiveProducts();
        if (!cancel) setProducts(prods);
      } catch (e: any) {
        console.error("[billing] loadActiveProducts failed", e);
        if (!cancel) setErr(e.message || String(e));
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Load limits (and poll periodically while signed in)
  useEffect(() => {
    let cancel = false;

    if (authLoading) return;
    if (!user) {
      setLimits(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const lim = await getJSON<LimitsResp>("/limits/me");
        if (!cancel) setLimits(lim);
      } catch (_e) {
        if (!cancel) setLimits(null);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => { cancel = true; };
  }, [user, authLoading]);

  // Observe subscriptions in real-time
  useEffect(() => {
    let unsub: undefined | (() => void);
    if (!user) { setSubs([]); return; }
    observeSubscriptions((list) => {
      setSubs(list);
      // concise diagnostics to verify Stripe→Firestore sync after portal actions
      const top = list[0];
      console.debug(`[billing][${getBillingTraceId()}] diag:subscriptions`, {
        count: list.length,
        top: top ? {
          id: top.id,
          status: (top as any).status,
          cancel_at: (top as any).cancel_at,
          cancel_at_period_end: (top as any).cancel_at_period_end,
          canceled_at: (top as any).canceled_at,
          current_period_end: (top as any).current_period_end,
          current_period_start: (top as any).current_period_start,
        } : null
      });
    })
      .then((fn) => { unsub = fn; })
      .catch((e) => console.warn("[billing] observeSubscriptions failed", e));
    return () => { if (unsub) unsub(); };
  }, [user]);

  // Extra: also poll limits every 5s while authenticated so usage updates in real time
  const pollRef = useRef<number | null>(null);
  const inflightRef = useRef(false);
  const POLL_MS = 5000;
  useEffect(() => {
    if (!user) return;
    async function tick() {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const lim = await getJSON<LimitsResp>("/limits/me");
        setLimits(lim);
      } catch {
        // ignore
      } finally {
        inflightRef.current = false;
      }
    }
    pollRef.current = window.setInterval(tick, POLL_MS) as unknown as number;
    return () => { if (pollRef.current != null) window.clearInterval(pollRef.current); };
  }, [user]);

  // Derive view model
  const activeSub = subs.find((s) => ["active", "trialing", "past_due"].includes((s as any).status));
  const latestSub = subs[0];

  const onPro = user ? (!!activeSub || limits?.plan === "PRO") : false;

  const proPrice: Price | undefined = useMemo(() => {
    const envId = (import.meta.env.VITE_STRIPE_PRO_PRICE_ID || "").trim();
    if (envId) {
      for (const p of products) {
        const hit = p.prices?.find((pr) => pr.id === envId);
        if (hit) return hit;
      }
    }
    let all: Price[] = [];
    for (const p of products) {
      if (p.prices?.length) {
        all = all.concat(p.prices.filter((pr) => pr.type !== "one_time" && pr.active !== false));
      }
    }
    if (!all.length) return undefined;
    return all.sort((a, b) => (a.unit_amount ?? 0) - (b.unit_amount ?? 0))[0];
  }, [products]);

  const renewal = asDate(activeSub && (activeSub as any).current_period_end);
  const cancelsOn =
    asDate(activeSub && (activeSub as any).cancel_at) ||
    ((activeSub as any)?.cancel_at_period_end && renewal) ||
    null;

  const isCanceled = (latestSub as any)?.status === "canceled";
  const scheduledCancel = !!cancelsOn;

  const statusLabel = onPro
    ? ((activeSub as any)?.status === "past_due"
        ? "Pro (payment issue)"
        : scheduledCancel
        ? "Pro (Cancelled)"
        : "Pro")
    : (isCanceled ? "Pro canceled" : "Free");

  // View diag
  useEffect(() => {
    console.debug(`[billing][${getBillingTraceId()}] diag:view`, {
      user: user?.uid || null,
      onPro,
      latestStatus: (latestSub as any)?.status || null,
      activeStatus: (activeSub as any)?.status || null,
      current_period_end: (activeSub as any)?.current_period_end || null,
      cancel_at: (activeSub as any)?.cancel_at || null,
      cancel_at_period_end: (activeSub as any)?.cancel_at_period_end || null,
      renewalISO: renewal ? renewal.toISOString() : null,
      cancelsOnISO: cancelsOn ? cancelsOn.toISOString() : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, onPro, (latestSub as any)?.status, (activeSub as any)?.status, renewal?.getTime(), cancelsOn?.getTime()]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {err && (
        <div className="mb-4 text-sm inline-flex items-center gap-2 rounded-md bg-rose-100/60 dark:bg-rose-900/20 text-rose-900 dark:text-rose-200 px-3 py-2">
          <AlertTriangle className="h-4 w-4" />
          {err}
        </div>
      )}

      <header className="mb-6">
        <div className="mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Plans &amp; Usage</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Pick what fits. Upgrade anytime — manage with one click.
              </p>
            </div>
            <PlanBadge onPro={onPro} />
          </div>

          <div className="mt-6 grid grid-cols-1 sm-grid-cols-3 sm:grid-cols-3 gap-3">
            <QuickStat
              icon={<MessageSquare className="h-4 w-4" />}
              label="Messages used"
              value={limits ? `${fmtInt(limits.usage.messages)}/${fmtInt(limits.caps.messages)}` : "—"}
            />
            <QuickStat
              icon={<UploadCloud className="h-4 w-4" />}
              label="Upload tokens"
              value={limits ? `${fmtInt(limits.usage.upload_tokens)}/${fmtInt(limits.caps.upload_tokens)}` : "—"}
            />
            <QuickStat
              icon={<Crown className="h-4 w-4" />}
              label="Status"
              value={statusLabel}
            />
          </div>
        </div>
      </header>

      {/* ALIGN: equal height with matched header/list/chip/button positions */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        {/* Free card */}
        <div className="relative rounded-2xl border shadow-sm p-5 md:p-7 h-full flex flex-col">
          {/* header */}
          <div className="mb-6">
            {/* Invisible 'Most popular' chip to reserve space for alignment */}
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 text-primary px-3 py-1 text-xs invisible pointer-events-none select-none">
              <Crown className="h-3.5 w-3.5" /> Most popular
            </div>
            <h3 className="mt-3 text-xl font-semibold">Free</h3>
            <div className="mt-1 text-3xl font-semibold">€0</div>
            <div className="text-sm text-muted-foreground">per month</div>
          </div>
          {/* features */}
          <ul className="text-sm space-y-2 mb-6 flex-1">
            <li>• 50 messages</li>
            <li>• 100,000 upload tokens (≈75 pages)</li>
            <li>• Get started — no credit card</li>
          </ul>

          {/* footer: chip row then button (keeps alignment) */}
          <div className="mt-auto flex flex-col gap-3">
            {/* Invisible cancel chip placeholder so buttons align */}
            <div className="inline-flex items-center gap-2 rounded-md bg-amber-100/60 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 px-2.5 py-1 text-xs invisible pointer-events-none select-none">
              <Info className="h-3.5 w-3.5" />
              Cancels on <strong className="ml-1">—</strong>
            </div>

            <Button className="w-full" variant="outline" disabled={onPro}>
              {onPro ? "You're on Pro" : "Your current plan"}
            </Button>

            {!onPro && isCanceled && (
              <div className="inline-flex items-center gap-2 rounded-md bg-rose-100/60 dark:bg-rose-900/20 text-rose-900 dark:text-rose-200 px-2.5 py-1 text-xs">
                <Info className="h-3.5 w-3.5" />
                Your previous Pro plan is canceled.
              </div>
            )}
          </div>
        </div>

        {/* Pro card */}
        <div className="relative rounded-2xl border shadow-sm bg-gradient-to-b from-primary/5 to-background p-5 md:p-7 h-full flex flex-col">
          {/* header */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 text-primary px-3 py-1 text-xs">
              <Crown className="h-3.5 w-3.5" /> Most popular
            </div>
            <h3 className="mt-3 text-xl font-semibold">Pro</h3>
            <div className="mt-1 text-3xl font-semibold">
              {formatMoney(proPrice?.unit_amount, proPrice?.currency)}
            </div>
            <div className="text-sm text-muted-foreground">per month</div>
          </div>
          {/* features */}
          <ul className="text-sm space-y-2 mb-6 flex-1">
            <li>• 10,000 messages / month</li>
            <li>• 20,000,000 upload tokens (≈15,000 pages) / month</li>
            <li>• Priority file processing & faster queue</li>
            <li>• Cross-document keyword search</li>
            <li>• Phone & email support (≤24h SLA)</li>
            <li>• Priority feature requests & roadmap voting</li>
          </ul>

          {/* footer: chip above button */}
          <div className="mt-auto flex flex-col gap-3">
            {onPro && cancelsOn ? (
              <div className="inline-flex items-center gap-2 rounded-md bg-amber-100/60 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 px-2.5 py-1 text-xs">
                <Info className="h-3.5 w-3.5" />
                Cancels on <strong className="ml-1">{fmtDate(cancelsOn)}</strong>
              </div>
            ) : (
              // placeholder to keep height so buttons align
              <div className="inline-flex items-center gap-2 rounded-md bg-amber-100/60 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 px-2.5 py-1 text-xs invisible pointer-events-none select-none">
                <Info className="h-3.5 w-3.5" />
                Cancels on <strong className="ml-1">—</strong>
              </div>
            )}

            {onPro ? (
              <Button
                className="w-full bg-primary/90 text-primary-foreground hover:bg-primary"
                variant="default"
                disabled={!!btnLoading}
                onClick={async () => {
                  if (btnLoading) return;
                  setErr(null);
                  setBtnLoading("manage");
                  try {
                    await openBillingPortal();
                  } catch (e: any) {
                    setErr(e?.message || String(e));
                  } finally {
                    // if navigation fails, re-enable; otherwise page unloads
                    setBtnLoading(null);
                  }
                }}
              >
                {btnLoading === "manage" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {btnLoading === "manage" ? "Opening portal..." : "Manage subscription"}
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={async () => {
                  if (!proPrice?.id) return;
                  if (btnLoading) return;
                  setErr(null);
                  setBtnLoading("subscribe");
                  try {
                    await startCheckout(proPrice.id);
                  } catch (e: any) {
                    setErr(e?.message || String(e));
                    setBtnLoading(null);
                  }
                }}
                disabled={!proPrice || !!btnLoading}
              >
                {btnLoading === "subscribe" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {btnLoading === "subscribe" ? "Redirecting..." : "Upgrade to Pro"}
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function QuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string; }) {
  return (
    <div className="rounded-xl border p-4 flex items-center gap-3">
      <div className="shrink-0">{icon}</div>
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-lg font-medium">{value}</div>
      </div>
    </div>
  );
}

function PlanBadge({ onPro }: { onPro: boolean }) {
  return (
    <div className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " + (onPro ? "border-primary/40 text-primary" : "border-muted-foreground/40 text-muted-foreground")}>
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border">
        {onPro ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
      </span>
      {onPro ? "You're on Pro" : "Free plan"}
    </div>
  );
}
