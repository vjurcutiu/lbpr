import { useEffect, useMemo, useState, FormEvent } from "react";
import { getJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { auth } from "@/features/auth/firebase";
import { startEmailChangeVerification, changePassword } from "@/features/auth/firebase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, EyeOff, Copy, AlertTriangle, CheckCircle2 } from "lucide-react";

type Profile = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

export default function ProfilePage() {
  const { refresh } = useAuthContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<{ email?: string; name?: string; password?: string; confirm?: string; picture?: string }>({
    email: "",
    name: "",
    password: "",
    confirm: "",
    picture: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [copied, setCopied] = useState(false);

  // derived
  const displayName = useMemo(
    () => form.name || (form.email ? form.email.split("@")[0] : ""),
    [form.name, form.email]
  );
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    if (form.password && form.password !== form.confirm) {
      setErr("Passwords do not match.");
      return;
    }
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in.");

      // 1) Email change → send verification to new email. Firebase applies the change after verify.
      if (form.email && form.email !== profile.email) {
        await startEmailChangeVerification(user, form.email);
        setOk("Verification email sent to your new address. Finish verification to complete the change.");
      }

      // 2) Password change (may require recent login)
      if (form.password) {
        await changePassword(user, form.password);
        setOk("Password updated.");
      }

      // 3) Save display name / picture to backend profile if your /me endpoint supports it.
      const resp = await fetch("/api/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // do NOT update email here; Firebase will update it after verification
          name: form.name,
          picture: form.picture,
        }),
      });
      if (!resp.ok) {
        const t = await resp.json().catch(() => ({}));
        throw new Error(t?.detail || `Save failed (${resp.status}).`);
      }
      const updated: Profile = await resp.json();
      setProfile(updated);
      setForm((f) => ({ ...f, password: "", confirm: "" }));
      await refresh(); // refresh header/user menu
      if (!ok) setOk("Saved!");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("recent")) {
        setErr("Please sign in again, then retry this change (requires recent login).");
      } else {
        setErr(msg || "Failed to save.");
      }
    } finally {
      setSaving(false);
      setTimeout(() => setOk(null), 3500);
    }
  }

  function onReset() {
    if (!profile) return;
    setForm({
      email: profile.email || "",
      name: profile.name || (profile.email ? profile.email.split("@")[0] : ""),
      picture: profile.picture || "",
      password: "",
      confirm: "",
    });
    setErr(null);
    setOk(null);
  }

  async function copyUid() {
    if (!profile?.uid) return;
    try {
      await navigator.clipboard.writeText(profile.uid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
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

  if (!profile && err) {
    return <div className="p-6 text-red-600">{err}</div>;
  }
  if (!profile) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Your Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your account, profile details, and security preferences.
          </p>
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

      {/* Header card */}
      <Card className="rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-5">
            <Avatar className="h-16 w-16 ring-2 ring-offset-2 ring-muted-foreground/10">
              <AvatarImage src={form.picture || ""} alt={displayName} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-lg font-medium truncate">{displayName || "Unnamed user"}</div>
              <div className="text-sm text-muted-foreground truncate">{form.email || "—"}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">UID:</span>
                <code className="text-xs px-2 py-1 rounded bg-muted break-all">{profile.uid}</code>
                <Button type="button" size="icon" variant="ghost" onClick={copyUid} className="h-7 w-7" title="Copy UID">
                  <Copy className="h-4 w-4" />
                </Button>
                {copied && <span className="text-xs text-muted-foreground">Copied</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={onSubmit} className="grid md:grid-cols-5 gap-6">
        {/* Account card */}
        <Card className="md:col-span-3 rounded-2xl overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle>Account</CardTitle>
            <CardDescription>Update your email, display name, and profile photo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="email" className="sm:col-span-1">Email</Label>
              <div className="sm:col-span-3">
                <Input
                  id="email"
                  value={form.email || ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Changing your email sends a verification link to the new address.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="name" className="sm:col-span-1">Display name</Label>
              <div className="sm:col-span-3">
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="picture" className="sm:col-span-1">Photo URL</Label>
              <div className="sm:col-span-3 space-y-3">
                <Input
                  id="picture"
                  value={form.picture || ""}
                  onChange={(e) => setForm({ ...form, picture: e.target.value })}
                  placeholder="https://…"
                  disabled={saving}
                />
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={form.picture || ""} alt={displayName} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <p className="text-xs text-muted-foreground">
                    Paste a direct URL to an image. Changes preview instantly.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onReset} disabled={saving}>
              Reset
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        </Card>

        {/* Security card */}
        <Card className="md:col-span-2 rounded-2xl overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle>Security</CardTitle>
            <CardDescription>Change your password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={form.password || ""}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  disabled={saving}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPw((v) => !v)}
                  title={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showPw2 ? "text" : "password"}
                  value={form.confirm || ""}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  placeholder="••••••••"
                  disabled={saving}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPw2((v) => !v)}
                  title={showPw2 ? "Hide password" : "Show password"}
                >
                  {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use at least 8 characters. You may need to sign in again after changing your password.
              </p>
            </div>
          </CardContent>
        </Card>
      </form>

      <Separator />

      <p className="text-xs text-muted-foreground">
        Tip: If email change fails with a "requires recent login" message, sign out and back in, then try again.
      </p>
    </div>
  );
}
