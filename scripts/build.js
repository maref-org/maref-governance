import { build } from "esbuild";

await build({
  entryPoints: ["./src/index.ts"],
  outfile: "./dist/index.js",
  format: "esm",
  platform: "node",
  external: ["@maref-org/sdk", "openclaw"],
  bundle: true,
  sourcemap: false,
  minify: false,
});

console.log("✓ Built dist/index.js");
