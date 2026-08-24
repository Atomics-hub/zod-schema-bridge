import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import manifest from "../package.json" with { type: "json" };

const tarball = resolve(process.env.BRIDGE_TARBALL ?? `${manifest.name}-${manifest.version}.tgz`);

for (const manager of ["pnpm", "yarn"]) {
  const fixture = mkdtempSync(join(tmpdir(), `zsb-${manager}-`));
  writeFileSync(join(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const packageReference = `file:${tarball}`;
  execFileSync("corepack", [manager, "add", packageReference, "zod@4.4.3"], { cwd: fixture, stdio: "pipe" });
  writeFileSync(
    join(fixture, "smoke.mjs"),
    `import assert from "node:assert/strict";\nimport { z } from "zod";\nimport { toProviderSchema } from "zod-schema-bridge";\nconst result = toProviderSchema(z.object({ value: z.string() }), { provider: "mcp", name: "smoke" });\nassert.equal(result.payload.inputSchema.type, "object");\n`,
  );
  execFileSync(process.execPath, [join(fixture, "smoke.mjs")], { cwd: fixture, stdio: "pipe" });
  assert.ok(basename(tarball).endsWith(".tgz"));
  console.log(`✔ ${manager} packed install and runtime smoke passed`);
}
