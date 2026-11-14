import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

// Every Supabase query stays pending: the page must render from the preload
// alone (this is the state Googlebot can snapshot).
vi.mock("@/integrations/supabase/client", () => {
  const never = new Promise(() => {});
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (res: unknown, rej: unknown) => never.then(res as never, rej as never) : () => chain),
    apply: () => chain,
  });
  return {
    supabase: {
      from: () => chain,
      storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: p } }) }) },
    },
  };
});

vi.mock("@/components/AppHeader", () => ({ default: () => null }));

import BlogPostPage from "@/pages/BlogPostPage";
import DesignPreloadView from "@/components/DesignPreloadView";
import { PAGE_PRELOAD_ID, readPagePreload, type DesignPreload } from "@/lib/pagePreload";
import { PAGE_PRELOAD_ID as PRERENDER_PRELOAD_ID, preloadScript } from "../../scripts/lib/seo.mjs";
import { blogPostTitle } from "@/lib/blogSeo";

const POST = {
  slug: "saakhaltslo-korporatiuli-sachukrebi",
  title_ka: "საახალწლო კორპორატიული საჩუქრები: ჰუდი და მაისური",
  body_md: "შესავალი.\n\n## ჰუდი კომპანიის ლოგოთი\nტექსტი </script><b>x</b>",
  cover_path: null,
  meta_description_ka: "ჰუდები და მაისურები ლოგოთი.",
  published_at: "2026-11-02T10:00:00+00:00",
  created_at: "2026-11-02T10:00:00+00:00",
  updated_at: "2026-11-14T10:00:00+00:00",
};

const DESIGN: DesignPreload = {
  title: "ძველი თბილისი — Timeless Architecture — მაისური | maika.ge",
  description: "შავ-თეთრი ფოტოკოლაჟი ძველი თბილისის აივნებით.",
  image: "https://cdn.example/t.png",
  name: "ძველი თბილისი — Timeless Architecture",
  body: "შავ-თეთრი ფოტოკოლაჟი: ძველი თბილისის ჩუქურთმიანი აივნები.",
  categoryLabel: "თბილისი",
};

/** Put the prerender's own <script> into the document, as the static page has it. */
function installPreload(kind: string, slug: string, data: unknown) {
  document.getElementById(PAGE_PRELOAD_ID)?.remove();
  const holder = document.createElement("div");
  holder.innerHTML = preloadScript(kind, slug, data);
  document.body.appendChild(holder.firstElementChild!);
}

afterEach(() => {
  document.getElementById(PAGE_PRELOAD_ID)?.remove();
});

describe("preloadScript (prerender) ↔ readPagePreload (app)", () => {
  it("same element id on both sides", () => {
    expect(PRERENDER_PRELOAD_ID).toBe(PAGE_PRELOAD_ID);
  });

  it("round-trips the data and cannot break out of its <script>", () => {
    const html = preloadScript("blog", POST.slug, POST);
    expect(html).not.toContain("</script><b>");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    installPreload("blog", POST.slug, POST);
    expect(readPagePreload("blog", POST.slug)).toEqual(POST);
  });

  it("only for the same kind and slug", () => {
    installPreload("blog", POST.slug, POST);
    expect(readPagePreload("blog", "other-post")).toBeNull();
    expect(readPagePreload("design", POST.slug)).toBeNull();
    expect(readPagePreload("blog", undefined)).toBeNull();
  });

  it("no element or malformed JSON → null", () => {
    expect(readPagePreload("blog", POST.slug)).toBeNull();
    const el = document.createElement("script");
    el.id = PAGE_PRELOAD_ID;
    el.type = "application/json";
    el.textContent = "{not json";
    document.body.appendChild(el);
    expect(readPagePreload("blog", POST.slug)).toBeNull();
  });
});

describe("BlogPostPage with a preload", () => {
  it("renders the post (h1, body, <title>) while Supabase is still pending — no spinner", async () => {
    installPreload("blog", POST.slug, POST);
    const { container } = render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[`/blog/${POST.slug}`]}>
          <Routes>
            <Route path="/blog/:slug" element={<BlogPostPage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: POST.title_ka })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "ჰუდი კომპანიის ლოგოთი" })).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
    await waitFor(() => expect(document.title).toBe(blogPostTitle(POST.title_ka)));
  });

  it("without a preload it still shows the loading state (unchanged behaviour)", () => {
    const { container } = render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[`/blog/${POST.slug}`]}>
          <Routes>
            <Route path="/blog/:slug" element={<BlogPostPage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("DesignPreloadView", () => {
  it("carries the design's own title, description, h1, image and text", async () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <DesignPreloadView preload={DESIGN} url="https://maika.ge/design/tbilisi-3" />
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: DESIGN.name })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: DESIGN.name })).toBeInTheDocument();
    expect(screen.getByText(DESIGN.body)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "კატალოგი" })).toHaveAttribute("href", "/designs");
    expect(screen.queryByRole("button", { name: "ხელახლა ცდა" })).toBeNull();
    await waitFor(() => expect(document.title).toBe(DESIGN.title));
    await waitFor(() =>
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://maika.ge/design/tbilisi-3"),
    );
  });

  it("load error: same content plus a retry button", () => {
    const onRetry = vi.fn();
    render(
      <HelmetProvider>
        <MemoryRouter>
          <DesignPreloadView preload={DESIGN} url="https://maika.ge/design/tbilisi-3" onRetry={onRetry} />
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: DESIGN.name })).toBeInTheDocument();
    screen.getByRole("button", { name: "ხელახლა ცდა" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
