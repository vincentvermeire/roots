# Contributing

Use Node.js 22 or later. This repository has no runtime dependencies or installation step for tests.
Run `npm run check` and `npm test`. Before packaging, inspect `npm pack --dry-run`.

Keep examples generic. Local endpoint choices, project paths, credential references, operational logs
and private instructions belong in a user's Roots home rather than the product tree.

For an adapter change, cite the upstream interface and add meaningful coverage for generated configuration,
credential precedence and state isolation. Document the exact compatibility tested and any remaining gap.
Use dummy credentials and stub HTTP for tests; make live model tests explicit and bounded.

Provider and model names are configuration data. Extensions should preserve the CLI's separation of
configuration, credentials, generated files and native agent state.
