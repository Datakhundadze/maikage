// Final catalog category list. Hard-coded so the admin upload form and the
// public catalog browser stay in lock-step without a round-trip through the
// DB. The slug is what we store in catalog_designs.category; label_ka /
// label_en are the user-facing strings.
export const CATEGORIES = [
  { slug: "georgian",       label_ka: "ქართული",         label_en: "Georgian" },
  { slug: "patriotic",      label_ka: "პატრიოტული",     label_en: "Patriotic" },
  { slug: "humor",          label_ka: "სასაცილო",        label_en: "Humor" },
  { slug: "music",          label_ka: "მუსიკა",           label_en: "Music" },
  { slug: "movies",         label_ka: "კინო",             label_en: "Movies" },
  { slug: "georgian-table", label_ka: "ქართული სუფრა",  label_en: "Georgian Table" },
  { slug: "couples",        label_ka: "წყვილები",         label_en: "Couples" },
  { slug: "art",            label_ka: "ხელოვნება",        label_en: "Art" },
  { slug: "animals",        label_ka: "ცხოველები",        label_en: "Animals" },
  { slug: "auto-moto",      label_ka: "აუტო-მოტო",       label_en: "Auto-Moto" },
  { slug: "sports",         label_ka: "სპორტი",           label_en: "Sports" },
  { slug: "professions",    label_ka: "პროფესიები",      label_en: "Professions" },
  { slug: "seasonal",       label_ka: "სეზონური",         label_en: "Seasonal" },
] as const;

export type CategorySlug = typeof CATEGORIES[number]["slug"];
