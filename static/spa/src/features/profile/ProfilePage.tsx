import { useEffect, useState, FormEvent } from "react";
import { getJSON, postJSON } from "@/shared/api";
import { useAuthContext } from "@/features/auth/AuthProvider";
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
  const { user, refresh } = useAuthContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getJSON<Profile>("/me");
        setProfile(data);
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
    setSaving(true);
    setErr(null);
    try {
      const updated = await fetch("/api/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profile.name ?? null, picture: profile.picture ?? null }),
      }).then(r => r.json());
      setProfile(updated);
      await refresh(); // refresh header/user menu
    } catch (e: any) {
      setErr(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!profile) return null;

  const initials = (profile.name || profile.email || "U").slice(0,1).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Your Profile</h1>

      <form className="space-y-6" onSubmit={onSubmit}>
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={profile.picture || ""} alt={profile.name || ""} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm text-muted-foreground">UID</div>
            <div className="font-mono text-sm break-all">{profile.uid}</div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Email</label>
          <Input value={profile.email || ""} disabled />
          <p className="text-xs text-muted-foreground mt-1">Email is managed by your identity provider.</p>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Display name</label>
          <Input
            value={profile.name || ""}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Photo URL</label>
          <Input
            value={profile.picture || ""}
            onChange={(e) => setProfile({ ...profile, picture: e.target.value })}
            placeholder="https://…"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
