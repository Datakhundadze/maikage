// The landing hero's H1 name: the brand alone when the URL names one
// (/hoodie/premium-washed → "Premium Washed Hoodie"), the product's Georgian
// label otherwise (/hoodie → "ჰუდი"). Separate from ProductLandingPage's
// landingName, which keeps feeding the SEO title and description unchanged.
export function heroTitle(productKa: string, brand: string | null): string {
  return brand ?? productKa;
}
