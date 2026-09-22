import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Under pnpm's store the last `node_modules/<name>/` segment names the library, so each test ends
// at that boundary.
const LIBRARY_GROUPS = [
  { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
  { name: "tanstack", test: /node_modules[\\/]@tanstack[\\/]/, priority: 30 },
  { name: "trpc", test: /node_modules[\\/]@trpc[\\/]/, priority: 30 },
  { name: "vendor", test: /node_modules[\\/]/, priority: 10 },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist",
    sourcemap: true,
    rolldownOptions: { output: { codeSplitting: { groups: LIBRARY_GROUPS } } },
  },
});
