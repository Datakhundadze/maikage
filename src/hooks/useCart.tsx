import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

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

async function uploadDataUrl(
  dataUrl: string,
  path: string,
): Promise<string | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const { error } = await supabase.storage
      .from("designs")
      .upload(path, blob, { contentType: blob.type || "image/png", upsert: true });
    if (error) {
      console.error(`[useCart] upload ${path} failed:`, error);
      return null;
    }
    const { data } = supabase.storage.from("designs").getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error(`[useCart] upload ${path} error:`, e);
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
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

      await Promise.all(
        data.frontOriginalPhotos.map((url, i) =>
          uploadDataUrl(url, `${prefix}/front-original-${i}.png`),
        ),
      );
      await Promise.all(
        data.backOriginalPhotos.map((url, i) =>
          uploadDataUrl(url, `${prefix}/back-original-${i}.png`),
        ),
      );

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
        quantity: 1,
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
