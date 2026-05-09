import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/hooks/useCart";
import AppHeader from "@/components/AppHeader";
import ProductPreview from "@/components/ProductPreview";
import OrderDialog from "@/components/OrderDialog";
import { Button } from "@/components/ui/button";
import {
  catalog,
  BRAND_COLORS,
  BRAND_SIZES,
  COLORS,
  type PlacementCoords,
  type ProductType,
  type ProductColor,
} from "@/lib/catalog";
import { calculatePrice } from "@/lib/pricing";
import { CATEGORIES } from "@/lib/categories";
import { compositeDesignOnProduct, CATALOG_PRINT_SCALE } from "@/lib/catalogCompositing";
import { ArrowLeft, ShoppingBag, ShoppingCart, ImageOff } from "lucide-react";

interface CatalogDesignRow {
  id: string;
  slug: string;
  title_ka: string;
  print_file_url: string;
  thumbnail_url: string | null;
  category: string | null;
  default_product_id: string | null;
  default_color: string | null;
}

interface ProductColorOption {
  name: string;
  hex: string;
}

interface ProductRow {
  id: string;
  type: string;
  sub_product: string | null;
  display_name_ka: string;
  base_price: number | null;
  colors: ProductColorOption[];
  sizes: string[];
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.label_ka]),
);

export default function DesignDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { addItem: addToCart, adding: addingToCart } = useCart();

  const [design, setDesign] = useState<CatalogDesignRow | null>(null);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [selectedColor, setSelectedColor] = useState<string>("White");
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [sizeError, setSizeError] = useState(false);

  const [composing, setComposing] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [orderMockup, setOrderMockup] = useState<string | null>(null);

  // Fetch design + product on slug change
  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    (async () => {
      const { data: rows } = await (supabase as any)
        .from("catalog_designs")
        .select("id, slug, title_ka, print_file_url, thumbnail_url, category, default_product_id, default_color")
        .eq("slug", slug)
        .eq("is_published", true)
        .limit(1);
      if (cancelled) return;

      const row: CatalogDesignRow | undefined = rows?.[0];
      if (!row) { setNotFound(true); setLoading(false); return; }
      setDesign(row);

      if (!row.default_product_id) { setLoading(false); return; }

      const { data: prodRows } = await (supabase as any)
        .from("products")
        .select("id, type, sub_product, display_name_ka, base_price, colors, sizes")
        .eq("id", row.default_product_id)
        .limit(1);
      if (cancelled) return;

      const prod: ProductRow | undefined = prodRows?.[0];
      if (prod) {
        setProduct(prod);
        // Default selections — prefer catalog's BRAND_COLORS (SSOT), fall back
        // to admin-curated products.colors, then "White".
        const sub = prod.sub_product || prod.type;
        const brandColors = BRAND_COLORS[sub] ?? [];
        const availableNames = brandColors.length > 0
          ? brandColors
          : (prod.colors ?? []).map((c) => c.name as ProductColor);
        const colorChoice =
          (row.default_color && availableNames.find((n) => n === row.default_color)) ||
          availableNames[0] ||
          "White";
        setSelectedColor(colorChoice);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [slug]);

  // Resolved catalog metadata for the current product+color (always front view)
  const imageResult = useMemo(() => {
    if (!product) return null;
    return catalog.findImageForColor(
      product.type as ProductType,
      product.sub_product || product.type,
      selectedColor as ProductColor,
      "front",
    );
  }, [product, selectedColor]);

  // Scale up the print on the live preview to match the off-screen mockup
  // produced by compositeDesignOnProduct (both apply CATALOG_PRINT_SCALE).
  const placementCoords: PlacementCoords = useMemo(() => {
    const zone = imageResult?.entry.placementZone ?? { x: 0.5, y: 0.42, scale: 0.35 };
    return {
      ...zone,
      scale: (zone.scale ?? 1) * CATALOG_PRINT_SCALE,
      scaleY: zone.scaleY != null ? zone.scaleY * CATALOG_PRINT_SCALE : undefined,
    };
  }, [imageResult]);

  const colorOptions = useMemo(() => {
    if (!product) return [] as { name: string; hex: string }[];
    const sub = product.sub_product || product.type;
    const brandColorNames = BRAND_COLORS[sub] ?? [];
    if (brandColorNames.length > 0) {
      return brandColorNames.map((name) => {
        const entry = COLORS.find((c) => c.name === name);
        return { name: name as string, hex: entry?.hex ?? "#FFFFFF" };
      });
    }
    return product.colors ?? [];
  }, [product]);

  const sizeOptions: string[] = useMemo(() => {
    if (!product) return [];
    if (product.sizes && product.sizes.length > 0) return product.sizes;
    const sub = product.sub_product || product.type;
    return BRAND_SIZES[sub] ?? [];
  }, [product]);

  const needsSize = useMemo(() => {
    if (!product) return false;
    return sizeOptions.length > 0 || product.type === "Phone Case";
  }, [product, sizeOptions]);

  const priceBreakdown = useMemo(() => {
    if (!product) return null;
    return calculatePrice(
      product.type as ProductType,
      product.sub_product || product.type,
      true,
      false,
      false,
    );
  }, [product]);

  const buildMockup = async () => {
    if (!design || !product) return null;
    return compositeDesignOnProduct({
      printFileUrl: design.print_file_url,
      productName: product.type,
      subProduct: product.sub_product || product.type,
      color: selectedColor,
      view: "front",
    });
  };

  const validateSize = () => {
    if (needsSize && !selectedSize) {
      setSizeError(true);
      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    setSizeError(false);
    return true;
  };

  const handleOrderClick = async () => {
    if (!validateSize() || !design || !product || !priceBreakdown) return;
    setComposing(true);
    const mockup = await buildMockup();
    setComposing(false);
    if (!mockup) {
      toast({ title: "preview ვერ აიგო", description: "სცადე სხვა ფერი/პროდუქტი", variant: "destructive" });
      return;
    }
    setOrderMockup(mockup);
    setOrderDialogOpen(true);
  };

  const handleAddToCartClick = async () => {
    if (!validateSize() || !design || !product || !priceBreakdown) return;
    setComposing(true);
    const mockup = await buildMockup();
    setComposing(false);
    if (!mockup) {
      toast({ title: "preview ვერ აიგო", description: "სცადე სხვა ფერი/პროდუქტი", variant: "destructive" });
      return;
    }
    try {
      await addToCart({
        product: product.type,
        subProduct: product.sub_product || product.type,
        color: selectedColor,
        size: selectedSize || null,
        isStudio: false,
        frontMockupDataUrl: mockup,
        backMockupDataUrl: null,
        transparentImageDataUrl: design.print_file_url,
        backTransparentImageDataUrl: null,
        frontOriginalPhotos: [],
        backOriginalPhotos: [],
        prompt: design.title_ka,
        productPrice: priceBreakdown.total,
      });
      toast({ title: "კალათაში დაემატა ✓" });
    } catch (e: any) {
      toast({ title: "შეცდომა", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const categoryLabel = design?.category ? CATEGORY_LABEL[design.category] ?? design.category : null;

  // ── States ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (notFound || !design) {
    return (
      <div className="flex flex-col h-screen">
        <AppHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <ImageOff className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">დიზაინი ვერ მოიძებნა</p>
          <Button variant="outline" onClick={() => navigate("/designs")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> კატალოგში დაბრუნება
          </Button>
        </div>
      </div>
    );
  }

  if (!product || !priceBreakdown) {
    return (
      <div className="flex flex-col h-screen">
        <AppHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <p className="text-sm text-muted-foreground">ამ დიზაინს არ აქვს კონფიგურირებული პროდუქტი</p>
          <Button variant="outline" onClick={() => navigate("/designs")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> კატალოგში დაბრუნება
          </Button>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen">
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
          <button
            onClick={() => navigate("/designs")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> კატალოგი
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Live preview — neutralise the dashed borders rendered by
                ProductPreview's zone outline AND DraggablePlacement's
                wrapper (both visual editor affordances we don't want here).
                Earlier we used [&_.border-dashed]:hidden but that also
                display:none'd the DraggablePlacement wrapper, which contains
                the design <img> — so the design vanished. Override only the
                border colour instead so the elements stay laid out, the
                design renders, and no dashes are visible. */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden [&_.border-dashed]:!border-transparent">
              <ProductPreview
                productName={product.type}
                subProduct={product.sub_product || product.type}
                colorName={selectedColor}
                view="front"
                placementCoords={placementCoords}
                designImage={design.print_file_url}
                disabled
              />
            </div>

            {/* Config panel */}
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-bold text-foreground">{design.title_ka}</h1>
                <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{product.display_name_ka}</span>
                  {categoryLabel && (
                    <>
                      <span>·</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{categoryLabel}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Color */}
              {colorOptions.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">ფერი</h3>
                  <div className="flex flex-wrap gap-2">
                    {colorOptions.map((c) => {
                      const active = selectedColor === c.name;
                      return (
                        <button
                          key={c.name}
                          onClick={() => setSelectedColor(c.name)}
                          title={c.name}
                          className={`h-9 w-9 rounded-full border-2 transition-all ${
                            active ? "border-primary scale-110 shadow-sm" : "border-border hover:border-muted-foreground"
                          }`}
                          style={{ backgroundColor: c.hex }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Size */}
              {sizeOptions.length > 0 && (
                <div id="size-selector">
                  <h3 className="text-sm font-semibold mb-2">ზომა {needsSize && <span className="text-destructive">*</span>}</h3>
                  <select
                    value={selectedSize}
                    onChange={(e) => { setSelectedSize(e.target.value); setSizeError(false); }}
                    className={`w-full h-10 rounded-md border bg-background px-3 py-2 text-sm ${
                      sizeError ? "border-destructive" : "border-input"
                    }`}
                  >
                    <option value="">აირჩიე ზომა</option>
                    {sizeOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {sizeError && <p className="mt-1 text-xs text-destructive">აირჩიე ზომა</p>}
                </div>
              )}

              {/* Price */}
              <div className="rounded-xl border border-border bg-card p-4 flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">ფასი</span>
                <span className="text-xl font-bold">₾{priceBreakdown.total}</span>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button onClick={handleOrderClick} disabled={composing} className="w-full h-11 gap-2 font-semibold">
                  <ShoppingBag className="h-4 w-4" />
                  {composing ? "მზადდება..." : "შეუკვეთე"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAddToCartClick}
                  disabled={composing || addingToCart}
                  className="w-full h-11 gap-2 font-semibold"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {addingToCart ? "ემატება..." : "კალათაში დამატება"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <OrderDialog
        breakdown={priceBreakdown}
        product={product.type}
        subProduct={product.sub_product || product.type}
        color={selectedColor}
        isStudio={false}
        externalOpen={orderDialogOpen}
        onExternalOpenChange={setOrderDialogOpen}
        frontMockupDataUrl={orderMockup}
        backMockupDataUrl={null}
        transparentImageDataUrl={design.print_file_url}
        backTransparentImageDataUrl={null}
        prompt={design.title_ka}
        size={selectedSize || undefined}
      >
        {/* Suppress OrderDialog's default DialogTrigger button — we drive
            opening via externalOpen, our own "შეუკვეთე" button is the trigger. */}
        <span className="hidden" />
      </OrderDialog>
    </div>
  );
}
