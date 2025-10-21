// src/features/profile/ProfilePage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getJSON, postJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { auth, startEmailChangeVerification, changePassword } from "@/features/auth/firebase";
import ReauthDialog from "@/features/auth/ReauthDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, EyeOff, AlertTriangle, CheckCircle2 } from "lucide-react";

type Profile = { uid: string; email?: string; name?: string; picture?: string };

export default function ProfilePage() {
  const { refresh } = useAuthContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<{ email: string; name: string; picture: string; password: string; confirm: string }>({
    email: "",
    name: "",
    picture: "",
    password: "",
    confirm: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  // Reauth dialog handling
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthIntent, setReauthIntent] = useState<"email" | "password" | undefined>(undefined);
  const pendingAction = useRef<null | (() => Promise<void>)>(null);

  // derived
  const displayName = useMemo(() => form.name || (form.email ? form.email.split("@")[0] : ""), [form.name, form.email]);
  const initials = (displayName || form.email || "U").slice(0, 1).toUpperCase();

  useEffect(() => {
    (async () => {
      try {
        const data = await getJSON<Profile>("/me");
        setProfile(data);
        setForm({
          email: data.email || "",
          name: data.name || (data.email ? data.email.split("@")[0] : ""),
          picture: data.picture || "",
          password: "",
          confirm: "",
        });
      } catch (e: any) {
        setErr(e?.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveProfileBasics(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setSaving(true);
    try {
      const payload = { name: form.name, picture: form.picture };
      const data = await postJSON<Profile>("/me", payload, { method: "PATCH" });
      setProfile(data);
      setOk("Profile updated.");
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
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
        return;
      }
      setErr(e?.message || "Operation failed.");
    }
  }

  async function onEmailChangeSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    const user = auth.currentUser;
    if (!user) return setErr("Not signed in.");
    await withReauthRetry(async () => {
      await startEmailChangeVerification(user, form.email.trim());
      setOk("Verification email sent. Please click the link in your new inbox to finish changing your email.");
    }, "email");
  }

  async function onPasswordChangeSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    if (form.password !== form.confirm) {
      setErr("Passwords do not match.");
      return;
    }
    const user = auth.currentUser;
    if (!user) return setErr("Not signed in.");
    await withReauthRetry(async () => {
      await changePassword(user, form.password);
      setOk("Password updated.");
      setForm({ ...form, password: "", confirm: "" });
    }, "password");
  }

  function onReauthSuccess() {
    setReauthOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) action().catch((e) => setErr(String(e?.message || e)));
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 md:p-10">
        <div className="animate-pulse space-y-6">
          <div className="h-7 w-40 rounded bg-muted" />
          <div className="h-32 w-full rounded-2xl bg-muted" />
          <div className="grid md:grid-cols-5 gap-6">
            <div className="md:col-span-3 h-72 rounded-2xl bg-muted" />
            <div className="md:col-span-2 h-72 rounded-2xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile && err) return <div className="p-6 text-red-600">{err}</div>;
  if (!profile) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Your Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your account, profile details, and security preferences.</p>
        </div>
      </div>

      {(err || ok) && (
        <Alert variant={err ? "destructive" as any : "default"} className="border rounded-xl">
          <div className="flex items-start gap-3">
            {err ? <AlertTriangle className="h-5 w-5 mt-0.5" /> : <CheckCircle2 className="h-5 w-5 mt-0.5" />}
            <div>
              <AlertTitle>{err ? "Something went wrong" : "Success"}</AlertTitle>
              <AlertDescription aria-live="polite">{err || ok}</AlertDescription>
            </div>
          </div>
        </Alert>
      )}

      <form onSubmit={saveProfileBasics} className="grid md:grid-cols-5 gap-6">
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update your name and photo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="name" className="sm:col-span-1">Display name</Label>
              <div className="sm:col-span-3">
                <Input id="name" value={displayName} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" disabled={saving} />
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="picture" className="sm:col-span-1">Photo URL</Label>
              <div className="sm:col-span-3 space-y-3">
                <Input id="picture" value={form.picture || ""} onChange={(e) => setForm({ ...form, picture: e.target.value })} placeholder="https://…" disabled={saving} />
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={form.picture || ""} alt={displayName} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <p className="text-xs text-muted-foreground">Paste a direct URL to an image. Changes preview instantly.</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </CardFooter>
        </Card>

        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
              <CardDescription>Change your login email. We'll send a verification link to the new address.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="email">New email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={onEmailChangeSubmit as any}>Send verification link</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Set a new password for your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input id="new-password" type={showPw ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPw(v => !v)} aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Input id="confirm-password" type={showPw2 ? "text" : "password"} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPw2(v => !v)} aria-label={showPw2 ? "Hide password" : "Show password"}>{showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={onPasswordChangeSubmit as any}>Update password</Button>
            </CardFooter>
          </Card>
        </div>
      </form>

      <Separator />

      <p className="text-xs text-muted-foreground">
        Tip: If an action fails with a "requires recent login" message, you'll be prompted to quickly re-authenticate here.
      </p>

      <ReauthDialog open={reauthOpen} onClose={() => setReauthOpen(false)} onSuccess={onReauthSuccess} intent={reauthIntent} />
    </div>
  );
}
