/**
 * Map Firebase Auth errors to friendly, actionable messages.
 * We keep the raw code in the dev console for easier debugging.
 */
export function friendlyAuthMessage(
  error: unknown,
  context:
    | "login"
    | "signup"
    | "verify"
    | "phone"
    | "phone-verify"
    | "generic"
    | "profile-email"
    | "profile-password" = "generic"
): string {
  // Extract best-effort code/message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e: any = error ?? {};
  const code: string = (typeof e.code === "string" ? e.code : "") || "";
  const msg: string = (typeof e.message === "string" ? e.message : "") || "";

  // Some SDKs embed the code in the message like "Firebase: Error (auth/invalid-credential)."
  const inferred = !code && /auth\/[a-z-]+/i.test(msg) ? msg.match(/auth\/([a-z-]+)/i)?.[0] : code;

  const c = (inferred || "").toLowerCase();

  // Common across flows
  if (c.includes("network-request-failed")) {
    return "Network error. Check your connection and try again.";
  }
  if (c.includes("too-many-requests")) {
    // Generic throttle copy
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (c.includes("popup-closed-by-user")) {
    return "The sign-in popup was closed before completing. Please try again.";
  }
  if (c.includes("internal-error")) {
    return "Something went wrong on our side. Please try again.";
  }
  if (c.includes("captcha-check-failed")) {
    return "reCAPTCHA check failed. If you're running locally, make sure your domain is whitelisted in Firebase Authentication → Settings → Authorized domains.";
  }



  if (context === "phone") {
    if (c.includes("operation-not-allowed") || msg.toLowerCase().includes("region enabled")) {
      return "SMS can't be sent to this phone number's region yet. In Firebase Console -> Authentication -> Settings -> SMS region policy, allow the country/region for this number (e.g. +40). If you're testing, add a test phone number/code under Authentication -> Sign-in method -> Phone -> Phone numbers for testing.";
    }
    if (c.includes("invalid-phone-number")) {
      return "That phone number looks invalid. Use international format, e.g. +40 712 345 678.";
    }
    if (c.includes("missing-phone-number")) {
      return "Please enter your phone number.";
    }
    if (c.includes("quota-exceeded")) {
      return "SMS quota exceeded for this project. Try again later or use email/Google.";
    }
    if (c.includes("user-disabled")) {
      return "This account has been disabled. Contact support if this is unexpected.";
    }
    if (c.includes("too-many-requests")) {
      return "Too many SMS requests. Please wait a moment and try again.";
    }
    return "We couldn't send the SMS code. Please try again.";
  }

  if (context === "phone-verify") {
    if (c.includes("invalid-verification-code")) {
      return "That code is incorrect. Please check the SMS and try again.";
    }
    if (c.includes("code-expired")) {
      return "That code expired. Please request a new one.";
    }
    return "Couldn't verify the code. Please try again.";
  }

  if (context === "login") {
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) {
      return "Email or password is incorrect.";
    }
    if (c.includes("invalid-email")) {
      return "Please enter a valid email address.";
    }
    if (c.includes("user-disabled")) {
      return "This account has been disabled. Contact support if this is unexpected.";
    }
    return "Unable to sign in. Please try again.";
  }

  if (context === "signup") {
    if (c.includes("email-already-in-use")) {
      return "An account with this email already exists. Try signing in instead.";
    }
    if (c.includes("invalid-email")) {
      return "Please enter a valid email address.";
    }
    if (c.includes("weak-password")) {
      return "Password is too weak. Use at least 8 characters with letters and numbers.";
    }
    if (c.includes("operation-not-allowed")) {
      return "Email/password sign-up is disabled. Please contact support.";
    }
    return "Unable to create account. Please try again.";
  }

  if (context === "verify") {
    // More specific copy for verification email throttling
    if (c.includes("too-many-requests")) {
      return "You're sending verification emails too often. Please wait a bit and try again.";
    }
    if (c.includes("missing-email")) {
      return "We couldn't find your email. Please sign in again and retry.";
    }
    return "Couldn't send the verification email. Please try again.";
  }

  // Profile (account settings) flows
  if (context === "profile-email") {
    if (c.includes("email-already-in-use") || msg.toLowerCase().includes("already in use")) {
      return "That email is already in use. Try a different address.";
    }
    if (c.includes("invalid-email")) {
      return "Please enter a valid email address.";
    }
    if (c.includes("requires-recent-login")) {
      return "Please re‑authenticate to continue.";
    }
    // Some projects with Email Enumeration Protection enabled may surface "operation-not-allowed"
    // when verifyBeforeUpdateEmail can't disclose the email's existence.
    if (c.includes("operation-not-allowed")) {
      return "We couldn't start the change using that address. Try a different email or contact support.";
    }
    return "Couldn't update your email. Please try again.";
  }

  if (context === "profile-password") {
    if (c.includes("weak-password")) {
      return "Password is too weak. Use at least 8 characters with letters and numbers.";
    }
    if (c.includes("requires-recent-login")) {
      return "Please re‑authenticate to continue.";
    }
    return "Couldn't update your password. Please try again.";
  }

  // Fallback
  return "Something went wrong. Please try again.";
}


