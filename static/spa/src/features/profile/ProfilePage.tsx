// src/features/profile/ProfilePage.tsx
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getJSON, postJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import {
  auth,
  changePassword,
  createRecaptchaVerifier,
  linkEmailPasswordToCurrentUser,
  linkGoogleToCurrentUser,
  sendVerificationEmail,
  startEmailChangeVerification,
  startPhoneLink,
  unlinkProviderFromCurrentUser,
  type ConfirmationResult,
} from "@/features/auth/firebase";
import ReauthDialog from "@/features/auth/ReauthDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { friendlyAuthMessage } from "@/features/auth/errorMessages";

type Profile = { uid: string; email?: string };

export default function ProfilePage() {
  const { refresh } = useAuthContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<{ email: string; password: string; confirm: string }>({
    email: "",
    password: "",
    confirm: "",
  });
  const [loading, setLoading] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  // Linked provider mgmt (Google / Phone / Email+password)
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState<string>("");
  const [phoneCode, setPhoneCode] = useState<string>("");
  const [phoneStep, setPhoneStep] = useState<"enter" | "code">("enter");
  const phoneConfirm = useRef<ConfirmationResult | null>(null);
  const phoneVerifier = useRef<any>(null);
  const phoneRecaptchaId = "profile-phone-recaptcha";

  // Reauth dialog handling
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthIntent, setReauthIntent] = useState<"email" | "password" | undefined>(undefined);
  const pendingAction = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getJSON<Profile>("/me");
        setProfile(data);
        setForm((f) => ({
          ...f,
          email: data.email || "",
        }));
      } catch (e: any) {
        toast.error(e?.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function syncServerSessionFromFirebase() {
    const u = auth.currentUser;
    if (!u) return;
    try {
      const idToken = await u.getIdToken(true);
      await postJSON("/auth/session", { id_token: idToken });
    } catch {
      // best-effort; the server will refresh on next full auth state change
    }
    await refresh();
  }

  async function reloadProfile() {
    try {
      const data = await getJSON<Profile>("/me");
      setProfile(data);
      setForm((f) => ({ ...f, email: data.email || f.email }));
    } catch {
      // ignore
    }
  }

  async function afterAuthMethodChange() {
    try {
      await auth.currentUser?.reload();
    } catch {}
    await syncServerSessionFromFirebase();
    await reloadProfile();
  }

  function isRecentLoginError(e: any) {
    const code = String(e?.code || "");
    const msg = String(e?.message || "");
    return code.includes("auth/requires-recent-login") || msg.toLowerCase().includes("requires recent login");
  }

  async function withReauthRetry(fn: () => Promise<void>, intent: "email" | "password") {
    try {
      await fn();
    } catch (e: any) {
      if (isRecentLoginError(e)) {
        pendingAction.current = fn;
        setReauthIntent(intent);
        setReauthOpen(true);
        toast.message("Please quickly re‑authenticate to continue.");
        return;
      }
      // Friendlier messages for account updates
      const ctx = intent === "email" ? "profile-email" : "profile-password";
      toast.error(friendlyAuthMessage(e, ctx as any));
    }
  }

  async function withReauthRetryAny(fn: () => Promise<void>, context: "profile-google" | "profile-phone" | "generic" = "generic") {
    try {
      await fn();
    } catch (e: any) {
      if (isRecentLoginError(e)) {
        pendingAction.current = fn;
        setReauthIntent(undefined);
        setReauthOpen(true);
        toast.message("Please quickly re‑authenticate to continue.");
        return;
      }
      toast.error(friendlyAuthMessage(e, context as any));
    }
  }

  async function onLinkGoogle() {
    if (busy) return;
    setBusy("google");
    try {
      await withReauthRetryAny(async () => {
        await linkGoogleToCurrentUser();
        toast.success("Google linked.");
        await afterAuthMethodChange();
      }, "profile-google");
    } finally {
      setBusy(null);
    }
  }

  async function onUnlinkProvider(providerId: string, context: "profile-google" | "profile-phone") {
    if (busy) return;
    setBusy(`unlink:${providerId}`);
    try {
      await withReauthRetryAny(async () => {
        await unlinkProviderFromCurrentUser(providerId);
        toast.success("Sign-in method unlinked.");
        await afterAuthMethodChange();
      }, context);
    } finally {
      setBusy(null);
    }
  }

  function clearPhoneLinkState() {
    setPhoneCode("");
    setPhoneStep("enter");
    phoneConfirm.current = null;
    try {
      phoneVerifier.current?.clear?.();
    } catch {}
    phoneVerifier.current = null;
  }

  async function onSendPhoneLinkCode() {
    const p = phone.trim();
    if (!p) return toast.error("Please enter your phone number.");
    if (busy) return;
    setBusy("phone:send");
    try {
      await withReauthRetryAny(async () => {
        clearPhoneLinkState();
        phoneVerifier.current = createRecaptchaVerifier(phoneRecaptchaId, { size: "invisible" });
        const conf = await startPhoneLink(p, phoneVerifier.current);
        phoneConfirm.current = conf;
        setPhoneStep("code");
        toast.success("Code sent. Check your SMS.");
      }, "profile-phone");
    } finally {
      setBusy(null);
    }
  }

  async function onConfirmPhoneLink() {
    const conf = phoneConfirm.current;
    if (!conf) return toast.error("Please request a code first.");
    const c = phoneCode.trim();
    if (!c) return toast.error("Please enter the SMS code.");
    if (busy) return;
    setBusy("phone:confirm");
    try {
      await conf.confirm(c);
      toast.success("Phone linked.");
      clearPhoneLinkState();
      await afterAuthMethodChange();
    } catch (e: any) {
      if (isRecentLoginError(e)) {
        pendingAction.current = () => onConfirmPhoneLink();
        setReauthIntent(undefined);
        setReauthOpen(true);
        toast.message("Please quickly re‑authenticate to continue.");
      } else {
        toast.error(friendlyAuthMessage(e, "phone-verify"));
      }
    } finally {
      setBusy(null);
    }
  }

  async function onEmailChangeSubmit(e: FormEvent) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return toast.error("Not signed in.");
    // If the user has no email yet (e.g. phone-only), guide them to link email/password first.
    if (!user.email && !profile?.email) {
      toast.message("No email is linked yet. Add email & password first.");
      return;
    }
    await withReauthRetry(async () => {
      const next = form.email.trim();
      if (!next) {
        toast.error("Email cannot be empty.");
        return;
      }
      await startEmailChangeVerification(user, next);
      toast.success("Verification email sent. Check your new inbox to confirm the change.");
      await afterAuthMethodChange();
    }, "email");
  }

  async function onPasswordChangeSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    const user = auth.currentUser;
    if (!user) return toast.error("Not signed in.");
    const providers = user.providerData?.map((p) => p.providerId) ?? [];
    const hasPasswordProvider = providers.includes("password");
    await withReauthRetry(async () => {
      if (!hasPasswordProvider) {
        const email = form.email.trim();
        if (!email) {
          toast.error("Please enter an email address to enable email login.");
          return;
        }
        await linkEmailPasswordToCurrentUser(email, form.password);
        try {
          const u = auth.currentUser;
          if (u && !u.emailVerified) {
            await sendVerificationEmail(u);
          }
        } catch {
          // ignore
        }
        toast.success("Email & password login added. Check your inbox to verify your email.");
        setForm({ ...form, password: "", confirm: "" });
        await afterAuthMethodChange();
        return;
      }

      await changePassword(user, form.password);
      toast.success("Password updated.");
      setForm({ ...form, password: "", confirm: "" });
      await afterAuthMethodChange();
    }, "password");
  }

  function onReauthSuccess() {
    setReauthOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) {
      action().catch((e) => toast.error(String(e?.message || e)));
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 md:p-10">
        <div className="animate-pulse space-y-6">
          <div className="h-7 w-40 rounded bg-muted" />
          <div className="h-32 w-full rounded-2xl bg-muted" />
          <div className="grid md:grid-cols-2 gap-6">
            <div className="h-72 rounded-2xl bg-muted" />
            <div className="h-72 rounded-2xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const fbUser = auth.currentUser;
  const providerIds = new Set(fbUser?.providerData?.map((p) => p.providerId) ?? []);
  if (fbUser?.phoneNumber) providerIds.add("phone");

  const hasGoogleProvider = providerIds.has("google.com");
  const hasPhoneProvider = providerIds.has("phone");
  const hasPasswordProvider = providerIds.has("password");
  const canUnlink = providerIds.size > 1;

  const currentEmail = fbUser?.email || profile.email || "";
  const sameEmail = !!currentEmail && form.email.trim() === currentEmail;

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your account and sign-in methods.</p>
        </div>
      </div>

      <Separator />

      {/* Sign-in methods */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Sign-in methods</h2>
        <p className="text-sm text-muted-foreground">
          Link additional ways to sign in. This helps you recover your account and switch devices more easily.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Google */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Google</CardTitle>
            <CardDescription>Sign in with the “Continue with Google” button.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              Status: <span className={hasGoogleProvider ? "font-medium" : "text-muted-foreground"}>{hasGoogleProvider ? "Linked" : "Not linked"}</span>
            </p>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            {hasGoogleProvider ? (
              <Button
                variant="secondary"
                onClick={() => onUnlinkProvider("google.com", "profile-google")}
                disabled={!canUnlink || busy !== null}
                title={!canUnlink ? "Link another sign-in method before unlinking Google" : undefined}
              >
                Unlink
              </Button>
            ) : (
              <Button onClick={onLinkGoogle} disabled={busy !== null}>
                Link Google
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Phone */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Phone</CardTitle>
            <CardDescription>Sign in using an SMS verification code.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* hidden container for invisible reCAPTCHA */}
            <div id={phoneRecaptchaId} className="hidden" />

            {hasPhoneProvider ? (
              <p className="text-sm">
                Status: <span className="font-medium">Linked</span>
                {fbUser?.phoneNumber ? (
                  <span className="text-muted-foreground"> — {fbUser.phoneNumber}</span>
                ) : null}
              </p>
            ) : (
              <div className="space-y-2">
                {phoneStep === "enter" ? (
                  <>
                    <Label htmlFor="phone-link">Phone number</Label>
                    <Input
                      id="phone-link"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+40 712 345 678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={busy !== null}
                    />
                  </>
                ) : (
                  <>
                    <Label htmlFor="phone-code">SMS code</Label>
                    <Input
                      id="phone-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={phoneCode}
                      onChange={(e) => setPhoneCode(e.target.value)}
                      disabled={busy !== null}
                    />
                    <p className="text-xs text-muted-foreground">We sent a code to {phone.trim() || "your phone"}.</p>
                  </>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-end gap-2">
            {hasPhoneProvider ? (
              <Button
                variant="secondary"
                onClick={() => onUnlinkProvider("phone", "profile-phone")}
                disabled={!canUnlink || busy !== null}
                title={!canUnlink ? "Link another sign-in method before unlinking your phone" : undefined}
              >
                Unlink
              </Button>
            ) : phoneStep === "enter" ? (
              <Button onClick={onSendPhoneLinkCode} disabled={busy !== null || !phone.trim()}>
                {busy === "phone:send" ? "Sending…" : "Send code"}
              </Button>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={() => clearPhoneLinkState()} disabled={busy !== null}>
                  Change number
                </Button>
                <Button onClick={onConfirmPhoneLink} disabled={busy !== null || !phoneCode.trim()}>
                  {busy === "phone:confirm" ? "Linking…" : "Link phone"}
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>

      <Separator />

      {/* Forms */}
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* Email */}
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Email address</CardTitle>
            <CardDescription>
              {currentEmail
                ? "We’ll send a verification link to your new email."
                : "No email is linked yet. Add email & password below to enable email sign-in."}
            </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
            {currentEmail ? (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  disabled={busy !== null}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your account doesn't have an email yet.
              </p>
            )}
            </CardContent>
            <CardFooter className="justify-end">
            <Button onClick={onEmailChangeSubmit as any} disabled={!currentEmail || !form.email || sameEmail || busy !== null}>
                {sameEmail ? "Already current" : "Send verification link"}
              </Button>
            </CardFooter>
          </Card>

          {/* Password */}
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Password</CardTitle>
            <CardDescription>
              {hasPasswordProvider
                ? "Set a new password for your account."
                : "Add email & password to enable email sign-in for this account."}
            </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
            {!hasPasswordProvider && (
              <div className="space-y-2">
                <Label htmlFor="link-email">Email</Label>
                <Input
                  id="link-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  disabled={busy !== null}
                  placeholder="you@example.com"
                />
              </div>
            )}
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="new-password"
                  disabled={busy !== null}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    title={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showPw2 ? "text" : "password"}
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                    autoComplete="new-password"
                    disabled={busy !== null}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPw2((v) => !v)}
                    aria-label={showPw2 ? "Hide password" : "Show password"}
                    title={showPw2 ? "Hide password" : "Show password"}
                  >
                    {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
            <Button
              onClick={onPasswordChangeSubmit as any}
              disabled={
                busy !== null ||
                !form.password ||
                !form.confirm ||
                (!hasPasswordProvider && !form.email.trim())
              }
            >
              {hasPasswordProvider ? "Update password" : "Add email & password"}
            </Button>
            </CardFooter>
          </Card>
        </div>
      </form>

      <Separator />
      <ReauthDialog open={reauthOpen} onClose={() => setReauthOpen(false)} onSuccess={onReauthSuccess} intent={reauthIntent} />
    </div>
  );
}
