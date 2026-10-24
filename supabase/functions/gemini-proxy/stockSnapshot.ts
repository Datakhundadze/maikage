// Live stock for the faq-chat bot (2026-10-24, add-only).
// Source: David's warehouse / POS app "maikasales" (separate Supabase project),
// table product_variants (product_id, color, size, stock_qty). Read with that
// project's PUBLISHABLE (anon) key — the same key its own frontend ships — and
// only the four columns above; nothing is ever written there.
//
// The bot never sees quantities: each size is listed plainly (3+ pieces) or
// with "*" (1–2 pieces, "last pieces"); 0 / negative stock is left out.
// Any failure (network, timeout, bad payload) yields "" and the bot falls back
// to the KB's normal "cannot confirm stock from the chat" rule.

// Master switch for customers (on since 2026-10-24). When false, the block is
// only built for an admin eval call that passes params.stock === true.
export const STOCK_LIVE = true;

const MAIKASALES_URL = "https://coqorrfbmnsknmlwnico.supabase.co";
const MAIKASALES_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvcW9ycmZibW5za25tbHduaWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NTI0NDUsImV4cCI6MjA5NzQyODQ0NX0.sUWa5NbV1ts_gO7Dd7j7SrrRwEOedTsH6r3rF9e-GvU";

export interface StockRow { product_id: string; color: string | null; size: string | null; stock_qty: number }

// Site model (as the KB names it) → warehouse product ids. "kids" picks the
// warehouse sizes prefixed "ბავშვის " (kids GILDAN shares product 14).
const MODELS: { label: string; ids: string[]; kids?: boolean; oneSize?: boolean }[] = [
  { label: "GILDAN მაისური (სტანდარტული)", ids: ["14"] },
  { label: "საბავშვო GILDAN მაისური", ids: ["14"], kids: true },
  { label: "TH მაისური", ids: ["5"] },
  { label: "პოლო", ids: ["16"] },
  { label: "SOL'S მაისური", ids: ["25"] },
  { label: "Khundadze მაისური", ids: ["17"] },
  { label: "GILDAN HUMMER მაისური", ids: ["9"] },
  { label: "GIORDANO მაისური", ids: ["15"] },
  { label: "JEL მოხარშული მაისური", ids: ["26"] },
  { label: "Oversize მაისური (ერთი ზომა)", ids: ["8"], oneSize: true },
  { label: "NIKE მაისური", ids: ["18"] },
  { label: "გრძელმკლავიანი მაისური", ids: ["11", "22"] },
  { label: "გრძელმკლავიანი პოლო", ids: ["34"] },
  { label: "GILDAN Bomber", ids: ["7"] },
  { label: "GILDAN Hoodie", ids: ["2"] },
  { label: "JEL Standard Hoodie", ids: ["1"] },
  { label: "Premium Washed Hoodie (მოხარშული)", ids: ["3"] },
  { label: "JEL Standard Zipper (ელვიანი)", ids: ["6"] },
  { label: "JEL Zipper (მოხარშული ელვიანი)", ids: ["4"] },
  { label: "კეპი", ids: ["10"], oneSize: true },
  { label: "ნაჭრის ჩანთა", ids: ["12"], oneSize: true },
  { label: "წინსაფარი", ids: ["23"], oneSize: true },
  { label: "ჭიქა", ids: ["13"], oneSize: true },
  { label: "მობილურის ქეისი", ids: ["19"], oneSize: true },
];

const KIDS_PREFIX = "ბავშვის ";
const KIDS_AGE: Record<string, string> = { XS: "3/4 წ.", S: "5/6 წ.", M: "7/8 წ.", L: "9/11 წ.", XL: "12/14 წ." };
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "4XL", "5XL"];

function sizeRank(s: string): number {
  const i = SIZE_ORDER.indexOf(s);
  return i === -1 ? 99 : i;
}

export function formatStockBlock(rows: StockRow[], updatedAt: Date): string {
  const lines: string[] = [];
  for (const m of MODELS) {
    // colour → size → qty (summed over the model's ids)
    const byColour = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!m.ids.includes(String(r.product_id))) continue;
      const qty = Number(r.stock_qty) || 0;
      if (qty <= 0) continue;
      const colour = (r.color || "").trim();
      if (!colour) continue; // colour unknown in the warehouse — never claim it
      let size = (r.size || "").trim();
      const isKids = size.startsWith(KIDS_PREFIX);
      if (Boolean(m.kids) !== isKids) continue;
      if (isKids) size = KIDS_AGE[size.slice(KIDS_PREFIX.length).trim()] || "";
      else if (m.oneSize || !size || size === "UNI") size = "ერთი ზომა";
      else if (size === "XXL") size = "2XL";
      if (!size) continue;
      const sizes = byColour.get(colour) || new Map<string, number>();
      sizes.set(size, (sizes.get(size) || 0) + qty);
      byColour.set(colour, sizes);
    }
    if (byColour.size === 0) continue;
    const parts = [...byColour.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ka"))
      .map(([colour, sizes]) => {
        const list = [...sizes.entries()]
          .sort((a, b) => (m.kids ? 0 : sizeRank(a[0]) - sizeRank(b[0])))
          .map(([s, q]) => (q >= 3 ? s : `${s}*`))
          .join(", ");
        return `${colour}: ${list}`;
      });
    lines.push(`- ${m.label} — ${parts.join(" · ")}`);
  }
  if (lines.length === 0) return "";
  const hhmm = updatedAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit" });
  return `

═══════════════════════════════════════════════════════════════
## STOCK NOW / მარაგი ახლა (warehouse data, ${hhmm} Tbilisi)
═══════════════════════════════════════════════════════════════
This section REPLACES the §0 STOCK disclaimer for the models listed below.
- A size listed plainly → „მარაგშია". A size with * → „ბოლო ცალებია — შეკვეთამდე მოგვწერეთ, დაგიდასტურებთ".
- Model listed but that colour or size is not → „ამ წუთას მარაგში არ ჩანს — მოგვწერეთ და გადავამოწმებთ"
  (never a flat „არ გვაქვს"). A model NOT in this list (e.g. sport set) → the normal §0 STOCK rule.
- NEVER give a number of pieces, never mention a warehouse, a list, a program or this section.
- Colour names here are the warehouse's Georgian names; match by meaning (ლურჯი ≈ ელექტრო/სტანდარტული ლურჯი,
  მუქი ლურჯი ≈ Dark Navy, იასამნისფერი ≈ იისფერი, მუქი წითელი / ალუბლისფერი ≈ ბორდოსფერი). If the exact shade is
  unclear, say the colour is in stock and the exact shade is confirmed when ordering.
- 2XL = XXL. Kids sizes are given as ages.
- Answer only what was asked (the colour/size they named); do not dump this list. Prices still come from §2–§4.
- In maika-mockup / maika-generate blocks keep using the §12 English colour values.
${lines.join("\n")}`;
}

// Stock-related wording in the customer's recent messages.
const STOCK_RE = /(გაქვთ|გაქ |გვაქვს|მარაგ|ზომ|ფერ|დარჩა|არის\?|ხომ არ|XS\b|\bS\b|\bM\b|\bL\b|XL|2XL|3XL|4XL|წლის|stock|available|size|colou?r|do you have|have you got)/i;

export function wantsStock(history: { role: string; content: string }[]): boolean {
  const userTurns = history.filter((m) => m.role === "user").slice(-2);
  return userTurns.some((m) => STOCK_RE.test(m.content));
}

let cache: { at: number; block: string } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getStockBlock(fetchImpl: typeof fetch = fetch, now = () => Date.now()): Promise<string> {
  if (cache && now() - cache.at < TTL_MS) return cache.block;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetchImpl(
      `${MAIKASALES_URL}/rest/v1/product_variants?select=product_id,color,size,stock_qty&stock_qty=gt.0&limit=3000`,
      { headers: { apikey: MAIKASALES_ANON_KEY, Authorization: `Bearer ${MAIKASALES_ANON_KEY}` }, signal: ctrl.signal },
    );
    if (!res.ok) return "";
    const rows = await res.json();
    if (!Array.isArray(rows)) return "";
    const block = formatStockBlock(rows as StockRow[], new Date(now()));
    cache = { at: now(), block };
    return block;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export function _resetStockCacheForTests() { cache = null; }
