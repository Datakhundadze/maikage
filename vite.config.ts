import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { componentTagger } from "lovable-tagger";

function publicAssetsSpaceSafePlugin(): Plugin {
  let outDir = "dist";
  let publicDir = "public";

  const walkFiles = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) => {
        const fullPath = path.join(dir, entry.name);
        return entry.isDirectory() ? walkFiles(fullPath) : Promise.resolve([fullPath]);
      })
    );
    return files.flat();
  };

  return {
    name: "public-assets-space-safe",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      publicDir = path.resolve(config.root, config.publicDir);
    },
    async closeBundle() {
      if (!existsSync(publicDir)) return;

      // Ensure all public files are present in build output.
      await fs.cp(publicDir, outDir, { recursive: true, force: true });

      // Create encoded aliases for files containing spaces (e.g. "A B.png" -> "A%20B.png").
      const publicFiles = await walkFiles(publicDir);
      await Promise.all(
        publicFiles.map(async (sourceFile) => {
          const relPath = path.relative(publicDir, sourceFile).split(path.sep).join("/");
          if (!relPath.includes(" ")) return;

          const encodedRelPath = relPath.replace(/ /g, "%20");
          if (encodedRelPath === relPath) return;

          const builtSource = path.join(outDir, relPath);
          const builtEncoded = path.join(outDir, encodedRelPath);

          if (!existsSync(builtSource) || existsSync(builtEncoded)) return;

          await fs.mkdir(path.dirname(builtEncoded), { recursive: true });
          await fs.copyFile(builtSource, builtEncoded);
        })
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), publicAssetsSpaceSafePlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
