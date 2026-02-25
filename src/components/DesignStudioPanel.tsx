import { useDesign } from "@/hooks/useDesign";
import DesignSection from "@/components/DesignSection";
import { Button } from "@/components/ui/button";
import { Zap, Sparkles } from "lucide-react";

interface DesignStudioPanelProps {
  onViewImage?: (src: string) => void;
}

export default function DesignStudioPanel({ onViewImage }: DesignStudioPanelProps) {
  const { state, dispatch } = useDesign();
  const { designParams, speed, expandedSections } = state;

  return (
    <div className="space-y-3">
      {/* Guide Box */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-4 gap-2 text-center text-[10px] text-muted-foreground">
          <div className="space-y-1">
            <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-banana-500/20 text-banana-500 text-xs font-bold">1</div>
            <span>Character</span>
          </div>
          <div className="space-y-1">
            <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-banana-500/20 text-banana-500 text-xs font-bold">2</div>
            <span>Scene</span>
          </div>
          <div className="space-y-1">
            <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-banana-500/20 text-banana-500 text-xs font-bold">3</div>
            <span>Style</span>
          </div>
          <div className="space-y-1">
            <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-banana-500/20 text-banana-500 text-xs font-bold">4</div>
            <span>Generate</span>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">⌘+V to paste images</p>
      </div>

      {/* Character (always visible) */}
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

      {/* Scene (collapsible) */}
      <DesignSection
        title="Scene / Action"
        subtitle="The SET. Defines the environment and pose."
        text={designParams.scene}
        onTextChange={(t) => dispatch({ type: "SET_SCENE", text: t })}
        placeholder="Describe the scene... e.g., Standing on a rooftop at sunset"
        image={designParams.sceneImage}
        onImageChange={(img) => dispatch({ type: "SET_SCENE_IMAGE", image: img })}
        collapsible
        expanded={expandedSections.scene}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "scene" })}
        onViewImage={onViewImage}
      />

      {/* Style (collapsible) */}
      <DesignSection
        title="Artistic Style"
        subtitle="The LENS. Defines the visual art direction."
        text={designParams.style}
        onTextChange={(t) => dispatch({ type: "SET_STYLE", text: t })}
        placeholder="Describe the style... e.g., Synthwave 80s neon aesthetic"
        image={designParams.styleImage}
        onImageChange={(img) => dispatch({ type: "SET_STYLE_IMAGE", image: img })}
        collapsible
        expanded={expandedSections.style}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "style" })}
        onViewImage={onViewImage}
      />

      {/* Typography (collapsible) */}
      <DesignSection
        title="Typography"
        subtitle="Text to include in the design."
        text={designParams.text}
        onTextChange={(t) => dispatch({ type: "SET_TEXT", text: t })}
        placeholder="Text to render on the design..."
        image={designParams.textImage}
        onImageChange={(img) => dispatch({ type: "SET_TEXT_IMAGE", image: img })}
        collapsible
        expanded={expandedSections.text}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "text" })}
        onViewImage={onViewImage}
      />

      {/* Speed Toggle */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={speed === "fast" ? "default" : "outline"}
          className={`flex-1 gap-1.5 ${speed === "fast" ? "bg-banana-500 text-primary-foreground hover:bg-banana-600" : ""}`}
          onClick={() => dispatch({ type: "SET_SPEED", speed: "fast" })}
        >
          <Zap className="h-3.5 w-3.5" />
          Fast
        </Button>
        <Button
          size="sm"
          variant={speed === "quality" ? "default" : "outline"}
          className={`flex-1 gap-1.5 ${speed === "quality" ? "bg-banana-500 text-primary-foreground hover:bg-banana-600" : ""}`}
          onClick={() => dispatch({ type: "SET_SPEED", speed: "quality" })}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Pro
        </Button>
      </div>

      {/* Generate Button */}
      <Button
        className="w-full h-12 bg-foreground text-background hover:bg-foreground/90 dark:bg-banana-500 dark:text-foreground dark:hover:bg-banana-600 font-semibold text-base"
        disabled={!designParams.character.trim() || state.appStatus !== "IDLE"}
      >
        {state.appStatus !== "IDLE" && state.appStatus !== "COMPLETE" && state.appStatus !== "ERROR"
          ? "Processing..."
          : "Generate Merchandise"}
      </Button>
    </div>
  );
}
