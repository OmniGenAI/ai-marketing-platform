"use client";

import Image from "next/image";
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
  Film,
  Search,
  BookOpen,
  Recycle,
  Image as ImageIcon,
  BarChart3,
  CalendarDays,
} from "lucide-react";

const navItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Brand Kit",
    href: "/brand-kit",
    icon: Building2,
  },
  {
    title: "Generate Post",
    href: "/generate/social",
    icon: Sparkles,
  },
  {
    title: "Generate Poster",
    href: "/generate/poster",
    icon: ImageIcon,
  },
  {
    title: "Create Reel",
    href: "/generate/reel",
    icon: Film,
  },
  {
    title: "Repurpose",
    href: "/generate/repurpose",
    icon: Recycle,
  },
  {
    title: "SEO",
    href: "/seo",
    icon: Search,
  },
  {
    title: "Blog",
    href: "/blog",
    icon: BookOpen,
  },
  {
    title: "My Posts",
    href: "/posts",
    icon: FileText,
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
  },
  {
    title: "Analytics",
    href: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Subscription",
    href: "/subscription",
    icon: CreditCard,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-card md:block">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold">
          <Image
            src="/omni_logo.png"
            alt="AI Marketing logo"
            width={28}
            height={28}
            priority
          />
          <span>AI Marketing</span>
        </Link>
      </div>
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const isRepurpose = item.href === "/generate/repurpose";
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
    </aside>
  );
}
