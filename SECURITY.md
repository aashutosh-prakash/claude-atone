# Security Policy

## Reporting

Report vulnerabilities privately to **aashutosh.code@gmail.com**. Do not open a public GitHub issue.

I will acknowledge within 7 days and aim to publish a fix or explanation within 90 days.

## Threat model

claude-atone is a macOS Claude Code `Stop` hook. On every reply it reads the
hook payload on stdin and, as a fallback, the tail of your session transcript.

**An attacker controls:** the LLM assistant output text and the JSON payload on
the hook's stdin (`last_assistant_message`, `transcript_path`). Both are
same-user, harness-supplied inputs.

**What that input can do:** flip a single boolean that decides whether a native
**consent dialog** appears. Nothing more.

**What it cannot do:** there is no code/command/AppleScript injection, no code
execution without an explicit human "Yes" click (after which only a fixed local
script runs), no network egress, and no privilege escalation. Everything runs as
the invoking user.

**Privacy:** your transcript is read **locally only**, used solely for
case-insensitive substring matching, and is **never transmitted anywhere**. The
tool has no network code. With `CLAUDE_ATONE_DEBUG` set, payload snippets are
written to `~/.claude/claude-atone/run.log` (created mode `0600`); it is silent
otherwise.

## Security properties

These are load-bearing invariants — regressions are security bugs:

- **No untrusted text reaches an executed command.** The assistant message and
  transcript content are only lowercased and `includes()`-matched into a
  boolean. They are never interpolated into the AppleScript, the `osascript`
  invocation, or any shell command. See `bin/on-stop.mjs`.
- **Argv-based `osascript` invocation.** `osascript` is spawned with an `argv`
  array (`spawn('osascript', ['-e', osa])`), not through a shell. The only
  dynamic value placed into the AppleScript is the self-derived `homedir()`
  animation path, which is single-quote-escaped for the shell and
  backslash-escaped for the AppleScript string literal.
- **Consent-gated execution.** No animation runs until the user clicks "Yes" in
  a native dialog (which self-dismisses after 30s). On "No" or timeout, nothing
  runs.
- **Never blocks Claude Code.** `bin/on-stop.mjs` wraps all work in `try/catch`
  and always `process.exit(0)`. On non-macOS it is a no-op. The dialog/animation
  is spawned detached so it outlives the hook.
- **Bounded reads.** Only the last 256 KB of the transcript is read, so an
  arbitrarily long session cannot blow up memory or latency on the Stop path.
- **Rate-limited.** A 60-second cooldown (`~/.claude/claude-atone/.last-trigger`)
  prevents a burst of apologetic replies from stacking dialogs or windows.
- **Atomic settings writes.** `~/.claude/settings.json` is written via
  `tmp + fsync + rename`, so an interrupted write can never truncate or corrupt
  it. The previous contents are snapshotted to
  `~/.claude/.claude-atone-backups/` before both install (`add`) and uninstall
  (`remove`). See `bin/cli.mjs`.
- **Hook-preserving.** Install/uninstall add and remove only claude-atone's own
  `Stop` entry; any other hooks (e.g. `claude-nudge`) are left untouched.
- **Zero runtime dependencies.** Node standard library only — no
  `dependencies`/`devDependencies`, no lockfile, no `node_modules`. Verified in
  CI.
- **Zero npm lifecycle scripts.** No `preinstall`/`install`/`postinstall`/
  `prepare` etc. `npm install` and `npx` execute nothing beyond the `bin`
  command the user invokes. Verified in CI against the published tarball.
- **No remote code execution on install.** `npx claude-atone` runs the package's
  own `bin/cli.mjs`, which copies two local files and edits `settings.json`.
  Nothing is fetched or `eval`'d from the network.
- **Published with npm provenance.** Verify with
  `npm audit signatures claude-atone`. Releases are published from GitHub Actions
  via OIDC trusted publishing — no long-lived `NPM_TOKEN` in repo secrets.
- **Symlink-safe settings writes.** The installer refuses to write through a
  `~/.claude/settings.json` symlink that points outside `~/.claude/`, and rejects
  a `$HOME` containing shell-meta characters before building the hook command.

## Out of scope

- Vulnerabilities in Claude Code itself, Node.js, or macOS — report upstream.
- PATH hijacking, symlink, or file-permission attacks that presuppose an
  already-compromised user account.
