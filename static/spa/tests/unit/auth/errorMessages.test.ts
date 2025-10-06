import { describe, it, expect } from "vitest";
import { friendlyAuthMessage } from "@/features/auth/errorMessages";

describe("friendlyAuthMessage", () => {
  it("maps invalid-credential to friendly login message", () => {
    const msg = friendlyAuthMessage({ code: "auth/invalid-credential" }, "login");
    expect(msg).toMatch(/Email or password is incorrect/i);
  });

  it("maps weak-password on signup", () => {
    const msg = friendlyAuthMessage({ code: "auth/weak-password" }, "signup");
    expect(msg).toMatch(/Password is too weak/i);
  });

  it("handles network error", () => {
    const msg = friendlyAuthMessage({ code: "auth/network-request-failed" }, "generic");
    expect(msg).toMatch(/Network error/i);
  });

  it("infers code from message string", () => {
    const msg = friendlyAuthMessage({ message: "Firebase: Error (auth/user-not-found)." }, "login");
    expect(msg).toMatch(/Email or password is incorrect/i);
  });
});
