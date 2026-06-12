# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.4]

### Fixed
- Figure still rendered magenta on macOS Sequoia+ even after 0.1.3: Apple
  Terminal advertises `COLORTERM=truecolor` in the popup's login shell while
  its renderer still mangles 24-bit `38;2` escapes (terracotta → magenta, blue
  shirt → gray). `COLORTERM` therefore can't be trusted as a capability signal
  there. The animation now hard-disables truecolor whenever
  `TERM_PROGRAM=Apple_Terminal` and uses the 256-color fallback it renders
  correctly; other terminals (iTerm2, VS Code, …) still get true 24-bit color
  (`bin/updown.mjs`).

## [0.1.3]

### Fixed
- Figure rendered solid magenta on Macs whose Terminal.app build lacks 24-bit
  truecolor support. The animation now emits the universally-supported
  256-color palette by default and only uses truecolor when the terminal
  advertises it via `COLORTERM` (`bin/updown.mjs`).

### Documented
- README now notes that the popup opening as a tab (rather than a window) is the
  macOS *"Prefer tabs when opening documents"* setting, and that switching it to
  "Manually" yields a clean popup window.

## [0.1.2]

### Changed
- Shorten the trigger cooldown from 60s to 20s (`COOLDOWN_MS` in
  `bin/on-stop.mjs`) so back-to-back apologies pop more responsively while still
  guarding against stacked dialog/Terminal windows.

## [0.1.1]

First properly-released version (published from CI with OIDC provenance).
Supersedes the manually-published 0.1.0.

### Fixed
- Center the popup figure (animation window 28×18 → 22×16).
- `bin` path no longer uses a leading `./` (silences npm's "bin script name was
  cleaned" warning and ensures a clean `npx` shim).

### Added
- Surface the macOS Automation permission the popup needs: install/`--test`/
  `--doctor` output and a README "macOS permission" section.

## [0.1.0]

Initial public release (manually published; superseded by 0.1.1).

### Added
- macOS Claude Code `Stop` hook: when Claude's reply matches a "mistake" phrase,
  a native dialog asks to atone and, on **Yes**, plays a pixel-art squat
  animation in a popup Terminal window.
- `npx claude-atone` installer/CLI with `--uninstall`, `--test`, `--doctor`,
  `--dry-run`, `--help`, `--version`.
- Atomic, backed-up `~/.claude/settings.json` writes; foreign `Stop` hooks
  preserved; migration of pre-rename `claude-punishment` installs.
- Zero runtime dependencies.

[0.1.2]: https://github.com/aashutosh-prakash/claude-atone/releases/tag/v0.1.2
[0.1.1]: https://github.com/aashutosh-prakash/claude-atone/releases/tag/v0.1.1
[0.1.0]: https://github.com/aashutosh-prakash/claude-atone/releases/tag/v0.1.0
