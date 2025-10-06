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

type LimitsResp = {
  plan: "FREE" | "PRO";
  window: string; // YYYYMM
  caps: { messages: number; upload_tokens: number };
  usage: { messages: number; upload_tokens: number };
  remaining: { messages: number; upload_tokens: number };
};

/**
 * Pricing + Usage screen:
 * - shows Free/Pro cards
 * - shows current monthly usage pulled from /limits/me
 * - handles upgrade via Stripe Checkout, and "Manage billing" via Customer Portal
 */
export default function BillingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [limits, setLimits] = useState<LimitsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load products, usage and observe subscription state
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [prods, lim] = await Promise.all([
          loadActiveProducts(),
          getJSON<LimitsResp>("/limits/me").catch(() => null),
        ]);
        if (!cancel) {
          setProducts(prods);
          if (lim) setLimits(lim);
        }
      } catch (e: any) {
        if (!cancel) setErr(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    let unsub: undefined | (() => void);
    observeSubscriptions((list) => setSubs(list)).then((fn) => {
      unsub = fn;
    }).catch(console.error);

    return () => {
      cancel = true;
      if (unsub) unsub();
    };
  }, []);

  // Figure out whether the user is on Pro
  const activeSub = subs.find((s) => ["active", "trialing", "past_due"].includes(s.status));
  const onPro = !!activeSub || limits?.plan === "PRO";

  // Pick a "Pro" price:
  // 1) environment override (if provided),
  // 2) the lowest active recurring price from any product,
  // 3) otherwise undefined (button disabled).
  const proPrice: Price | undefined = useMemo(() => {
    const envId = (import.meta.env.VITE_STRIPE_PRO_PRICE_ID || "").trim();
    if (envId) {
      for (const p of products) {
        const hit = p.prices?.find((pr) => pr.id === envId);
        if (hit) return hit;
      }
    }
    // fallback: first lowest recurring
    let all: Price[] = [];
    for (const p of products) {
      if (p.prices?.length) {
        all = all.concat(p.prices.filter((pr) => pr.type !== "one_time" && pr.active !== false));
      }
    }
    if (!all.length) return undefined;
    return all.sort((a, b) => (a.unit_amount ?? 0) - (b.unit_amount ?? 0))[0];
  }, [products]);

  return (
    <div className="max-w-5xl mx-auto">
      <header className="text-center mb-10">
        <h1 className="text-3xl font-semibold">Plans & Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the plan that fits. You can manage or cancel anytime.
        </p>
      </header>

      {err && (
        <div className="mb-6 text-sm text-destructive">
          {err}
        </div>
      )}

      {/* Usage snapshot */}
      {limits && (
        <section className="mb-8 grid gap-4 md:grid-cols-2">
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

      {/* Pricing cards */}
      <section className="grid gap-6 md:grid-cols-2">
        {/* Free card */}
        <div className="card card-lg p-6 flex flex-col">
          <div className="mb-6">
            <h3 className="text-xl font-semibold">Free</h3>
            <div className="mt-2 text-3xl font-semibold">€0</div>
            <div className="text-sm text-muted-foreground">per month</div>
          </div>
          <ul className="text-sm space-y-2 flex-1">
            <li>• Core chat and basic usage</li>
            <li>• Community support</li>
            <li>• Limited uploads</li>
          </ul>
          <Button className="mt-6" variant="outline" disabled={onPro}>
            {onPro ? "You're on Pro" : "Your current plan"}
          </Button>
        </div>

        {/* Pro card */}
        <div className="card card-lg p-6 flex flex-col border-primary/30">
          <div className="mb-6">
            <h3 className="text-xl font-semibold">Pro</h3>
            <div className="mt-2 text-3xl font-semibold">
              {formatMoney(proPrice?.unit_amount, proPrice?.currency)}
            </div>
            <div className="text-sm text-muted-foreground">per {proPrice?.interval ?? "month"}</div>
          </div>
          <ul className="text-sm space-y-2 flex-1">
            <li>• Priority RAG + longer context</li>
            <li>• Faster image creation</li>
            <li>• Team-ready features & support</li>
          </ul>
          <Button
            className="mt-6"
            onClick={() => {
              if (!proPrice) return;
              startCheckout(proPrice.id, { mode: "subscription" })
                .catch((e) => alert(e.message));
            }}
            disabled={!proPrice || onPro}
          >
            {onPro ? "You're on Pro" : "Get Pro"}
          </Button>
        </div>
      </section>

      {/* Manage billing (Stripe Customer Portal) */}
      <div className="text-center mt-8">
        <Button
          variant="link"
          className="underline underline-offset-4"
          onClick={() => openBillingPortal().catch((e) => alert(e.message))}
          title="Update card, invoices, cancel, etc."
        >
          Manage billing
        </Button>
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

function UsageCard({ title, used, cap }: { title: string; used: number; cap: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  const remaining = Math.max(0, cap - used);
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="font-medium">{title}</h4>
        <div className="text-sm text-muted-foreground">
          {used.toLocaleString()} / {cap.toLocaleString()}
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-2 bg-primary"
          style={{ width: `${pct}%` }}
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={used}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {remaining.toLocaleString()} remaining this month
      </div>
    </div>
  );
}
