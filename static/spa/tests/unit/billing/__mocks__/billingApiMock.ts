// __mocks__/billingApiMock.ts
// Re-export shapes to keep types happy when importing from '@/features/billing/api'
export type { Product, Price, Subscription } from "@/features/billing/api";

// Provide test doubles that return Promises by default because the component calls `.catch(...)`
export const loadActiveProducts = vi.fn(async () => {
  return [];
});

export const startCheckout = vi.fn(async (_priceId?: string, _opts?: any) => {
  // Simulate Stripe redirect creation success
  return { id: "cs_test_123" };
});

export const openBillingPortal = vi.fn(async () => {
  // Simulate portal session creation success
  return { id: "bps_test_123" };
});

// Observe subscriptions: resolves to an unsubscribe function and may call cb synchronously.
export const observeSubscriptions = vi.fn((cb: (subs: Subscription[]) => void) => {
  cb([]);
  return Promise.resolve(() => {});
});
