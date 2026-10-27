import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DesignDescription from "@/components/catalog/DesignDescription";

// /design/:slug shows catalog_designs.description_ka under the H1, matching
// the <p> the static prerender (scripts/prerender.mjs designRoot) writes.

const TEXT =
  "ქართული წარწერით მაისური — დაბეჭდილი DTF ტექნოლოგიით.\nშეუკვეთე ნებისმიერ ფერსა და ზომაზე.";

afterEach(() => cleanup());

describe("DesignDescription", () => {
  it("renders the trimmed description as a paragraph", () => {
    render(<DesignDescription text={`  ${TEXT}  `} />);
    const p = screen.getByTestId("design-description");
    expect(p.tagName).toBe("P");
    expect(p.textContent).toBe(TEXT);
    // line breaks are kept visible
    expect(p.className).toContain("whitespace-pre-line");
  });

  it("renders nothing for null / undefined / empty / whitespace", () => {
    for (const t of [null, undefined, "", "   \n "]) {
      const { container } = render(<DesignDescription text={t} />);
      expect(container.innerHTML).toBe("");
      expect(screen.queryByTestId("design-description")).toBeNull();
      cleanup();
    }
  });

  it("treats the text as plain text, never HTML", () => {
    const evil = "<b>bold</b><img src=x onerror=alert(1)>";
    render(<DesignDescription text={evil} />);
    const p = screen.getByTestId("design-description");
    expect(p.textContent).toBe(evil);
    expect(p.querySelector("b")).toBeNull();
    expect(p.querySelector("img")).toBeNull();
  });
});

describe("DesignDetailPage wiring", () => {
  const SRC = readFileSync(path.resolve(__dirname, "../pages/DesignDetailPage.tsx"), "utf8");

  it("renders DesignDescription with description_ka right under the H1 block", () => {
    expect(SRC).toContain('import DesignDescription from "@/components/catalog/DesignDescription";');
    expect(SRC).toContain("<DesignDescription text={design.description_ka} />");
    const h1 = SRC.indexOf("<h1");
    const desc = SRC.indexOf("<DesignDescription");
    const switcher = SRC.indexOf("switchOptions.length > 1 &&");
    expect(h1).toBeGreaterThan(-1);
    expect(desc).toBeGreaterThan(h1);
    expect(desc).toBeLessThan(switcher);
  });

  it("does not inject description as HTML", () => {
    expect(SRC).not.toContain("dangerouslySetInnerHTML");
  });
});
