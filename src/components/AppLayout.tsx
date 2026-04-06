import type { ReactNode } from "react";
import AppHeader from "./AppHeader";
import ContactBar from "./ContactBar";
import { useAppState } from "@/hooks/useAppState";
import { Image } from "lucide-react";

interface AppLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export default function AppLayout({ sidebar, main }: AppLayoutProps) {
  const { setMode, lang } = useAppState();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:h-screen">
        <AppHeader />
        <div className="flex-1 overflow-y-auto p-4">
          {sidebar}
        </div>
        {/* Simple Mode footer button */}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <button
            onClick={() => setMode("simple")}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-semibold text-sm py-2.5 transition-all hover:border-primary/50"
          >
            <Image className="h-4 w-4" />
            {lang === "en" ? "Switch to Simple Mode" : "მარტივ რეჟიმზე გადასვლა"}
          </button>
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
