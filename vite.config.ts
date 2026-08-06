import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const portalRoot = fileURLToPath(new URL("./apps/portal", import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: portalRoot,
  build: {
    outDir: fileURLToPath(new URL("./dist/portal", import.meta.url)),
    emptyOutDir: true,
  },
  test: {
    root: repositoryRoot,
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
