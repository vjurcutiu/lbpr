// features/billing/BillingPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  observeActiveProducts,
  startCheckout,
  openBillingPortal,
  observeSubscriptions,
  getBillingTraceId,
  selectPlanCatalogPrice,
  loadPlanCatalogSelection,
  STRIPE_PRO_PLAN_KEY,
  STRIPE_PRO_LOOKUP_KEY,
  type Product,
  type Subscription,
  type Price,
} from "./api";
import { Button } from "@/components/ui/button";
import { getJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { Check, Crown, MessageSquare, UploadCloud, AlertTriangle, Loader2, Info, Mic, ScanText } from "lucide-react";

/* ------------------------------- Types ------------------------------- */
type LimitsResp = {
  plan: "FREE" | "PRO";
  window: string; // YYYYMM
  caps: { messages: number; file_processing_tokens?: number; upload_tokens: number; workflow_tokens?: number; transcribe_seconds?: number; ocr_images?: number };
  usage: { messages: number; file_processing_tokens?: number; upload_tokens: number; workflow_tokens?: number; transcribe_seconds?: number; ocr_images?: number };
};

/* ------------------------------ Helpers ----------------------------- */
function fmtInt(n?: number) {
  try { return new Intl.NumberFormat().format(n ?? 0); } catch { return String(n ?? 0); }
}

function fmtCompactInt(n?: number) {
  const value = Number(n ?? 0);
  const abs = Math.abs(value);
  if (abs < 1_000) return fmtInt(value);

  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];
  const unit = units.find((item) => abs >= item.threshold);
  if (!unit) return fmtInt(value);

  const scaled = value / unit.threshold;
  const shouldShowDecimal = Math.abs(scaled) < 10 && !Number.isInteger(scaled);
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: shouldShowDecimal ? 1 : 0,
  }).format(scaled);
  return formatted + unit.suffix;
}

function fileProcessingValue(bucket: { file_processing_tokens?: number; upload_tokens?: number } | null | undefined): number {
  return Number(bucket?.file_processing_tokens ?? bucket?.upload_tokens ?? 0);
}

function workflowTokensValue(bucket: { workflow_tokens?: number } | null | undefined): number {
  return Number(bucket?.workflow_tokens ?? 0);
}

function formatMoney(amount?: number, currency?: string) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(amount / 100);
  } catch {
    return `€${(amount / 100).toFixed(0)}`;
  }
}

function formatInterval(price?: Price) {
  const interval = price?.interval || "month";
  const count = Number(price?.interval_count || 1);
  if (!Number.isFinite(count) || count <= 1) return `per ${interval}`;
  const plural = interval.endsWith("s") ? interval : `${interval}s`;
  return `every ${count} ${plural}`;
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
  const [serverCatalog, setServerCatalog] = useState<{ product: Product; price: Price } | undefined>(undefined);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [limits, setLimits] = useState<LimitsResp | null>(null);
  const [, setLoading] = useState(true);
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

  // Observe Stripe product catalog mirrored by the Firebase Stripe extension.
  // This lets price changes made in Stripe appear after the extension syncs Firestore.
  useEffect(() => {
    try {
      const unsubscribe = observeActiveProducts((prods) => {
        setProducts(prods);
        console.debug(`[billing][${getBillingTraceId()}] diag:products`, {
          count: prods.length,
          products: prods.map((product) => ({
            id: product.id,
            name: product.name,
            active: product.active,
            default_price: typeof product.default_price === "string"
              ? product.default_price
              : ((product.default_price as any)?.id || (product.default_price as any)?.path || null),
            metadata: product.metadata || {},
            prices: (product.prices || []).map((price) => ({
              id: price.id,
              active: price.active,
              amount: price.unit_amount,
              currency: price.currency,
              interval: price.interval,
              lookup_key: price.lookup_key,
            })),
          })),
        });
      });
      return unsubscribe;
    } catch (e: any) {
      console.error("[billing] observeActiveProducts failed", e);
      setErr(e.message || String(e));
    }
  }, []);

  // Server catalog fallback: if Firestore has the product doc but its prices
  // have not synced yet, ask FastAPI to resolve the live Stripe catalog.
  useEffect(() => {
    let cancelled = false;
    const localSelection = selectPlanCatalogPrice(products, STRIPE_PRO_PLAN_KEY, STRIPE_PRO_LOOKUP_KEY);
    if (localSelection) {
      setServerCatalog(undefined);
      return;
    }

    loadPlanCatalogSelection(STRIPE_PRO_PLAN_KEY)
      .then((selection) => {
        if (!cancelled) setServerCatalog(selection);
      })
      .catch(() => {
        if (!cancelled) setServerCatalog(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [products]);

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
        const lim = await getJSON<LimitsResp>("/limits/me", { cache: "no-store" });
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
        const lim = await getJSON<LimitsResp>("/limits/me", { cache: "no-store" });
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

  const firestoreCatalog = useMemo(() => {
    return selectPlanCatalogPrice(products, STRIPE_PRO_PLAN_KEY, STRIPE_PRO_LOOKUP_KEY);
  }, [products]);
  const proCatalog = firestoreCatalog || serverCatalog;
  const proPrice: Price | undefined = proCatalog?.price;

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

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <QuickStat
              icon={<MessageSquare className="h-4 w-4" />}
              label="Messages used"
              value={limits ? <UsageStatValue used={limits.usage.messages} cap={limits.caps.messages} /> : "—"}
            />
            <QuickStat
              icon={<UploadCloud className="h-4 w-4" />}
              label="File upload tokens"
              value={limits ? <UsageStatValue used={fileProcessingValue(limits.usage)} cap={fileProcessingValue(limits.caps)} /> : "—"}
            />
            <QuickStat
              icon={<Check className="h-4 w-4" />}
              label="Workflow tokens"
              value={limits ? <UsageStatValue used={workflowTokensValue(limits.usage)} cap={workflowTokensValue(limits.caps)} /> : "—"}
            />
            <QuickStat
              icon={<Mic className="h-4 w-4" />}
              label="Transcription"
              value={(() => {
                if (!limits) return "—";
                const u = limits.usage.transcribe_seconds;
                const c = limits.caps.transcribe_seconds;
                if (u == null || c == null) return "—";
                const uMin = Math.round(u / 60);
                const cMin = Math.round(c / 60);
                return <UsageStatValue used={uMin} cap={cMin} suffix="min" />;
              })()}
            />
            <QuickStat
              icon={<ScanText className="h-4 w-4" />}
              label="OCR images"
              value={(() => {
                if (!limits) return "—";
                const u = limits.usage.ocr_images;
                const c = limits.caps.ocr_images;
                if (u == null || c == null) return "—";
                return <UsageStatValue used={u} cap={c} />;
              })()}
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
            <li>• 100,000 file upload tokens (≈75 pages)</li>
            <li>• 100,000 workflow tokens</li>
            <li>• 5 minutes transcription</li>
            <li>• 5 OCR images</li>
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
            <div className="text-sm text-muted-foreground">{formatInterval(proPrice)}</div>
          </div>
          {/* features */}
          <ul className="text-sm space-y-2 mb-6 flex-1">
            <li>• 2,000 messages / month</li>
            <li>• 20,000,000 file upload tokens (≈15,000 pages) / month</li>
            <li>• 5,000,000 workflow tokens / month</li>
            <li>• 1,000 minutes transcription / month</li>
            <li>• 1,000 OCR images / month</li>
            <li>• Pseudonymization to protect sensitive data (PII)</li>
            <li>• Phone & email support (≤24h SLA)</li>          </ul>

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
                    await startCheckout({ planKey: STRIPE_PRO_PLAN_KEY, mode: "subscription" });
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

function QuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode; }) {
  return (
    <div className="rounded-xl border p-4 flex items-start gap-3 min-w-0">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 min-w-0 text-base md:text-lg font-medium leading-tight break-words">{value}</div>
      </div>
    </div>
  );
}

function UsageStatValue({
  used,
  cap,
  suffix,
}: {
  used: number;
  cap: number;
  suffix?: string;
}) {
  const fullLabel = `${fmtInt(used)} / ${fmtInt(cap)}${suffix ? ` ${suffix}` : ""}`;

  return (
    <div
      className="min-w-0 flex flex-nowrap items-baseline gap-x-1 overflow-hidden whitespace-nowrap"
      title={fullLabel}
      aria-label={fullLabel}
    >
      <span className="shrink-0">{fmtCompactInt(used)}</span>
      <span className="shrink-0 text-muted-foreground/70">/</span>
      <span className="shrink-0">{fmtCompactInt(cap)}</span>
      {suffix ? <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span> : null}
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
