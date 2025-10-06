import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";

vi.mock("@/features/billing/api", async () => {
  const mod = await import("./__mocks__/billingApiMock");
  return mod;
});
vi.mock("@/shared/api", () => ({ getJSON: vi.fn() }));

import BillingPage from "@/features/billing/BillingPage";
import { getJSON } from "@/shared/api";
import {
  loadActiveProducts,
  startCheckout,
  openBillingPortal,
  observeSubscriptions,
  type Price,
  type Product,
  type Subscription,
} from "@/features/billing/api";

function arrangeProducts(): Product[] {
  const pro: Price = {
    id: "price_pro_month",
    type: "recurring",
    unit_amount: 1200,
    currency: "eur",
    interval: "month",
    active: true,
  };
  return [{
    id: "prod_pro",
    name: "Pro",
    description: "Pro plan",
    active: true,
    default_price: pro.id,
    images: [],
    metadata: {},
    prices: [pro],
  }];
}

function fakeLimits(plan: "FREE" | "PRO") {
  return {
    plan,
    window: "202510",
    caps: { messages: plan === "PRO" ? 10000 : 200, upload_tokens: plan === "PRO" ? 20000000 : 200000 },
    usage: { messages: 3, upload_tokens: 1234 },
    remaining: { messages: plan === "PRO" ? 9997 : 197, upload_tokens: plan === "PRO" ? (20000000-1234) : (200000-1234) },
  };
}

const getProCard = async () => {
  // Wait until we see the "Pro" heading and the formatted price, then return the enclosing card
  const heading = await screen.findByRole("heading", { name: /pro/i });
  const card = heading.closest("div")!.parentElement as HTMLElement;
  expect(card).toBeTruthy();
  // Also ensure the money text landed to avoid early queries
  await screen.findByText(/€?\s?12\.00/i);
  return card;
};

const getProButton = async () => {
  const card = await getProCard();
  // Be robust: search by text inside the card and then climb to the button element
  const textNode = await within(card).findByText(/get pro|you're on pro/i);
  const btn = textNode.closest("button") as HTMLButtonElement | null;
  if (!btn) throw new Error("Pro button not found");
  return btn;
};

beforeEach(() => {
  vi.clearAllMocks();
  (loadActiveProducts as any).mockResolvedValue(arrangeProducts());
  (getJSON as any).mockResolvedValue(fakeLimits("FREE"));
  (observeSubscriptions as any).mockImplementation((cb: (subs: Subscription[]) => void) => {
    cb([]);
    return Promise.resolve(() => {});
  });
});

describe("BillingPage — subscription upgrade", () => {
  it("shows 'Get Pro' and calls startCheckout with the chosen price", async () => {
    render(<BillingPage />);

    const btn = await getProButton();
    expect(btn).toBeEnabled();

    fireEvent.click(btn);
    await waitFor(() => {
      expect(startCheckout).toHaveBeenCalledTimes(1);
      const [priceId, opts] = (startCheckout as any).mock.calls[0];
      expect(priceId).toBe("price_pro_month");
      expect(opts).toMatchObject({ mode: "subscription" });
    });
  });

  it("disables Pro button when already on Pro (plan=PRO from /limits/me)", async () => {
    (getJSON as any).mockResolvedValueOnce(fakeLimits("PRO"));

    render(<BillingPage />);

    const btn = await getProButton();
    expect(btn).toBeDisabled();
    expect(btn.textContent?.toLowerCase()).toContain("you're on pro");
  });
});

describe("BillingPage — usage tier upgrades", () => {
  it("shows usage cards and reflects PRO caps when plan=PRO from /limits/me", async () => {
    (getJSON as any).mockResolvedValueOnce(fakeLimits("PRO"));
    render(<BillingPage />);

    expect(await screen.findByText(/Messages/i)).toBeInTheDocument();
    expect(screen.getByText(/10,000/)).toBeInTheDocument();
    expect(screen.getByText(/20,000,000/)).toBeInTheDocument();

    const btn = await getProButton();
    expect(btn).toBeDisabled();
  });
});

describe("BillingPage — subscription cancellation", () => {
  it("re-enables upgrade when only 'canceled' subscription is present", async () => {
    (observeSubscriptions as any).mockImplementation((cb: (subs: Subscription[]) => void) => {
      cb([{ id: "sub_1", status: "canceled" } as Subscription]);
      return Promise.resolve(() => {});
    });

    render(<BillingPage />);
    const btn = await getProButton();
    expect(btn).toBeEnabled();
  });
});

describe("BillingPage — access to Stripe's billing management", () => {
  it("calls openBillingPortal when 'Manage billing' is clicked", async () => {
    render(<BillingPage />);
    const manage = await screen.findByRole("button", { name: /manage billing/i });
    fireEvent.click(manage);
    await waitFor(() => expect(openBillingPortal).toHaveBeenCalledTimes(1));
  });
});

describe("BillingPage — subscription period dates", () => {
  it("treats an 'active' sub with a future current_period_end as Pro (plan=PRO)", async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    (observeSubscriptions as any).mockImplementation((cb: (subs: Subscription[]) => void) => {
      cb([{ id: "sub_2", status: "active", current_period_end: periodEnd } as Subscription]);
      return Promise.resolve(() => {});
    });
    (getJSON as any).mockResolvedValueOnce(fakeLimits("PRO"));

    render(<BillingPage />);
    const btn = await getProButton();
    expect(btn).toBeDisabled();
  });
});
