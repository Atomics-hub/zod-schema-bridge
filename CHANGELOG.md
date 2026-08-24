# Changelog

## 0.2.0

- Add provider-ready payload adapters for OpenAI, Anthropic, Gemini, MCP, and Vercel AI SDK.
- Validate payloads against official SDK contracts; use Gemini `parametersJsonSchema` and an AI SDK-compatible Vercel schema wrapper.
- Add a syntax-aware repository migration scanner with preview, JSON reporting, atomic writes, dirty-worktree protection, and CI `--check` mode.
- Split the browser-safe converter from the Node-only `zod-schema-bridge/migrate` entry.
- Make genuine Zod 4 conversion lossless-by-default by throwing on unrepresentable schemas.
- Add explicit diagnostics when callers opt into lossy `{}` conversion.
- Adapt legacy `override` and `postProcess` callbacks for Zod 4 and support mixed-version preloaded definitions.
- Add seeded property testing, semantic AJV checks, adversarial scale tests, isolated Zod consumer tests, and Node 18–24 runtime checks.
- Add enforced coverage and bundle budgets, browser bundling, cross-runtime/package-manager CI, CodeQL, Dependabot, trusted publishing, and provenance attestations.
- Publish a pinned 20-repository/2,352-file migration corpus with conservative results.

## 0.1.0

- Vendor the ISC-licensed `zod-to-json-schema` 3.25.2 implementation as the Zod 3 compatibility engine.
- Dispatch genuine Zod 4 schemas through Zod's native JSON Schema converter.
- Preserve the established `zodToJsonSchema(schema, options)` entry point.
- Add conversion diagnostics and engine reporting with `convertZodSchema`.
- Add OpenAI-strict normalization for Zod 4 object schemas.
- Add a CLI for converting an exported schema from a JavaScript or TypeScript module.
