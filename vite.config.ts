import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const application = mode === "operai" ? "operai" : "studio";
  return {
    plugins: [react()],
    root: fileURLToPath(new URL(`./apps/${application}`, import.meta.url)),
    build: {
      outDir: fileURLToPath(new URL(`./dist/${application}`, import.meta.url)),
      emptyOutDir: true,
    },
    test: {
      root: repositoryRoot,
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  };
});
