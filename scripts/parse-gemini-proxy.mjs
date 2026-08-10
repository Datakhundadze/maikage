// Parse the Deno edge function with the TypeScript compiler API. `tsc -b` does
// not cover supabase/functions (Deno, own module resolution), so this is the
// only thing that proves the file is still syntactically valid TypeScript —
// and the KB is a template literal, where one unescaped backtick silently
// swallows the rest of the file.
import ts from "typescript";
import fs from "node:fs";

const file = "supabase/functions/gemini-proxy/index.ts";
const src = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const diags = sf.parseDiagnostics ?? [];
for (const d of diags) {
  const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
  console.log(`PARSE ERROR ${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}
console.log(diags.length === 0 ? "PARSE OK — 0 diagnostics" : `PARSE FAILED — ${diags.length}`);

// Pull FAQ_KB out of the AST (not by regex) and confirm it is one string.
let kb = null;
sf.forEachChild(function walk(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText() === "FAQ_KB" && n.initializer) {
    if (ts.isNoSubstitutionTemplateLiteral(n.initializer)) kb = n.initializer.text;
    else console.log("!! FAQ_KB is not a plain template literal:", ts.SyntaxKind[n.initializer.kind]);
  }
  n.forEachChild(walk);
});
if (kb == null) { console.log("!! FAQ_KB not found"); process.exit(1); }

const geo = (kb.match(/[Ⴀ-ჿ]/g) || []).length;
const est = Math.round(geo / 1.6 + (kb.length - geo) / 4);
console.log(`FAQ_KB chars=${kb.length} lines=${kb.split("\n").length} georgian=${geo} est_tokens≈${est}`);
for (const need of ["maika-generate", "დამიხატე", "Pixar 3D", "withBackground", "RE-EMIT THE BLOCK"])
  console.log(`  contains ${JSON.stringify(need)}: ${kb.includes(need)}`);
// Every fence in the KB must be a real triple backtick after unescaping.
console.log("  maika-generate fences:", (kb.match(/```maika-generate/g) || []).length,
            "| maika-mockup fences:", (kb.match(/```maika-mockup/g) || []).length);
process.exit(diags.length === 0 ? 0 : 1);
