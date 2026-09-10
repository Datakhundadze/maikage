import { useEffect, useRef, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Lang } from "@/lib/i18n";

export interface MobileNavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Kicks off the route chunk fetch — same hover/touch preload the
   *  desktop tabs use, so a tap in the sheet lands as fast as a tab. */
  preload?: () => Promise<unknown>;
}

interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: MobileNavItem[];
  lang: Lang;
  /** The hamburger that opened the sheet. Focus goes back to it on close
   *  — Radix only does that by itself for its own Trigger, and this sheet
   *  is opened by a plain controlled button. */
  returnFocusTo: RefObject<HTMLElement>;
}

// The phone-width navigation: a slide-in sheet listing every destination
// the desktop tab row has, with its label. Built on the shared Sheet
// (Radix Dialog) so it gets the overlay, focus trap, Escape-to-close and
// the close button for free, and it is portaled to <body>, so it never
// takes part in the header's or the page's layout.
//
// Loaded lazily by AppHeader on first open, the same way LoginModal is,
// so the header on every page stays as cheap as it was.
export default function MobileNav({ open, onOpenChange, items, lang, returnFocusTo }: MobileNavProps) {
  const location = useLocation();

  // Close on navigation. The link's own onClick already does this for
  // taps inside the sheet; this also covers a route change from anywhere
  // else (back button, a programmatic navigate) while the sheet is open.
  // Compared against the previous pathname rather than run on every
  // effect pass: this component mounts on the first open, and closing on
  // mount would shut the sheet the moment it appears.
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    onOpenChange(false);
  }, [location.pathname, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo.current?.focus();
        }}
        className="w-[min(85vw,20rem)] bg-sidebar text-sidebar-foreground border-sidebar-border p-0 flex flex-col"
      >
        <SheetHeader className="px-4 pt-4 pb-2 text-left">
          <SheetTitle className="text-sm font-bold text-sidebar-foreground">
            {lang === "en" ? "Menu" : "მენიუ"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {lang === "en" ? "Site navigation" : "საიტის ნავიგაცია"}
          </SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-2 pb-4" aria-label={lang === "en" ? "Main" : "მთავარი"}>
          {items.map(({ path, label, icon: Icon, preload }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => onOpenChange(false)}
                onMouseEnter={preload}
                onFocus={preload}
                onTouchStart={preload}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
