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
      email: "Email",
      password: "Password",
      signIn: "Sign In",
      signUp: "Sign Up",
      or: "or",
    },
    nav: {
      studio: "Studio",
      simple: "Simple",
      myDesigns: "My Designs",
      community: "Samples",
      logout: "Logout",
    },
    theme: {
      light: "☀️",
      dark: "🌙",
    },
    studio: {
      guide: {
        character: "Character",
        characterHint: "Who/what is in the design?",
        scene: "Scene",
        sceneHint: "Where & what are they doing?",
        style: "Style",
        styleHint: "Visual look & feel",
        generate: "Generate",
        generateHint: "Create your design!",
        paste: "Ctrl+V to paste images",
      },
      character: {
        title: "Characters",
        subtitle: "The Subject/Actor. Defines WHO is in the shot.",
        placeholder: "Describe your character... e.g., A cyberpunk samurai with neon armor",
      },
      scene: {
        title: "Scene / Action",
        subtitle: "The SET. Defines the environment and pose.",
        placeholder: "Describe the scene... e.g., Standing on a rooftop at sunset",
      },
      style: {
        title: "Artistic Style",
        subtitle: "The LENS. Defines the visual art direction.",
        placeholder: "Describe the style... e.g., Synthwave 80s neon aesthetic",
      },
      typography: {
        title: "Text",
        subtitle: "Text to include in the design.",
        placeholder: "Text to render on the design...",
      },
      speed: {
        fast: "Fast",
        pro: "Pro",
      },
      generate: "Generate Merchandise",
      regenerate: "Regenerate",
      processing: "Processing...",
      startNew: "Start New Design",
      randomize: "Magic Randomizer ✨",
      randomizing: "Randomizing...",
    },
    result: {
      preview: "Preview",
      printFile: "Print File (PNG)",
      save: "Save to Cloud",
      saving: "Saving...",
      downloadAll: "Download All",
      view: "View",
      copy: "Copy",
      download: "Download",
      downloadPng: "Download PNG",
      upscale: "Upscale 4K",
      upscaling: "Upscaling...",
    },
    myDesigns: {
      title: "My Designs",
      count: (n: number) => `${n} design${n !== 1 ? "s" : ""} saved`,
      empty: "No designs yet",
      emptyHint: "Generate your first design in the Studio!",
      deleteConfirm: "Delete this design?",
    },
    community: {
      title: "Samples",
      subtitle: "Discover designs from the maika.ge community.",
      empty: "No published designs yet",
      emptyHint: "Be the first to publish!",
    },
    config: {
      product: "Product",
      brand: "Brand",
      color: "Color",
      view: "View",
      size: "Size",
      front: "Front",
      back: "Back",
      chooseSize: "Choose size",
    },
    upload: "Upload",
    products: {
      "T-Shirt": "T-Shirt",
      "Hoodie": "Hoodie",
      "Tote Bag": "Tote Bag",
      "Cap": "Cap",
      "Apron": "Apron",
      "Phone Case": "Phone Case",
      "Mug": "Mug",
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
      email: "ელფოსტა",
      password: "პაროლი",
      signIn: "შესვლა",
      signUp: "რეგისტრაცია",
      or: "ან",
    },
    nav: {
      studio: "სტუდია",
      simple: "მარტივი",
      myDesigns: "ჩემი დიზაინები",
      community: "მაგალითები",
      logout: "გამოსვლა",
    },
    theme: {
      light: "☀️",
      dark: "🌙",
    },
    studio: {
      guide: {
        character: "პერსონაჟი",
        characterHint: "ვინ/რა არის დიზაინში?",
        scene: "სცენა",
        sceneHint: "სად და რას აკეთებს?",
        style: "სტილი",
        styleHint: "ვიზუალური მიმართულება",
        generate: "გენერაცია",
        generateHint: "შექმენი დიზაინი!",
        paste: "Ctrl+V სურათის ჩასასმელად",
      },
      character: {
        title: "პერსონაჟები",
        subtitle: "სუბიექტი/აქტორი. განსაზღვრავს ვინ არის კადრში.",
        placeholder: "აღწერეთ პერსონაჟი... მაგ., კიბერპანკ სამურაი ნეონის ჯავშნით",
      },
      scene: {
        title: "სცენა / მოქმედება",
        subtitle: "გარემო. განსაზღვრავს პოზას და ადგილს.",
        placeholder: "აღწერეთ სცენა... მაგ., სახურავზე მზის ჩასვლისას",
      },
      style: {
        title: "მხატვრული სტილი",
        subtitle: "ვიზუალური მიმართულება.",
        placeholder: "აღწერეთ სტილი... მაგ., სინთვეივ 80-იანი ნეონი",
      },
      typography: {
        title: "წარწერა",
        subtitle: "ტექსტი დიზაინში ჩასართავად.",
        placeholder: "ტექსტი დიზაინზე...",
      },
      speed: {
        fast: "სწრაფი",
        pro: "პრო",
      },
      generate: "დიზაინის გენერაცია",
      regenerate: "ხელახლა გენერაცია",
      processing: "მუშავდება...",
      startNew: "ახალი დიზაინი",
      randomize: "მაგიური რანდომაიზერი ✨",
      randomizing: "რანდომიზაცია...",
    },
    result: {
      preview: "გადახედვა",
      printFile: "ბეჭდვის ფაილი (PNG)",
      save: "შენახვა Cloud-ზე",
      saving: "ინახება...",
      downloadAll: "ყველას ჩამოტვირთვა",
      view: "ნახვა",
      copy: "კოპირება",
      download: "ჩამოტვირთვა",
      downloadPng: "PNG ჩამოტვირთვა",
      upscale: "4K გადიდება",
      upscaling: "იზრდება...",
    },
    myDesigns: {
      title: "ჩემი დიზაინები",
      count: (n: number) => `${n} დიზაინი შენახულია`,
      empty: "დიზაინები ჯერ არ არის",
      emptyHint: "შექმენით პირველი დიზაინი სტუდიაში!",
      deleteConfirm: "წაშალოთ ეს დიზაინი?",
    },
    community: {
      title: "მაგალითები",
      subtitle: "აღმოაჩინეთ maika.ge-ს საზოგადოების დიზაინები.",
      empty: "გამოქვეყნებული დიზაინები ჯერ არ არის",
      emptyHint: "იყავი პირველი!",
    },
    config: {
      product: "პროდუქტი",
      brand: "ბრენდი",
      color: "ფერი",
      view: "ხედი",
      size: "ზომა",
      front: "წინა",
      back: "უკანა",
      chooseSize: "აირჩიე ზომა",
    },
    upload: "ატვირთვა",
    products: {
      "T-Shirt": "მაისური",
      "Hoodie": "ჰუდი",
      "Tote Bag": "ჩანთა",
      "Cap": "კეპი",
      "Apron": "წინსაფარი",
      "Phone Case": "ქეისი",
      "Mug": "ჭიქა",
    },
  },
} as const;

// Type-safe translation getter supporting nested keys and function values
export function t(lang: Lang, key: string, ...args: any[]): string {
  const keys = key.split(".");
  let result: any = translations[lang];
  for (const k of keys) {
    result = result?.[k];
  }
  if (typeof result === "function") return result(...args);
  return (result as string) ?? key;
}

export { translations };
