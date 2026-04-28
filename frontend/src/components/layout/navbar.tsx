"use client";

import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, User, Menu, Coins } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Settings,
  Sparkles,
  FileText,
  CreditCard,
  Building2,
  Image as ImageIcon,
} from "lucide-react";

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Brand Kit", href: "/brand-kit", icon: Building2 },
  { title: "Generate Post", href: "/generate/social", icon: Sparkles },
  { title: "Generate Poster", href: "/generate/poster", icon: ImageIcon },
  { title: "My Posts", href: "/posts", icon: FileText },
  { title: "Subscription", href: "/subscription", icon: CreditCard },
  { title: "Settings", href: "/settings", icon: Settings },
];

export function Navbar() {
  const { user, logout } = useAuth();
  const { creditsRemaining, planSlug } = useSubscription();
  const pathname = usePathname();

  const formatCredits = (c: number) =>
    c === Infinity || c === -1 ? "Unlimited" : c.toString();

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "U";

  return (
    <header className="flex h-16 items-center justify-between border-b px-4 md:px-6">
      <div className="flex items-center gap-4">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="flex h-16 items-center border-b px-6">
              <span className="text-lg font-bold">AI Marketing</span>
            </div>
            <nav className="flex flex-col gap-1 p-4">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.title}
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
        <h2 className="text-lg font-semibold md:hidden">AI Marketing</h2>
      </div>

      <div className="flex items-center gap-3">
        {/* Credit counter */}
        <div className="hidden sm:flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm">
          <Coins className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-medium">{formatCredits(creditsRemaining)}</span>
          <span className="text-muted-foreground">credits</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground capitalize">{planSlug}</span>
        </div>

        <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-9 w-9 rounded-full">
            <Avatar className="h-9 w-9">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <div className="flex items-center gap-2 p-2">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}
