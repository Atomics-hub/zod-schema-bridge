import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarball = resolve(process.env.BRIDGE_TARBALL ?? process.argv[2] ?? "");
if (!tarball.endsWith(".tgz")) {
  throw new Error("Set BRIDGE_TARBALL or pass the packed .tgz path");
}

for (const zodVersion of ["3.25.76", "4.4.3"]) {
  const fixture = mkdtempSync(join(tmpdir(), `zod-schema-bridge-zod-${zodVersion}-`));
  writeFileSync(join(fixture, "package.json"), JSON.stringify({ type: "module", private: true }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `zod@${zodVersion}`, tarball], {
    cwd: fixture,
    stdio: "pipe",
  });
  writeFileSync(
    join(fixture, "smoke.mjs"),
    `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { z } from "zod";
import bridge, { convertZodSchema, toProviderSchema, zodToJsonSchema } from "zod-schema-bridge";
const schema = z.object({ id: z.string(), count: z.number().int().optional() });
const result = convertZodSchema(schema, "Thing");
assert.equal(result.engine, ${JSON.stringify(zodVersion.startsWith("3.") ? "legacy-zod3" : "native-zod4")});
assert.equal(result.schema.$ref, "#/definitions/Thing");
assert.deepEqual(bridge(schema), zodToJsonSchema(schema));
const provider = toProviderSchema(schema, { provider: "openai", name: "thing" });
assert.equal(provider.payload.json_schema.strict, true);
const require = createRequire(import.meta.url);
assert.equal(typeof require("zod-schema-bridge").zodToJsonSchema, "function");
`,
  );
  execFileSync(process.execPath, [join(fixture, "smoke.mjs")], { cwd: fixture, stdio: "pipe" });
  console.log(`✔ packed consumer with Zod ${zodVersion}: ESM, CJS, default, named, and engine dispatch passed`);
}
