# Changelog scout

Scout watches explicit public changelog URLs. It is separate from agent launch and does not run
automatically when a session starts. Configure sources in `config.json`:

```json
{
  "sources": [
    { "id": "codex", "url": "https://api.github.com/repos/openai/codex/releases" }
  ],
  "profile": "review",
  "model": "your-review-model"
}
```

This object is the `scout` field, not the complete configuration. The review profile is a user-selected
billing context, and no model is chosen automatically.

## Behaviour

1. The first successful fetch records a content-hash baseline without a model call.
2. Later changed content queues a local source snapshot and writes a report.
3. `roots scout run --review` sends at most 20,000 characters per pending source to the configured
   OpenAI-compatible review model. Exact evidence quotes are validated before queue entries clear.
4. Proposals remain human decisions. Scout never applies agent configuration changes.

`roots scout status` shows source health, pending snapshot paths, last result and report paths.
Failed source/model requests keep pending work. Reports live in `ROOTS_HOME/reports/` and can be
read by another tool. Runtime locks prevent overlapping runs for the same Roots home; an interrupted
run can leave `scout.lock`, which should be inspected before removal.

This version compares complete fetched text, rather than parsing every vendor's release entries.
Dynamic HTML can therefore produce noisy changes. Prefer stable Markdown, RSS or release JSON sources.
No inference occurs without `--review`; inference uses the configured profile, not a hardcoded account.

## Scheduling

Scheduling is external. Use Windows Task Scheduler, cron or another scheduler to invoke the CLI.
The product does not install, replace or inspect system tasks automatically.

For Windows Task Scheduler, create a task for the intended user with:

| Setting | Value |
|---|---|
| Program | Absolute path to `node.exe` |
| Arguments | `"C:/Code/roots/bin/roots.mjs" scout run --home "C:/Users/me/.config/roots"` |
| Trigger | Your selected weekly time |
| Missed starts | Run when available, if appropriate |
| Overlap | Do not start another instance |
| Authentication | Model review needs the profile's environment variable or interactive 1Password access |

For cron, use absolute paths and an explicit home:

```cron
0 14 * * 5 /usr/local/bin/node /opt/roots/bin/roots.mjs scout run --home /home/me/.config/roots
```

Start with a deterministic run, check its exit code and `scout status`, then enable model review
only after credential availability is tested in that scheduler's execution context.
