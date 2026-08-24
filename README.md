# zod-schema-bridge

A migration-first compatibility bridge from Zod schemas to JSON Schema.

`zod-schema-bridge` preserves the familiar `zodToJsonSchema(schema, options)` API for Zod 3 schemas and adds real Zod 4 support through Zod's native converter. It targets teams that cannot migrate thousands of generated schemas in one flag day.

> Status: **alpha**. The Zod 3 engine carries the mature behavior of `zod-to-json-schema` 3.25.2. Genuine Zod 4 support is new and intentionally emits diagnostics when compatibility is approximate.

## Install

```bash
npm install zod-schema-bridge zod
```

## Drop-in usage

```ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-schema-bridge";

const User = z.object({
  name: z.string(),
  age: z.number().int().optional(),
});

const jsonSchema = zodToJsonSchema(User, "User");
```

Existing Zod 3 consumers can initially change only the import:

```diff
- import { zodToJsonSchema } from "zod-to-json-schema";
+ import { zodToJsonSchema } from "zod-schema-bridge";
```

## Diagnostics

Use `convertZodSchema` during migration to see which engine ran and where output is approximate:

```ts
import { convertZodSchema } from "zod-schema-bridge";

const result = convertZodSchema(User, { target: "openAi" });

console.log(result.engine);       // "native-zod4"
console.log(result.diagnostics);  // conversion notes and warnings
console.log(result.schema);
```

Unsupported Zod 4 constructs throw by default so a migration cannot silently weaken validation. If unconstrained `{}` output is intentional, opt in explicitly:

```ts
convertZodSchema(schema, { unrepresentable: "any" });
// diagnostics includes { code: "lossy-schema", level: "warning", ... }
```

## Provider payloads

Build the envelope expected at each provider boundary from the same schema:

```ts
import { toProviderSchema } from "zod-schema-bridge";

const openai = toProviderSchema(SearchInput, {
  provider: "openai",
  name: "search",
  description: "Search the product catalog",
});

const anthropic = toProviderSchema(SearchInput, { provider: "anthropic", name: "search" });
const gemini = toProviderSchema(SearchInput, { provider: "gemini", name: "search" });
const mcp = toProviderSchema(SearchInput, { provider: "mcp", name: "search" });
const vercel = toProviderSchema(SearchInput, { provider: "vercel", name: "search" });
```

The result contains the provider payload, normalized schema, and diagnostics. Payload types are compile-tested against the current official provider SDKs. OpenAI supports both Structured Outputs and function tools:

```ts
toProviderSchema(SearchInput, {
  provider: "openai",
  openaiMode: "tool",
  name: "search",
});
```

Gemini uses `parametersJsonSchema`; Vercel receives an AI SDK-compatible `inputSchema` wrapper. Provider names, root-object constraints, strict OpenAI objects, serialization, and known Gemini keywords are validated before return. Set `validation: "none"` only when downstream software intentionally supports a broader dialect.

## Targets

```ts
zodToJsonSchema(User, { target: "jsonSchema7" });
zodToJsonSchema(User, { target: "jsonSchema2019-09" });
zodToJsonSchema(User, { target: "openApi3" });
zodToJsonSchema(User, { target: "openAi" });
```

- Zod 3 schemas use the vendored compatibility engine.
- Zod 4 schemas use Zod's native converter.
- Draft 2019-09 is currently emulated from native draft 2020-12 output and emits a warning.
- `openAi` makes object fields required, converts formerly optional fields to nullable, and closes objects with `additionalProperties: false`.

## CLI

Export a schema from a JavaScript module:

```js
// schema.mjs
import { z } from "zod";
export const User = z.object({ name: z.string() });
```

```bash
npx zod-schema-bridge ./schema.mjs \
  --export User \
  --target openAi \
  --name User \
  --diagnostics
```

Scan an existing repository before changing anything:

```bash
npx zod-schema-bridge migrate .
npx zod-schema-bridge migrate . --json
```

The report identifies legacy imports and dependencies, callbacks needing review, transforms, and Zod types that JSON Schema cannot represent. Apply only the deterministic import and dependency changes with:

```bash
npx zod-schema-bridge migrate . --write
```

Writes are atomic. Module specifiers are identified by a syntax-aware scanner, so comments, documentation strings, and unrelated literals are preserved. `--write` refuses a dirty Git worktree unless `--force` is explicit, and `--check` provides a CI-friendly non-zero exit when deterministic changes remain.

The Node-only programmatic API is isolated from the browser-safe converter entry:

```ts
import { migrateRepository } from "zod-schema-bridge/migrate";
```

## Compatibility evidence

The migration preview has been run against a pinned corpus of 20 public repositories and 2,352 source/manifests. See the [methodology and per-repository results](docs/compatibility-corpus.md). No third-party repository was modified.

## Compatibility policy

1. Zod 3 output stability comes first.
2. Genuine Zod 4 schemas use native conversion instead of private-internal emulation.
3. Lossy or approximate behavior should be explicit in diagnostics.
4. Provider presets belong at the boundary: JSON Schema dialects, OpenAPI, OpenAI, and MCP—not scattered across application code.

## Attribution and stewardship

The Zod 3 compatibility engine is adapted from the ISC-licensed [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) project by Stefan Terdell and its contributors. The original license is preserved in `LICENSE`, and attribution is recorded in `NOTICE`.

This repository is currently an independent experiment. It does not claim endorsement by the original project or by Zod. Any future package-name or stewardship handoff must be explicit and consensual.
