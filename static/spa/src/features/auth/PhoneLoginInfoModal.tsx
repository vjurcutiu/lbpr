// src/features/auth/PhoneLoginInfoModal.tsx
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber?: string | null;
  /** If true, hides the "Go to profile" action (useful if you're already on /profile). */
  hideProfileCta?: boolean;
};

function maskPhone(phone?: string | null) {
  if (!phone) return "";
  const p = phone.trim();
  if (p.length <= 6) return p;
  // Keep country code (+xx) and last 2-3 digits visible.
  const last = p.slice(-3);
  const prefix = p.startsWith("+") ? p.slice(0, Math.min(3, p.length - 3)) : p.slice(0, 2);
  return `${prefix}•••${last}`;
}

export default function PhoneLoginInfoModal({ open, onOpenChange, phoneNumber, hideProfileCta }: Props) {
  const masked = maskPhone(phoneNumber);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Sign in with your phone number</DialogTitle>
          <DialogDescription>
            Your account is set up for phone sign‑in. Next time you can log in by entering your phone number{masked ? (
              <span className="font-medium"> ({masked})</span>
            ) : null} on the login screen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-xl border bg-muted/30 p-3">
            <div className="font-medium">Want more sign-in options?</div>
            <div className="text-muted-foreground mt-1">
              You can add Google or email & password in <span className="font-medium">Profile → Sign‑in methods</span>.
              This makes it easier to switch devices and recover your account.
            </div>
          </div>

          <div className="text-muted-foreground">
            Tip: bookmark the login page and choose <span className="font-medium">Continue with phone</span> anytime.
          </div>
        </div>

        <DialogFooter>
          {!hideProfileCta ? (
            <Button asChild variant="secondary" autoFocus>
              <Link to="/profile" onClick={() => onOpenChange(false)}>
                Go to profile
              </Link>
            </Button>
          ) : null}

          <Button autoFocus onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
