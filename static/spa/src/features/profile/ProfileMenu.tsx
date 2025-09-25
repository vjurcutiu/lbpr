import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { logoutFirebase } from "@/features/auth/firebase";
import { postJSON } from "@/shared/api";

export default function ProfileMenu() {
  const { user, clear } = useAuthContext();
  const navigate = useNavigate();
  const email = user?.email || "—";
  const name = user?.name || email.split("@")[0] || "User";
  const pic = user?.picture || "";
  const initials = (name || email || "U").slice(0,1).toUpperCase();

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
        <Button variant="ghost" className="h-9 px-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={pic} alt={name} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate max-w-[14rem]">
          Signed in as {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/billing">Billing</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
