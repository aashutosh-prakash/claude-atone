# Contributing

Thanks for your interest! This project is deliberately tiny — its job is to install one Stop hook, safely, and play a fun animation when Claude admits a mistake.

## Scope

In scope:
- macOS reliability, install/uninstall correctness
- Security hardening (see [SECURITY.md](./SECURITY.md))
- Compatibility with new Claude Code hook payload shapes
- Trigger-phrase tuning (the `TRIGGERS` array in `bin/on-stop.mjs`)
- Animation quality (`bin/updown.mjs`)

Out of scope (for now):
- Linux / Windows window-spawning (may reconsider — open an issue to discuss)
- A separate config file — the hook lives in `~/.claude/settings.json`, never a new file
- Sending any transcript content off the machine (the tool has no network code, by design)

## Development

Zero dependencies. Requires Node.js ≥ 18.

```bash
git clone https://github.com/aashutosh-prakash/claude-atone.git
cd claude-atone
npm test                    # run the test suite (no install needed)
node bin/cli.mjs --dry-run  # preview install changes
node bin/cli.mjs --doctor   # check local install health
```

There is no `install.sh` — the installer is the Node CLI (`bin/cli.mjs`), which is
also the `npx claude-atone` entry point. Run it directly during development.

## Testing your changes against a real ~/.claude

```bash
# back up your real settings first
cp ~/.claude/settings.json ~/.claude/settings.json.local-backup

# pack and install locally
npm pack
npx ./claude-atone-*.tgz
npx ./claude-atone-*.tgz --test        # pops the "atone?" dialog
npx ./claude-atone-*.tgz --uninstall

# restore
mv ~/.claude/settings.json.local-backup ~/.claude/settings.json
```

## Pull requests

- Keep changes focused. Small PRs get merged faster.
- Add or update tests for behavioral changes (`test/merge.test.mjs`, `test/runner.test.mjs`).
- If you touch security-relevant code (trigger matching, AppleScript/`osascript` invocation, the `settings.json` merge), call that out explicitly in the PR description.
- CI must be green before merge.

## Releasing

Releases are tag-driven and published from CI with npm provenance:

```bash
# bump version in package.json, commit, then:
git tag v0.1.0
git push origin v0.1.0   # CI verifies tag == package.json version, runs tests, publishes
```

## Filing issues

Please include the output of `npx claude-atone --doctor`, your macOS version, and your Claude Code version. A bug template is provided.

## Security issues

**Do not** open a public issue. Email `aashutosh.code@gmail.com` instead — see [SECURITY.md](./SECURITY.md).
