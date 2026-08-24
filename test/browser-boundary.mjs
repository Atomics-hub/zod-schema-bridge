import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
for (const file of ["dist/index.js", "dist/index.cjs"]) {
  const source = readFileSync(resolve(root, file), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|path|os|url|child_process)/, `${file} contains a Node-only import`);
}

const runtime = await import(resolve(root, "dist/index.js"));
assert.equal(typeof runtime.zodToJsonSchema, "function");
assert.equal("migrateRepository" in runtime, false);

const migration = await import(resolve(root, "dist/migrate-entry.js"));
assert.equal(typeof migration.migrateRepository, "function");
await build({
  stdin: {
    contents: `export { zodToJsonSchema, toProviderSchema } from ${JSON.stringify(resolve(root, "dist/index.js"))};`,
    resolveDir: root,
    sourcefile: "browser-entry.js",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  external: ["zod", "zod/*"],
  write: false,
});
console.log("✔ browser boundary: root is Node-builtin-free; migration API is isolated");
