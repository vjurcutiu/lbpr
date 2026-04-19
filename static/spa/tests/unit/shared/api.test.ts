import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getJSON, postJSON } from "@/shared/api";

describe("shared api timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts stuck requests after the provided timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockImplementation((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => {
          reject(capturedSignal?.reason ?? new DOMException("Request timed out", "TimeoutError"));
        });
      });
    }) as typeof fetch);

    const promise = getJSON("/session", { timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(30);

    await expect(promise).rejects.toThrow("The request timed out. Please try again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("keeps working for successful JSON posts", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(postJSON("/auth/session", { id_token: "abc" }, { timeoutMs: 100 })).resolves.toEqual({ ok: true });
  });
});
