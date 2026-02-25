export type Lang = "en" | "ge";

const translations = {
  en: {
    header: {
      title: "maika.ge",
      subtitle: "Studio",
      guestMode: "Guest Mode",
    },
    login: {
      title: "maika.ge Studio",
      subtitle: "Sign in to generate and save your designs.",
      google: "Sign in with Google",
      guest: "Continue as Guest",
      error: "Authentication failed. Please try again.",
    },
    theme: {
      light: "☀️",
      dark: "🌙",
    },
    nav: {
      logout: "Logout",
    },
  },
  ge: {
    header: {
      title: "maika.ge",
      subtitle: "სტუდია",
      guestMode: "სტუმრის რეჟიმი",
    },
    login: {
      title: "maika.ge სტუდია",
      subtitle: "შედით სისტემაში დიზაინების შესაქმნელად და შესანახად.",
      google: "შესვლა Google-ით",
      guest: "გაგრძელება სტუმრად",
      error: "ავტორიზაცია ვერ მოხერხდა. სცადეთ ხელახლა.",
    },
    theme: {
      light: "☀️",
      dark: "🌙",
    },
    nav: {
      logout: "გამოსვლა",
    },
  },
} as const;

export function t(lang: Lang, key: string): string {
  const keys = key.split(".");
  let result: any = translations[lang];
  for (const k of keys) {
    result = result?.[k];
  }
  return (result as string) ?? key;
}

export { translations };
