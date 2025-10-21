// src/features/profile/ProfilePage.tsx
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { auth, startEmailChangeVerification, changePassword } from "@/features/auth/firebase";
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

  async function onEmailChangeSubmit(e: FormEvent) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return toast.error("Not signed in.");
    await withReauthRetry(async () => {
      const next = form.email.trim();
      if (!next) {
        toast.error("Email cannot be empty.");
        return;
      }
      await startEmailChangeVerification(user, next);
      toast.success("Verification email sent. Check your new inbox to confirm the change.");
      await refresh();
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
    await withReauthRetry(async () => {
      await changePassword(user, form.password);
      toast.success("Password updated.");
      setForm({ ...form, password: "", confirm: "" });
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

  const sameEmail = profile.email && form.email.trim() === profile.email;

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Update your email and password.</p>
        </div>
      </div>

      {/* Forms */}
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* Email */}
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Email address</CardTitle>
              <CardDescription>We’ll send a verification link to your new email.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={onEmailChangeSubmit as any} disabled={!form.email || sameEmail}>
                {sameEmail ? "Already current" : "Send verification link"}
              </Button>
            </CardFooter>
          </Card>

          {/* Password */}
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Set a new password for your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="new-password"
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
              <Button onClick={onPasswordChangeSubmit as any} disabled={!form.password || !form.confirm}>
                Update password
              </Button>
            </CardFooter>
          </Card>
        </div>
      </form>

      <Separator />
      <ReauthDialog open={reauthOpen} onOpenChange={() => setReauthOpen(false)} onSuccess={onReauthSuccess} intent={reauthIntent} />
    </div>
  );
}
