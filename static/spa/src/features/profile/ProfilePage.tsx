import { useEffect, useState, FormEvent } from "react";
import { getJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { auth } from "@/features/auth/firebase";
import { startEmailChangeVerification, changePassword } from "@/features/auth/firebase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Profile = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

export default function ProfilePage() {
  const { refresh } = useAuthContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<{ email?: string; name?: string; password?: string; confirm?: string; picture?: string }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getJSON<Profile>("/me");
        setProfile(data);
        setForm({
          email: data.email || "",
          name: data.name || (data.email ? data.email.split("@")[0] : ""),
          picture: data.picture || "",
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
      setForm(f => ({ ...f, password: "", confirm: "" }));
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
      setTimeout(() => setOk(null), 3000);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err && !profile) return <div className="p-6 text-red-600">{err}</div>;
  if (!profile) return null;

  const displayName = form.name || (form.email ? form.email.split("@")[0] : "");
  const initials = (displayName || form.email || "U").slice(0,1).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Your Profile</h1>

      <form className="space-y-6" onSubmit={onSubmit}>
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={form.picture || ""} alt={displayName} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm text-muted-foreground">UID</div>
            <div className="font-mono text-sm break-all">{profile.uid}</div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Email</label>
          <Input
            value={form.email || ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Changing your email will send a verification link to the new address. The change completes after verification.
          </p>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Display name</label>
          <Input
            value={displayName}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Your name (defaults to your email username)"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Photo URL</label>
          <Input
            value={form.picture || ""}
            onChange={(e) => setForm({ ...form, picture: e.target.value })}
            placeholder="https://…"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">New password</label>
          <Input
            type="password"
            value={form.password || ""}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Confirm new password</label>
          <Input
            type="password"
            value={form.confirm || ""}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            placeholder="••••••••"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {ok && <span className="text-sm text-green-700">{ok}</span>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </form>
    </div>
  );
}
