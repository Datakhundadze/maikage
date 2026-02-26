import { useDesign } from "@/hooks/useDesign";
import DesignSection from "@/components/DesignSection";
import { Button } from "@/components/ui/button";
import { Zap, Sparkles, RefreshCw } from "lucide-react";

interface DesignStudioPanelProps {
  onViewImage?: (src: string) => void;
  onGenerate?: () => void;
  hasResult?: boolean;
  onStartNew?: () => void;
  onApply?: () => void;
}

export default function DesignStudioPanel({ onViewImage, onGenerate, hasResult, onStartNew, onApply }: DesignStudioPanelProps) {
  const { state, dispatch } = useDesign();
  const { designParams, speed, expandedSections, appStatus } = state;

  const isProcessing = appStatus !== "IDLE" && appStatus !== "COMPLETE" && appStatus !== "ERROR";

  return (
    <div className="space-y-3">
      {/* Guide Box */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-4 gap-2 text-center text-[10px] text-muted-foreground">
          {["Character", "Scene", "Style", "Generate"].map((label, i) => (
            <div key={label} className="space-y-1">
              <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">{i + 1}</div>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">⌘+V to paste images</p>
      </div>

      {/* Character */}
      <DesignSection
        title="Characters"
        subtitle="The Subject/Actor. Defines WHO is in the shot."
        text={designParams.character}
        onTextChange={(t) => dispatch({ type: "SET_CHARACTER", text: t })}
        placeholder="Describe your character... e.g., A cyberpunk samurai with neon armor"
        images={designParams.characterImages}
        onAddImage={(img) => dispatch({ type: "ADD_CHARACTER_IMAGE", image: img })}
        onRemoveImage={(i) => dispatch({ type: "REMOVE_CHARACTER_IMAGE", index: i })}
        onViewImage={onViewImage}
      />

      {/* Scene */}
      <DesignSection
        title="Scene / Action"
        subtitle="The SET. Defines the environment and pose."
        text={designParams.scene}
        onTextChange={(t) => dispatch({ type: "SET_SCENE", text: t })}
        placeholder="Describe the scene... e.g., Standing on a rooftop at sunset"
        image={designParams.sceneImage}
        onImageChange={(img) => dispatch({ type: "SET_SCENE_IMAGE", image: img })}
        collapsible expanded={expandedSections.scene}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "scene" })}
        onViewImage={onViewImage}
      />

      {/* Style */}
      <DesignSection
        title="Artistic Style"
        subtitle="The LENS. Defines the visual art direction."
        text={designParams.style}
        onTextChange={(t) => dispatch({ type: "SET_STYLE", text: t })}
        placeholder="Describe the style... e.g., Synthwave 80s neon aesthetic"
        image={designParams.styleImage}
        onImageChange={(img) => dispatch({ type: "SET_STYLE_IMAGE", image: img })}
        collapsible expanded={expandedSections.style}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "style" })}
        onViewImage={onViewImage}
      />

      {/* Typography */}
      <DesignSection
        title="Typography"
        subtitle="Text to include in the design."
        text={designParams.text}
        onTextChange={(t) => dispatch({ type: "SET_TEXT", text: t })}
        placeholder="Text to render on the design..."
        image={designParams.textImage}
        onImageChange={(img) => dispatch({ type: "SET_TEXT_IMAGE", image: img })}
        collapsible expanded={expandedSections.text}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "text" })}
        onViewImage={onViewImage}
      />

      {/* Speed Toggle */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={speed === "fast" ? "default" : "outline"}
          className={`flex-1 gap-1.5 ${speed === "fast" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
          onClick={() => dispatch({ type: "SET_SPEED", speed: "fast" })}
        >
          <Zap className="h-3.5 w-3.5" /> Fast
        </Button>
        <Button
          size="sm"
          variant={speed === "quality" ? "default" : "outline"}
          className={`flex-1 gap-1.5 ${speed === "quality" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
          onClick={() => dispatch({ type: "SET_SPEED", speed: "quality" })}
        >
          <Sparkles className="h-3.5 w-3.5" /> Pro
        </Button>
      </div>

      {/* Action Buttons */}
      {hasResult ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              className="flex-1 h-12 gap-1.5 bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 font-semibold"
              disabled={isProcessing}
              onClick={onGenerate}
            >
              <RefreshCw className="h-4 w-4" /> Regenerate
            </Button>
          </div>
          <button
            onClick={onStartNew}
            className="w-full text-center text-sm text-primary hover:text-primary/80"
          >
            Start New Design
          </button>
        </div>
      ) : (
        <Button
          className="w-full h-12 bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 font-semibold text-base"
          disabled={!designParams.character.trim() || isProcessing}
          onClick={onGenerate}
        >
          {isProcessing ? "Processing..." : "Generate Merchandise"}
        </Button>
      )}
    </div>
  );
}
