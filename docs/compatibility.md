# Compatibility and evidence

This initial release implements adapters for Claude Code, Codex and OpenCode. Unit/integration
tests exercise generated files, project selection, credential handling and stub subprocesses.
They do not establish end-to-end compatibility with every gateway, model or tool release.

A bounded Windows smoke test with Codex **0.165.0** passed: strict configuration accepted the generated
`roots` provider/profile, and a Responses-compatible custom gateway returned the expected reply.
No tools were invoked and no credential was written by Roots. Claude/OpenCode live routing remains
to be verified separately; their initial evidence is generated-configuration and stub-process coverage.

| Surface | Implemented | Requirement / evidence boundary |
|---|---|---|
| Codex | Custom Responses provider, generated profile, isolated `CODEX_HOME`, stdio/HTTP MCP | A Responses-compatible gateway; standalone search additionally needs Codex's native contract |
| Claude Code | Anthropic endpoint/token, scoped config directory, instruction/skill sync, explicit MCP | A compatible Anthropic Messages gateway; default model aliases use the selected model |
| OpenCode 1 | OpenAI-compatible provider, allowlist, MCP, XDG/config isolation | Select `opencodeSchema: 1`; verify the installed release's provider package/interface |
| OpenCode 2 | Provider package/settings, provider-use policies, MCP servers, XDG/config isolation | Select `opencodeSchema: 2` (default); verify the installed release |
| Gateway model discovery | OpenAI-compatible `/models` | Returns `{ "data": [{ "id": "..." }] }`; no vendor-specific filtering |
| LiteLLM | HTTP-compatible gateway configuration | Run/configure it separately; no LiteLLM dependency or enterprise API requirement |
| 1Password | Optional `op read` credential source | Installed and authorized `op`; references remain local |
| Cursor / Antigravity / Gemini CLI | No product adapter yet | Do not infer gateway or project-isolation support from another tool's adapter |
| T3 / agent managers | No integration yet | Separate optional consumers; Roots owns configuration and credentials |

## Platform support

Node.js 22+ is the baseline. The automated test matrix covers Windows and Linux on Node 22 and 24.
Windows native executables are launched without a shell. Known npm agent shims are resolved to their
JavaScript entry points; arbitrary `.cmd`/`.bat` wrappers are rejected. MCP servers should use a native
executable or `node` plus a script path, rather than a shell wrapper.

Local Agent Skills use directory links: junctions on Windows and symlinks on Unix. Existing unrelated
skill directories are preserved and reported as conflicts. macOS uses the Unix implementation but is
not included in the initial automated matrix.

## Upstream references

- [Codex custom providers, configuration homes and generated profiles](https://learn.chatgpt.com/docs/config-file/config-advanced)
- [Claude Code gateways](https://code.claude.com/docs/en/llm-gateway)
- [OpenCode configuration](https://opencode.ai/docs/config/)
- [OpenCode providers](https://opencode.ai/docs/providers/)
- [LiteLLM OpenAI-compatible usage](https://docs.litellm.ai/docs/proxy/user_keys)

Adapter interfaces change quickly. Check current upstream documentation and run a bounded smoke
test with a generic project before treating a gateway/tool combination as verified. A mode flag,
successful config parse or HTTP 200 with empty results is not proof that a feature works.
