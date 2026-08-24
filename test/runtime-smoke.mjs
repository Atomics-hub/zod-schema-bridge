import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { z } from "zod";
import bridge, { convertZodSchema } from "../dist/index.js";

const schema = z.object({ id: z.string(), tags: z.array(z.string()).optional() });
const converted = convertZodSchema(schema, "RuntimeSmoke");
assert.equal(converted.schema.$ref, "#/definitions/RuntimeSmoke");
assert.equal(typeof bridge, "function");
assert.equal(typeof createRequire(import.meta.url)("../dist/index.cjs").zodToJsonSchema, "function");
const runtime = globalThis.Bun
  ? `Bun ${globalThis.Bun.version}`
  : globalThis.Deno
    ? `Deno ${globalThis.Deno.version.deno}`
    : `Node ${process.version}`;
console.log(`✔ ${runtime} runtime smoke passed`);
