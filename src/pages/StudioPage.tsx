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

const RESULT_STORAGE_KEY = "maika_last_generation";

function StudioContent() {
  const productConfig = useProductConfig();
  const { state, dispatch } = useDesign();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const generationCountRef = useRef(0);
  const { user } = useAuth();
  const { toast } = useToast();
  const { saveDesign } = useDesignStorage();
  const { trackEvent } = useAnalytics();

  // Restore last generation from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RESULT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GenerationResult;
        if (parsed.mockupImage && parsed.transparentImage) {
          setResult(parsed);
          dispatch({ type: "SET_STATUS", status: "COMPLETE" });
        }
      }
    } catch {
      // ignore parse errors
    }
  }, [dispatch]);

  // Persist result to localStorage whenever it changes
  useEffect(() => {
    if (result) {
      try {
        localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
      } catch {
        // quota exceeded — ignore
      }
    }
  }, [result]);

  useEffect(() => {
    trackEvent("page_visit", { page: "studio" });
  }, [trackEvent]);

  useEffect(() => {
    trackEvent("product_selected", { product: productConfig.config.product });
  }, [productConfig.config.product, trackEvent]);

  const handleGenerate = useCallback(async () => {
    if (!user && generationCountRef.current >= 1) {
      setShowLoginModal(true);
      return;
    }

    try {
      generationCountRef.current += 1;
      dispatch({ type: "SET_STATUS", status: "GENERATING_DESIGN" });
      productConfig.setLocked(true);

      const { config } = productConfig;
      const entry = catalog.findProduct(config.product, config.subProduct, "White" as any, config.view);
      const productImageUrl = entry?.imageUrl ?? null;

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
      );

      setResult(genResult);
      dispatch({ type: "SET_STATUS", status: "COMPLETE" });
      productConfig.setLocked(false);
      trackEvent("design_generated", { product: productConfig.config.product });

      // Save generation record for analytics
      try {
        const isGuest = !user;
        const genRecord = {
          user_id: user?.id ?? null,
          session_id: isGuest ? getGuestSessionId() : null,
          is_guest: isGuest,
          product: config.product,
          color: config.color,
          style: state.designParams.style || null,
          prompt: genResult.prompt || null,
          mockup_image_path: genResult.mockupImage || null,
          transparent_image_path: genResult.transparentImage || null,
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

      // Auto-save to designs table for "My Designs"
      try {
        if (user) {
          const title = state.designParams.character.slice(0, 60) || "Untitled";
          await saveDesign({
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
          toast({ title: "დიზაინი შენახულია ✅" });
        }
      } catch (e: any) {
        console.error("[Generation] Auto-save to designs failed:", e);
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
  }, [state.designParams, state.speed, productConfig, dispatch, toast, user, saveDesign, trackEvent]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    const title = state.designParams.character.slice(0, 60) || "Untitled";
    await saveDesign({
      title,
      prompt: result.prompt,
      product: productConfig.config.product,
      color: productConfig.config.color,
      placementX: productConfig.config.placementCoords.x,
      placementY: productConfig.config.placementCoords.y,
      placementScale: productConfig.config.placementCoords.scale,
      transparentImageDataUrl: result.transparentImage,
      mockupImageDataUrl: result.mockupImage,
    });
    setSaving(false);
  }, [result, state.designParams.character, productConfig.config, saveDesign]);

  const handleStartNew = useCallback(() => {
    setResult(null);
    localStorage.removeItem(RESULT_STORAGE_KEY);
    dispatch({ type: "RESET" });
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
      colorName={productConfig.config.color}
      onSave={handleSave}
      saving={saving}
      onResultUpdate={setResult}
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
            />
            <div className="border-t border-sidebar-border pt-4 space-y-4">
              {(() => {
                const bd = calculatePrice(
                  productConfig.config.product,
                  productConfig.config.subProduct,
                  "none",
                  true,
                );
                return (
                  <>
                    <PriceDisplay breakdown={bd} />
                    {result && (
                      <OrderDialog
                        breakdown={bd}
                        product={productConfig.config.product}
                        subProduct={productConfig.config.subProduct}
                        color={productConfig.config.color}
                        isStudio={true}
                      />
                    )}
                  </>
                );
              })()}
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
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
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
