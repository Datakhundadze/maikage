// Production lead time: product landing hero (LandingHero), home "სერვისები"
// cards and service menus (serviceRouteSlugs), service pages (serviceCopy),
// SEO descriptions (pageSeo, designSeo), the static prerender and llms.txt.
// Separate literal copies: FAQ (faqContent), OrderDialog, CartPage, and the
// bots in supabase/functions.
//
// Business decision (2026-11): "1–3 სამუშაო დღე" everywhere — the same range
// OrderDialog, CartPage and the bot (meta-webhook LEAD_TIME_LINE) already show.
export const LEAD_TIME_KA = "1–3 სამუშაო დღე";
