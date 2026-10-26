// Regenerates public/llms.txt from the same sources the site renders
// (scripts/lib/seo.mjs buildLlmsTxt: CONTACT, the landing routes, titles and
// description tail, the FAQ / corporate / portfolio copy).
//
//   node scripts/generate-llms-txt.mjs
//
// Not part of `npm run build`: the file is committed, and
// src/test/seoStatic.test.ts fails when it no longer matches the builder's
// output — run this script, then commit the result.

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppModules } from "./lib/appModules.mjs";
import { buildLlmsTxt, landingRoutes } from "./lib/seo.mjs";

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "llms.txt");

const app = await loadAppModules("[llms.txt]");
if (!app) {
  process.exitCode = 1;
} else {
  const text = buildLlmsTxt({
    routes: landingRoutes(app),
    productKa: app.productTypeKa,
    landingSeo: app.landingSeo,
    servicesKa: app.LANDING_TAIL_KA,
    faqPage: app.FAQ_PAGE,
    servicePages: app.SERVICE_PAGE_LIST,
  });
  await writeFile(OUTPUT, text, "utf8");
  console.log(`[llms.txt] wrote public/llms.txt (${Buffer.byteLength(text, "utf8")} bytes).`);
}
