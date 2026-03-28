import Replicate from "replicate";
import { writeFileSync } from "fs";
import { createWriteStream } from "fs";
import https from "https";
import http from "http";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
if (!REPLICATE_API_TOKEN) {
  console.error("❌ Set REPLICATE_API_TOKEN env variable");
  process.exit(1);
}

const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

const personImageUrl =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512";
const garmentImageUrl =
  "https://chakqdmeqxxivtdqhggv.supabase.co/storage/v1/object/public/designs/generations/f528eace-8950-4ebe-aab6-717b4fced42d-mockup.png";

console.log("🚀 Running virtual try-on...");
console.log("  Person :", personImageUrl);
console.log("  Garment:", garmentImageUrl);

const output = await replicate.run("cedoysch/flux-fill-redux-try-on", {
  input: {
    human_img: personImageUrl,
    garm_img: garmentImageUrl,
  },
});

console.log("\n✅ Output:", output);

// Save result image
const resultUrl = Array.isArray(output) ? output[0] : output;
if (resultUrl) {
  await new Promise((resolve, reject) => {
    const proto = String(resultUrl).startsWith("https") ? https : http;
    proto.get(resultUrl, (res) => {
      const file = createWriteStream("result.png");
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
  console.log("💾 Saved to result.png");
} else {
  console.error("No output URL returned");
}
