import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "openclaw/plugin-sdk/plugin-entry": resolve(__dirname, "src/__mocks__/plugin-entry.ts"),
      "openclaw/plugin-sdk/types": resolve(__dirname, "src/__mocks__/types.ts"),
    },
  },
});
