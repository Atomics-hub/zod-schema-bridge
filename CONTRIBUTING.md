# Contributing

Compatibility comes before new features.

1. Add or update a fixture that demonstrates the behavior.
2. Run `npm run verify`.
3. State whether the change affects Zod 3, Zod 4, or both engines.
4. Call out intentional output changes in `CHANGELOG.md`.
5. Run provider contract fixtures when changing payload adapters.
6. Keep the root entry browser-safe; Node built-ins belong only in `zod-schema-bridge/migrate` or the CLI.

## Pull requests

- Keep changes focused and add a minimal regression fixture.
- Do not commit generated `dist` files or tarballs.
- Use Conventional Commit-style subjects when practical (`fix:`, `feat:`, `docs:`, `test:`).
- Security reports belong in private vulnerability reporting, not issues.

Do not silently change generated schemas. New lossy behavior should emit a diagnostic.
