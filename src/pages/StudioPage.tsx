import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview from "@/components/ProductPreview";
import DesignStudioPanel from "@/components/DesignStudioPanel";
import Lightbox from "@/components/Lightbox";
import { useProductConfig } from "@/hooks/useProductConfig";
import { DesignProvider } from "@/hooks/useDesign";

function StudioContent() {
  const productConfig = useProductConfig();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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
              <DesignStudioPanel onViewImage={setLightboxSrc} />
            </div>
          </div>
        }
        main={
          <ProductPreview
            productName={productConfig.config.product}
            colorName={productConfig.config.color}
            view={productConfig.config.view}
            placementCoords={productConfig.config.placementCoords}
          />
        }
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
