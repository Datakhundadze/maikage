import { describe, expect, it } from "vitest";
import { countedHost, visitSource, VISIT_WINDOW_MS } from "@/lib/tour/showroomStats";
import { funnelBy, shareOfOpen, sourceLabel, type FunnelRow } from "@/lib/tour/showroomFunnel";

const NOW = 1_800_000_000_000;

describe("visitSource — where this showroom visit came from", () => {
  it("uses a fresh last touch's utm tags", () => {
    expect(visitSource({ lt: { source: "Meta", medium: "Paid", campaign: "Showroom-Test", ts: NOW - 1000 } }, NOW)).toEqual({ source: "meta", medium: "paid", campaign: "showroom-test" });
  });
  it("names Meta and Google from their click ids when there is no utm_source", () => {
    expect(visitSource({ lt: { fbclid: "x", ts: NOW } }, NOW).source).toBe("meta");
    expect(visitSource({ lt: { gclid: "x", ts: NOW } }, NOW).source).toBe("google");
  });
  it("falls back to the referring host", () => {
    expect(visitSource({ lt: { referrer: "l.instagram.com/", ts: NOW } }, NOW)).toEqual({ source: "l.instagram.com", medium: "referral", campaign: undefined });
  });
  it("ignores a last touch from an earlier visit", () => {
    expect(visitSource({ lt: { source: "meta", ts: NOW - VISIT_WINDOW_MS - 1 } }, NOW)).toEqual({ source: "direct" });
    expect(visitSource({ lt: { source: "meta", ts: NOW - VISIT_WINDOW_MS - 1 }, in_app: "instagram" }, NOW)).toEqual({ source: "instagram", medium: "in-app" });
  });
  it("is direct with nothing known", () => {
    expect(visitSource(null, NOW)).toEqual({ source: "direct" });
  });
});

describe("countedHost — only the real site is counted", () => {
  it("counts maika.ge and its punycode twin, nothing else", () => {
    expect(countedHost("maika.ge")).toBe(true);
    expect(countedHost("www.maika.ge")).toBe(true);
    expect(countedHost("xn--lodaxeh.xn--node")).toBe(true);
    expect(countedHost("localhost")).toBe(false);
    expect(countedHost("preview--maika.lovable.app")).toBe(false);
    expect(countedHost("notmaika.ge")).toBe(false);
  });
});

describe("funnelBy — the admin tables", () => {
  const rows: FunnelRow[] = [
    { day: "2026-11-26", source: "meta", medium: "paid", event: "open", sessions: 40 },
    { day: "2026-11-26", source: "meta", medium: "paid", event: "enter", sessions: 20 },
    { day: "2026-11-27", source: "meta", medium: "paid", event: "open", sessions: 10 },
    { day: "2026-11-27", source: "direct", medium: "", event: "open", sessions: 5 },
    { day: "2026-11-27", source: "direct", medium: "", event: "print", sessions: 1 },
  ];
  it("groups by source and totals", () => {
    const f = funnelBy(rows, (r) => sourceLabel(r.source, r.medium));
    expect(f.groups.find((g) => g.key === "meta / paid")!.counts).toEqual({ open: 50, enter: 20 });
    expect(f.groups.find((g) => g.key === "direct")!.counts).toEqual({ open: 5, print: 1 });
    expect(f.total).toEqual({ open: 55, enter: 20, print: 1 });
  });
  it("groups by day", () => {
    const f = funnelBy(rows, (r) => r.day);
    expect(f.groups.find((g) => g.key === "2026-11-27")!.counts.open).toBe(15);
  });
  it("shows each step as a share of those who opened the page", () => {
    expect(shareOfOpen({ open: 50, enter: 20 }, "enter")).toBe("40%");
    expect(shareOfOpen({ open: 50 }, "print")).toBe("0%");
    expect(shareOfOpen({ open: 50 }, "open")).toBe("");
    expect(shareOfOpen({}, "enter")).toBe("");
  });
});
