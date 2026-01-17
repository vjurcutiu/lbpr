import { describe, expect, it } from "vitest";
import { friendlyAuthMessage } from "@/features/auth/errorMessages";

describe("friendlyAuthMessage", () => {
  it("maps network errors", () => {
    expect(friendlyAuthMessage({ code: "auth/network-request-failed" }, "login"))
      .toMatch(/Network error/i);
  });

  it("maps login invalid credential variants", () => {
    expect(friendlyAuthMessage({ code: "auth/invalid-credential" }, "login"))
      .toBe("Email or password is incorrect.");
    expect(friendlyAuthMessage({ code: "auth/wrong-password" }, "login"))
      .toBe("Email or password is incorrect.");
    expect(friendlyAuthMessage({ code: "auth/user-not-found" }, "login"))
      .toBe("Email or password is incorrect.");
  });

  it("maps signup email already in use", () => {
    expect(friendlyAuthMessage({ code: "auth/email-already-in-use" }, "signup"))
      .toMatch(/already exists/i);
  });

  it("maps weak password", () => {
    expect(friendlyAuthMessage({ code: "auth/weak-password" }, "signup"))
      .toMatch(/too weak/i);
  });

  it("maps phone invalid phone", () => {
    expect(friendlyAuthMessage({ code: "auth/invalid-phone-number" }, "phone"))
      .toMatch(/looks invalid/i);
  });

  it("maps phone verify invalid code", () => {
    expect(friendlyAuthMessage({ code: "auth/invalid-verification-code" }, "phone-verify"))
      .toMatch(/incorrect/i);
  });

  it("infers code from message when code missing", () => {
    const msg = "Firebase: Error (auth/too-many-requests).";
    expect(friendlyAuthMessage({ message: msg }, "verify"))
      .toMatch(/too often/i);
  });

  it("falls back to generic", () => {
    expect(friendlyAuthMessage({ code: "auth/some-new-error" }, "login"))
      .toMatch(/Unable to sign in/i);
  });
});
