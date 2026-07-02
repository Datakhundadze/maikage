import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Actions that each cost a paid image call at the gateway → rate-limited per
// caller. convert-bg-black (internal second half of a generate-design) and
// randomize-prompt (cheap text) are intentionally exempt.
const BILLABLE_ACTIONS = new Set(["generate-design", "virtual-tryon", "upscale", "isolate-subject", "restyle", "edit-image"]);

// Text-only actions: they skip the image modality, run a single attempt, and
// return { text } (no image extraction). randomize-prompt (existing) and
// faq-chat (FAQ chatbot) share these text rails.
const TEXT_ACTIONS = new Set(["randomize-prompt", "faq-chat"]);

// FAQ chatbot knowledge base — injected verbatim as the SYSTEM prompt for the
// "faq-chat" action. Public info (prices/hours/delivery/products). To edit it,
// change this string and REDEPLOY the function (a GitHub merge does not deploy
// edge functions). Behavior rules (answer only from this doc, reply in the
// user's language, unknown → contact us) live in §0 of the document itself.
const FAQ_KB = `# maika.ge — FAQ Chatbot Knowledge Base
# ცოდნის ბაზა (KA + EN)
# Single source of truth for the website FAQ assistant.
# Prices = exactly what the cart charges (pricing.ts). Update here when prices change.
# Last reconciled: 2026-06-25

═══════════════════════════════════════════════════════════════
## 0. ASSISTANT BEHAVIOR / ასისტენტის ქცევა
═══════════════════════════════════════════════════════════════

You are maika.ge's friendly website assistant. Answer ONLY from the facts in this
document. Reply in the SAME language the user writes in (Georgian or English).
Keep answers short, warm, and helpful.

If you don't know something or it's not in this document (custom quotes, special
requests, exact corporate pricing, anything uncertain):
→ KA: "ამ კითხვაზე ზუსტი პასუხისთვის დაგვიკავშირდით: +(995 32) 2 05 06 20 / 599 05 08 07, WhatsApp +995 599 05 08 07, Facebook/Instagram (maika.ge), ან შემოგვიარეთ შოურუმში."
→ EN: "For an exact answer please contact us: +(995 32) 2 05 06 20 / 599 05 08 07, WhatsApp +995 599 05 08 07, Facebook/Instagram (maika.ge), or visit our showroom."

Never invent prices, deadlines, or promises. Never offer discounts unless they are
written here. For large/corporate orders → direct to contact (individual quote).

⚠️ CRITICAL — never confirm a product/service we don't clearly have in this document.
If asked "do you have X?" and X is NOT explicitly listed here, do NOT say "yes, we have it."
Instead say we don't offer it, or that they should contact us to check. In particular NEVER
claim we have official/licensed sports kits (national team, football clubs, etc.) — we don't.
When unsure, under-promise and point to contact; a false "yes" causes real harm.

═══════════════════════════════════════════════════════════════
## 1. COMPANY / კომპანია
═══════════════════════════════════════════════════════════════

KA:
- სახელი: maika.ge — საქართველოს ცნობილი მაისურების ბრენდი, 15+ წლის გამოცდილებით (custom apparel + ბეჭდვა).
- მისამართი / შოურუმი: ა. წერეთლის გამზ. #2, დინამოს არენა, კარი #10, თბილისი.
- ტელეფონი: +(995 32) 2 05 06 20 · 599 05 08 07
- ელფოსტა: maika@maika.ge
- საიტი: www.maika.ge
- სამუშაო საათები: ორშაბათი–პარასკევი 11:00–19:00 · შაბათი 11:00–18:00 · კვირა დაკეტილია.

EN:
- Name: maika.ge — a well-known Georgian apparel brand with 15+ years of experience (custom apparel + printing).
- Address / showroom: A. Tsereteli Ave #2, Dinamo Arena, Gate #10, Tbilisi.
- Phone: +(995 32) 2 05 06 20 · 599 05 08 07
- Email: maika@maika.ge
- Website: www.maika.ge
- Working hours: Monday–Friday 11:00–19:00 · Saturday 11:00–18:00 · Sunday closed.

═══════════════════════════════════════════════════════════════
## 2. PRICES — T-SHIRTS / ფასები — მაისურები
═══════════════════════════════════════════════════════════════
(Price = front print included. "Two-sided" = front + back, surcharge applies.
These are the live cart prices.)

KA — მაისურები (ცალმხრივი ბეჭდვა შედის ფასში):
- GILDAN (სტანდარტი): 35₾ · ორმხრივი 50₾
- GILDAN KIDS (საბავშვო): 35₾ · ორმხრივი 50₾
- TH: 45₾ · ორმხრივი 60₾
- Polo: 45₾ · ორმხრივი 60₾
- SOL'S: 50₾ · ორმხრივი 65₾
- Khundadze: 55₾ · ორმხრივი 70₾
- GILDAN HUMMER (პრემიუმ მძიმე ნაჭარი): 60₾ · ორმხრივი 75₾
- GIORDANO: 70₾ · ორმხრივი 85₾
- JEL (მოხარშული ნაჭარი): 70₾ · ორმხრივი 85₾
- Oversize: 70₾ · ორმხრივი 85₾
- NIKE: 100₾ · ორმხრივი 115₾

EN — T-shirts (front print included):
- GILDAN (standard): 35₾ · two-sided 50₾
- GILDAN KIDS: 35₾ · two-sided 50₾
- TH: 45₾ · two-sided 60₾
- Polo: 45₾ · two-sided 60₾
- SOL'S: 50₾ · two-sided 65₾
- Khundadze: 55₾ · two-sided 70₾
- GILDAN HUMMER (premium heavy fabric): 60₾ · two-sided 75₾
- GIORDANO: 70₾ · two-sided 85₾
- JEL (washed fabric): 70₾ · two-sided 85₾
- Oversize: 70₾ · two-sided 85₾
- NIKE: 100₾ · two-sided 115₾

═══════════════════════════════════════════════════════════════
## 3. PRICES — HOODIES / ფასები — ჰუდები
═══════════════════════════════════════════════════════════════

KA — ჰუდები (ბეჭდვა შედის):
- GILDAN Bomber: 75₾ · ორმხრივი 90₾
- GILDAN Hoodie: 80₾ · ორმხრივი 95₾
- JEL Standard Hoodie: 85₾ · ორმხრივი 100₾
- Premium Washed Hoodie: 95₾ · ორმხრივი 110₾
- JEL Standard Zipper (ელვიანი): 95₾ · ორმხრივი 110₾
- JEL Zipper (ელვიანი): 105₾ · ორმხრივი 120₾

EN — Hoodies (print included):
- GILDAN Bomber: 75₾ · two-sided 90₾
- GILDAN Hoodie: 80₾ · two-sided 95₾
- JEL Standard Hoodie: 85₾ · two-sided 100₾
- Premium Washed Hoodie: 95₾ · two-sided 110₾
- JEL Standard Zipper: 95₾ · two-sided 110₾
- JEL Zipper: 105₾ · two-sided 120₾

═══════════════════════════════════════════════════════════════
## 4. PRICES — OTHER PRODUCTS / ფასები — სხვა პროდუქცია
═══════════════════════════════════════════════════════════════

KA:
- სპორტული ფორმა (მაისური + შორტი): 65₾ · ორმხრივი 80₾
- ნაჭრის ჩანთა (Tote): 35₾
- წინსაფარი (Apron): 45₾
- ჭიქა (Mug): 25₾
- კეპი (Cap): 25₾
- მობილურის ქეისი (Phone Case): 20₾

EN:
- Sport set (shirt + shorts): 65₾ · two-sided 80₾
- Tote bag: 35₾
- Apron: 45₾
- Mug: 25₾
- Cap: 25₾
- Phone case: 20₾

═══════════════════════════════════════════════════════════════
## 5. ADD-ONS & EXTRAS / დამატებები
═══════════════════════════════════════════════════════════════

KA:
- ორმხრივი ბეჭდვა: +10/15₾ პრინტის ზომის მიხედვით (ზუსტი ფასი ცხრილებშია — §2/§3).
- A4-ზე დიდი პრინტი (მაქს. A3): +10/15₾ ზომის მიხედვით.
- სპორტულ მაისურზე გვარი + ნომერი: 20₾.
- შენი მოტანილი მაისური/ჰუდი (ბეჭდვა): 20₾ (მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ).
- ფასში შედის: ცალმხრივი, დაახლოებით A4 ზომის ბეჭდვა.

EN:
- Two-sided printing: +10/15₾ depending on print size (exact prices in tables §2/§3).
- Print larger than A4 (up to A3): +10/15₾ depending on size.
- Name + number on a sports shirt: 20₾.
- Printing on your own item: 20₾ (we can't take responsibility for items you bring).
- Included in price: single-side print, approximately A4 size.

═══════════════════════════════════════════════════════════════
## 6. DISCOUNTS / ფასდაკლება
═══════════════════════════════════════════════════════════════

KA: 10 ცალიდან ზემოთ ვრცელდება ფასდაკლება. ზუსტი ფასი დამოკიდებულია შეკვეთის დეტალებზე —
დაგვიკავშირდით და შემოგთავაზებთ ინდივიდუალურ ფასს. (კორპორატიული / დიდი შეკვეთა → ინდივიდუალური ფასი.)

EN: Discounts apply from 10 items and up. The exact price depends on order details —
contact us for an individual quote. (Corporate / bulk → individual pricing.)

═══════════════════════════════════════════════════════════════
## 7. PRODUCTION TIME / დამზადების ვადა
═══════════════════════════════════════════════════════════════

KA: ჩვეულებრივ იმავე დღეს ან მაქსიმუმ მეორე დღეს მზადდება. კონკრეტული დღისთვის თუ გჭირდებათ — მოგვწერეთ და დაგეხმარებით.
დიდი შეკვეთა: 21–50ც → 3–4 დღე · 50+ → ინდივიდუალურად.

EN: Usually ready the same day or by the next day at the latest. If you need it by a specific date, message us and we'll help.
Large orders: 21–50 pcs → 3–4 days · 50+ → individually.

═══════════════════════════════════════════════════════════════
## 8. DELIVERY / მიწოდება
═══════════════════════════════════════════════════════════════

KA:
- შოურუმიდან გატანა (თვითგატანა): უფასო — ა. წერეთლის #2, დინამოს არენა, კარი #10.
- კურიერი თბილისში: 8₾.
- კურიერი რეგიონში (თბილისს გარეთ): 12₾.
- მთელ საქართველოში ვაგზავნით, კურიერი კარზე მოგაწვდით.

EN:
- Pickup from showroom: free — A. Tsereteli #2, Dinamo Arena, Gate #10.
- Courier in Tbilisi: 8₾.
- Courier to regions (outside Tbilisi): 12₾.
- We deliver across Georgia; the courier brings it to your door.

═══════════════════════════════════════════════════════════════
## 9. PAYMENT / გადახდა
═══════════════════════════════════════════════════════════════

KA: საბანკო გადარიცხვით, ონლაინ ბარათით (BOG / TBC საიტზე) ან ნაღდი ანგარიშსწორებით.
ძირითადად 100% წინასწარ.

EN: Bank transfer, online card payment (BOG / TBC on the site), or cash. Usually 100% upfront.

═══════════════════════════════════════════════════════════════
## 9b. HOW TO ORDER / შეკვეთის არხები
═══════════════════════════════════════════════════════════════
(When the user asks how/where to order, or you direct them to order, ALWAYS
mention ALL of these channels, not just the site.)

KA: შეკვეთა შესაძლებელია რამდენიმე გზით:
- პირდაპირ საიტიდან: www.maika.ge
- Facebook გვერდზე: facebook.com/maika.ge
- Instagram-ზე: instagram.com/maika.ge_
- WhatsApp-ით: +995 599 05 08 07
- ტელეფონით: +(995 32) 2 05 06 20 · 599 05 08 07
- ან შემოგვიარეთ შოურუმში: ა. წერეთლის #2, დინამოს არენა, კარი #10.

EN: You can order in several ways:
- Directly on the site: www.maika.ge
- On Facebook: facebook.com/maika.ge
- On Instagram: instagram.com/maika.ge_
- Via WhatsApp: +995 599 05 08 07
- By phone: +(995 32) 2 05 06 20 · 599 05 08 07
- Or visit our showroom: A. Tsereteli #2, Dinamo Arena, Gate #10.

═══════════════════════════════════════════════════════════════
## 10. PRODUCTS, BRANDS & SIZES / პროდუქცია, ბრენდები, ზომები
═══════════════════════════════════════════════════════════════

KA:
- ასორტიმენტი: მაისური · პოლო · ჰუდი · წინსაფარი · სპორტული ფორმა · კეპი · ნაჭრის ჩანთა · ჭიქა · მობილურის ქეისი.
- ბრენდები: GILDAN (სტანდარტი), GILDAN HUMMER (პრემიუმ), TH, JEL (მოხარშული), GIORDANO, Khundadze, SOL'S, Oversize, NIKE, Polo, GILDAN KIDS; ჰუდები: GILDAN, JEL, Premium Washed, Bomber, Zipper-ები.
- ბეჭდვა: DTF · ვინილი.
- ზომები: 3 წლის ბავშვიდან 5XL-მდე (ზოგ მოდელში S–XXL). ზუსტი ხელმისაწვდომობა მოდელზეა დამოკიდებული — დაგვიკავშირდით ან შემოგვიარეთ.

EN:
- Range: t-shirt · polo · hoodie · apron · sport set · cap · tote bag · mug · phone case.
- Brands: GILDAN (standard), GILDAN HUMMER (premium), TH, JEL (washed), GIORDANO, Khundadze, SOL'S, Oversize, NIKE, Polo, GILDAN KIDS; hoodies: GILDAN, JEL, Premium Washed, Bomber, Zippers.
- Printing: DTF · vinyl.
- Sizes: from age 3 (kids) up to 5XL (some models S–XXL). Exact availability depends on the model — contact us or visit the showroom.

═══════════════════════════════════════════════════════════════
## 11. PRINT QUALITY & CARE / ბეჭდვის ხარისხი და მოვლა
═══════════════════════════════════════════════════════════════

KA:
Q: რეცხვის შემდეგ პრინტი ხომ არ წავა?
A: არა. ვბეჭდავთ DTF ტექნოლოგიით — ფერი სტაბილურია, ბუნებრივი და ნათელი, პრინტი ქსოვილში
ინტეგრირებული და რეცხვაგამძლეა.

EN:
Q: Will the print fade after washing?
A: No. We print with DTF technology — the color is stable, natural and bright, the print is
integrated into the fabric and wash-resistant.

═══════════════════════════════════════════════════════════════
## 12. AI DESIGN & HOW IT WORKS / AI დიზაინი და როგორ მუშაობს
═══════════════════════════════════════════════════════════════

KA:
- AI დიზაინი: maika.ge-ის საიტზე უფასოდ შეგიძლიათ შექმნათ უნიკალური დიზაინი ხელოვნური
  ინტელექტით — ატვირთეთ ფოტო, დაწერეთ ტექსტი ან აღწერეთ რა გინდათ, AI შეგიქმნით.
  მერე დაბეჭდეთ მაისურზე, ჰუდიზე თუ სხვა ნივთზე.
- ატვირთეთ ფოტო ან ტექსტი და შეუკვეთეთ რეგისტრაციის გარეშე.
- Virtual Try-On: დიზაინი ვირტუალურად მაისურზე ნახეთ შეკვეთამდე.

EN:
- AI design: on maika.ge you can create a unique design with AI for free — upload a photo,
  type text, or describe what you want, and the AI creates it. Then print it on a t-shirt,
  hoodie or other item.
- Upload a photo or text and order without registration.
- Virtual Try-On: preview your design on a shirt before ordering.

═══════════════════════════════════════════════════════════════
## 13. SPORT & CORPORATE / სპორტული და კორპორატიული
═══════════════════════════════════════════════════════════════

KA:
- სპორტულ მაისურზე გვარი + ნომერი: 20₾.
- სპორტული გუნდებისთვის ვკერავთ ინდივიდუალურ (საკუთარი დიზაინის) ფორმებს — დეტალებზე დაგვიკავშირდით.
- ⚠️ მნიშვნელოვანი: ოფიციალურ/ლიცენზირებულ ფორმებს (მაგ. საქართველოს ნაკრები, დინამო თბილისი, ან სხვა კლუბის/ბრენდის ოფიციალური ფორმა) — არ ვამზადებთ და არ გვაქვს, რადგან ამის უფლება არ გვაქვს. თუ მომხმარებელი ასეთ ფორმას ეძებს, უპასუხე: „ოფიციალურ/ლიცენზირებულ ფორმებს (ნაკრები, კლუბები) ვერ ვამზადებთ. ვკერავთ მხოლოდ ინდივიდუალურ ფორმებს საკუთარი დიზაინით — დეტალებისთვის დაგვიკავშირდით." არასოდეს დაადასტურო რომ გვაქვს ნაკრების ან კლუბის ოფიციალური ფორმა.
- კორპორატიული შეკვეთა (ბრენდირებული ფორმები, საჩუქრები): ლოგოს ატვირთვით საიტზე ფორმის შევსება,
  ან დაგვიკავშირდით ინდივიდუალური ფასისთვის. ფასდაკლება 10+ ცალიდან.

EN:
- Name + number on a sports shirt: 20₾.
- For sports teams we sew custom (your-own-design) uniforms — contact us for details.
- ⚠️ Important: we do NOT make and do not have official/licensed kits (e.g. the Georgian national team, Dinamo Tbilisi, or any other club's/brand's official kit) — we are not licensed to. If a customer asks for one, reply: "We can't make official/licensed kits (national team, clubs). We only sew custom uniforms with your own design — contact us for details." Never confirm that we have a national-team or club official kit.
- Corporate orders (branded uniforms, gifts): fill the form on the site with your logo,
  or contact us for an individual quote. Discounts from 10+ items.

═══════════════════════════════════════════════════════════════
## 14. EXTRA PRINTING / დამატებითი ბეჭდვა
═══════════════════════════════════════════════════════════════

KA:
- ქეისზე ბეჭდვა: 20₾ (სასურველი პრინტით).
- ჭიქაზე ბეჭდვა: 25₾.
- ნაჭრის ჩანთაზე ბეჭდვა: 35₾.

EN:
- Phone case printing: 20₾ (with your chosen print).
- Mug printing: 25₾.
- Tote bag printing: 35₾.

═══════════════════════════════════════════════════════════════
# END — დოკუმენტი ცოცხალია; ფასი/ფაქტი შეიცვალა → აქ განაახლე.
═══════════════════════════════════════════════════════════════
`;

/** Extract base64 image from various response formats the gateway might return */
function extractImage(data: any): string | null {
  // Format 1: content array with image_url objects
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "image_url" && part?.image_url?.url) return part.image_url.url;
      if (part?.type === "image" && part?.image_url?.url) return part.image_url.url;
      if (part?.inline_data?.data) {
        const mime = part.inline_data.mime_type || "image/png";
        return `data:${mime};base64,${part.inline_data.data}`;
      }
    }
  }

  // Format 2: separate images array on message
  const images = data?.choices?.[0]?.message?.images;
  if (Array.isArray(images) && images.length > 0) {
    if (images[0]?.image_url?.url) return images[0].image_url.url;
    if (images[0]?.url) return images[0].url;
    if (typeof images[0] === "string") return images[0];
  }

  // Format 3: top-level data array (images/generations style)
  if (Array.isArray(data?.data) && data.data[0]?.url) return data.data[0].url;
  if (Array.isArray(data?.data) && data.data[0]?.b64_json) {
    return `data:image/png;base64,${data.data[0].b64_json}`;
  }

  return null;
}

function getUserError(nativeFinishReason: string | undefined, finishReason: string | undefined): string | null {
  if (nativeFinishReason === "IMAGE_PROHIBITED_CONTENT" || nativeFinishReason === "PROHIBITED_CONTENT") {
    return "The AI could not generate this image due to content policy restrictions. Try modifying your prompt or using different reference images.";
  }
  if (nativeFinishReason === "MAX_TOKENS" || finishReason === "length") {
    return "The image was too complex to generate. Try simplifying your prompt or using smaller reference images.";
  }
  if (nativeFinishReason === "SAFETY" || nativeFinishReason === "BLOCKLIST") {
    return "The request was blocked by safety filters. Please adjust your prompt.";
  }
  if (nativeFinishReason === "RECITATION") {
    return "The AI could not generate an original image for this prompt. Try rephrasing.";
  }
  return null;
}

/** Sanitize youth-related terms to avoid content policy */
function sanitizeCharacter(character: string): string {
  return character.replace(
    /\b(boy|girl|child|kid|teen|teenager|minor|infant|baby|toddler)\b/gi,
    (match) => {
      const map: Record<string, string> = {
        boy: "young adult man", girl: "young adult woman", child: "adult person",
        kid: "adult person", teen: "young adult", teenager: "young adult",
        minor: "adult person", infant: "adult person", baby: "adult person",
        toddler: "adult person",
      };
      return map[match.toLowerCase()] || "adult person";
    }
  );
}

/** Describe print placement position from normalized coords (0–1) */
function describePlacement(x?: number, y?: number, scale?: number): string {
  if (x == null || scale == null) return "centered on the chest";
  const horz = x < 0.38 ? "upper left chest" : x > 0.62 ? "upper right chest" : "center of the chest";
  const size = scale < 0.32 ? "small" : scale > 0.6 ? "large" : "medium-sized";
  return `${size} print on the ${horz}`;
}

function buildGenerateDesignMessages(params: any) {
  const { character, characterImages, scene, sceneImage, style, styleImage, text: rawText, textImage, product, color } = params;
  const text = (rawText || "").trim();
  const safeCharacter = sanitizeCharacter(character || "No character specified");

  const isRealistic = /realistic|photo|\u10e0\u10d4\u10d0\u10da\u10d8\u10e1\u10e2|\u10e4\u10dd\u10e2\u10dd/i.test(style || "");

  const content: any[] = [];

  if (isRealistic) {
    // Realistic mode: hyperrealistic render. Do NOT mention garments/printing —
    // the compositing pipeline handles placing it on the product.
    content.push({
      type: "text",
      text: `⚠️ CRITICAL INSTRUCTION — READ THIS FIRST:
THIS MUST BE A REAL PHOTOGRAPH OR PHOTOREALISTIC IMAGE.
DO NOT generate: illustration, cartoon, anime, drawing, painting, comic book art, cel-shading, vector art, flat design, digital art, graphic design, or ANY form of stylized artwork.
If the output looks like artwork rather than a photograph, it is COMPLETELY WRONG.

---

Generate a photorealistic studio photograph shot with a professional DSLR camera.

SUBJECT: ${safeCharacter}
${scene ? `SETTING/SCENE: ${scene}` : ""}

MANDATORY PHOTOGRAPHIC PROPERTIES:
• Must look IDENTICAL to a photo taken with a Canon 5D Mark IV or Sony A7R — not digital art
• Natural photographic lighting with soft shadows, realistic penumbra, and proper light falloff
• Real surface textures visible: skin pores, individual hair strands, fabric thread weave, material grain
• Natural depth of field — foreground sharp, background may have lens bokeh
• Realistic color temperature (no hyper-saturated cartoon colors)
• Zero black outlines — real objects in photographs never have cartoon outlines
• Three-dimensional volume, weight, and physical presence
• Photographic imperfections: subtle lens vignette, natural grain, real-world light behavior
• Background: pure white studio cyclorama #FFFFFF — ZERO ambient shadow on the backdrop, NO floor shadow under the subject, NO drop shadow, NO penumbra anywhere on the white surface. The subject must cast no shadow onto the background. Use light only from above-front so the backdrop stays uniformly bright pure-white (#FFFFFF) edge-to-edge. The downstream pipeline removes this background by difference matting, which requires the backdrop to be uniformly #FFFFFF — any shadow or off-white tone will leave a visible halo when composited onto a t-shirt.

${text ? `TEXT: Render the text "${text}" as physical text on a real surface (printed, painted, engraved, or signage) — must look photographic` : "• No text, letters, numbers, or written characters anywhere in the image"}

NON-NEGOTIABLE RULES:
• Every element MUST look photographically real — no artistic stylization of any kind
• No Russian language, Cyrillic text, or Russian cultural references
• All persons must be clearly adults (18+)
• ASPECT RATIO: square 1:1 — the subject must be fully framed inside a square composition with even margins on all four sides. Do NOT crop the subject. Do NOT use vertical (portrait) or horizontal (landscape) framing.

OUTPUT: A single square (1:1 aspect ratio) photorealistic image on a solid white studio background #FFFFFF.
The result must be INDISTINGUISHABLE from a real professional photograph.`,
    });
  } else {
    // Illustration / graphic mode
    content.push({
      type: "text",
      text: `You are an expert concept artist. Generate a standalone illustration/artwork on a pure white background.

DESIGN SYSTEM:
- Character/Subject = WHO is in the design
- Scene/Action = The pose, environment, action
- Style = Art direction, visual aesthetic
- Typography = Text to include

⚠️ ABSOLUTE RULES — VIOLATING ANY OF THESE MAKES THE OUTPUT WRONG:
1. DO NOT draw a t-shirt, shirt, hoodie, garment, clothing silhouette, apparel mockup, or any piece of wearable clothing in the image. The output is the ARTWORK ONLY — never a garment containing the artwork.
2. DO NOT draw a rectangular frame, border, box, panel, or any container around the artwork.
3. DO NOT draw a mockup, template, product preview, or any representation of the design being placed on something.
4. Pure white background (#FFFFFF) — absolutely no gradients, shadows, or textures in background.
5. High contrast, bold lines, vibrant colors.
6. ABSOLUTELY NO Russian language, Cyrillic script, Russian words, or Russian cultural references. Use English or other non-Russian languages only.
7. ALL characters must be depicted as ADULTS (18+). Never depict minors or children.
8. ASPECT RATIO: square 1:1 — compose the artwork to fit a square frame with even spacing on all sides. Do NOT use portrait or landscape framing. The subject must fit fully inside the square.

CHARACTER/SUBJECT: ${safeCharacter}
${scene ? `SCENE/ACTION: ${scene}` : ""}
${style ? `ARTISTIC STYLE: ${style}` : ""}
${text ? `TYPOGRAPHY: Include the exact text "${text}" — legibility is priority, make it stylish and integrated` : "DO NOT include any text, words, letters, numbers, or typography of any kind in the design. The design must be purely visual/illustrative with absolutely no written elements."}

OUTPUT: A single standalone illustration with square (1:1) aspect ratio on a solid pure white (#FFFFFF) background. NO garments, NO t-shirt shapes, NO frames, NO borders, NO mockups — just the raw artwork floating on white.`,
    });
  }

  if (characterImages?.length) {
    content.push({ type: "text", text: "Character reference images:" });
    for (const img of characterImages) {
      content.push({ type: "image_url", image_url: { url: img } });
    }
  }
  if (sceneImage) {
    content.push({ type: "text", text: "Scene reference:" });
    content.push({ type: "image_url", image_url: { url: sceneImage } });
  }
  if (styleImage) {
    content.push({ type: "text", text: "Style reference:" });
    content.push({ type: "image_url", image_url: { url: styleImage } });
  }
  if (textImage) {
    content.push({ type: "text", text: "Typography/font reference:" });
    content.push({ type: "image_url", image_url: { url: textImage } });
  }

  return [{ role: "user", content }];
}

async function callGateway(model: string, messages: any[], attempt: number, action: string): Promise<Response> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const needsImage = !TEXT_ACTIONS.has(action);

  console.log(`[gemini-proxy] Gateway call: model=${model}, attempt=${attempt + 1}, modalities=${needsImage ? "image+text" : "text"}`);

  const body: any = { model, messages };
  if (needsImage) {
    body.modalities = ["image", "text"];
  }

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return response;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params } = await req.json();
    console.log(`[gemini-proxy] Action: ${action}`);

    // Resolved caller id for the faq-chat conversation log (null for anon).
    // Captured in the faq-chat gate below; used at the success path.
    let faqChatUserId: string | null = null;

    // --- Rate limiting (billable actions only) ---
    // Keyed on user_id for authed callers, IP for anon. Admins (trusted batch
    // generation) are exempt. Enforced BEFORE any gateway call so blocked
    // requests cost nothing. verify_jwt stays false — anon Studio must work.
    if (BILLABLE_ACTIONS.has(action)) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });

      // null/err for anon (no user JWT); a real user object when logged in.
      const { data: { user } } = await client.auth.getUser();

      // Admins bypass the limit entirely (mirrors check-design-quality's
      // has_role gate). On any rpc error, treat as non-admin (still limited).
      let isAdmin = false;
      if (user) {
        const { data: adminFlag } = await client.rpc("has_role", {
          _user_id: user.id,
          _role: "admin",
        });
        isAdmin = adminFlag === true;
      }

      if (!isAdmin) {
        // Block check for a logged-in REAL (non-anonymous) caller, on EVERY
        // billable action, before any gateway call (so a blocked request costs
        // nothing). The RPC blocks when profiles.is_blocked (manual admin block
        // — applies to ALL billable actions) OR, for generate-design only, the
        // >15-generations-and-no-paid-order anti-abuse rule. Anonymous sessions
        // and admins are unaffected. Fails open on RPC error.
        if (user && user.is_anonymous !== true) {
          const { data: blocked, error: blockErr } = await client.rpc(
            "check_generation_block",
            { p_user_id: user.id, p_action: action },
          );
          if (blockErr) {
            // Fail open: never block real users on an infra hiccup.
            console.error("[gemini-proxy] generation-block check failed — failing open:", blockErr);
          } else if (blocked === true) {
            console.log(`[gemini-proxy] blocked: user ${user.id} action ${action}`);
            return new Response(
              JSON.stringify({
                error: "უფასო გენერაციების ლიმიტი ამოიწურა. გასაგრძელებლად გააფორმე შეკვეთა ან დაგვიკავშირდი. (You've reached the free generation limit. Place an order to continue, or contact us.)",
                code: "GENERATION_BLOCKED",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        const requiresLogin = !user;
        let key: string;
        if (user) {
          key = `gen:user:${user.id}`;
        } else {
          const ip = req.headers.get("cf-connecting-ip")
            ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? "unknown";
          key = `gen:ip:${ip}`;
        }
        const hourLimit = user ? 30 : 10;
        const dayLimit = user ? 100 : 30;

        const { data: allowed, error: rlError } = await client.rpc(
          "check_and_increment_rate_limit",
          { p_key: key, p_hour_limit: hourLimit, p_day_limit: dayLimit },
        );

        if (rlError) {
          // Fail open: never block real users on an infra hiccup.
          console.error("[gemini-proxy] rate-limit check failed — failing open:", rlError);
        } else if (allowed === false) {
          console.log(`[gemini-proxy] rate limit reached for ${key}`);
          return new Response(
            JSON.stringify({
              error: requiresLogin
                ? "უფასო გენერაციის ლიმიტი ამოიწურა — გასაგრძელებლად გაიარეთ ავტორიზაცია. (Free generation limit reached — sign in to continue.)"
                : "გენერაციის ლიმიტი ამოიწურა — სცადეთ მოგვიანებით. (Generation limit reached — please try again later.)",
              code: "RATE_LIMITED",
              requiresLogin,
            }),
            {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" },
            },
          );
        }
      }
    }

    // --- Rate limiting (faq-chat) — SEPARATE from BILLABLE_ACTIONS so the text
    // chatbot NEVER consumes the image-generation quota. Own `faq:` key
    // namespace + tighter limits (anon 10/hr 30/day, authed 30/hr 100/day).
    // Manual admin block (is_blocked) applies; the >15-image rule does NOT
    // (check_generation_block only enforces that for action 'generate-design').
    // Admins are exempt. Fails open on RPC error.
    if (action === "faq-chat") {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });

      const { data: { user } } = await client.auth.getUser();
      faqChatUserId = user?.id ?? null;

      let isAdmin = false;
      if (user) {
        const { data: adminFlag } = await client.rpc("has_role", {
          _user_id: user.id,
          _role: "admin",
        });
        isAdmin = adminFlag === true;
      }

      if (!isAdmin) {
        // Manual admin block only: p_action != 'generate-design', so
        // check_generation_block returns true ONLY when profiles.is_blocked.
        if (user && user.is_anonymous !== true) {
          const { data: blocked, error: blockErr } = await client.rpc(
            "check_generation_block",
            { p_user_id: user.id, p_action: action },
          );
          if (blockErr) {
            console.error("[gemini-proxy] faq-chat block check failed — failing open:", blockErr);
          } else if (blocked === true) {
            console.log(`[gemini-proxy] faq-chat blocked: user ${user.id}`);
            return new Response(
              JSON.stringify({
                error: "ანგარიში დაბლოკილია — დაგვიკავშირდით. (Your account is blocked — please contact us.)",
                code: "GENERATION_BLOCKED",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        let key: string;
        if (user) {
          key = `faq:user:${user.id}`;
        } else {
          const ip = req.headers.get("cf-connecting-ip")
            ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? "unknown";
          key = `faq:ip:${ip}`;
        }
        const hourLimit = user ? 30 : 10;
        const dayLimit = user ? 100 : 30;

        const { data: allowed, error: rlError } = await client.rpc(
          "check_and_increment_rate_limit",
          { p_key: key, p_hour_limit: hourLimit, p_day_limit: dayLimit },
        );

        if (rlError) {
          console.error("[gemini-proxy] faq-chat rate-limit check failed — failing open:", rlError);
        } else if (allowed === false) {
          console.log(`[gemini-proxy] faq-chat rate limit reached for ${key}`);
          return new Response(
            JSON.stringify({
              error: "ბევრი შეტყობინება — სცადეთ მოგვიანებით. (Too many messages — please try again later.)",
              code: "RATE_LIMITED",
            }),
            {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" },
            },
          );
        }
      }
    }

    let model: string;
    let messages: any[];

    if (action === "generate-design") {
      const speed = params.speed || "fast";
      // Accept explicit flag from client (no regex needed); fallback to regex for safety
      const isRealisticMode = params.isRealistic === true ||
        /realistic|photo|\u10e0\u10d4\u10d0\u10da\u10d8\u10e1\u10e2|\u10e4\u10dd\u10e2\u10dd/i.test(params.style || "");
      // Realistic mode always uses the pro model — Flash is heavily biased toward illustrations
      model = (speed === "fast" && !isRealisticMode) ? "google/gemini-2.5-flash-image" : "google/gemini-3-pro-image-preview";
      console.log(`[gemini-proxy] generate-design: style="${params.style}" isRealistic=${isRealisticMode} model=${model}`);
      messages = buildGenerateDesignMessages(params);

    } else if (action === "convert-bg-black") {
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Change the background of this image from WHITE to PURE BLACK (#000000). Keep the subject/design EXACTLY identical — same colors, same details, same position. Only the white background should become pure black. Do not alter the subject in any way.

CRITICAL: Output must be pixel-identical to the input except for the background color. Do NOT redraw, re-light, or re-shade the subject. Do NOT change subject colors, contours, shadows, highlights, or details. Do NOT regenerate the photograph — this is a background-swap operation, not a re-shoot. Only replace the white background pixels with #000000. The subject and its silhouette must remain exactly as in the input — every subject pixel must match the input pixel for pixel. The downstream pipeline performs difference matting between the input and your output; subject pixels that differ across the two will produce a translucent halo on the final image.`,
          },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "upscale") {
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Upscale this image to 4K resolution (4096x4096). Keep exact same details, colors, composition. Just increase resolution with enhanced detail.",
          },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "isolate-subject") {
      // A2 (photo background removal): isolate the main subject of an arbitrary
      // UPLOADED photo onto a solid GREEN CHROMA-KEY background. The client then
      // chroma-keys the green to transparent (src/lib/chromaKey.ts). Photos must
      // NOT go through the design-oriented convert-bg-black + difference-matting
      // path (runTransparencyPipeline): on a photograph convert-bg-black returns
      // a silhouette/mask, which matting collapses into a binary mask. Green
      // keys far more reliably than white (which punches holes in white/skin/
      // highlight regions), so we ask for a green screen and key it client-side.
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Isolate the MAIN SUBJECT (the primary foreground person, animal, or object) from this photo and place it on a SOLID BRIGHT GREEN CHROMA-KEY background (pure green screen, #00FF00). Completely remove the original background and everything that is not the main subject — no scenery, no environment, no other objects.

CRITICAL:
- Keep the main subject EXACTLY as it is: same shape, colors, textures, photographic detail, proportions and pose. Do NOT redraw, restyle, re-light, silhouette, or regenerate the subject — this is a background-replacement/segmentation operation, NOT a re-shoot and NOT a mask. Preserve every photographic detail and the original colors of the real subject. Do NOT output a flat solid silhouette or a black/white mask.
- The new background must be uniformly PURE BRIGHT GREEN #00FF00, edge to edge, with NO shadow, gradient, texture, reflection, or any other color anywhere. The subject must cast NO shadow onto the green backdrop. (A downstream chroma-key removes exactly this green, so any non-green background pixel stays visible.)
- Do NOT let the green spill onto or tint the subject — keep the subject's original colors with clean edges.
- Keep the subject fully inside the frame, roughly centered, at a similar scale to the input.

Output: a single photographic image of the isolated main subject (full detail, original colors) on a pure solid bright green (#00FF00) chroma-key background.`,
          },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "restyle") {
      // Phase B (photo restyle): re-render an UPLOADED photo in an artistic
      // style/medium chosen by the user (preset chip or free text). Mirrors
      // isolate-subject's single-image + instruction shape. The preset list
      // lives in the frontend; the client passes the chosen style as a
      // free-text params.instruction. A fixed server-side GUARD keeps every
      // request subject-preserving (identity/pose/composition unchanged) even
      // for free-text input.
      const GUARD =
        "This is an artistic style transfer, not a re-shoot. Preserve the " +
        "subject's identity, pose, count, framing and composition exactly; " +
        "change ONLY the artistic medium/style; do not add text, watermarks " +
        "or new objects.";
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          { type: "text", text: `${GUARD} ${params.instruction}` },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "edit-image") {
      // Chat image editing: apply a free-text edit instruction to an UPLOADED
      // image. Same { image, instruction } shape as restyle, but the GUARD
      // allows general instruction-following edits (add/remove/modify objects,
      // change background/colors), unlike restyle's style-transfer-only guard.
      // restyle stays byte-identical — new behavior gets its own branch.
      const GUARD =
        "Edit this image following the user's instruction. This is an EDIT, " +
        "not a re-generation: apply ONLY the requested change and keep " +
        "everything the instruction does not ask to change — subject " +
        "identity, pose, colors, composition, background, lighting — exactly " +
        "as in the input. Never add text, watermarks, signatures or logos " +
        "unless the instruction explicitly asks for them. Never produce " +
        "sexual, violent or otherwise unsafe content, and never turn the " +
        "subject into a recognizable copyrighted or trademarked character. " +
        "If the instruction is unclear, apply the most reasonable " +
        "interpretation. Instruction:";
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          { type: "text", text: `${GUARD} ${params.instruction}` },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "randomize-prompt") {
      model = "google/gemini-3-flash-preview";
      messages = [{
        role: "user",
        content: `You are a creative director for a streetwear merch brand. Generate a random, creative, unique design concept for a ${params.product || "hoodie"}.

Return ONLY a JSON object with these fields (no markdown, no explanation):
{
  "character": "A vivid character description (1-2 sentences)",
  "scene": "A scene/action/pose description (1 sentence)",
  "style": "An artistic style direction (1 sentence)",
  "text": "Optional catchy text/slogan to include (or empty string)"
}

Be wildly creative. Mix unexpected aesthetics: cyberpunk samurai, cosmic barista, underwater DJ, retro-futuristic gardener, etc. Make each concept unique and memorable.`,
      }];

    } else if (action === "virtual-tryon") {
      model = "google/gemini-2.5-flash-image";
      const placementDesc = describePlacement(params.placementX, params.placementY, params.placementScale);
      const tryOnText = params.useMockupStyle
        ? `You are a photorealistic fashion compositor. Create a virtual try-on image.

The second image shows the EXACT garment the person should wear — including its COLOR (this is the most important attribute), texture, fabric (e.g. acid-washed, vintage-washed, distressed) and the printed design on the chest.

INSTRUCTIONS:
1. Keep the person (face, hair, body, pose, background) EXACTLY as in the first photo — do not alter anything
2. Replace the person's top clothing with the garment from the second image, preserving its EXACT color (if the garment in the second image is black, the result MUST be black; if white, MUST be white; etc.), texture, fabric style, and chest print
3. Do NOT change the garment colour under any circumstance — colour is mandatory
4. Lighting, fabric folds and shadows should look natural and photorealistic

Output: one photorealistic composite photo.`
        : `You are a photorealistic fashion compositor. Create a virtual try-on image.

GARMENT SPECIFICATIONS:
- Type: ${params.productName || "t-shirt"}
- Color: ${params.colorName || "white"}
- Print/design: the artwork shown in the second image, placed as a ${placementDesc}

INSTRUCTIONS:
1. Keep the person (face, hair, body, pose, background) EXACTLY as in the first photo — do not alter anything about the person or setting
2. Replace the person's top clothing with a ${params.colorName || "white"} ${params.productName || "t-shirt"}
3. Print the design from the second image onto the garment as a ${placementDesc} — respect the exact placement position
4. The ${params.productName || "t-shirt"} color MUST be ${params.colorName || "white"} — this is mandatory
5. Lighting and fabric folds should look natural and photorealistic

Output: one photorealistic composite photo.`;
      messages = [{
        role: "user",
        content: [
          { type: "text", text: tryOnText },
          { type: "image_url", image_url: { url: params.personImage } },
          { type: "image_url", image_url: { url: params.designImage } },
        ],
      }];

    } else if (action === "faq-chat") {
      // FAQ chatbot (text). SYSTEM = FAQ_KB (the knowledge base + behavior
      // rules); the client sends the conversation in params.messages. The model
      // replies in the user's language per §0 of the KB.
      //
      // SANITIZE (prompt-injection guard): accept ONLY user/assistant turns
      // from the client — any client-supplied `system` role is dropped, so the
      // server-side system prompt can't be overridden. Keep the last 8 turns
      // and cap each to ~1000 chars (cost / abuse bound).
      //
      // TODO: switch model to "google/gemini-2.5-flash-lite" once confirmed
      // enabled on the Lovable AI gateway. Until then use the proven text model
      // (the same one randomize-prompt already uses successfully).
      model = "google/gemini-3-flash-preview";
      const incoming = Array.isArray(params.messages) ? params.messages : [];
      const history = incoming
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
      messages = [{ role: "system", content: FAQ_KB }, ...history];

    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retry logic — one retry for image actions (4xx is never retried).
    // Text actions (randomize-prompt, faq-chat) run a single attempt.
    const maxAttempts = TEXT_ACTIONS.has(action) ? 1 : 2;
    let lastError = "";

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await callGateway(model, messages, attempt, action);

        if (!response.ok) {
          const status = response.status;
          const text = await response.text();
          console.error(`[gemini-proxy] Gateway HTTP ${status} (attempt ${attempt + 1}):`, text.slice(0, 300));

          if (status === 429) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (status === 402) {
            return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }), {
              status: 402,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Other 4xx are request/client errors — retrying won't help. Fail fast.
          if (status >= 400 && status < 500) {
            return new Response(JSON.stringify({ error: "AI generation failed. Please try again." }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          lastError = `Gateway returned ${status}`;
          if (attempt < maxAttempts - 1) {
            console.log(`[gemini-proxy] Retrying in ${(attempt + 1) * 2}s...`);
            await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }

          return new Response(JSON.stringify({ error: "AI generation failed. Please try again." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await response.json();
        const nativeFinishReason = data.choices?.[0]?.native_finish_reason;
        const finishReason = data.choices?.[0]?.finish_reason;
        const textContent = typeof data.choices?.[0]?.message?.content === "string"
          ? data.choices[0].message.content
          : "";

        // Text actions (randomize-prompt, faq-chat): return text, no image.
        if (TEXT_ACTIONS.has(action)) {
          console.log(`[gemini-proxy] ${action} success (text)`);

          // Persist the faq-chat turn (latest user message + assistant reply)
          // via the SERVICE ROLE so it bypasses chat_logs' deny-all RLS.
          // Awaited so it actually lands before the isolate is reclaimed, but
          // wrapped so a log failure NEVER breaks or changes the chat response.
          // Only faq-chat logs — randomize-prompt is untouched.
          if (action === "faq-chat") {
            try {
              const sessionId = typeof params.session_id === "string" ? params.session_id : null;
              const logLang = typeof params.lang === "string" ? params.lang : null;
              const srUrl = Deno.env.get("SUPABASE_URL");
              const srKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
              const msgs = Array.isArray(params.messages) ? params.messages : [];
              const lastUser = [...msgs].reverse().find(
                (m) => m && m.role === "user" && typeof m.content === "string",
              );
              if (sessionId && srUrl && srKey) {
                const rows: Record<string, unknown>[] = [];
                if (lastUser) {
                  rows.push({ session_id: sessionId, user_id: faqChatUserId, role: "user", content: String(lastUser.content).slice(0, 4000), lang: logLang });
                }
                if (textContent) {
                  rows.push({ session_id: sessionId, user_id: faqChatUserId, role: "assistant", content: String(textContent).slice(0, 8000), lang: logLang });
                }
                if (rows.length) {
                  const logClient = createClient(srUrl, srKey);
                  const { error: logErr } = await logClient.from("chat_logs").insert(rows);
                  if (logErr) console.error("[gemini-proxy] chat_logs insert failed:", logErr.message);
                }
              }
            } catch (e) {
              console.error("[gemini-proxy] chat log error (ignored):", e);
            }
          }

          return new Response(JSON.stringify({ image: null, text: textContent }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Extract image from response
        const imageData = extractImage(data);
        console.log(`[gemini-proxy] attempt=${attempt + 1} hasImage=${!!imageData} finishReason=${finishReason} native=${nativeFinishReason}`);

        if (!imageData) {
          const userError = getUserError(nativeFinishReason, finishReason);
          if (userError) {
            console.error(`[gemini-proxy] Blocked: ${nativeFinishReason}`);
            return new Response(JSON.stringify({ error: userError, text: textContent }), {
              status: 422,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const responseKeys = JSON.stringify({
            hasChoices: !!data.choices,
            messageKeys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [],
            contentType: typeof data.choices?.[0]?.message?.content,
            contentIsArray: Array.isArray(data.choices?.[0]?.message?.content),
            finishReason,
            nativeFinishReason,
          });
          console.error(`[gemini-proxy] No image extracted (attempt ${attempt + 1}). Structure: ${responseKeys}`);

          lastError = "No image in response";
          if (attempt < maxAttempts - 1) {
            console.log(`[gemini-proxy] Retrying in ${(attempt + 1) * 2}s...`);
            await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }

          return new Response(JSON.stringify({ error: "AI did not return an image after multiple attempts. Please try again.", text: textContent }), {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Success
        console.log(`[gemini-proxy] Success: action=${action}, attempt=${attempt + 1}`);
        return new Response(JSON.stringify({ image: imageData, text: textContent }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      } catch (attemptErr) {
        lastError = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
        console.error(`[gemini-proxy] Attempt ${attempt + 1} exception:`, lastError);
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ error: `AI generation failed: ${lastError}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[gemini-proxy] Fatal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
