import type { ReactNode } from "react";
import AppHeader from "./AppHeader";
import ContactBar from "./ContactBar";
import { useAppState } from "@/hooks/useAppState";
import { Image } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface AppLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export default function AppLayout({ sidebar, main }: AppLayoutProps) {
  const { setMode, lang, theme, toggleTheme } = useAppState();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:h-screen">
        <AppHeader />
        <div className="flex-1 overflow-y-auto p-4">
          {sidebar}
        </div>
        {/* Footer: Simple mode + theme switcher */}
        <div className="shrink-0 border-t border-sidebar-border p-3 flex items-center gap-2">
          <button
            onClick={() => setMode("simple")}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-semibold text-sm py-2.5 transition-all hover:border-primary/50"
          >
            <Image className="h-4 w-4" />
            {lang === "en" ? "Simple Mode" : "მარტივი რეჟიმი"}
          </button>
          {/* Theme dots */}
          <div className="flex items-center gap-1.5 px-2">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => theme !== "dark" && toggleTheme()}
                  className={`h-5 w-5 rounded-full bg-[#F97316] transition-all ${theme === "dark" ? "ring-2 ring-[#F97316]/50 scale-110" : "opacity-40 hover:opacity-70"}`}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Dark Orange</TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => theme !== "green" && toggleTheme()}
                  className={`h-5 w-5 rounded-full bg-[#25B988] transition-all ${theme === "green" ? "ring-2 ring-[#25B988]/50 scale-110" : "opacity-40 hover:opacity-70"}`}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Light Green</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-background lg:h-screen lg:overflow-y-auto flex flex-col">
        <ContactBar />
        <div className="flex-1">
          {main}
        </div>
      </main>
    </div>
  );
}
