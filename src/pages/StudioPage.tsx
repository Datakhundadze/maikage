import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getGuestSessionId } from "@/lib/guestSession";
import AppLayout from "@/components/AppLayout";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview from "@/components/ProductPreview";
import DesignStudioPanel from "@/components/DesignStudioPanel";
import GenerationLoader from "@/components/GenerationLoader";
import ResultView from "@/components/ResultView";
import Lightbox from "@/components/Lightbox";
import { useProductConfig } from "@/hooks/useProductConfig";
import { DesignProvider, useDesign } from "@/hooks/useDesign";
import { runGenerationPipeline, type GenerationResult } from "@/lib/generation";
import { catalog } from "@/lib/catalog";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { calculatePrice } from "@/lib/pricing";
import PriceDisplay from "@/components/PriceDisplay";
import OrderDialog from "@/components/OrderDialog";
import LoginModal from "@/components/LoginModal";
import { useGenerationLimit } from "@/hooks/useGenerationLimit";

const RESULT_STORAGE_KEY = "maika_last_generation";
const RESULT_TS_KEY = "maika_last_generation_ts";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function StudioContent() {
  const productConfig = useProductConfig();
  const { state, dispatch } = useDesign();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [savedDesignId, setSavedDesignId] = useState<string | null>(null);
  const [isShared, setIsShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalMessage, setLoginModalMessage] = useState<string | undefined>();
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  
  const { user } = useAuth();
  const { checkLimit, recordGeneration } = useGenerationLimit();
  const { toast } = useToast();
  const { saveDesign, togglePublish } = useDesignStorage();
  const { trackEvent } = useAnalytics();

  // Restore last generation from localStorage on mount (only if < 30 min old)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RESULT_STORAGE_KEY);
      const savedTs = localStorage.getItem(RESULT_TS_KEY);
      if (saved && savedTs) {
        const age = Date.now() - Number(savedTs);
        if (age < SESSION_TIMEOUT_MS) {
          const parsed = JSON.parse(saved) as GenerationResult;
          if (parsed.mockupImage && parsed.transparentImage) {
            setResult(parsed);
            dispatch({ type: "SET_STATUS", status: "COMPLETE" });
          }
        } else {
          localStorage.removeItem(RESULT_STORAGE_KEY);
          localStorage.removeItem(RESULT_TS_KEY);
        }
      } else if (saved) {
        localStorage.removeItem(RESULT_STORAGE_KEY);
      }
    } catch {
      // ignore parse errors
    }
  }, [dispatch]);

  // Persist result with timestamp
  useEffect(() => {
    if (result) {
      try {
        localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
        localStorage.setItem(RESULT_TS_KEY, String(Date.now()));
      } catch {}
    }
  }, [result]);

  // 30-minute inactivity → redirect to landing
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setResult(null);
        localStorage.removeItem(RESULT_STORAGE_KEY);
        localStorage.removeItem(RESULT_TS_KEY);
        window.location.href = "/";
      }, SESSION_TIMEOUT_MS);
    };
    const events = ["click", "keydown", "scroll", "mousemove", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  useEffect(() => {
    trackEvent("page_visit", { page: "studio" });
  }, [trackEvent]);

  useEffect(() => {
    trackEvent("product_selected", { product: productConfig.config.product });
  }, [productConfig.config.product, trackEvent]);

  const handleGenerate = useCallback(async () => {
    const limitResult = checkLimit();
    if (!limitResult.allowed) {
      if ('reason' in limitResult && limitResult.reason === "guest_limit") {
        setLoginModalMessage('message' in limitResult ? limitResult.message : undefined);
        setShowLoginModal(true);
      } else if ('message' in limitResult) {
        setLimitMessage(limitResult.message);
      }
      return;
    }
    setLimitMessage(null);

    try {
      recordGeneration();
      dispatch({ type: "SET_STATUS", status: "GENERATING_DESIGN" });
      productConfig.setLocked(true);

      const { config } = productConfig;
      const colorEntry = catalog.findImageForColor(config.product, config.subProduct, config.color as any, config.view);
      const productImageUrl = colorEntry?.entry?.imageUrl ?? null;
      const isExactColor = colorEntry?.isExact ?? false;

      const genResult = await runGenerationPipeline(
        {
          designParams: state.designParams,
          product: config.product,
          color: config.color,
          speed: state.speed,
        },
        config.placementCoords,
        productImageUrl,
        (status) => dispatch({ type: "SET_STATUS", status: status as any }),
        isExactColor,
      );

      setResult(genResult);
      dispatch({ type: "SET_STATUS", status: "COMPLETE" });
      productConfig.setLocked(false);
      trackEvent("design_generated", { product: productConfig.config.product });

      // Save generation record for analytics
      try {
        const isGuest = !user;
        const genId = crypto.randomUUID();

        // Upload images to storage (avoid storing large base64 in DB)
        let mockupPath: string | null = null;
        let transparentPath: string | null = null;

        function base64ToBlob(dataUrl: string): Blob {
          const [header, base64] = dataUrl.split(",");
          const mime = header.match(/:(.*?);/)?.[1] || "image/png";
          const binary = atob(base64);
          const arr = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
          return new Blob([arr], { type: mime });
        }

        const [mockupBlob, transparentBlob] = [
          genResult.mockupImage ? base64ToBlob(genResult.mockupImage) : null,
          genResult.transparentImage ? base64ToBlob(genResult.transparentImage) : null,
        ];

        const uploads = await Promise.all([
          mockupBlob ? supabase.storage.from("designs").upload(`generations/${genId}-mockup.png`, mockupBlob, { contentType: "image/png" }) : Promise.resolve(null),
          transparentBlob ? supabase.storage.from("designs").upload(`generations/${genId}-transparent.png`, transparentBlob, { contentType: "image/png" }) : Promise.resolve(null),
        ]);

        if (uploads[0] && !uploads[0].error) mockupPath = `generations/${genId}-mockup.png`;
        else if (uploads[0]?.error) console.error("[Generation] Mockup upload failed:", uploads[0].error);
        if (uploads[1] && !uploads[1].error) transparentPath = `generations/${genId}-transparent.png`;
        else if (uploads[1]?.error) console.error("[Generation] Transparent upload failed:", uploads[1].error);

        // Use user's typed input as prompt (Gemini's text response is typically empty for image generation)
        const userPrompt = [
          state.designParams.character,
          state.designParams.scene,
          state.designParams.style,
          genResult.prompt,
        ].filter(Boolean).join(" • ") || null;

        const genRecord = {
          user_id: user?.id ?? null,
          session_id: isGuest ? getGuestSessionId() : null,
          is_guest: isGuest,
          product: config.product,
          color: config.color,
          style: state.designParams.style || null,
          prompt: userPrompt,
          mockup_image_path: mockupPath,
          transparent_image_path: transparentPath,
        };

        const { error: insertError } = await supabase
          .from("generations" as any)
          .insert(genRecord);

        if (insertError) {
          console.error("[Generation] Insert error:", insertError);
        }
      } catch (e: any) {
        console.error("[Generation] Failed to save generation record:", e);
      }

      // Auto-save to designs table for "My Designs" (only for logged-in users)
      if (user) {
        try {
          const title = state.designParams.character.slice(0, 60) || "Untitled";
          const designId = await saveDesign({
            title,
            prompt: genResult.prompt,
            product: config.product,
            color: config.color,
            placementX: config.placementCoords.x,
            placementY: config.placementCoords.y,
            placementScale: config.placementCoords.scale,
            transparentImageDataUrl: genResult.transparentImage,
            mockupImageDataUrl: genResult.mockupImage,
          });
          if (designId) setSavedDesignId(designId);
          setIsShared(false);
        } catch (e: any) {
          console.error("[Generation] Auto-save to designs failed:", e);
        }
      }
    } catch (err: any) {
      console.error("Generation failed:", err);
      dispatch({ type: "SET_STATUS", status: "ERROR" });
      dispatch({ type: "SET_ERROR", error: err.message });
      productConfig.setLocked(false);
      toast({
        title: "Generation failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    }
  }, [state.designParams, state.speed, productConfig, dispatch, toast, user, saveDesign, trackEvent, checkLimit, recordGeneration]);

  const handleShareToCommunity = useCallback(async () => {
    if (!savedDesignId) {
      toast({ title: "შესვლა საჭიროა", description: "გაზიარებისთვის გაიარეთ ავტორიზაცია.", variant: "destructive" });
      return;
    }
    setSharing(true);
    const ok = await togglePublish(savedDesignId, false);
    if (ok) setIsShared(true);
    setSharing(false);
  }, [savedDesignId, togglePublish, toast]);

  const handleStartNew = useCallback(() => {
    setResult(null);
    setSavedDesignId(null);
    setIsShared(false);
    localStorage.removeItem(RESULT_STORAGE_KEY);
    localStorage.removeItem(RESULT_TS_KEY);
    dispatch({ type: "SET_STATUS", status: "IDLE" });
    productConfig.setLocked(false);
  }, [dispatch, productConfig]);

  const isProcessing = state.appStatus !== "IDLE" && state.appStatus !== "COMPLETE" && state.appStatus !== "ERROR";

  const mainContent = isProcessing ? (
    <div className="flex h-full items-center justify-center">
      <GenerationLoader status={state.appStatus} />
    </div>
  ) : result ? (
    <ResultView
      result={result}
      onViewImage={setLightboxSrc}
      productName={productConfig.config.product}
      subType={productConfig.config.subProduct}
      colorName={productConfig.config.color}
      onResultUpdate={setResult}
      onOrder={() => setOrderDialogOpen(true)}
      onShareToCommunity={savedDesignId ? handleShareToCommunity : undefined}
      sharing={sharing}
      isShared={isShared}
    />
  ) : (
    <ProductPreview
      productName={productConfig.config.product}
      subProduct={productConfig.config.subProduct}
      colorName={productConfig.config.color}
      view={productConfig.config.view}
      placementCoords={productConfig.config.placementCoords}
      onCoordsChange={productConfig.setPlacementCoords}
      designImage={null}
    />
  );

  const priceBreakdown = calculatePrice(
    productConfig.config.product,
    productConfig.config.subProduct,
    "none",
    true,
  );

  return (
    <>
      <AppLayout
        sidebar={
          <div className="space-y-6">
            <ProductConfigPanel
              config={productConfig.config}
              locked={productConfig.locked}
              onProductChange={productConfig.setProduct}
              onSubProductChange={productConfig.setSubProduct}
              onColorChange={productConfig.setColor}
              onViewChange={productConfig.setView}
              selectedSize={productConfig.config.size}
              onSizeChange={productConfig.setSize}
              excludeProducts={["Sport"]}
            />
            <div className="border-t border-sidebar-border pt-4 space-y-4">
              <PriceDisplay breakdown={priceBreakdown} />
              {result && (
                <OrderDialog
                  breakdown={priceBreakdown}
                  product={productConfig.config.product}
                  subProduct={productConfig.config.subProduct}
                  color={productConfig.config.color}
                  isStudio={true}
                  externalOpen={orderDialogOpen}
                  onExternalOpenChange={setOrderDialogOpen}
                  frontMockupDataUrl={result?.mockupImage || null}
                  transparentImageDataUrl={result?.transparentImage || null}
                   prompt={result?.prompt || null}
                   size={productConfig.config.size}
                />
              )}
              <DesignStudioPanel
                onViewImage={setLightboxSrc}
                onGenerate={handleGenerate}
                hasResult={!!result}
                onStartNew={handleStartNew}
                product={productConfig.config.product}
              />
            </div>
          </div>
        }
        main={mainContent}
      />
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} message={loginModalMessage} />
      {limitMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 backdrop-blur-sm px-5 py-3 text-sm text-foreground shadow-lg flex items-center gap-3">
          <span>{limitMessage}</span>
          <button onClick={() => setLimitMessage(null)} className="text-muted-foreground hover:text-foreground ml-auto">✕</button>
        </div>
      )}
    </>
  );
}

export default function StudioPage() {
  return (
    <DesignProvider>
      <StudioContent />
    </DesignProvider>
  );
}
