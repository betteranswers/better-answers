import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** A local-only harness for previewing the workspace blocks; the app's build is unchanged. */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-the-block-harness-at-the-root",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url === "/" || request.url === "/index.html") request.url = "/preview.html";
          next();
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "0.0.0.0", port: 5173, allowedHosts: true, open: false },
});
