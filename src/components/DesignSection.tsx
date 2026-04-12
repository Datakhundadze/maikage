import { useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, X, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";

interface ImageSlot {
  src: string;
}

interface DesignSectionProps {
  title: string;
  subtitle: string;
  text: string;
  onTextChange: (text: string) => void;
  placeholder: string;
  // Single image mode
  image?: string | null;
  onImageChange?: (img: string | null) => void;
  // Multi image mode
  images?: string[];
  onAddImage?: (img: string) => void;
  onRemoveImage?: (index: number) => void;
  // Collapsible
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onViewImage?: (src: string) => void;
  // Preset chips
  presets?: string[];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DesignSection({
  title,
  subtitle,
  text,
  onTextChange,
  placeholder,
  image,
  onImageChange,
  images,
  onAddImage,
  onRemoveImage,
  collapsible,
  expanded,
  onToggle,
  onViewImage,
  presets,
}: DesignSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMulti = !!onAddImage;
  const { lang } = useAppState();

  if (collapsible && !expanded) {
    return (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm font-medium text-card-foreground hover:border-banana-500/50 transition-colors"
      >
        <span>{title}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    if (isMulti) {
      onAddImage?.(base64);
    } else {
      onImageChange?.(base64);
    }
    e.target.value = "";
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const base64 = await fileToBase64(file);
          if (isMulti) onAddImage?.(base64);
          else onImageChange?.(base64);
        }
        return;
      }
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div>
          <h4 className="text-sm font-semibold text-card-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {collapsible && (
          <button onClick={onToggle} className="text-muted-foreground hover:text-foreground">
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Image area */}
        <div className="flex flex-wrap gap-2">
          {/* Multi images */}
          {isMulti && images?.map((img, i) => (
            <div key={i} className="relative group h-16 w-16 rounded-lg overflow-hidden border border-border">
              <img src={img} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                {onViewImage && (
                  <button onClick={() => onViewImage(img)} className="text-white">
                    <Eye className="h-3 w-3" />
                  </button>
                )}
                <button onClick={() => onRemoveImage?.(i)} className="text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}

          {/* Single image */}
          {!isMulti && image && (
            <div className="relative group h-16 w-16 rounded-lg overflow-hidden border border-border">
              <img src={image} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                {onViewImage && (
                  <button onClick={() => onViewImage(image)} className="text-white">
                    <Eye className="h-3 w-3" />
                  </button>
                )}
                <button onClick={() => onImageChange?.(null)} className="text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Add button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-banana-500/50 hover:text-banana-500 transition-colors gap-0.5"
          >
            <Plus className="h-4 w-4" />
            <span className="text-[8px] font-medium leading-none">{t(lang, "upload")}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Preset chips */}
        {presets && presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset}
                onClick={() => onTextChange(text === preset ? "" : preset)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  text === preset
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        )}

        {/* Text area */}
        <Textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={handlePaste}
          placeholder={placeholder}
          className="min-h-[60px] text-sm resize-none"
        />
      </div>
    </div>
  );
}
