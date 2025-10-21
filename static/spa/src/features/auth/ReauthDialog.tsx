// src/features/auth/ReauthDialog.tsx
import { useEffect, useMemo, useState } from "react";
import { auth, reauthWithPassword, reauthWithGoogle } from "@/features/auth/firebase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  intent?: "email" | "password"; // context for user copy only
};

export default function ReauthDialog({ open, onClose, onSuccess, intent }: Props) {
  const user = auth.currentUser;
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const providers = user?.providerData?.map(p => p.providerId) ?? [];
  const hasPasswordProvider = providers.includes("password");
  const hasGoogleProvider = providers.includes("google.com");

  useEffect(() => {
    if (!open) {
      setPw("");
      setErr(null);
      setLoading(false);
    }
  }, [open]);

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
      } else {
        await reauthWithGoogle();
      }
      onSuccess();
    } catch (e: any) {
      const code = String(e?.code || "");
      setErr(code || "Re-authentication failed. Please try again.");
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

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : onClose())}>
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

          <DialogFooter className="gap-2 sm:gap-3">
            {hasGoogleProvider && (
              <Button type="button" variant="secondary" onClick={onGoogle} disabled={loading}>
                Continue with Google
              </Button>
            )}
            <Button type="submit" disabled={loading}>
              {loading ? "Verifying…" : "Verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
