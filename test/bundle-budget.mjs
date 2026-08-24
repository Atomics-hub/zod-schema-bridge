import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const budgets = {
  "dist/index.js": 20_000,
  "dist/index.cjs": 20_000,
};

for (const [file, budget] of Object.entries(budgets)) {
  const compressed = gzipSync(readFileSync(resolve(root, file))).byteLength;
  assert.ok(compressed <= budget, `${file} is ${compressed} gzip bytes; budget is ${budget}`);
  console.log(`✔ ${file}: ${compressed} gzip bytes / ${budget} budget`);
}
