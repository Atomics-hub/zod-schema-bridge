# Public repository migration corpus

Snapshot date: 2026-08-23. Selection: 20 public TypeScript repositories returned by GitHub code search for `zod-to-json-schema`, emphasizing recognizable SDK, MCP, and schema projects. This is a reproducible static migration scan, not an endorsement by those projects and not a claim that every review warning is a runtime incompatibility.

The scanner inspected 2,352 source/manifests without modifying them:

- 17 repositories contain deterministic dependency/import migrations across 43 files.
- 7 of those repositories need only deterministic changes and produced no conservative review warnings.
- 10 contain deterministic changes plus constructs requiring human review.
- 3 had no deterministic migration at the scanned revision; two contain review-only patterns.
- 44 deterministic findings and 149 conservative review findings were reported.

| Repository | Revision | Files | Changed files | Review findings |
| --- | --- | ---: | ---: | ---: |
| googleapis/js-genai | `6e9b35c` | 507 | 7 | 4 |
| openai/openai-deno-build | `28ffdaa` | 116 | 0 | 10 |
| cloudflare/playwright-mcp | `ee81e27` | 77 | 4 | 1 |
| exa-labs/exa-js | `d3213b4` | 97 | 2 | 0 |
| conductor-oss/javascript-sdk | `816e5f5` | 641 | 2 | 76 |
| SmartBear/smartbear-mcp | `d0e2df7` | 428 | 0 | 2 |
| landing-ai/ade-typescript | `db5be2e` | 86 | 0 | 0 |
| factorialco/shadowdog | `fab10cd` | 37 | 2 | 6 |
| agentrpc/agentrpc | `52ad330` | 32 | 3 | 35 |
| hustcc/mcp-mermaid | `1349706` | 18 | 2 | 0 |
| hustcc/mcp-echarts | `5a4c1cc` | 52 | 3 | 1 |
| Dokploy/mcp | `ea429e8` | 18 | 2 | 1 |
| jina-ai/node-DeepResearch | `fd323b5` | 62 | 2 | 0 |
| run-llama/app-creator | `d9796fa` | 32 | 2 | 0 |
| elierotenberg/fastify-zod | `0fa2806` | 21 | 2 | 4 |
| dzhng/zod-gpt | `9be7db3` | 10 | 2 | 0 |
| holdenmatt/openai-zod-functions | `07b735d` | 14 | 2 | 0 |
| olup/zod-chatgpt | `d85f9d3` | 3 | 2 | 0 |
| forge-ml/forge-ml | `3bf3792` | 53 | 2 | 8 |
| jamubc/gemini-mcp-tool | `588e73d` | 48 | 2 | 1 |

## Interpretation

“Changed files” means the syntax-aware preview found an actual package dependency or JavaScript/TypeScript module specifier. Review findings are intentionally conservative: transformations, unrepresentable Zod types, and legacy callbacks are reported repository-wide so maintainers can inspect them. Comments, documentation strings, template strings, generated output directories, dependencies, symlinks, and build artifacts are not rewritten.

The next public campaign should run each owner-approved migrated branch through that repository’s own test suite. This project will not execute arbitrary third-party install scripts or submit unsolicited pull requests merely to inflate compatibility claims.
