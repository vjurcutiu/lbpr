import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, CreditCard, LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { logoutFirebase } from "@/features/auth/firebase";
import { cn } from "@/lib/utils";
import { postJSON } from "@/shared/api";

function emailNamePart(email: string) {
  const localPart = email.split("@")[0]?.trim();
  return localPart || "";
}

function ProfileAvatar({ picture, name, size }: { picture?: string; name: string; size: "sm" | "md" }) {
  const isSmall = size === "sm";

  return (
    <Avatar className={cn(isSmall ? "size-6" : "size-9", "border border-border/80 shadow-sm")}>
      {picture ? <AvatarImage src={picture} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          "bg-primary/10 text-primary",
          isSmall ? "text-[11px]" : "text-sm"
        )}
      >
        <UserRound className={isSmall ? "size-3.5" : "size-5"} aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  );
}

export default function ProfileMenu() {
  const { user, clear } = useAuthContext();
  const navigate = useNavigate();
  const email = user?.email?.trim() || "";
  const phoneNumber = user?.phoneNumber?.trim() || "";
  const name = user?.name?.trim() || emailNamePart(email) || phoneNumber || "User";
  const contact = email || phoneNumber || "Signed in";
  const pic = user?.picture?.trim() || "";

  async function signOut() {
    try {
      await postJSON("/auth/logout", {});
    } catch {}
    try {
      await logoutFirebase();
    } catch {}
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-8 rounded-full px-1.5 pr-2 text-foreground hover:bg-primary/10",
            "focus-visible:ring-2 focus-visible:ring-primary/30"
          )}
          aria-label="Open account menu"
        >
          <ProfileAvatar picture={pic} name={name} size="sm" />
          <span className="hidden max-w-28 truncate text-xs font-medium xl:inline">
            {name}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="w-64 rounded-2xl p-2 shadow-xl shadow-primary/5">
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex items-center gap-3">
            <ProfileAvatar picture={pic} name={name} size="md" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{name}</div>
              <div className="truncate text-xs font-normal text-muted-foreground">{contact}</div>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="rounded-xl px-2.5 py-2">
          <Link to="/profile">
            <UserRound className="size-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-xl px-2.5 py-2">
          <Link to="/billing">
            <CreditCard className="size-4" />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="rounded-xl px-2.5 py-2">
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
