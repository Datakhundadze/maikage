import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// AdminPage's tab bar is two rows (TAB_ROWS). Read straight from the source so
// the page (Supabase client, lazy tabs) is never loaded: every tab id must sit
// in exactly one row, and every badge tab in row 1.

const SRC = readFileSync(path.resolve(__dirname, "../pages/AdminPage.tsx"), "utf8");

function block(start: RegExp, end = "];"): string {
  const m = start.exec(SRC);
  if (!m) throw new Error(`${start} not found in AdminPage.tsx`);
  const from = m.index + m[0].length;
  return SRC.slice(from, SRC.indexOf(end, from));
}
const strings = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((x) => x[1]);

const allTabIds = [...block(/const ALL_TABS[^=]*= \[/).matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
const rows = block(/const TAB_ROWS: Tab\[\]\[\] = \[/)
  .split(/\]\s*,?/)
  .map(strings)
  .filter((r) => r.length > 0);
const badgeTabs = strings(block(/const BADGE_TABS = new Set<Tab>\(\[/, "])"));

describe("AdminPage tab rows", () => {
  it("parses the source", () => {
    expect(allTabIds.length).toBeGreaterThan(10);
    expect(rows).toHaveLength(2);
    expect(badgeTabs.length).toBeGreaterThan(0);
  });

  it("every tab id is in exactly one row; rows name no unknown id", () => {
    const placed = rows.flat();
    for (const id of allTabIds) {
      expect(placed.filter((x) => x === id), `"${id}" must appear in exactly one row`).toHaveLength(1);
    }
    for (const id of placed) expect(allTabIds, `row id "${id}" is not in ALL_TABS`).toContain(id);
  });

  it("every badge tab is in row 1", () => {
    for (const id of badgeTabs) expect(rows[0], `badge tab "${id}" must be in row 1`).toContain(id);
  });

  it("ALL_TABS is listed in row order", () => {
    expect(allTabIds).toEqual(rows.flat());
  });
});
