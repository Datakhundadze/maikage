import { useEffect, useState } from "react";
import { Image as ImageIcon, Package, FolderTree } from "lucide-react";
import CatalogDesigns from "./catalog/CatalogDesigns";
import CatalogProducts from "./catalog/CatalogProducts";
import CatalogCategories from "./catalog/CatalogCategories";

export type CatalogSubTab = "designs" | "products" | "categories";

const SUBTABS: { id: CatalogSubTab; label: string; icon: typeof ImageIcon }[] = [
  { id: "designs",    label: "🎨 დიზაინები",    icon: ImageIcon },
  { id: "products",   label: "👕 პროდუქტები",   icon: Package },
  { id: "categories", label: "📂 კატეგორიები",  icon: FolderTree },
];

function readSubTabFromUrl(): CatalogSubTab {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("subtab");
  return v === "products" || v === "categories" ? v : "designs";
}

function writeSubTabToUrl(sub: CatalogSubTab) {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", "catalog");
  params.set("subtab", sub);
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", next);
}

export default function AdminCatalog() {
  const [sub, setSub] = useState<CatalogSubTab>(() => readSubTabFromUrl());

  useEffect(() => {
    writeSubTabToUrl(sub);
  }, [sub]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {SUBTABS.map(({ id, label, icon: Icon }) => {
          const active = sub === id;
          return (
            <button
              key={id}
              onClick={() => setSub(id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-amber-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      {sub === "designs"    && <CatalogDesigns />}
      {sub === "products"   && <CatalogProducts />}
      {sub === "categories" && <CatalogCategories />}
    </div>
  );
}
