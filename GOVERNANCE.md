# Governance

`zod-schema-bridge` is maintained by Atomics Hub. Compatibility decisions are evidence-led:

1. Published Zod 3 behavior is preserved unless it is unsafe or demonstrably incorrect.
2. Zod 4 behavior follows public Zod APIs.
3. Provider behavior follows current public provider SDK contracts.
4. Lossy behavior must be opt-in and diagnostic.
5. Breaking changes require a major version and a migration note.

Maintainer access follows least privilege. npm publication uses GitHub trusted publishing rather than long-lived automation tokens. At least one approving review is required before enabling release automation on the canonical repository.
