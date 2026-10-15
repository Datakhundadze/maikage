// Whether /showroom may be indexed. ONE switch for the three places that must
// agree: ShowroomPage's SeoHead (robots noindex), the sitemap
// (scripts/generate-sitemap.mjs adds /showroom only when true) and the static
// prerender (scripts/prerender.mjs emits the same robots tag while false).
//
// false while the photo room is a test (see ShowroomPage). Flip to true when
// it goes live; a sitemap listing a noindex URL is a Search Console error.
export const SHOWROOM_INDEXABLE = false;
