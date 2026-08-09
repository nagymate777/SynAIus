import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const application = mode === "operai" ? "operai" : "studio";
  const bridgeTarget = process.env.SYNAIUS_BRIDGE_URL ?? "http://127.0.0.1:4311";
  return {
    plugins: [react()],
    root: fileURLToPath(new URL(`./apps/${application}`, import.meta.url)),
    build: {
      outDir: fileURLToPath(new URL(`./dist/${application}`, import.meta.url)),
      emptyOutDir: true,
    },
    server: application === "operai" ? {
      proxy: {
        "/api/thread-stream": bridgeTarget,
      },
    } : undefined,
    test: {
      root: repositoryRoot,
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  };
});
