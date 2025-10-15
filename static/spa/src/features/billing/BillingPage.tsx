// features/billing/BillingPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  loadActiveProducts,
  startCheckout,
  openBillingPortal,
  observeSubscriptions,
  type Product,
  type Subscription,
  type Price,
} from "./api";
import { Button } from "@/components/ui/button";
import { getJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { Check, Crown, MessageSquare, UploadCloud, AlertTriangle, Loader2 } from "lucide-react";

type LimitsResp = {
  plan: "FREE" | "PRO";
  window: string; // YYYYMM
  caps: { messages: number; upload_tokens: number };
  usage: { messages: number; upload_tokens: number };
  remaining: { messages: number; upload_tokens: number };
};

/**
 * Plans & Usage page
 * - Cleaner layout + visuals
 * - Shows usage snapshot
 * - Upgrade via Stripe Checkout
 * - If on Pro, show a dedicated **Cancel subscription** button (opens Stripe Portal)
 * - Removed the old "Manage billing" link section
 */
export default function BillingPage() {
  const { user, loading: authLoading } = useAuthContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [limits, setLimits] = useState<LimitsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load products once (public)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const prods = await loadActiveProducts();
        if (!cancel) setProducts(prods);
      } catch (e: any) {
        if (!cancel) setErr(e.message || String(e));
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Load limits when auth is ready (ensures cookie for /limits/me)
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

    return () => {
      cancel = true;
    };
  }, [user, authLoading]);

  // Observe subscription state
  useEffect(() => {
    let unsub: undefined | (() => void);
    observeSubscriptions((list) => setSubs(list))
      .then((fn) => {
        unsub = fn;
      })
      .catch(console.error);
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Refresh limits when window regains focus
  useEffect(() => {
    function onFocus() {
      if (!user) return;
      getJSON<LimitsResp>("/limits/me").then(setLimits).catch(() => {});
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user]);

  // Determine plan
  const activeSub = subs.find((s) => ["active", "trialing", "past_due"].includes(s.status));
  const onPro = !!activeSub || limits?.plan === "PRO";

  // Pick a Pro price (env override -> lowest recurring)
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

  const renewal = activeSub?.current_period_end
    ? new Date((activeSub.current_period_end as number) * 1000)
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
      {/* Page header */}
      <header className="mb-10">
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Plans &amp; Usage</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Pick what fits. Upgrade anytime — cancel with one click.
              </p>
            </div>
            <PlanBadge onPro={onPro} />
          </div>

          {/* Current plan quick stats */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              value={onPro ? (activeSub?.status === "past_due" ? "Pro (payment issue)" : "Pro") : "Free"}
            />
          </div>
        </div>
      </header>

      {err && (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span>{err}</span>
        </div>
      )}

      {/* Usage snapshot 
      {limits && (
        <section className="mb-10 grid gap-5 md:grid-cols-2">
          <UsageCard
            title="Messages"
            used={limits.usage.messages || 0}
            cap={limits.caps.messages}
          />
          <UsageCard
            title="Upload tokens"
            used={limits.usage.upload_tokens || 0}
            cap={limits.caps.upload_tokens}
          />
        </section>
      )}
      */}

      {/* Plans */}
      <section className="grid gap-6 md:grid-cols-2">
        {/* Free */}
        <div className="rounded-2xl border p-6 md:p-7 shadow-sm bg-background">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
              <Check className="h-3.5 w-3.5" /> Included
            </div>
            <h3 className="mt-3 text-xl font-semibold">Free</h3>
            <div className="mt-1 text-3xl font-semibold">€0</div>
            <div className="text-sm text-muted-foreground">per month</div>
          </div>
          <ul className="text-sm space-y-2 mb-6">
            <li>• Core chat and basic usage</li>
            <li>• Community support</li>
            <li>• Limited uploads</li>
          </ul>
          <Button className="w-full" variant="outline" disabled={onPro}>
            {onPro ? "You're on Pro" : "Your current plan"}
          </Button>
        </div>

        {/* Pro */}
        <div className="relative rounded-2xl border border-primary/30 p-6 md:p-7 shadow-sm bg-gradient-to-b from-primary/5 to-background">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 text-primary px-3 py-1 text-xs">
              <Crown className="h-3.5 w-3.5" /> Most popular
            </div>
            <h3 className="mt-3 text-xl font-semibold">Pro</h3>
            <div className="mt-1 text-3xl font-semibold">
              {formatMoney(proPrice?.unit_amount, proPrice?.currency)}
            </div>
            <div className="text-sm text-muted-foreground">per {proPrice?.interval ?? "month"}</div>
            {renewal && onPro && (
              <div className="mt-2 text-xs text-muted-foreground">
                Renews on <span className="font-medium">{renewal.toLocaleDateString()}</span>
              </div>
            )}
            {activeSub?.status === "past_due" && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-amber-100/60 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 px-2.5 py-1 text-xs">
                <AlertTriangle className="h-3.5 w-3.5" />
                Payment issue — update card in the portal.
              </div>
            )}
          </div>

          <ul className="text-sm space-y-2 mb-6">
            <li>• Priority RAG + longer context</li>
            <li>• Faster image creation</li>
            <li>• Team-ready features &amp; support</li>
          </ul>

          {!onPro ? (
            <Button
              className="w-full"
              onClick={() => {
                if (!proPrice) return;
                startCheckout(proPrice.id, { mode: "subscription" }).catch((e) => alert(e.message));
              }}
              disabled={!proPrice}
            >
              {proPrice ? "Get Pro" : "Loading price…"}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <Button className="w-full" variant="secondary" disabled>
                You're on Pro
              </Button>
              {/* CANCEL SUBSCRIPTION: replaces "Manage billing" link */}
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => {
                  const ok = window.confirm(
                    "Are you sure you want to cancel your subscription? You'll keep Pro until the end of the current period."
                  );
                  if (!ok) return;
                  // We open the Stripe Customer Portal where the user can finalize cancellation.
                  openBillingPortal()
                    .catch((e) => alert(e.message));
                }}
              >
                Cancel subscription
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Loading veil (auth handshake or first limits fetch) */}
      {loading && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating usage…
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ components ------------------------------ */

function PlanBadge({ onPro }: { onPro: boolean }) {
  return onPro ? (
    <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 text-primary px-3 py-1 text-xs bg-primary/5">
      <Crown className="h-3.5 w-3.5" />
      Pro plan
    </div>
  ) : (
    <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
      Free plan
    </div>
  );
}

function QuickStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2 shadow-sm">
      <div className="rounded-md border p-2">{icon}</div>
      <div className="text-sm">
        <div className="text-muted-foreground">{label}</div>
        <div className="font-medium">{value}</div>
      </div>
    </div>
  );
}

function UsageCard({ title, used, cap }: { title: string; used: number; cap: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  const remaining = Math.max(0, cap - used);
  return (
    <div className="rounded-2xl border p-5 shadow-sm bg-background">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="font-medium">{title}</h4>
        <div className="text-sm text-muted-foreground">
          {fmtInt(used)} / {fmtInt(cap)}
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-2 bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={used}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {fmtInt(remaining)} remaining this month
      </div>
    </div>
  );
}

/* ------------------------------ utilities ------------------------------ */

function formatMoney(amount?: number, currency?: string) {
  if (amount == null) return "—";
  const c = (currency || "eur").toUpperCase();
  return (amount / 100).toLocaleString(undefined, { style: "currency", currency: c });
}

function fmtInt(n: number) {
  try {
    return n.toLocaleString();
  } catch {
    return String(n ?? 0);
  }
}
