import { Sparkles, RefreshCw, Download, Maximize, Shirt, ArrowDownToLine } from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import GenerationLoader from "@/components/GenerationLoader";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import type { AppStatus } from "@/hooks/useDesign";

// Checkerboard backdrop for the transparent (without-background) result so the
// cut-out artwork reads clearly. With-background results are opaque on-white,
// so they keep the plain panel background instead.
const CHECKER_STYLE: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #d4d4d8 25%, transparent 25%), linear-gradient(-45deg, #d4d4d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d8 75%), linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

interface SimpleAiPanelProps {
  lang: Lang;
  prompt: string;
  onPromptChange: (v: string) => void;
  styleOptions: string[];
  selectedStyle: string;
  onSelectStyle: (s: string) => void;
  withBackground: boolean;
  onToggleBackground: (v: boolean) => void;
  generating: boolean;
  status: AppStatus;
  /** Image to show in the result panel (transparent design on without-bg,
   *  raw generation on with-bg). null until a generation completes. */
  resultImage: string | null;
  /** Product-adaptive primary CTA label (e.g. "მაისურზე გადატანა"). */
  transferLabel: string;
  canGenerate: boolean;
  onGenerate: () => void;
  onTransfer: () => void;
  onRegenerate: () => void;
  onStartNew: () => void;
  onDownload: () => void;
  /** Phase 2 — upscale the generated design to 4K (mirrors Studio). */
  onUpscale: () => void;
  upscaling: boolean;
  /** Phase 2 — open the inline virtual try-on modal with the design. */
  onTryOn: () => void;
}

export default function SimpleAiPanel({
  lang, prompt, onPromptChange, styleOptions, selectedStyle, onSelectStyle,
  withBackground, onToggleBackground, generating, status, resultImage,
  transferLabel, canGenerate, onGenerate, onTransfer, onRegenerate, onStartNew, onDownload,
  onUpscale, upscaling, onTryOn,
}: SimpleAiPanelProps) {
  return (
    <div className="rounded-2xl border-2 border-[#26BB89]/40 bg-[#26BB89]/[0.06] overflow-hidden shadow-sm">
      {/* Accent header strip — brand-green highlight so the AI feature pops */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#26BB89]/10 border-b border-[#26BB89]/25">
        <Sparkles className="h-4 w-4" style={{ color: "#26BB89" }} />
        <h3 className="text-sm font-bold" style={{ color: "#26BB89" }}>
          {t(lang, "simpleAi.heading")}
        </h3>
      </div>

      <div className="p-3 space-y-3">
      {generating ? (
        <div className="rounded-xl border border-border bg-card">
          <GenerationLoader status={status} />
        </div>
      ) : resultImage ? (
        /* ── Result panel ── */
        <div className="space-y-2">
          <div
            className={`rounded-xl border border-border p-2 flex items-center justify-center ${withBackground ? "bg-background" : ""}`}
            style={withBackground ? undefined : CHECKER_STYLE}
          >
            <img
              src={resultImage}
              alt="AI design"
              className="max-h-56 w-auto object-contain rounded-lg"
            />
          </div>

          {/* PRIMARY: transfer onto the product */}
          <Button
            onClick={onTransfer}
            className="w-full h-12 gap-2 font-semibold text-base bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          >
            <ArrowDownToLine className="h-4 w-4" />
            {transferLabel}
          </Button>

          {/* Secondary actions */}
          <div className="grid grid-cols-3 gap-1.5">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onRegenerate}>
              <RefreshCw className="h-3.5 w-3.5" /> {t(lang, "simpleAi.regenerate")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onDownload}>
              <Download className="h-3.5 w-3.5" /> {t(lang, "simpleAi.download")}
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={onStartNew}>
              {t(lang, "simpleAi.startNew")}
            </Button>
          </div>

          {/* Upscale + virtual try-on */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onUpscale} disabled={upscaling}>
              <Maximize className="h-3.5 w-3.5" /> {upscaling ? t(lang, "simpleAi.upscaling") : t(lang, "simpleAi.upscale")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onTryOn}>
              <Shirt className="h-3.5 w-3.5" /> {t(lang, "simpleAi.tryOn")}
            </Button>
          </div>
        </div>
      ) : (
        /* ── Form ── */
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{t(lang, "simpleAi.promptLabel")}</label>
            <Textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              rows={3}
              placeholder={t(lang, "simpleAi.promptPlaceholder")}
            />
          </div>

          {/* Style chips (shared with Studio via getStyleOptions) */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{t(lang, "simpleAi.styleLabel")}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {styleOptions.map((opt) => {
                const active = selectedStyle === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onSelectStyle(active ? "" : opt)}
                    className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Background toggle (default: without background) */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onToggleBackground(false)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium border transition-colors ${
                !withBackground ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(lang, "simpleAi.withoutBackground")}
            </button>
            <button
              type="button"
              onClick={() => onToggleBackground(true)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium border transition-colors ${
                withBackground ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(lang, "simpleAi.withBackground")}
            </button>
          </div>

          <Button
            onClick={onGenerate}
            disabled={!canGenerate}
            className="w-full h-11 gap-2 font-semibold bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          >
            <Sparkles className="h-4 w-4" />
            {t(lang, "simpleAi.generate")}
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}
