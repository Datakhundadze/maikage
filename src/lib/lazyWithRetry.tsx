import {
  Component,
  lazy,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

// Why this file exists
// ────────────────────
// Every route in src/App.tsx is a `lazy()` import, so each page is its own
// JS chunk fetched on demand. When that fetch fails, React throws an
// uncaught TypeError ("Failed to fetch dynamically imported module") and,
// because nothing above the route catches it, the whole screen goes blank.
// Two things cause it, and neither is a bug in the page being loaded:
//
//   1. A deploy replaced the build. A tab that was already open still holds
//      the old index.html, so it asks for a chunk name that no longer
//      exists (e.g. LandingPage-R0wkj0DS.js). The fix is to reload so the
//      browser picks up the new index.html and its new chunk names.
//   2. A momentary network/edge hiccup (offline flicker, 5xx from the CDN).
//      The fix is to simply try the fetch again.
//
// `lazyWithRetry` handles both: retry in place, then reload once if the
// chunk is genuinely gone, and never reload twice for the same problem.
// `ChunkErrorBoundary` is the last-resort net: if loading still fails it
// shows a short message with a working reload button instead of a blank
// page, so the customer is never stranded.
//
// Bilingual by design: the app is en/ge, so the copy is picked from
// localStorage the same way the rest of the UI does it, with Georgian as the
// default (same as useAppState).

const RELOAD_FLAG = "maika-chunk-reload-at";
// A second reload within this window means the first one did not help, so
// stop and show the message instead of bouncing forever.
const RELOAD_COOLDOWN_MS = 30_000;
const RETRY_DELAY_MS = [300, 900];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Loading chunk \d+ failed|Importing a module script failed/i.test(
    message,
  );
}

function alreadyReloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    return last > 0 && Date.now() - last < RELOAD_COOLDOWN_MS;
  } catch {
    // sessionStorage can be unavailable (private mode / blocked storage).
    // Treat as "never reloaded" so recovery is still attempted once.
    return false;
  }
}

function markReload() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // Nothing to do; the cooldown is a safety net, not a requirement.
  }
}

/**
 * `lazy()` with the chunk-fetch failure modes handled: retry the import a
 * couple of times, and if the chunk is still missing, reload the page once
 * so the browser re-reads index.html and its current chunk names. If
 * recovery is impossible (already reloaded for this same problem), the
 * original error is rethrown for `ChunkErrorBoundary` to present.
 *
 * Drop-in replacement for `lazy()` — the call site stays identical.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy<T>(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAY_MS.length; attempt++) {
      try {
        return await factory();
      } catch (error) {
        lastError = error;
        if (!isChunkLoadError(error)) throw error;
        if (attempt < RETRY_DELAY_MS.length) {
          await sleep(RETRY_DELAY_MS[attempt]);
          continue;
        }
        // Retries exhausted: the chunk is very likely gone because the
        // build changed under this tab. One reload fixes it.
        if (!alreadyReloadedRecently()) {
          markReload();
          window.location.reload();
          // Keep suspending while the reload takes over; the page is about
          // to go away, so never resolve with a broken module.
          await new Promise<never>(() => {});
        }
        throw lastError;
      }
    }
    // Unreachable: the loop either returns, reloads, or throws.
    throw lastError;
  });
}

/**
 * Language for the fallback message, from the raw `maika-lang` value.
 * Mirrors useAppState: the stored Lang is "en" | "ge" and an unset value
 * means "ge", so only an explicit "en" gets English.
 */
export function chunkErrorLang(stored: string | null): "ge" | "en" {
  return stored === "en" ? "en" : "ge";
}

function isGeorgian() {
  try {
    return chunkErrorLang(localStorage.getItem("maika-lang")) === "ge";
  } catch {
    // Same default useAppState falls back to when storage throws.
    return true;
  }
}

/**
 * Catches a page chunk that could not be loaded and shows a short,
 * bilingual message with a reload button, instead of React unmounting the
 * whole tree and leaving a blank screen.
 */
export class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged so the failure is visible in the preview's console telemetry.
    console.error("[chunk] page failed to load", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const ka = isGeorgian();
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-lg font-medium text-foreground">
          {ka ? "გვერდის ჩატვირთვა ვერ მოხერხდა" : "This page couldn't load"}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {ka
            ? "საიტი განახლდა. გადატვირთეთ გვერდი გასაგრძელებლად."
            : "The site was just updated. Reload the page to continue."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {ka ? "გადატვირთვა" : "Reload"}
        </button>
      </div>
    );
  }
}
