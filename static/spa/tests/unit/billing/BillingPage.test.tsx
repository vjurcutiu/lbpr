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
  const legacyIntro: Price = {
    id: "price_intro_month",
    type: "recurring",
    unit_amount: 100,
    currency: "eur",
    interval: "month",
    active: true,
  };
  const pro: Price = {
    id: "price_pro_month",
    type: "recurring",
    unit_amount: 1200,
    currency: "eur",
    interval: "month",
    active: true,
    lookup_key: "pro_monthly",
  };
  return [{
    id: "prod_pro",
    name: "LexBot Pro",
    description: "Pro plan",
    active: true,
    default_price: pro.id,
    images: [],
    metadata: { code: "pro" },
    prices: [legacyIntro, pro],
  }];
}

function fakeLimits(plan: "FREE" | "PRO") {
  return {
    plan,
    window: "202510",
    caps: { messages: plan === "PRO" ? 2000 : 200, upload_tokens: plan === "PRO" ? 20000000 : 200000, workflow_tokens: plan === "PRO" ? 5000000 : 200000 },
    usage: { messages: 3, upload_tokens: 1234, workflow_tokens: 4567 },
    remaining: { messages: plan === "PRO" ? 1997 : 197, upload_tokens: plan === "PRO" ? (20000000-1234) : (200000-1234), workflow_tokens: plan === "PRO" ? (5000000-4567) : (200000-4567) },
  };
}

const getProCard = async () => {
  // Wait until we see the "Pro" heading and the formatted price, then return the enclosing card
  const heading = await screen.findByRole("heading", { name: /pro/i });
  const card = heading.closest("div")!.parentElement as HTMLElement;
  expect(card).toBeTruthy();
  // Also ensure the money text landed to avoid early queries
  await screen.findByText(/€\s?12|€12/i);
  return card;
};

const getProButton = async () => {
  const card = await getProCard();
  // Be robust: search by text inside the card and then climb to the button element
  const textNode = await within(card).findByText(/upgrade to pro|you're on pro/i);
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
  it("shows 'Upgrade to Pro' and asks the backend to start checkout", async () => {
    render(<BillingPage />);

    const btn = await getProButton();
    expect(btn).toBeEnabled();

    fireEvent.click(btn);
    await waitFor(() => {
      expect(startCheckout).toHaveBeenCalledTimes(1);
      const [opts] = (startCheckout as any).mock.calls[0];
      expect(opts).toMatchObject({ planKey: "pro", mode: "subscription" });
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
    expect(screen.getByLabelText("3 / 2,000")).toHaveTextContent("3/2K");
    expect(screen.getByLabelText("1,234 / 20,000,000")).toHaveTextContent("1.2K/20M");
    expect(screen.getByLabelText("4,567 / 5,000,000")).toHaveTextContent("4.6K/5M");

    expect(screen.getByText(/2,000 messages \/ month/)).toBeInTheDocument();
    expect(screen.getByText(/20,000,000 file upload tokens/)).toBeInTheDocument();
    expect(screen.getByText(/5,000,000 workflow tokens \/ month/)).toBeInTheDocument();

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
    const manage = await screen.findByRole("button", { name: /manage subscription/i });
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
