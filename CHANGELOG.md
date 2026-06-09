# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

Initial public release.

### Added
- macOS Claude Code `Stop` hook: when Claude's reply matches a "mistake" phrase,
  a native dialog asks to atone and, on **Yes**, plays a pixel-art squat
  ("uthak-baithak") animation in a popup Terminal window.
- `npx claude-atone` installer/CLI with `--uninstall`, `--test`, `--doctor`,
  `--dry-run`, `--help`, `--version`.
- Atomic, backed-up `~/.claude/settings.json` writes; foreign `Stop` hooks
  preserved; migration of pre-rename `claude-punishment` installs.
- Zero runtime dependencies; published to npm with OIDC provenance.

[0.1.0]: https://github.com/aashutosh-prakash/claude-atone/releases/tag/v0.1.0
