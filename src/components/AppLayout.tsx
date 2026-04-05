import type { ReactNode } from "react";
import AppHeader from "./AppHeader";
import ContactBar from "./ContactBar";

interface AppLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export default function AppLayout({ sidebar, main }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:h-screen lg:overflow-y-auto">
        <ContactBar />
        <AppHeader />
        <div className="flex-1 overflow-y-auto p-4">
          {sidebar}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-background lg:h-screen lg:overflow-y-auto">
        {main}
      </main>
    </div>
  );
}
