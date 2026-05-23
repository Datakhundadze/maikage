import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DesignState } from "@/lib/designState";
import { uploadBlobWithRetry, dataUrlToBlob } from "@/lib/uploadWithRetry";

export interface CartItem {
  id: string;
  createdAt: number;
  product: string;
  subProduct: string | null;
  color: string;
  size: string | null;
  isStudio: boolean;
  frontMockupUrl: string | null;
  backMockupUrl: string | null;
  transparentImageUrl: string | null;
  backTransparentImageUrl: string | null;
  prompt: string | null;
  productPrice: number;
  quantity: number;
  /** Structured editor state with upload URLs filled in. Null for legacy
   *  cart items persisted before this field was added. */
  designState: DesignState | null;
}

interface AddItemInput {
  product: string;
  subProduct: string | null;
  color: string;
  size: string | null;
  isStudio: boolean;
  frontMockupDataUrl: string | null;
  backMockupDataUrl: string | null;
  transparentImageDataUrl: string | null;
  backTransparentImageDataUrl: string | null;
  frontOriginalPhotos: string[];
  backOriginalPhotos: string[];
  prompt: string | null;
  productPrice: number;
  /** Initial cart quantity. Defaults to 1 when omitted. Clamped to >= 1
   *  inside addItem so a stray 0 / negative / non-integer never lands
   *  in the cart. */
  quantity?: number;
  designState: DesignState | null;
}

interface CartContextType {
  items: CartItem[];
  addItem: (data: AddItemInput) => Promise<void>;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  clearCart: () => void;
  itemCount: number;
  totalPrice: number;
  adding: boolean;
}

const CartContext = createContext<CartContextType | null>(null);

const STORAGE_KEY = "maika-cart-v1";

// Required uploads (mockup, transparent print file): throw on persistent
// failure so the cart-add can surface a toast instead of silently
// adding a broken cart item.
async function uploadDataUrl(dataUrl: string, path: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const { publicUrl } = await uploadBlobWithRetry("designs", path, blob);
  return publicUrl;
}

// Best-effort uploads (original full-resolution photos). The cart still
// goes through if these fail since the admin can recover from the
// rendered mockup. Returns null on failure so the caller can record it
// in design_state.
async function uploadOriginalDataUrl(dataUrl: string, path: string): Promise<string | null> {
  try {
    return await uploadDataUrl(dataUrl, path);
  } catch (e) {
    console.error(`[useCart] best-effort original upload ${path} failed:`, e);
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<CartItem>[];
      // Items persisted before designState was added: default it to null
      // so consumers don't have to guard against `undefined`.
      return parsed.map((i) => ({ ...i, designState: i.designState ?? null } as CartItem));
    } catch {
      return [];
    }
  });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error("[useCart] persist failed:", e);
    }
  }, [items]);

  const addItem = useCallback(async (data: AddItemInput) => {
    setAdding(true);
    try {
      const cartItemId = crypto.randomUUID();
      const prefix = `cart-items/${cartItemId}`;

      const [frontUrl, backUrl, transparentUrl, backTransparentUrl] = await Promise.all([
        data.frontMockupDataUrl
          ? uploadDataUrl(data.frontMockupDataUrl, `${prefix}/front-mockup.png`)
          : Promise.resolve(null),
        data.backMockupDataUrl
          ? uploadDataUrl(data.backMockupDataUrl, `${prefix}/back-mockup.png`)
          : Promise.resolve(null),
        data.transparentImageDataUrl
          ? uploadDataUrl(data.transparentImageDataUrl, `${prefix}/front-transparent.png`)
          : Promise.resolve(null),
        data.backTransparentImageDataUrl
          ? uploadDataUrl(data.backTransparentImageDataUrl, `${prefix}/back-transparent.png`)
          : Promise.resolve(null),
      ]);

      const frontOriginalUrls = await Promise.all(
        data.frontOriginalPhotos.map((url, i) =>
          uploadOriginalDataUrl(url, `${prefix}/front-original-${i}.png`),
        ),
      );
      const backOriginalUrls = await Promise.all(
        data.backOriginalPhotos.map((url, i) =>
          uploadOriginalDataUrl(url, `${prefix}/back-original-${i}.png`),
        ),
      );

      // Merge upload URLs into design_state so the order-row insert at
      // checkout has the photo URLs already filled in.
      const finalDesignState: DesignState | null = data.designState
        ? {
            ...data.designState,
            front: data.designState.front
              ? { ...data.designState.front, photos: data.designState.front.photos.map((p, i) => ({ ...p, url: frontOriginalUrls[i] ?? null })) }
              : null,
            back: data.designState.back
              ? { ...data.designState.back, photos: data.designState.back.photos.map((p, i) => ({ ...p, url: backOriginalUrls[i] ?? null })) }
              : null,
          }
        : null;

      const item: CartItem = {
        id: cartItemId,
        createdAt: Date.now(),
        product: data.product,
        subProduct: data.subProduct,
        color: data.color,
        size: data.size,
        isStudio: data.isStudio,
        frontMockupUrl: frontUrl,
        backMockupUrl: backUrl,
        transparentImageUrl: transparentUrl,
        backTransparentImageUrl: backTransparentUrl,
        prompt: data.prompt,
        productPrice: data.productPrice,
        quantity: Math.max(1, Math.floor(data.quantity ?? 1)),
        designState: finalDesignState,
      };

      setItems((prev) => [...prev, item]);
    } finally {
      setAdding(false);
    }
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, qty: number) => {
    if (qty < 1) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: qty } : i)));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.productPrice * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQuantity, clearCart, itemCount, totalPrice, adding }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
