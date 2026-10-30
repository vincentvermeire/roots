# Contributing with an agent

Roots manages shared coding-agent configuration and project-scoped gateway access.
Read docs/architecture.md when changing configuration, launch flow or file ownership.
Read docs/compatibility.md when changing a tool adapter; verify its current upstream interface.

- Keep provider endpoints, model IDs, credential references and project paths in user configuration.
- Resolve credentials for child-process memory; generated files and diagnostics contain references.
- Preserve project/profile isolation and fail explicitly on missing or ambiguous bindings.
- Keep native agent settings separate from Roots-owned generated files.
- Use built-in Node modules. Add a dependency only when a concrete requirement warrants it.
- Add meaningful regression coverage for credential, process, filesystem or adapter changes.
- Run npm run check and npm test before submitting a change.

Publication includes product source, generic examples and documentation. Review the tracked tree,
package file list and commit metadata before publication; local configuration and runtime data stay external.
