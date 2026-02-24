import { defineConfig } from "eslint/config";
import raycastConfig from "@raycast/eslint-config";

export default defineConfig([
  {
    ignores: [
      ".venv/**",
      "npid-api-layer/**",
      "mcp-servers/**",
      "src/python/**",
      "src/lib/prospect-pipeline/**",
    ],
  },
  ...raycastConfig,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
