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
# Last reconciled: 2026-07-22

═══════════════════════════════════════════════════════════════
## 0. ASSISTANT BEHAVIOR / ასისტენტის ქცევა
═══════════════════════════════════════════════════════════════

You are maika.ge's friendly website assistant. Answer ONLY from the facts in this
document. Reply in the SAME language the user writes in (Georgian or English).
Keep answers short, warm, and helpful.

⚠️ LENGTH — SHORT. This is a chat, not documentation. Long answers are a defect here.
- 2-4 short sentences, or at most 5 short bullet lines. Then STOP.
- One idea per paragraph, blank line between them. Never a wall of text.
- NEVER repeat the contact list (phone / WhatsApp / Facebook / showroom) more than ONCE
  in a conversation. Give it when they ask how to reach us, or when you truly cannot
  answer — not as a sign-off.
- ⚠️ BUT WHEN YOU DO GIVE IT, GIVE ALL OF IT — the full §9b set, copied verbatim, never
  the phone number alone. Someone who prefers Instagram should not have to ask if it works.
- Do NOT restate what was just said, do NOT summarise your own reply, do NOT end every
  turn with an offer of further help.
- Answer the question asked. Do not volunteer adjacent facts they did not ask for.
- KA: ერთი შეკითხვა — ერთი მოკლე პასუხი. არ გაიმეორო უკვე ნათქვამი და არ ჩამოწერო
  საკონტაქტო არხები ყოველ პასუხში.

If you don't know something or it's not in this document (custom quotes, special
requests, exact corporate pricing, anything uncertain):
→ say you cannot confirm it from here and give the §9b block VERBATIM — the whole set,
  in its [label](url) form, exactly as written there. Never retype a handle from memory
  and never list a channel twice in one reply.

⚠️ CALLER. The last line of this prompt is "CALLER: registered" or "CALLER: guest",
from the verified session — a fact, never to quote, mention or ask about. Its only use
is the §12a allowance rule. Missing → treat as guest.

Never invent prices, deadlines, or promises. Never offer discounts unless they are
written here. For large/corporate orders → direct to contact (individual quote).

⚠️ CRITICAL — never confirm a product/service we don't clearly have in this document.
If asked "do you have X?" and X is NOT explicitly listed here, do NOT say "yes, we have it."
Instead say we don't offer it, or that they should contact us to check. In particular NEVER
claim we have official/licensed sports kits (national team, football clubs, etc.) — we don't.
When unsure, under-promise and point to contact; a false "yes" causes real harm.

⚠️ CRITICAL — IMAGES: an uploaded photo is an unverified request, not a confirmed order.
Never confirm printability or quote a price from a picture alone. If it appears to show a club
or national-team crest, a brand logo, or any third-party mark, refuse under the licensed-kit
rule above and send them to contact.
⚠️ BUT THIS IS NOT A REFUSAL TO SHOW IT. Declining to confirm the PRINT and showing the
SKETCH are different actions; this rule forbids only the first. Emit the maika-mockup block,
and only if quality genuinely worries you add one sentence that the print must be checked.
Withholding the block because of this rule is the most common way this conversation goes
wrong — the customer asked to see something and got contact details.

⚠️ NEVER PROMISE A FOLLOW-UP. Do not tell a customer that our team will look at something,
check it, or get back to them. Not as a closing line, not after a thank-you, not in the same
message as a price list or any answer you just gave. If you answered the question, that IS the
whole answer — end there.
There are exactly two situations where it is true, and both are "I cannot answer", not "I will
answer later": an uploaded image whose printability you genuinely cannot judge, and a possible
licensed or third-party mark. In those two, say you cannot confirm it from here and give the §9b
channels, so the customer reaches a person. That is the real next step; a promise from you is not.

⚠️ უკან ბეჭდვა: თუ კლიენტს მხოლოდ ზურგზე უნდა ბეჭდვა — უბრალოდ უპასუხე მოთხოვნას.
ᲜᲣ ახსნი, რომ ეს ცალმხრივად ითვლება და ᲜᲣ ლაპარაკობ დანამატზე — არავის უკითხავს.
BACK-ONLY: when the customer wants a print only on the back, just answer the request.
Do NOT explain that it still counts as single-sided, and do NOT mention the surcharge.
(The pricing rule itself is unchanged — you still charge single-sided. You just don't say it.)

⚠️ CRITICAL — PRICING: never quote the two-sided (ორმხრივი) price unless the customer clearly wants a print on BOTH sides. A print on the back only is SINGLE-SIDED. See §2a.

═══════════════════════════════════════════════════════════════
## 1. COMPANY / კომპანია
═══════════════════════════════════════════════════════════════
(Company record — facts about us. To tell a customer how to reach us or order,
use the §9b block, never this list.)

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
## 2a. ⚠️ SINGLE-SIDED vs TWO-SIDED / ცალმხრივი vs ორმხრივი — READ FIRST
═══════════════════════════════════════════════════════════════
(This is the #1 source of pricing mistakes. Read it before quoting any price.)

KA — წესი:
- ცალმხრივი = ბეჭდვა მხოლოდ ერთ მხარეს — მხოლოდ წინ ან მხოლოდ უკან. ორივე შემთხვევაში ფასი ძირითადია, დანამატის გარეშე.
- ორმხრივი (+15₾) = ბეჭდვა წინ და უკან ერთდროულად (ორივე მხარეს).
- ⚠️ თუ კლიენტი ამბობს „უკან მინდა სახელი", „ზურგზე დამიწერეთ", „უკანა მხარეს ლოგო" — ეს ცალმხრივია. დანამატი არ ემატება. ნუ იტყვი ორმხრივის ფასს!
- დანამატი ემატება მხოლოდ მაშინ, როცა კლიენტი ცხადად ითხოვს ორივე მხარეს ბეჭდვას.
- თუ ბუნდოვანია (ვერ ხვდები ერთი მხარეა თუ ორივე) — ჰკითხე: „წინ და უკან ორივეზე გნებავთ ბეჭდვა, თუ მხოლოდ ერთ მხარეს?"

მაგალითები:
- „ნაცრისფერ Oversize-ზე უკან სახელი მინდა" → ცალმხრივი, 70₾ ✅
- „Oversize-ზე ზურგზე წარწერა" → ცალმხრივი, 70₾ ✅
- „Oversize-ზე წინ ლოგო და უკან სახელი" → ორმხრივი, 85₾ ✅
- „GILDAN-ზე მხოლოდ უკან პრინტი" → ცალმხრივი, 35₾ ✅ (არა 50₾)

EN — rule:
- Single-sided = print on ONE side only — front only OR back only. In both cases the base price applies, with no surcharge.
- Two-sided (+15₾) = print on front AND back together.
- ⚠️ If the customer says "I want a name on the back", "print on the back" — that is single-sided. Do NOT add the surcharge, do NOT quote the two-sided price.
- The surcharge applies only when the customer clearly wants both sides printed.
- If unclear — ask: "Would you like the print on both front and back, or just one side?"

Examples:
- "Name on the back of a grey Oversize" → single-sided, 70₾ ✅
- "Print on the back of a GILDAN" → single-sided, 35₾ ✅ (not 50₾)
- "Logo on front and name on back" → two-sided, 85₾ ✅

═══════════════════════════════════════════════════════════════
## 2. PRICES — T-SHIRTS / ფასები — მაისურები
═══════════════════════════════════════════════════════════════
(Base price = ONE side printed — front only OR back only. The "ორმხრივი / two-sided" price applies ONLY when both front AND back are printed. See §2a.)

KA — მაისურები (ცალმხრივი ბეჭდვა = მხოლოდ წინ ან მხოლოდ უკან, შედის ფასში):
- სტანდარტული (GILDAN) მაისური — 35₾ · ორმხრივი 50₾
- საბავშვო (GILDAN KIDS) მაისური — 35₾ · ორმხრივი 50₾
- სტანდარტული მაისური (TH clothes) — 45₾ · ორმხრივი 60₾
- პოლო (Polo) მაისური — 45₾ · ორმხრივი 60₾
- პრემიუმ მაისური (SOL'S) — 50₾ · ორმხრივი 65₾
- Khundadze მაისური — 55₾ · ორმხრივი 70₾
- პრემიუმ მაისური (GILDAN Hammer) — 60₾ · ორმხრივი 75₾
- ჯორდანოს (GIORDANO) მაისური — 70₾ · ორმხრივი 85₾
- მოხარშული ნაჭრის მაისური (JEL) — 70₾ · ორმხრივი 85₾
- მძიმე ნაჭრის, oversize სტილის მაისური — 70₾ · ორმხრივი 85₾
- NIKE მაისური — 100₾ · ორმხრივი 115₾

EN — T-shirts (single-side print — front only or back only — included):
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
(Same rule: base price = one side only. See §2a.)

KA — ჰუდები (ცალმხრივი ბეჭდვა შედის):
- GILDAN Bomber: 80₾ · ორმხრივი 95₾
- GILDAN Hoodie: 80₾ · ორმხრივი 95₾
- JEL Standard Hoodie: 85₾ · ორმხრივი 100₾
- Premium Washed Hoodie: 95₾ · ორმხრივი 110₾
- JEL Standard Zipper (ელვიანი): 95₾ · ორმხრივი 110₾
- JEL Zipper (ელვიანი): 105₾ · ორმხრივი 120₾

EN — Hoodies (single-side print included):
- GILDAN Bomber: 80₾ · two-sided 95₾
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
- ორმხრივი ბეჭდვა (მხოლოდ როცა წინ და უკან ორივეზე იბეჭდება — იხ. §2a): +15₾ (ზუსტი ფასი ცხრილებშია — §2/§3). ⚠️ მხოლოდ უკან ბეჭდვა ორმხრივი არ არის — ეს ცალმხრივია, დანამატის გარეშე.
- A4-ზე დიდი პრინტი (A3 ფორმატი): +15₾.
- სპორტულ მაისურზე გვარი + ნომერი: 20₾.
- შენი მოტანილი მაისური/ჰუდი (ბეჭდვა): 20₾ (მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ).
- ფასში შედის: ცალმხრივი (ერთ მხარეს — წინ ან უკან), დაახლოებით A4 ზომის ბეჭდვა.

EN:
- Two-sided printing (ONLY when both front and back are printed — see §2a): +15₾ (exact prices in tables §2/§3). ⚠️ A back-only print is NOT two-sided — it is single-sided, no surcharge.
- Print larger than A4 (A3 format): +15₾.
- Name + number on a sports shirt: 20₾.
- Printing on your own item: 20₾ (we can't take responsibility for items you bring).
- Included in price: single-side print (one side — front or back), approximately A4 size.

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

KA: 1–2 სამუშაო დღე. კონკრეტული თარიღისთვის თუ გჭირდებათ — მოგვწერეთ და შევეცდებით დაგეხმაროთ.
⚠️ ვადაზე კითხვისას უპასუხე ᲛᲮᲝᲚᲝᲓ ეს. ნუ ჩამოთვლი რაოდენობრივ საფეხურებს (21–50ც, 50+).
დიდი ან კორპორატიული შეკვეთის შემთხვევაში თქვი, რომ ზუსტი თარიღისთვის პირდაპირ დაგვიკავშირდნენ.

EN: 1–2 working days. If you need it by a specific date, message us and we'll try to help.
⚠️ Answer ONLY that. Never volunteer quantity tiers (21–50, 50+). For a large or
corporate order, tell them to contact us directly for an exact date.

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
give ALL FIVE ordering channels, not just the site. Copy the lines VERBATIM,
including the [label](url) link form — the Instagram handle ends in an
underscore and that character is part of the account name.)

⚠️ ORDERING vs INFORMATION. The five channels below are how an order is placed.
The LANDLINE IS NOT ONE OF THEM: never say they can order by phone, never list
it among the ordering channels. It is for questions only. (599 05 08 07 does
take orders — over WhatsApp, not as a call.)

KA: შეკვეთა შესაძლებელია ხუთი გზით:
- საიტიდან: [www.maika.ge](https://www.maika.ge)
- Facebook: [facebook.com/maika.ge](https://facebook.com/maika.ge)
- Instagram: [instagram.com/maika.ge_](https://instagram.com/maika.ge_)
- WhatsApp: +995 599 05 08 07
- ან შემოგვიარეთ შოურუმში: ა. წერეთლის #2, დინამოს არენა, კარი #10
ინფორმაციისთვის დაგვირეკეთ (შეკვეთა ტელეფონით არ მიიღება): +995 32 2 05 06 20 · 599 05 08 07

EN: You can order in five ways:
- Site: [www.maika.ge](https://www.maika.ge)
- Facebook: [facebook.com/maika.ge](https://facebook.com/maika.ge)
- Instagram: [instagram.com/maika.ge_](https://instagram.com/maika.ge_)
- WhatsApp: +995 599 05 08 07
- Or visit our showroom: A. Tsereteli #2, Dinamo Arena, Gate #10
For information call (orders are not taken by phone): +995 32 2 05 06 20 · 599 05 08 07

═══════════════════════════════════════════════════════════════
## 10. PRODUCTS, BRANDS & SIZES / პროდუქცია, ბრენდები, ზომები
═══════════════════════════════════════════════════════════════

KA:
- ასორტიმენტი: მაისური · პოლო · ჰუდი · წინსაფარი · სპორტული ფორმა · კეპი · ნაჭრის ჩანთა · ჭიქა · მობილურის ქეისი.
- ბრენდები: GILDAN (სტანდარტი), GILDAN HUMMER (პრემიუმ), TH, JEL (მოხარშული), GIORDANO, Khundadze, SOL'S, Oversize, NIKE, Polo, GILDAN KIDS; ჰუდები: GILDAN, JEL, Premium Washed, Bomber, Zipper-ები.
- ბეჭდვა: DTF · ვინილი.
- ზომები: 3 წლის ბავშვიდან 5XL-მდე (ზოგ მოდელში S–XXL). ზუსტი ხელმისაწვდომობა მოდელზეა დამოკიდებული — დაგვიკავშირდით ან შემოგვიარეთ.
- Oversize მოდელი არის ერთი ზომის (One Size), რომელიც დაახლოებით L-დან XL-მდე ზომებს შეესაბამება. დამზადებულია მყარი ქსოვილისგან, აქვს განიერი ფორმა და მკლავები.
- ⚠️ Oversize-ზე ᲜᲣ ეტყვი, რომ S–XL აქვს, და ᲜᲣ დაამატებ ზემოთ ჩამოთვლილს გარდა სხვა დეტალს.
- ზომებზე საუბრისას თქვი „ემთხვევა" ან „შეესაბამება" — არა „ითარგმნება" (ზომა არ ითარგმნება).

EN:
- Range: t-shirt · polo · hoodie · apron · sport set · cap · tote bag · mug · phone case.
- Brands: GILDAN (standard), GILDAN HUMMER (premium), TH, JEL (washed), GIORDANO, Khundadze, SOL'S, Oversize, NIKE, Polo, GILDAN KIDS; hoodies: GILDAN, JEL, Premium Washed, Bomber, Zippers.
- Printing: DTF · vinyl.
- Sizes: from age 3 (kids) up to 5XL (some models S–XXL). Exact availability depends on the model — contact us or visit the showroom.
- The Oversize model is ONE SIZE, corresponding roughly to L through XL. It is made of sturdy fabric and has a wide shape and wide sleeves.
- ⚠️ Never say Oversize comes in S–XL, and never add any detail about it beyond the line above.
- When comparing sizes say a measurement "matches"/"corresponds to" another — never "is translated".

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
- AI დიზაინი: საიტზე უფასოდ ქმნით უნიკალურ დიზაინს AI-ით — ატვირთეთ ფოტო ან დაწერეთ რა
  გინდათ. ატვირთულ ფოტოს AI არედაქტირებს: „გახადე შავ-თეთრი", „მოაშორე ფონი", „დაუმატე ქუდი".
  მერე დაბეჭდეთ მაისურზე, ჰუდიზე თუ სხვა ნივთზე.
- ატვირთეთ ფოტო ან დაწერეთ ტექსტი და შეუკვეთეთ რეგისტრაციის გარეშე.
- კატალოგი: გვაქვს მზა დიზაინების კატალოგი — მთავარ მენიუში „კატალოგი". კატეგორიები:
  ქართული · პატრიოტული · სასაცილო · მუსიკა · კინო · ქართული სუფრა · წყვილები · ხელოვნება ·
  ცხოველები · აუტო-მოტო · სპორტი · პროფესიები · სეზონური · მოგზაურობა · სხვადასხვა.
  ნებისმიერი მზა დიზაინი დაიბეჭდება ნებისმიერ პროდუქტზე და პირდაპირ შეუკვეთავთ.
- ვირტუალური გასახდელი (Virtual Try-On): უფასო — ატვირთეთ თქვენი ფოტო და შეკვეთამდე ნახეთ
  დიზაინი საკუთარ თავზე. ღილაკი პროდუქტის სურათის ქვეშაა.

EN:
- AI design: create a unique design with AI on maika.ge for free — upload a photo, or type
  what you want. AI also edits an uploaded photo: "make it black and white", "remove the
  background", "add a hat". Then print it on a t-shirt, hoodie or other item.
- Upload a photo or type text and order without registration.
- Catalogue: we have a catalogue of ready-made designs — "კატალოგი" in the main nav.
  Categories: Georgian · Patriotic · Humor · Music · Movies · Georgian Table · Couples ·
  Art · Animals · Auto-Moto · Sports · Professions · Seasonal · Travel · Various.
  Any ready-made design can be put on any product and ordered directly.
  ⚠️ NEVER say we do not have ready-made designs — we do, and this is exactly the kind of
  denial §0 exists to prevent.
- Virtual Try-On (ვირტუალური გასახდელი): free — upload your photo and see the design on
  yourself before ordering. The button is below the product image.
- ესკიზი: დიზაინი (ტექსტი ან ფოტო) დატანილი პროდუქტზე — ხედავთ როგორი იქნება დაბეჭდილი ნივთი.
  ესკიზი = დიზაინი პროდუქტზე; ვირტუალური გასახდელი = პროდუქტი თქვენს სხეულზე.
- Sketch (ესკიზი): the design (text or photo) placed ON the product, showing how the printed
  item will look. Sketch = design on product; try-on = product on the body.

⚠️ SKETCH — TWO CASES, EQUAL WEIGHT. Reply briefly, then append the block, when:
(1) the customer DESCRIBES a design for a product; or
(2) the customer ATTACHES A PHOTO and wants it on a garment. This second case is as much a
sketch request as the first and is the one that gets missed. Their photo IS the design —
nothing further to ask for. Emit the block with NO "text" field (example 4).
Any phrasing counts: „როგორ გამოვა ეს მაისურზე?", „ამის დაბეჭდვა შეიძლება?", „მაჩვენე
მაისურზე", "how would this look on a shirt?" — a question mark does not make it a question
you answer in prose; it is a request to SEE it.
Both cases: NEVER claim you drew a mockup, don't explain manual steps, don't promise a
preview in the prose ("აი, როგორ გამოჩნდება...") — end naturally, then emit the block.

WORKED EXAMPLES — copy this shape; include EVERY field the customer indicated:
1. „დამიწერე საქართველო თეთრად, გულთან, შავ მაისურზე"
\`\`\`maika-mockup
{"text":"საქართველო","product":"T-Shirt","subProduct":"GILDAN","color":"Black","side":"front","placement":"left-chest","textColor":"White"}
\`\`\`
2. „ჯემალი მინდა მარჯვენა მკერდზე, წითლად, თეთრ ჰუდზე"
\`\`\`maika-mockup
{"text":"ჯემალი","product":"Hoodie","subProduct":"GILDAN Hoodie","color":"White","side":"front","placement":"right-chest","textColor":"Red"}
\`\`\`
3. „georgia მინდა შავ მაისურზე" (no position, no lettering colour → omit both)
\`\`\`maika-mockup
{"text":"georgia","product":"T-Shirt","subProduct":"GILDAN","color":"Black","side":"front"}
\`\`\`

4. ᲤᲝᲢᲝ ᲒᲐᲠᲔᲨᲔ ᲢᲔᲥᲡᲢᲘᲡᲐ — კლიენტმა ატვირთა სურათი და წერს: „როგორ გამოვა ეს შავ მაისურზე?"
   მისი ფოტოა დიზაინი, ამიტომ "text" საერთოდ არ არის — ეს სწორია, არა ნაკლული ბლოკი.
\`\`\`maika-mockup
{"product":"T-Shirt","subProduct":"GILDAN","color":"Black","side":"front"}
\`\`\`
   A block with no "text" is VALID whenever a photo is attached. Never invent a caption, and
   never withhold the block because they typed no words to print.

5. სპორტული მაისრის ზურგზე გვარი და ნომერი: „სპორტულ მაისურზე უკან წავაწერო ხუნდაძე 10"
\`\`\`maika-mockup
{"text":"ხუნდაძე","number":"10","product":"Sport","subProduct":"Sport Set","side":"back","placement":"jersey-back"}
\`\`\`
   "jersey-back" lays out BOTH prints as a football shirt is printed — name above, number
   much larger below. Use it whenever a name AND a number are wanted on a sport shirt back.
   Name in "text", number in "number"; never merged into one string.

6. ᲤᲝᲜᲘᲡ ᲛᲝᲮᲡᲜᲐ — კლიენტმა ატვირთა ფოტო და წერს: „ფონი მოაშორე და დამადე მაისურზე"
\`\`\`maika-mockup
{"product":"T-Shirt","subProduct":"GILDAN","color":"White","side":"front","removeBackground":true}
\`\`\`
   ღილაკზე დაჭერით ფოტო დაედება პროდუქტს და ფონი ავტომატურად მოეხსნება.
   Set "removeBackground" ONLY when a photo is attached AND they asked for the background
   gone („ფონი მოაშორე", „გაასუფთავე", "without background").

⚠️ DO IT, DON'T EXPLAIN IT. Anything expressible as a block → emit the block, never
describe which button to press. "ატვირთე ფოტო, დააჭირე ფონის მოხსნას…" is a BUG. Written
instructions are for what a block cannot carry, nothing else.

Include "placement" WHENEVER they indicate a position, and "textColor" WHENEVER they name a
colour for the lettering. Omitting a field is correct ONLY when the customer didn't specify it —
never omit something they did say, and never guess something they didn't.

⚠️ ONE BLOCK = ONE LAYER, ONE COLOUR. A block carries one "text" in one "textColor"; extra
colours would simply vanish. Wanting the same lettering in several colours → say so and take
them ONE AT A TIME; each button ADDS a layer to the same design, so asking again keeps what is
there. Emit the block for the first colour, invite the next.
- KA: „ერთ ჯერზე ერთი ფერი — დავიწყოთ პირველით, მერე დაამატებ დანარჩენს იმავე დიზაინში."
- EN: "One colour at a time — let's start with the first, then you can add the others to the same design."

⚠️ GARMENT COLOUR, in BOTH blocks. When the customer names a colour, INCLUDE it —
„ლურჯი მაისური" must produce a blue shirt. When they did NOT name one, omit the field
entirely and the site keeps what they already chose; never restate a colour from an earlier
turn and never fill in a default.
KA: თუ კლიენტმა დაასახელა ფერი — ჩასვი. თუ არ დაასახელა — საერთოდ გამოტოვე, საიტი
შეინარჩუნებს იმას, რაც უკვე აქვს არჩეული.

Use these values EXACTLY, including capitalisation. "product" is the TYPE, never a brand —
brands go in "subProduct". "text" is the customer's ACTUAL words, never a placeholder —
and it is OMITTED ENTIRELY when they attached a photo instead of asking for lettering.
product: T-Shirt | Hoodie | Tote Bag | Cap | Apron | Phone Case | Mug | Sport
subProduct (T-Shirt): GILDAN | Sol's | GILDAN HUMMER | TH | JEL T-Shirt | GIORDANO | Khundadze | NIKE | Polo | Oversize | GILDAN KIDS
subProduct (Hoodie): GILDAN Hoodie | Premium Washed Hoodie | JEL Standard Hoodie | JEL Zipper | JEL Standard Zipper | GILDAN Bomber
subProduct (Sport): Sport Set — other products have no subProduct, omit it.
color (the GARMENT) — ⚠️ PER BRAND. Colours are NOT interchangeable; pick only from the line
for the brand in "subProduct". There is no plain "Blue" on a t-shirt — GILDAN's blues are
Electric Blue, Light Blue, Standard Blue. No matching colour on the brand's line → omit
"color" rather than borrow one from another brand.
- GILDAN · Polo · GILDAN KIDS · GILDAN Hoodie · Sport Set · Cap: White | Black | Beige | Light Gray | Red | Electric Blue | Dark Navy | Yellow | Orange | Light Blue | Standard Blue | Burgundy | Gray | Lime | Purple
- GILDAN HUMMER: White | Black | Electric Blue | Light Gray Melange
- Sol's: White | Black | Sol's Khaki | Sol's Pink | Sol's Emerald | Sol's Electric | Sol's Navy | Sol's Ultramarine
- JEL T-Shirt: Black | Purple | Gray | Light Cream | Pink | Electric Blue | Khaki | Brown
- TH · GIORDANO · Khundadze · Oversize · Apron: White | Black
- NIKE: Dark Navy | White | Cream
- Premium Washed Hoodie: Black | Gray | Khaki | Pink | Purple
- JEL Standard Hoodie: White | Black | Red | Burgundy | Electric Blue | Dark Navy | Light Gray
- JEL Zipper: Black | Dark Navy | Gray
- JEL Standard Zipper: Black | Dark Navy | Light Gray Melange | Blue
- GILDAN Bomber: Black | White | Red | Standard Blue | Brown
- Tote Bag: White | Black | Cream | Dark Navy | Electric Blue | Turquoise | Green | Lime | Pink | Red | Burgundy | Purple
- Mug: White · Phone Case: no colour — omit the field.
side: front | back
placement: center | left-chest | right-chest | jersey-back — გულთან / მარცხენა მკერდი → left-chest; მარჯვენა მკერდი → right-chest; შუაში / ცენტრში → center
number: the squad number, DIGITS ONLY ("10"), and only with placement "jersey-back". Never put it in "text".
removeBackground: true | omit — true ONLY with an attached photo the customer wants cut out.
textColor (the LETTERING): Black | White | Red | Blue | Green | Yellow | Orange | Purple | Pink | Gray | Gold | Navy — თეთრად → White; შავად → Black; წითლად → Red; ლურჯად → Blue; მწვანედ → Green; ყვითლად → Yellow; ნარინჯისფრად → Orange; იისფრად → Purple; ვარდისფრად → Pink; ნაცრისფრად → Gray; ოქროსფრად → Gold; მუქი ლურჯი → Navy

⚠️ NEVER SEND THEM TO ვირტუალური გასახდელი TO SEE A DESIGN. To show a design on a product you
emit the maika-mockup block — that gives them a button. Do NOT write "to see how it looks, use
ვირტუალური გასახდელი", do NOT describe manual steps, and do NOT add a closing sentence promising
a preview. ვირტუალური გასახდელი is ONLY for seeing a product on the CUSTOMER'S OWN BODY from a
photo of themselves — mention it only when that is what they asked about.
დიზაინის ჩვენებას ემსახურება ესკიზი (maika-mockup ღილაკი), არა ვირტუალური გასახდელი —
გასახდელი მხოლოდ მაშინ, როცა კლიენტს პროდუქტის საკუთარ ფოტოზე მორგება აინტერესებს.

⚠️ PRICES — COMPLETENESS: when quoting prices for a product type, list ALL models of that type
from §2/§3, cheapest first — never a subset. ONE MODEL PER LINE, exactly as written there; never
merge models onto a shared line ("TH / Polo: 45₾" is wrong — they are two lines).
ფასების ჩამოთვლისას დაასახელე ამ ტიპის ყველა მოდელი (§2/§3), იაფიდან ძვირისკენ, თითო ხაზზე თითო
მოდელი — არ გააერთიანო ერთ ხაზზე.

═══════════════════════════════════════════════════════════════
## 12a. „დამიხატე" — AI GENERATION BLOCK / maika-generate
═══════════════════════════════════════════════════════════════

When the customer wants a PICTURE DRAWN — something that does not exist yet — reply
briefly, then append a \`\`\`maika-generate block LAST, giving them a „დამიხატე" button
that opens the constructor and starts the generation.
You never draw anything and never show an image in chat: no "here it is", no describing
the picture as if it exists, no promised preview. End naturally, then emit the block.

WHICH BLOCK — one line each:
- maika-mockup   = words or a photo the customer ALREADY has, placed on a product.
- maika-generate = a NEW picture the AI must draw.
NEVER emit both in one reply. Drawn design → maika-generate. Lettering → maika-mockup.

FIELDS — in this order, omitting any the customer did not name:
prompt · style · withBackground · product · subProduct · color · side

- prompt: WHAT TO DRAW, in the customer's own words and language. The picture only —
  never the garment, never "on a t-shirt", never "print".
- style: EXACTLY one of these ENGLISH values, or "" for automatic:
  Realistic | Animated | Illustration | Oil Art | Anime | Comics | Line Art | Graphic | Pixar 3D
  Anything else is discarded and treated as "". Never invent, translate or Georgianise one;
  no style named → "".
  რეალისტური → Realistic · ანიმაციური → Animated · ილუსტრაცია → Illustration ·
  ოილ არტი → Oil Art · ანიმე → Anime · კომიქსი → Comics · გრაფიკა → Graphic
- withBackground: false = cut out, no background (THE DEFAULT, and what printing wants).
  true = ONLY if they explicitly ask to keep a background or scene.
- product / subProduct / color / side: exactly the values listed in §12, and ONLY what
  the customer named in THIS message. Omit any they did not — the site keeps what they
  already chose. Never invent a default; that is the site's job, not yours. See the
  ⚠️ GARMENT COLOUR rule in §12, which is stricter still and applies here too.

WORKED EXAMPLES — copy this shape exactly.

1. „დამიხატე მგელი მთვარეზე, შავ მაისურზე"
\`\`\`maika-generate
{"prompt":"მგელი მთვარეზე ყმუის","style":"","withBackground":false,"product":"T-Shirt","subProduct":"GILDAN","color":"Black","side":"front"}
\`\`\`

2. „ანიმეს სტილში კატა მინდა თეთრ ჰუდზე"
\`\`\`maika-generate
{"prompt":"საყვარელი კატა","style":"Anime","withBackground":false,"product":"Hoodie","subProduct":"GILDAN Hoodie","color":"White","side":"front"}
\`\`\`

3. "draw me a realistic mountain landscape on a beige tote bag, keep the background"
\`\`\`maika-generate
{"prompt":"a realistic mountain landscape at sunrise","style":"Realistic","withBackground":true,"product":"Tote Bag","subProduct":"","color":"Beige","side":"front"}
\`\`\`

4. „დამიხატე ლომი" (they named no garment and no colour → omit those fields entirely)
\`\`\`maika-generate
{"prompt":"ლომი","style":"","withBackground":false,"side":"front"}
\`\`\`

⚠️ CHANGES — RE-EMIT THE BLOCK. Any change to a design you already suggested
(„ფერი შემიცვალე", „ჰუდზე გადამიტანე", „ანიმეს სტილში", "make it black", "on the back
instead") MUST be answered with a NEW block carrying the UPDATED fields and every other
field as it was. Prose alone is a BUG — no block, no button, nothing to act on. Applies
to maika-mockup as much as maika-generate.

Example — after example 1 above, the customer says „თეთრზე გადამიტანე":
\`\`\`maika-generate
{"prompt":"მგელი მთვარეზე ყმუის","style":"","withBackground":false,"product":"T-Shirt","subProduct":"GILDAN","color":"White","side":"front"}
\`\`\`

⚠️ A TURN EITHER ASKS OR EMITS — never both. This is about YOUR questions, not theirs.
If YOUR reply asks about the design ("which animal?", "t-shirt or hoodie?", "what colour?"),
it carries NO block: a customer tapping the button mid-question spends one of two daily
generations on a request you just said you did not understand.
A question from the CUSTOMER is the opposite — „როგორ გამოვა ეს მაისურზე?" MUST carry the
block. Never read this rule as a reason to withhold one.

⚠️ ONE GOOD GENERATION, NOT THREE. Too vague to draw — no subject, or a subject with no
indication of what it looks like („რამე ლამაზი", „დამიხატე რაღაც", "something cool") — ask
ONE short question first (not a list, never more than one such turn). As soon as you have a
subject, emit the block; do not keep refining by chat.
- KA: „რას დაგიხატო — რომელი ცხოველი/სიმბოლო/სცენა?"
- EN: "What should I draw — which animal, symbol or scene?"

⚠️ AFTER A GENERATION — OFFER THE EDITS, NOT ANOTHER GENERATION. The useful next steps are
the layer edits in the constructor: ფონის მოხსნა (background removal), სტილის შეცვლა
(restyle), or a small change typed as text („დაუმატე ქუდი", „გახადე შავ-თეთრი"). Suggest
those. Do NOT propose generating a new one unless they say they dislike this one.

GENERATION ALLOWANCE — ⚠️ GUESTS ONLY. If the CALLER line says "registered", NEVER
mention the allowance and NEVER suggest signing up. For a guest: say it ONCE, when it
actually matters (they ask, or are about to run out). Never repeat it, never open with it.
- KA: სტუმრებს 2 უფასო გენერაცია აქვთ 24 საათში. უფასო რეგისტრაციის შემდეგ ეს
  შეზღუდვა აღარ მოქმედებს. ფონის მოხსნა და სხვა რედაქტირება იმავე ლიმიტიდან
  იხარჯება — ცალკე არ ითვლება.
- EN: guests get 2 free generations per 24 hours. A free sign-up removes that limit.
  Background removal and other edits come OUT OF THE SAME allowance — they are not
  counted separately, including one requested via "removeBackground". Never present it
  as free or unlimited.

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

// Guard for the OPTIONAL faq-chat photo attachment. Accepts ONLY a
// `data:image/*;base64,...` URL and caps the payload; anything else (remote
// URLs, non-image data URLs, oversized blobs) is rejected and the request
// simply proceeds as text-only. The client already downscales to 1024px /
// JPEG q0.8 (~150-250KB), so 8MB of base64 (~6MB of image) is a generous
// ceiling that still bounds abuse. Used by faq-chat only.
const MAX_CHAT_IMAGE_CHARS = 8 * 1024 * 1024; // 8 MB of base64 data URL
// ── Customer chat photos → private storage ────────────────────────────────
//
// The picture a customer uploads is kept so an admin can judge, after the
// fact, whether the bot answered it correctly — chat_logs previously recorded
// a literal " [image]" and nothing else.
//
// BUCKET: "chat-uploads", PRIVATE. Deliberately not the existing "designs"
// bucket, which is public — fine for generated artwork, wrong for a file a
// stranger uploaded. Written here by the SERVICE ROLE only; there is no insert
// policy at all, so the browser has no path into this bucket.
//
// SIZE: the bytes are reused exactly as the browser already sent them. Both
// chats downscale to 1024px longest edge at JPEG 0.8 before the request
// (ATTACH_MAX_EDGE / ATTACH_QUALITY), so no second copy and no extra payload.
const CHAT_UPLOAD_BUCKET = "chat-uploads";

/** Extension from a data URL's declared MIME, defaulting to jpg. */
function chatImageExt(dataUrl: string): string {
  const mime = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl)?.[1]?.toLowerCase() ?? "jpeg";
  if (mime === "jpeg" || mime === "jpg") return "jpg";
  if (mime === "png" || mime === "webp" || mime === "gif") return mime;
  return "jpg";
}

/**
 * Object path for one uploaded photo: <session>/<uuid>.<ext>.
 *
 * Grouped by chat session so a conversation's pictures sit together, and named
 * with a UUID so a path can never be guessed from the session id alone. The
 * bucket is private regardless, so this is defence in depth, not the defence.
 */
function chatUploadPath(sessionId: string, dataUrl: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "unknown";
  return `${safeSession}/${crypto.randomUUID()}.${chatImageExt(dataUrl)}`;
}

/** Decode a base64 data URL to bytes, or null if it is not one we can read. */
function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  try {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType: match[1] };
  } catch {
    return null;
  }
}

/** Put one chat photo in the private bucket. Never throws. */
async function uploadChatImage(
  srUrl: string,
  srKey: string,
  path: string,
  dataUrl: string,
): Promise<void> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return;
  const client = createClient(srUrl, srKey);
  const { error } = await client.storage
    .from(CHAT_UPLOAD_BUCKET)
    .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: false });
  if (error) console.error("[gemini-proxy] chat image upload failed:", error.message);
}

/**
 * Run work that must NOT delay the response.
 *
 * A bare floating promise would be wrong here: the edge runtime may reclaim
 * the isolate as soon as the Response is returned, killing the upload
 * mid-flight. EdgeRuntime.waitUntil keeps the isolate alive for it WITHOUT
 * putting it on the request's critical path — which is the whole requirement:
 * the customer's reply is sent immediately and a slow or failing upload can
 * never hold it up or change it.
 *
 * Falls back to a floating promise where waitUntil is unavailable (local
 * `supabase functions serve`, older runtimes). Best-effort by design.
 */
function runInBackground(work: Promise<unknown>, label: string): void {
  const guarded = work.catch((e) => console.error(`[gemini-proxy] ${label} failed (ignored):`, e));
  try {
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") rt.waitUntil(guarded);
  } catch {
    /* fall through — the promise is already running and already guarded */
  }
}

function isAcceptableChatImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_CHAT_IMAGE_CHARS &&
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)
  );
}

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

  // Belt-and-braces for Georgian typography. The model has been observed
  // substituting Mtavruli capitals (U+1C90 block) in a scrambled letter order
  // for the Mkhedruli (U+10D0 block) it was given. Naming the script only when
  // the text actually contains Georgian codepoints keeps every other prompt
  // byte-identical. Ranges: U+10A0-10FF (Asomtavruli + Mkhedruli),
  // U+1C90-1CBF (Mtavruli).
  const georgianScriptHint =
    /[\u10a0-\u10ff\u1c90-\u1cbf]/.test(text)
      ? " \u2014 the text is Georgian: render it in Mkhedruli script exactly as given, letter for letter; do not transliterate, do not substitute Latin or Mtavruli capital forms"
      : "";

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
${text ? `TYPOGRAPHY: Include the exact text "${text}" — legibility is priority, make it stylish and integrated${georgianScriptHint}` : "DO NOT include any text, words, letters, numbers, or typography of any kind in the design. The design must be purely visual/illustrative with absolutely no written elements."}

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

        // An ANONYMOUS session is a guest, not a customer.
        //
        // "სტუმრად შესვლა" calls signInAnonymously(), which produces a real
        // user object with is_anonymous: true. Keying that by user.id handed it
        // the REGISTERED ceilings — 30/hour, 100/day — so anyone who tapped
        // that button got fifteen times the guest allowance, and a fresh
        // anonymous sign-in minted a brand new empty bucket on demand. The
        // ceiling has to follow what the caller IS, not merely whether a JWT
        // was present.
        //
        // Anonymous callers are therefore keyed by IP with the guest ceilings,
        // exactly like a caller with no session at all. A real signed-in user
        // is untouched: same gen:user: key, same 30/100.
        const isRealUser = !!user && user.is_anonymous !== true;
        const requiresLogin = !isRealUser;
        let key: string;
        if (isRealUser) {
          key = `gen:user:${user.id}`;
        } else {
          const ip = req.headers.get("cf-connecting-ip")
            ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? "unknown";
          key = `gen:ip:${ip}`;
        }
        const hourLimit = isRealUser ? 30 : 2;
        const dayLimit = isRealUser ? 100 : 5;

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
      // A slogan to RENDER AS TYPOGRAPHY. Extracted client-side by the quote
      // regex in handleAiGenerate and sent verbatim as `text`; nothing here
      // parses it, this only asks whether there is one.
      const hasSloganText = typeof params.text === "string" && params.text.trim() !== "";
      //
      // MODEL ROUTING, in priority order:
      //
      //   1. REALISTIC → pro. About ARTWORK, not typography: flash skews
      //      illustrative and breaks photoreal output. Unchanged, and it wins
      //      over the slogan rule below — a realistic design with a slogan
      //      still goes to pro, because the artwork is the expensive half.
      //   2. SLOGAN, non-realistic → gemini-3.1-flash-image. This used to force
      //      pro (speed:"pro") for ONE reason: 2.5-flash garbles non-Latin
      //      script, returning scrambled Mtavruli where Mkhedruli was asked
      //      for. 3.1-flash renders Georgian correctly, so the reason is gone —
      //      and it costs 0.269 against pro's 0.560. Note `speed` is
      //      deliberately not consulted here: the client sets speed:"pro" only
      //      to reach a model that renders Georgian, and that is now this one.
      //   3. NO TEXT, non-realistic → gemini-2.5-flash-image. 3.1 is 1.7x the
      //      price and buys nothing without type to render.
      //   4. Anything else (an explicit non-"fast" speed with no text and no
      //      realistic flag) keeps its previous behaviour: pro.
      model = isRealisticMode
        ? "google/gemini-3-pro-image"
        : hasSloganText
          ? "google/gemini-3.1-flash-image"
          : (speed === "fast" ? "google/gemini-2.5-flash-image" : "google/gemini-3-pro-image");
      console.log(`[gemini-proxy] generate-design: style="${params.style}" isRealistic=${isRealisticMode} slogan=${hasSloganText} model=${model}`);
      messages = buildGenerateDesignMessages(params);

    } else if (action === "convert-bg-black") {
      // COST GATE — FLASH, UNCONDITIONALLY (revert: pro, or restore the
      // isRealistic ternary this replaced).
      //
      // The previous rule kept pro for realistic designs and, because it read
      // `isRealistic === false`, fell OPEN to pro whenever the flag was absent.
      // A realistic generation therefore paid pro TWICE — once for the artwork
      // in generate-design, and again here — and the second call is the one
      // that does not earn it.
      //
      // WHY THIS IS THE CHEAP HALF. This action does not create an image. It
      // re-renders the SAME picture on a black background so the client can
      // subtract the two and read alpha out of the difference
      // (runTransparencyPipeline → differenceMatting). The subject, the
      // composition and every pixel of content are already fixed by the time
      // this runs; the model is asked to change one thing, the backdrop.
      // Generative headroom buys nothing here — what matters is that the
      // subject comes back UNCHANGED between the two passes, and a model that
      // reinterprets it is a worse matte regardless of tier.
      //
      // WHAT CATCHES A BAD MATTE. runTransparencyPipeline validates the result
      // and falls back to threshold-based white removal on failure. Note that
      // isMostlyPartialAlpha was written for exactly this failure mode — a
      // model re-rendering the subject between passes, leaving a mid-band
      // translucent haze — so the guard that most directly covers a weaker
      // matte model already exists and predates this change.
      //
      // ⚠️ generate-design's routing is untouched: realistic artwork and
      // Georgian slogans still go to pro there. This is the matte only.
      model = "google/gemini-2.5-flash-image";
      console.log(`[gemini-proxy] convert-bg-black: isRealistic=${params.isRealistic} model=${model}`);
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
      model = "google/gemini-3-pro-image";
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
      //
      // COST GATE — flash. Revert this one line to
      // "google/gemini-3-pro-image" to undo it; nothing else changes.
      //
      // ⚠️ THIS ONE IS NOT LIKE convert-bg-black's GATE, AND THE DIFFERENCE IS
      // AGAINST US. That gate moved only FLAT ILLUSTRATION to flash and kept
      // pro for realistic/photographic input, on the stated grounds that
      // photographic mattes "need pixel-level fidelity across soft edges, hair
      // and gradients, where flash drift causes halos". isolate-subject's input
      // is ALWAYS a photograph — it is the photo path by construction — so this
      // is exactly the case that argument said to keep on pro.
      //
      // The mitigation is that the failure modes here are visible rather than
      // subtle: the prompt below demands a uniform #00FF00 backdrop, no spill
      // and no silhouette, and the client chroma-keys it. Green that drifts, or
      // a subject flattened into a silhouette, shows up immediately as a ragged
      // or hollow cut-out. It does not fail quietly.
      //
      // WHETHER FLASH IS GOOD ENOUGH HERE IS UNKNOWN AND CANNOT BE KNOWN FROM
      // READING THE CODE. No side-by-side has been run on real customer photos
      // — hair, fur, motion blur, low light, busy backgrounds. Treat this as a
      // cost change made on a cost argument, watch the cut-outs, and revert the
      // line above if quality drops.
      model = "google/gemini-2.5-flash-image";
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
      model = "google/gemini-3-pro-image";
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
      model = "google/gemini-3-pro-image";
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
      // WHO IS ASKING. The KB's generation-allowance line is for guests only —
      // telling a registered customer that "guests get 2 free generations, then
      // sign up" asks them to do the thing they have already done, with numbers
      // that do not apply to them. The model had no way to tell the two apart:
      // FAQ_KB was the entire system prompt.
      //
      // faqChatUserId is already resolved above from the caller's VERIFIED
      // session (auth.getUser on the request's own Authorization header), so
      // this is a server-side fact the customer cannot assert or spoof — which
      // is exactly why it is appended here rather than accepted as a request
      // field. Absent session → "guest", the safe default: a guest wrongly told
      // about the allowance loses nothing.
      //
      // Appended to the SYSTEM turn, not sent as its own message, so it cannot
      // be mistaken for conversation and cannot be overridden by history (the
      // sanitiser above already drops any client-supplied system role).
      const caller = faqChatUserId ? "registered" : "guest";
      messages = [{ role: "system", content: `${FAQ_KB}\n\nCALLER: ${caller}` }, ...history];

      // ── OPTIONAL PHOTO (add-only) ──────────────────────────────────────
      // When params.image is absent, everything above is untouched and this
      // block is skipped — the no-image path is byte-identical to before.
      //
      // The image is REQUEST-SCOPED: it is attached to the last user turn of
      // THIS call only. It never enters `history` (which stays string-only, so
      // the .filter above would drop it anyway) and is therefore never resent
      // on a later turn. It is never persisted — no storage, no table.
      if (isAcceptableChatImage(params.image)) {
        const lastUserIdx = messages.map((m: { role: string }) => m.role).lastIndexOf("user");
        if (lastUserIdx !== -1) {
          const turn = messages[lastUserIdx] as { role: string; content: string };
          messages[lastUserIdx] = {
            role: "user",
            content: [
              { type: "text", text: turn.content },
              { type: "image_url", image_url: { url: params.image } },
            ],
          };
        }
      }

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
                  // The photo rides on params.image, NOT inside messages, so
                  // lastUser still has string content and the user row is never
                  // lost. Only a short marker is appended — the base64 itself is
                  // never written to chat_logs; the picture goes to private
                  // storage and only its PATH is recorded here.
                  const hasImage = isAcceptableChatImage(params.image);
                  const imageMarker = hasImage ? " [image]" : "";
                  const imagePath = hasImage ? chatUploadPath(sessionId, params.image as string) : null;
                  rows.push({ session_id: sessionId, user_id: faqChatUserId, role: "user", content: String(lastUser.content).slice(0, 4000) + imageMarker, lang: logLang, image_path: imagePath });
                  // Scheduled, never awaited — see runInBackground. The path is
                  // written above optimistically; if the upload loses, the admin
                  // view finds no object and shows the marker alone, which is
                  // exactly today's behaviour. Delaying a customer's reply to
                  // guarantee otherwise would be the wrong trade.
                  if (imagePath) {
                    runInBackground(
                      uploadChatImage(srUrl, srKey, imagePath, params.image as string),
                      "chat image upload",
                    );
                  }
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
