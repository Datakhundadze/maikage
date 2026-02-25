import AppLayout from "@/components/AppLayout";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";

function SidebarContent() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-card p-4">
        <h2 className="text-lg font-semibold text-card-foreground">Product Configuration</h2>
        <p className="text-sm text-muted-foreground mt-1">Coming in Phase 2</p>
      </div>
      <div className="rounded-xl border border-sidebar-border bg-card p-4">
        <h2 className="text-lg font-semibold text-card-foreground">Design Studio</h2>
        <p className="text-sm text-muted-foreground mt-1">Coming in Phase 3</p>
      </div>
    </div>
  );
}

function MainContent() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-4xl font-black text-primary-foreground">
            M
          </div>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">maika.ge Studio</h1>
        <p className="text-muted-foreground">
          Select a product and describe your design to get started.
        </p>
      </div>
    </div>
  );
}

export default function StudioPage() {
  return <AppLayout sidebar={<SidebarContent />} main={<MainContent />} />;
}
