import { useEffect, useRef } from "react";
import {
  Sparkles, Send, Upload, Eraser, Palette, RefreshCw, Share2, Shirt,
  ArrowDownToLine, Mail, Loader2, SlidersHorizontal, ChevronDown,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import GenerationLoader from "@/components/GenerationLoader";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import type { AppStatus } from "@/hooks/useDesign";

// Merged chat-first AI panel (replaces SimpleAiPanel + the per-layer "Edit
// with AI" sidebar block). Fully controlled — ALL state lives in SimplePage;
// this component only renders and calls back. It is assigned to the same
// `aiPanel` const and rendered in the same two responsive slots as the old
// panel, so mobile/desktop behavior is inherited verbatim.
//
// Progressive disclosure:
//   - empty state (no photos, no messages): upload zone + one input, nothing else
//   - style/background options: collapsed behind a toggle, generation mode only
//   - edit chips (remove-bg, restyle presets): only when a photo layer exists

// Checkerboard backdrop for transparent (without-background) results —
// same style as the old SimpleAiPanel result frame.
const CHECKER_STYLE: CSSProperties = {
  backgroundColor: "#f7f7f8",
  backgroundImage:
    "linear-gradient(45deg, #e6e8ec 25%, transparent 25%), linear-gradient(-45deg, #e6e8ec 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e6e8ec 75%), linear-gradient(-45deg, transparent 75%, #e6e8ec 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
};

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  /** Result image (generated design or edited photo). */
  image?: string;
  kind?: "generated" | "edited" | "error";
}

export interface RestylePreset {
  key: string;
  ge: string;
  en: string;
  instruction: string;
}

interface SimpleAiChatPanelProps {
  lang: Lang;
  messages: AiChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  /** Any AI operation in flight (generate, edit, remove-bg). */
  busy: boolean;
  /** Text-to-image generation in flight — shows the staged loader. */
  generating: boolean;
  status: AppStatus;
  /** Target photo for edit commands (selected layer, or the most recent). */
  activePhoto: { id: string; image: string } | null;
  hasPhotos: boolean;
  canUpload: boolean;
  onUploadClick: () => void;
  restylePresets: RestylePreset[];
  onPresetChip: (preset: RestylePreset) => void;
  onRemoveBg: () => void;
  /** Generation options row — collapsed by default (progressive disclosure). */
  optionsOpen: boolean;
  onToggleOptions: (v: boolean) => void;
  styleOptions: string[];
  selectedStyle: string;
  onSelectStyle: (s: string) => void;
  withBackground: boolean;
  onToggleBackground: (v: boolean) => void;
  /** True while an aiResult exists — enables the latest generated message's actions. */
  hasResult: boolean;
  transferLabel: string;
  onTransfer: () => void;
  onRegenerate: () => void;
  onShare: () => void;
  onTryOn: () => void;
  blocked?: boolean;
}

export default function SimpleAiChatPanel({
  lang, messages, input, onInputChange, onSubmit, canSubmit, busy, generating,
  status, activePhoto, hasPhotos, canUpload, onUploadClick, restylePresets,
  onPresetChip, onRemoveBg, optionsOpen, onToggleOptions, styleOptions,
  selectedStyle, onSelectStyle, withBackground, onToggleBackground, hasResult,
  transferLabel, onTransfer, onRegenerate, onShare, onTryOn, blocked,
}: SimpleAiChatPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the transcript pinned to the newest message / pending indicator.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  const lastGeneratedId = [...messages].reverse().find((m) => m.kind === "generated")?.id;

  // Bring the newest generated design into view.
  //
  // The effect above only pins the TRANSCRIPT's own scrollTop. That is not
  // enough: this panel is the fourth block inside the sidebar's own
  // `overflow-y-auto` container (product config → inline preview → try-on →
  // side indicator → here), and a chat handoff opens the constructor in a
  // FRESH TAB with that container at scrollTop 0. A generation seeded from the
  // chat therefore completed entirely below the fold — the customer saw the
  // garment unchanged and concluded nothing had happened.
  //
  // scrollIntoView is the right tool precisely because it walks EVERY
  // scrollable ancestor, so it reaches the sidebar container this component
  // knows nothing about. `block: "nearest"` scrolls the minimum needed, which
  // keeps it a no-op when the bubble is already visible — the manual path.
  const generatedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!lastGeneratedId) return;
    generatedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lastGeneratedId]);

  const isEmpty = messages.length === 0 && !hasPhotos && !busy;

  const inputRow = (
    <div className="flex items-center gap-1.5">
      {canUpload && !isEmpty && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={onUploadClick}
          aria-label={lang === "en" ? "Upload photo" : "ფოტოს ატვირთვა"}
          title={lang === "en" ? "Upload photo" : "ფოტოს ატვირთვა"}
        >
          <Upload className="h-4 w-4" />
        </Button>
      )}
      <Input
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        placeholder={
          isEmpty
            ? (lang === "en" ? "Upload a photo or describe what you want" : "ატვირთე ფოტო ან აღწერე რა გინდა")
            : hasPhotos
              ? (lang === "en" ? "Describe an edit or a command…" : "აღწერე ან დაწერე ბრძანება…")
              : (lang === "en" ? 'Describe your design… (text in quotes: "moby")' : "აღწერე შენი დიზაინი… (წარწერა ბრჭყალებში: „მობი\u201C)")
        }
        maxLength={1000}
        className="h-10 text-sm"
      />
      <Button
        type="button"
        size="icon"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="h-10 w-10 shrink-0 bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
        aria-label={lang === "en" ? "Send" : "გაგზავნა"}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );

  // Generation options (style chips + background toggle). Shown whenever there
  // is NO photo layer — i.e. text-to-image mode, INCLUDING the empty state
  // before the first message — so the style choice is visible while the user
  // types their prompt, not only after generating. (Edit mode shows edit chips
  // instead; nothing here then.)
  const generationOptions = !hasPhotos ? (
    <div>
      <button
        type="button"
        onClick={() => onToggleOptions(!optionsOpen)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <SlidersHorizontal className="h-3 w-3" />
        {lang === "en" ? "Options" : "პარამეტრები"}
        <ChevronDown className={`h-3 w-3 transition-transform ${optionsOpen ? "rotate-180" : ""}`} />
      </button>
      {/* Quotes convention: the ONLY way to get text rendered on the design. */}
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        {lang === "en"
          ? 'For text on the design, put it in quotes: "moby"'
          : "წარწერისთვის ჩასვი ბრჭყალებში: „მობი\u201C"}
      </p>
      {optionsOpen && (
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t(lang, "simpleAi.styleLabel")}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {/* "Auto" = the empty-style default (aiStyle === ""), rendered
                  first so the no-style state reads as a deliberate choice.
                  Selecting it sends style: "" — byte-identical to the default.
                  Clicking it while active is a harmless no-op (already ""). */}
              {(() => {
                const active = selectedStyle === "";
                return (
                  <button
                    type="button"
                    onClick={() => onSelectStyle("")}
                    className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {lang === "en" ? "Auto" : "ავტომატური"}
                  </button>
                );
              })()}
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
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="rounded-2xl border-2 border-[#26BB89]/40 bg-[#26BB89]/[0.06] overflow-hidden shadow-sm">
      {/* Accent header strip — brand-green highlight, same as the old panel */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#26BB89]/10 border-b border-[#26BB89]/25">
        <Sparkles className="h-4 w-4" style={{ color: "#26BB89" }} />
        <h3 className="text-sm font-bold" style={{ color: "#26BB89" }}>
          {t(lang, "simpleAi.heading")}
        </h3>
        {/* Active layer — commands apply to this photo */}
        {activePhoto && (
          <div className="ml-auto flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-muted-foreground truncate">
              {lang === "en" ? "Active photo" : "აქტიური ფოტო"}
            </span>
            <img
              src={activePhoto.image}
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-md object-cover border border-[#26BB89]/40 shrink-0"
            />
          </div>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        {/* Anti-abuse block notice — persistent until a paid order unblocks. */}
        {blocked && (
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-2">
            <p className="font-medium text-foreground">
              {lang === "en"
                ? "You've reached the free generation limit. Place an order to continue, or contact us."
                : "უფასო გენერაციების ლიმიტი ამოიწურა. გასაგრძელებლად გააფორმე შეკვეთა ან დაგვიკავშირდი."}
            </p>
            <a href="mailto:maika@maika.ge" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
              <Mail className="h-3.5 w-3.5" /> maika@maika.ge
            </a>
          </div>
        )}

        {isEmpty ? (
          /* ── Empty state: upload zone + one input. Nothing else. ── */
          <div className="space-y-2.5">
            {canUpload && (
              <Button
                type="button"
                variant="outline"
                className="w-full h-16 border-dashed gap-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={onUploadClick}
              >
                <Upload className="h-4 w-4" />
                {lang === "en" ? "Upload a photo" : "ატვირთე ფოტო"}
              </Button>
            )}
            {/* Style options visible up-front (generation mode) — the one thing
                that shapes the result, so it earns its place before generating. */}
            {generationOptions}
            {inputRow}
          </div>
        ) : (
          <>
            {/* ── Transcript ── */}
            {(messages.length > 0 || busy) && (
              <div ref={listRef} className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    ref={m.id === lastGeneratedId ? generatedRef : undefined}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl text-sm break-words ${
                        m.role === "user"
                          ? "bg-foreground text-background rounded-br-sm px-3 py-2"
                          : m.kind === "error"
                            ? "bg-destructive/10 text-destructive rounded-bl-sm px-3 py-2"
                            : "bg-card border border-border rounded-bl-sm p-2"
                      }`}
                    >
                      {m.text && <span className="whitespace-pre-wrap">{m.text}</span>}
                      {m.image && (
                        <div className="space-y-2">
                          <div
                            className="rounded-xl p-1.5 flex items-center justify-center"
                            style={m.kind === "generated" && !withBackground ? CHECKER_STYLE : undefined}
                          >
                            <img
                              src={m.image}
                              alt={m.kind === "edited" ? "Edited photo" : "AI design"}
                              className="max-h-52 w-auto object-contain rounded-lg select-none"
                              onContextMenu={(e) => e.preventDefault()}
                              draggable={false}
                            />
                          </div>
                          {/* Latest generated design → transfer / regenerate / share / try-on */}
                          {m.kind === "generated" && m.id === lastGeneratedId && hasResult && (
                            <div className="space-y-1.5">
                              <Button
                                onClick={onTransfer}
                                className="w-full h-10 gap-2 font-semibold bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
                              >
                                <ArrowDownToLine className="h-4 w-4" />
                                {transferLabel}
                              </Button>
                              <div className="space-y-1.5">
                                <div className="grid grid-cols-2 gap-1.5">
                                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onRegenerate}>
                                    <RefreshCw className="h-3.5 w-3.5" /> {t(lang, "simpleAi.regenerate")}
                                  </Button>
                                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onShare}>
                                    <Share2 className="h-3.5 w-3.5" /> {t(lang, "simpleAi.share")}
                                  </Button>
                                </div>
                                <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={onTryOn}>
                                  <Shirt className="h-3.5 w-3.5" /> {t(lang, "simpleAi.tryOn")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {/* Pending bubble */}
                {busy && (
                  <div className="flex justify-start">
                    <div className="max-w-[92%] w-full rounded-2xl rounded-bl-sm border border-border bg-card">
                      {generating ? (
                        <GenerationLoader status={status} />
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {lang === "en" ? "Working on it…" : "მუშავდება…"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Edit chips — only when a photo layer exists ── */}
            {hasPhotos && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy || !activePhoto}
                  onClick={onRemoveBg}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <Eraser className="h-3 w-3" />
                  {lang === "en" ? "Remove background" : "ფონის მოხსნა"}
                </button>
                {restylePresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={busy || !activePhoto}
                    onClick={() => onPresetChip(preset)}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <Palette className="h-3 w-3" />
                    {lang === "en" ? preset.en : preset.ge}
                  </button>
                ))}
              </div>
            )}

            {/* Generation options (style chips + background) — generation mode. */}
            {generationOptions}

            {inputRow}
          </>
        )}
      </div>
    </div>
  );
}
