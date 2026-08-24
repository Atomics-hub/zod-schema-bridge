import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const temporary = mkdtempSync(join(tmpdir(), "zod-schema-bridge-cli-"));
const fixture = join(temporary, "schema.mjs");
const output = join(temporary, "schema.json");
const migrationRoot = join(temporary, "migration");
const dirtyMigrationRoot = join(temporary, "dirty-migration");

writeFileSync(
  fixture,
  `import { z } from ${JSON.stringify(join(root, "node_modules", "zod", "index.js"))};\nexport const User = z.object({ id: z.string().uuid(), nickname: z.string().optional() });\n`,
);

const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
assert.match(help, /jsonSchema2019-09/);

const stdout = execFileSync(
  process.execPath,
  [cli, fixture, "--export", "User", "--target", "openAi", "--name", "User", "--diagnostics"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const parsed = JSON.parse(stdout);
assert.equal(parsed.$ref, "#/definitions/User");

execFileSync(process.execPath, [cli, fixture, "--export", "User", "--out", output]);
assert.equal(JSON.parse(readFileSync(output, "utf8")).type, "object");

for (const args of [
  [],
  [fixture, "--target", "bogus"],
  [fixture, "--export", "Missing"],
  [fixture, "--unknown"],
]) {
  const failure = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.notEqual(failure.status, 0, `expected failure for ${args.join(" ")}`);
  assert.match(failure.stderr, /^zod-schema-bridge:/);
}

mkdirSync(migrationRoot);
writeFileSync(
  join(migrationRoot, "package.json"),
  `${JSON.stringify({ dependencies: { "zod-to-json-schema": "^3.25.0", zod: "^4.0.0" } }, null, 2)}\n`,
);
writeFileSync(
  join(migrationRoot, "schema.ts"),
  `import { zodToJsonSchema } from "zod-to-json-schema";\nimport { z } from "zod";\nconst lazy = () => import("zod-to-json-schema");\nconst legacy = require("zod-to-json-schema");\nconst documentation = "zod-to-json-schema";\n// import "zod-to-json-schema" must remain documentation\nconst risky = z.date().transform(String);\nzodToJsonSchema(risky, { override: () => ({}) });\n`,
);

const preview = JSON.parse(
  execFileSync(process.execPath, [cli, "migrate", migrationRoot, "--json"], { encoding: "utf8" }),
);
assert.equal(preview.filesChanged, 2);
assert.equal(preview.wroteChanges, false);
assert.equal(preview.findings.some((finding) => finding.code === "unrepresentable-zod4"), true);
assert.match(readFileSync(join(migrationRoot, "schema.ts"), "utf8"), /zod-to-json-schema/);

const checkBefore = spawnSync(process.execPath, [cli, "migrate", migrationRoot, "--check"], { encoding: "utf8" });
assert.equal(checkBefore.status, 1);

execFileSync(process.execPath, [cli, "migrate", migrationRoot, "--write"], { encoding: "utf8" });
const migratedSource = readFileSync(join(migrationRoot, "schema.ts"), "utf8");
assert.match(migratedSource, /from "zod-schema-bridge"/);
assert.match(migratedSource, /import\("zod-schema-bridge"\)/);
assert.match(migratedSource, /require\("zod-schema-bridge"\)/);
assert.match(migratedSource, /documentation = "zod-to-json-schema"/);
assert.match(migratedSource, /\/\/ import "zod-to-json-schema" must remain documentation/);
const migratedPackage = JSON.parse(readFileSync(join(migrationRoot, "package.json"), "utf8"));
assert.equal(migratedPackage.dependencies["zod-to-json-schema"], undefined);
assert.equal(migratedPackage.dependencies["zod-schema-bridge"], "^0.2.0");
const checkAfter = spawnSync(process.execPath, [cli, "migrate", migrationRoot, "--check"], { encoding: "utf8" });
assert.equal(checkAfter.status, 0);

mkdirSync(dirtyMigrationRoot);
writeFileSync(join(dirtyMigrationRoot, "package.json"), `${JSON.stringify({ dependencies: { "zod-to-json-schema": "^3" } }, null, 2)}\n`);
execFileSync("git", ["init", "-q"], { cwd: dirtyMigrationRoot });
execFileSync("git", ["add", "."], { cwd: dirtyMigrationRoot });
execFileSync("git", ["-c", "user.name=Bridge Test", "-c", "user.email=bridge@example.invalid", "commit", "-qm", "fixture"], { cwd: dirtyMigrationRoot });
writeFileSync(join(dirtyMigrationRoot, "unrelated.ts"), "export const dirty = true;\n");
const dirtyWrite = spawnSync(process.execPath, [cli, "migrate", dirtyMigrationRoot, "--write"], { encoding: "utf8" });
assert.notEqual(dirtyWrite.status, 0);
assert.match(dirtyWrite.stderr, /dirty Git worktree/);

console.log("✔ CLI smoke: conversion, 4 failure modes, migration preview, risk report, and safe rewrite passed");
