import AppLayout from "@/components/AppLayout";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";

function SidebarContent() {
  const { config, locked, setProduct, setSubProduct, setColor, setView } = useProductConfig();

  return (
    <ProductConfigPanel
      config={config}
      locked={locked}
      onProductChange={setProduct}
      onSubProductChange={setSubProduct}
      onColorChange={setColor}
      onViewChange={setView}
    />
  );
}

// We need to lift state so sidebar and main share the same config
export default function StudioPage() {
  const productConfig = useProductConfig();

  return (
    <AppLayout
      sidebar={
        <ProductConfigPanel
          config={productConfig.config}
          locked={productConfig.locked}
          onProductChange={productConfig.setProduct}
          onSubProductChange={productConfig.setSubProduct}
          onColorChange={productConfig.setColor}
          onViewChange={productConfig.setView}
        />
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
  );
}
