import { useState, useCallback } from "react";
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
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { useToast } from "@/hooks/use-toast";

function StudioContent() {
  const productConfig = useProductConfig();
  const { state, dispatch } = useDesign();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { saveDesign } = useDesignStorage();

  const handleGenerate = useCallback(async () => {
    try {
      dispatch({ type: "SET_STATUS", status: "GENERATING_DESIGN" });
      productConfig.setLocked(true);

      const genResult = await runGenerationPipeline(
        {
          designParams: state.designParams,
          product: productConfig.config.product,
          color: productConfig.config.color,
          speed: state.speed,
        },
        productConfig.config.placementCoords,
        null,
        (status) => dispatch({ type: "SET_STATUS", status: status as any }),
      );

      setResult(genResult);
      dispatch({ type: "SET_STATUS", status: "COMPLETE" });
      productConfig.setLocked(false);
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
  }, [state.designParams, state.speed, productConfig, dispatch, toast]);

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
            <div className="border-t border-sidebar-border pt-4">
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
