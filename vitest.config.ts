import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
      miniflare: {
        bindings: {
          ENTORNO: "test",
          GEMINI_API_KEY: "clave-de-prueba",
          PANEL_USUARIO: "admin",
          PANEL_CLAVE: "clave-prueba",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
