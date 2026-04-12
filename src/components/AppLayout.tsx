import { type ReactNode, useState } from "react";
import AppHeader from "./AppHeader";
import ContactBar from "./ContactBar";
import { useAppState } from "@/hooks/useAppState";
import { Image, Settings, Eye } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface AppLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export default function AppLayout({ sidebar, main }: AppLayoutProps) {
  const { setMode, lang, theme, toggleTheme } = useAppState();
  const [mobileTab, setMobileTab] = useState<"config" | "preview">("config");

  return (
    <div className="flex flex-col h-screen">
      {/* Full-width top navigation */}
      <AppHeader />
      <ContactBar />

      {/* Mobile tab switcher */}
      <div className="lg:hidden flex border-b border-border bg-sidebar shrink-0">
        <button
          onClick={() => setMobileTab("config")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors ${mobileTab === "config" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
        >
          <Settings className="h-3.5 w-3.5" />
          {lang === "en" ? "Config" : "კონფიგურაცია"}
        </button>
        <button
          onClick={() => setMobileTab("preview")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors ${mobileTab === "preview" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
        >
          <Eye className="h-3.5 w-3.5" />
          {lang === "en" ? "Preview" : "გადახედვა"}
        </button>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className={`w-full lg:w-[450px] lg:min-w-[450px] shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:overflow-hidden ${mobileTab === "config" ? "flex" : "hidden lg:flex"}`}>
          <div className="flex-1 overflow-y-auto p-4">
            {sidebar}
          </div>
          {/* Footer: Simple mode + theme switcher */}
          <div className="shrink-0 border-t border-sidebar-border p-3 flex items-center gap-2">
            <button
              onClick={() => setMode("simple")}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sidebar-accent border border-sidebar-border hover:opacity-90 text-sidebar-foreground font-semibold text-sm py-2.5 transition-all"
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
                    className={`h-5 w-5 rounded-full bg-black border transition-all ${theme === "dark" ? "border-white/50 ring-2 ring-white/30 scale-110" : "border-white/20 opacity-50 hover:opacity-80"}`}
                    title="Dark"
                  />
                </TooltipTrigger>
                <TooltipContent side="top">Dark</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => theme !== "green" && toggleTheme()}
                    className={`h-5 w-5 rounded-full bg-[#25B988] transition-all ${theme === "green" ? "ring-2 ring-[#25B988]/60 scale-110" : "opacity-50 hover:opacity-80"}`}
                    title="Green"
                  />
                </TooltipTrigger>
                <TooltipContent side="top">Green</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className={`flex-1 bg-background overflow-y-auto ${mobileTab === "preview" ? "flex" : "hidden lg:flex"} flex-col`}>
          {main}
        </main>
      </div>
    </div>
  );
}
