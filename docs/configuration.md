# Configuration

`config.json` uses version 1. Unknown fields are rejected to catch mistakes and accidental inline credentials.
The [two-project example](../examples/config.json) has empty local bindings so it is portable.

## Gateways and profiles

```json
{
  "version": 1,
  "defaultTool": "codex",
  "gateways": {
    "local": {
      "openaiBaseUrl": "http://localhost:4000/v1",
      "anthropicBaseUrl": "http://localhost:4000"
    }
  },
  "profiles": {
    "alpha": {
      "gateway": "local",
      "credential": { "env": "PROJECT_ALPHA_KEY" },
      "models": {
        "codex": "your-code-model",
        "claude": "your-chat-model",
        "opencode": "your-code-model"
      },
      "opencodeSchema": 2
    }
  },
  "projects": {},
  "scout": { "sources": [] }
}
```

`openaiBaseUrl` is the API base, including any `/v1` prefix. Roots appends `/models` or
`/chat/completions` for its own requests. Codex uses the Responses API; OpenCode's compatible
provider uses its own native client. `anthropicBaseUrl` is an explicit Messages API base for
Claude Code, not inferred from the OpenAI base. Check your gateway's current documentation.

For LiteLLM, configure the required [OpenAI-compatible routes](https://docs.litellm.ai/docs/proxy/user_keys)
and [Claude Code integration](https://docs.litellm.ai/docs/tutorials/claude_responses_api).
Roots talks to LiteLLM over HTTP and does not embed its server, SDK or enterprise features.

Credential sources select exactly one of:

```json
{ "env": "PROJECT_ALPHA_KEY" }
```

```json
{ "op": "op://Example Vault/Project Alpha/api key" }
```

```json
{ "none": true }
```

1Password is optional and requires an installed, authorized `op` CLI. Identical references are
read once per launch; different references can require separate approval prompts. `none` is for
an endpoint that needs no authentication; native clients that require a key receive the non-secret
placeholder `local`. Roots' own HTTP calls omit authentication in this case.

## Project selection and isolation

`roots project bind <directory> --profile alpha` writes the canonical absolute path into local
configuration. The closest bound parent wins. Directory-prefix lookalikes do not match.
`--profile` explicitly chooses a profile when working in an unbound directory.

The runtime identity includes the canonical project root, profile, gateway definition and credential
reference. A different project, profile, endpoint or credential reference gets another runtime home
and model cache. Credential values are never hashed into identity files or persisted by Roots.
Changing a secret behind the same reference preserves the home; use `roots models check` to refresh visibility.

Roots removes known inherited model keys, gateway URLs and configured credential-source variables,
then injects the selected credentials. It also isolates tool configuration and session locations where
the adapter supports them. Native user overrides and external services remain under the user's control;
this is not an OS sandbox or proof of billing isolation inside every upstream helper.

## Shared instructions and skills

Edit `ROOTS_HOME/AGENTS.md`. Sync copies it into Codex's `AGENTS.md` and Claude's `CLAUDE.md`,
and gives OpenCode an instruction-file reference. Repository rules remain owned by the repository.
Skills are imported from reviewed local directories containing `SKILL.md`; imports reject symlinks.
Each agent runtime links to the shared skill source. Roots does not automatically discover or install skills.

## MCP definitions

`mcp.json` contains a `servers` object. See [example definitions](../examples/mcp.json).
Each server may limit availability using `profiles: ["alpha"]`.

Stdio servers use an executable and argument array. Roots resolves each configured variable once
in the parent process and starts a small wrapper to give that server its own mapped environment.
HTTP servers use a URL and header references. For an Authorization header, the referenced environment
value contains the complete header, including `Bearer ` when needed.

Secret-looking field names require environment or 1Password references. Non-secret settings may
use `{ "value": "info" }`. Validation cannot decide whether arbitrary user text is confidential;
keep actual credentials out of all source files and command arguments.

## Search

Codex configurations request `web_search = "live"`. This selects a mode; it does not implement search.
Only set `supportsStandaloneWebSearch: true` on a gateway after verifying its Codex-compatible
standalone endpoint and the selected model/runtime. Model metadata alone is insufficient.
