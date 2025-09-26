// features/billing/BillingPage.tsx
import { useEffect, useState } from "react";
import { startCheckout, openBillingPortal, loadActiveProducts, observeSubscriptions, type Product, type Subscription } from "./api";
import { Button } from "@/components/ui/button";

export default function BillingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const prods = await loadActiveProducts();
        if (!cancel) setProducts(prods);
      } catch (e: any) {
        console.error(e);
        if (!cancel) setError(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    let unsub: undefined | (() => void);
    observeSubscriptions((list) => setSubs(list)).then((fn) => { unsub = fn; }).catch(console.error);
    return () => { cancel = true; if (unsub) unsub(); };
  }, []);

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your plan and payment details.</p>
        </div>
        <Button variant="outline" onClick={() => openBillingPortal().catch((e)=>alert(e.message))}>
          Open Billing Portal
        </Button>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Your Subscription</h2>
        {subs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No active subscription found.</div>
        ) : (
          <div className="grid gap-3">
            {subs.map((s) => (
              <div key={s.id} className="card p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.status.replaceAll("_", " ")}</div>
                  <div className="text-sm text-muted-foreground">
                    {s.items?.[0]?.price?.nickname || s.items?.[0]?.price?.id}
                  </div>
                </div>
                {s.current_period_end && (
                  <div className="text-sm text-muted-foreground">
                    Renews on {new Date(s.current_period_end * 1000).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Plans</h2>
        {loading && <div className="text-sm">Loading products…</div>}
        {error && <div className="text-sm text-destructive">Error: {error}</div>}
        {!loading && !error && (
          <div className="grid md:grid-cols-3 gap-6">
            {products.map((p) => (
              <div key={p.id} className="card card-lg p-6 flex flex-col">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  {p.description && (
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{p.description}</p>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {p.prices?.map((pr) => (
                    <div key={pr.id} className="flex items-center justify-between rounded-xl border px-3 py-2">
                      <div>
                        <div className="font-medium">
                          {formatMoney(pr.unit_amount, pr.currency)}
                          {pr.interval ? <span className="text-sm text-muted-foreground"> /{pr.interval}</span> : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pr.nickname || (pr.type === "recurring" ? "Subscription" : "One-time")}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          startCheckout(pr.id, { mode: pr.type === "one_time" ? "payment" : "subscription" })
                            .catch((e) => alert(e.message))
                        }
                      >
                        {pr.type === "one_time" ? "Buy" : "Subscribe"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatMoney(amount?: number, currency?: string) {
  if (amount == null) return "-";
  const c = (currency || "usd").toUpperCase();
  return (amount / 100).toLocaleString(undefined, { style: "currency", currency: c });
}
