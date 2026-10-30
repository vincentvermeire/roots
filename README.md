# Roots

One source for coding-agent instructions, skills, MCP servers and model-gateway configuration.
Roots launches agents with explicit project profiles and keeps credentials out of generated files.

**MIT licensed. Node.js 22+. No runtime dependencies.** This is an initial release: adapter coverage
and limitations are described in [compatibility](docs/compatibility.md).

## What it does

- Configure OpenAI-compatible gateways, including LiteLLM, and optional Anthropic Messages endpoints.
- Bind projects to profiles with their own credential sources and model choices.
- Launch Claude Code, Codex and OpenCode with separate configuration/session homes.
- Sync shared instructions, local Agent Skills and MCP definitions without editing repository rules.
- Discover gateway models, inspect configuration health and list sessions launched through Roots.
- Scout user-selected changelogs; model review is opt-in and produces proposals for human review.

Roots is a CLI and configuration layer. Run your gateway separately. Gateway compatibility does
not automatically provide every native agent feature, including hosted search or cloud helpers.

## Run from source

```sh
git clone https://github.com/vincentvermeire/roots.git
cd roots
node bin/roots.mjs --help
```

For local installation, `npm install -g .` exposes the `roots` command. The package is not currently
published to the npm registry. An existing command named `roots` may be replaced by a global installation;
use the explicit source entry point while trying this version alongside another installation.

## Start with a gateway

Supply a model ID that your gateway serves:

```sh
roots init --gateway http://localhost:4000/v1 --model your-code-model --key-env PROJECT_ALPHA_KEY
roots project bind /path/to/project-alpha --profile default
roots run codex --dry-run
roots run codex
```

Set `PROJECT_ALPHA_KEY` in the launching process, or change the profile credential to a 1Password
reference. `init` creates references, not API keys. On Windows, pass an existing Windows directory
to `project bind`, such as `C:/Code/project-alpha`. Commands use the current directory unless
`--project` is supplied.

For another project, use another profile and key:

```sh
roots profile add beta --gateway default --model your-code-model --key-env PROJECT_BETA_KEY
roots project bind /path/to/project-beta --profile beta
```

An unbound project fails. `--profile` is an explicit override; Roots never guesses another project's key.
Both projects can use the same gateway URL while their keys and runtime state remain separate.

To use Claude Code, add its model to the profile and configure the gateway's exact
`anthropicBaseUrl`. To use OpenCode, add its model and select `opencodeSchema: 1` or `2`
for the installed major version. See [configuration](docs/configuration.md).

## Everyday commands

| Command | Purpose |
|---|---|
| `roots sync --dry-run` | Preview generated files; resolve no secrets |
| `roots run codex -- exec "Review this change"` | Forward arguments directly to Codex |
| `roots models check` | Discover model changes using the selected project key |
| `roots doctor --online` | Check installation/configuration and model discovery |
| `roots status` | List recent sessions launched through this Roots home |
| `roots mcp list` | List shared MCP definitions |
| `roots skills add /path/to/a-skill` | Import a reviewed local skill |
| `roots scout run` | Check configured changelogs without model calls |
| `roots scout run --review` | Request opt-in model proposals with evidence quotes |
| `roots help run` | Explain a command's options and behaviour |

## Where things live

By default, `ROOTS_HOME` is `~/.config/roots` on all platforms. Set the environment variable
or pass `--home` to use a different location. It is independent of this repository.

| Location | Owns |
|---|---|
| This repository: `bin/`, `src/` | CLI and reusable implementation |
| `ROOTS_HOME/config.json` | Gateways, profiles, models and local project bindings |
| `ROOTS_HOME/AGENTS.md` | Your shared instructions |
| `ROOTS_HOME/skills/` | Your imported Agent Skills |
| `ROOTS_HOME/mcp.json` | Your MCP definitions and credential references |
| `ROOTS_HOME/state/runtimes/<profile>/<identity>/` | Generated agent homes and native agent state |
| `ROOTS_HOME/state/runs/` | Roots launch metadata, without prompts or credentials |
| `ROOTS_HOME/state/scout.json` | Changelog baselines, pending changes and run status |
| `ROOTS_HOME/reports/` | Local scout proposals |
| Environment / optional 1Password | Actual credential values |

See [architecture](docs/architecture.md) for the complete ownership and launch map,
[compatibility](docs/compatibility.md) for tested support, and [scout](docs/scout.md) for scheduling.

## Development

```sh
npm run check
npm test
npm pack --dry-run
```

Tests use temporary homes, dummy credentials and stubbed HTTP. They make no model calls.
GitHub Actions runs the suite on Windows and Linux. See [contributing](CONTRIBUTING.md).
