// @vitest-environment node
//
// lazyWithRetry rules:
//   (a) every code-split import under src/ goes through lazyWithRetry, so a
//       chunk that 404s after a deploy retries / reloads once / shows the
//       reload message instead of a blank screen. The only bare `lazy()`
//       imports allowed are the two OrderDialog ones (OrderDialog wiring is
//       byte-stable).
//   (b) the fallback message language follows useAppState: "ge" or unset is
//       Georgian, only "en" is English.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { chunkErrorLang } from "@/lib/lazyWithRetry";

const SRC = path.resolve(__dirname, "..");

const ALLOWED_BARE_LAZY = new Set([
  'src/pages/SimplePage.tsx: const OrderDialog = lazy(() => import("@/components/OrderDialog"));',
  'src/pages/DesignDetailPage.tsx: const OrderDialog = lazy(() => import("@/components/OrderDialog"));',
]);

const BARE_LAZY = /(?<![\w$])(?:React\.)?lazy\(\s*\(\s*\)\s*=>\s*import\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (path.relative(SRC, full) === "test") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("code-split imports use lazyWithRetry", () => {
  it("no bare lazy(() => import(...)) outside the OrderDialog allow-list", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(path.resolve(SRC, ".."), file).split(path.sep).join("/");
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line) => {
          if (!BARE_LAZY.test(line)) return;
          const key = `${rel}: ${line.trim()}`;
          if (!ALLOWED_BARE_LAZY.has(key)) offenders.push(key);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("chunkErrorLang", () => {
  it("is Georgian for 'ge'", () => {
    expect(chunkErrorLang("ge")).toBe("ge");
  });
  it("is Georgian when nothing is stored (useAppState default)", () => {
    expect(chunkErrorLang(null)).toBe("ge");
  });
  it("is English for 'en'", () => {
    expect(chunkErrorLang("en")).toBe("en");
  });
});
