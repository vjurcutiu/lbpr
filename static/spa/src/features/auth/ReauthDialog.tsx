// src/features/auth/ReauthDialog.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  auth,
  createRecaptchaVerifier,
  reauthWithGoogle,
  reauthWithPassword,
  reauthWithPhone,
  startPhoneReauth,
} from "@/features/auth/firebase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { friendlyAuthMessage } from "@/features/auth/errorMessages";

type Props = {
  open: boolean;
  onClose?: () => void;
  // Back-compat: some callers use onOpenChange; we support both.
  onOpenChange?: (open: boolean) => void;
  onSuccess: () => void;
  intent?: "email" | "password"; // context for user copy only
};

export default function ReauthDialog({ open, onClose, onOpenChange, onSuccess, intent }: Props) {
  const user = auth.currentUser;
  const [pw, setPw] = useState("");
  const [phone, setPhone] = useState("");
  const [sms, setSms] = useState("");
  const [phoneStep, setPhoneStep] = useState<"enter" | "code">("enter");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const verifierRef = useRef<any>(null);
  const recaptchaId = "reauth-recaptcha";

  const providers = user?.providerData?.map(p => p.providerId) ?? [];
  const hasPasswordProvider = providers.includes("password");
  const hasGoogleProvider = providers.includes("google.com");
  const hasPhoneProvider = providers.includes("phone") || !!user?.phoneNumber;

  useEffect(() => {
    if (open) {
      setPw("");
      setPhone(user?.phoneNumber || "");
      setSms("");
      setPhoneStep("enter");
      setVerificationId(null);
      setErr(null);
      setLoading(false);
      return;
    }
    // closing
    try {
      verifierRef.current?.clear?.();
    } catch {}
    verifierRef.current = null;
  }, [open, user?.phoneNumber]);

  const title = useMemo(() => {
    if (intent === "email") return "Verify your identity to change email";
    if (intent === "password") return "Verify your identity to change password";
    return "Verify your identity";
  }, [intent]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setErr(null);
    setLoading(true);
    try {
      if (hasPasswordProvider) {
        await reauthWithPassword(user.email || "", pw);
      } else if (hasGoogleProvider) {
        await reauthWithGoogle();
      } else if (hasPhoneProvider) {
        // If we reached here, user hit "Verify" in the phone step.
        if (!verificationId) {
          throw new Error("Missing verification state");
        }
        await reauthWithPhone(verificationId, sms);
      } else {
        await reauthWithGoogle();
      }
      onSuccess();
    } catch (e: any) {
      if (hasPhoneProvider) {
        setErr(friendlyAuthMessage(e, "phone-verify"));
      } else {
        const code = String(e?.code || "");
        setErr(code || "Re-authentication failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setErr(null);
    setLoading(true);
    try {
      await reauthWithGoogle();
      onSuccess();
    } catch (e: any) {
      const code = String(e?.code || "");
      setErr(code || "Re-authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onSendPhoneCode() {
    if (!user) return;
    const p = phone.trim();
    if (!p) {
      setErr("Please enter your phone number.");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      try {
        verifierRef.current?.clear?.();
      } catch {}
      verifierRef.current = createRecaptchaVerifier(recaptchaId, { size: "invisible" });
      const vid = await startPhoneReauth(p, verifierRef.current);
      setVerificationId(vid);
      setPhoneStep("code");
    } catch (e: any) {
      setErr(friendlyAuthMessage(e, "phone"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange?.(v);
        if (!v) onClose?.();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            For your security, we need you to confirm it's really you.
          </DialogDescription>
        </DialogHeader>

        {err && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription aria-live="polite">{err}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          {/* hidden container for invisible reCAPTCHA (phone reauth) */}
          <div id={recaptchaId} className="hidden" />

          {hasPasswordProvider && (
            <div className="space-y-2">
              <label htmlFor="current-password" className="text-sm font-medium">Current password</label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                disabled={loading}
                placeholder="Enter your current password"
              />
            </div>
          )}

          {hasPhoneProvider && !hasPasswordProvider && !hasGoogleProvider && (
            <div className="space-y-2">
              {phoneStep === "enter" ? (
                <>
                  <label htmlFor="reauth-phone" className="text-sm font-medium">Phone number</label>
                  <Input
                    id="reauth-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loading}
                    placeholder="+40 712 345 678"
                  />
                  <Button type="button" onClick={onSendPhoneCode} disabled={loading || !phone.trim()}>
                    {loading ? "Sending…" : "Send code"}
                  </Button>
                </>
              ) : (
                <>
                  <label htmlFor="reauth-code" className="text-sm font-medium">SMS code</label>
                  <Input
                    id="reauth-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={sms}
                    onChange={(e) => setSms(e.target.value)}
                    disabled={loading}
                    placeholder="123456"
                  />
                </>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-3">
            {(hasGoogleProvider || (!hasPasswordProvider && !hasPhoneProvider && !hasGoogleProvider)) && (
              <Button type="button" variant="secondary" onClick={onGoogle} disabled={loading}>
                Continue with Google
              </Button>
            )}
            {/* For phone reauth, the submit button only appears in the code step */}
            {!(hasPhoneProvider && !hasPasswordProvider && !hasGoogleProvider && phoneStep === "enter") && (
              <Button type="submit" disabled={loading}>
                {loading ? "Verifying…" : "Verify"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
