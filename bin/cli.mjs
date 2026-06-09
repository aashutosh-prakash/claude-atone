#!/usr/bin/env node
// cli.mjs — installer/CLI for claude-atone (the `npx claude-atone` entry).
//
// Installs a Claude Code `Stop` hook into ~/.claude/settings.json and copies the
// runner (on-stop.mjs) + animation (updown.mjs) to ~/.claude/claude-atone/. All
// settings writes are backed up and atomic (temp file + rename), so a failed or
// interrupted write can never corrupt the user's config. macOS only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// We identify our own Stop entry solely by these markers in the command path, so
// other Stop hooks (e.g. claude-nudge) are never touched. LEGACY_MARKER matches
// installs from before the claude-punishment → claude-atone rename, so install
// migrates (refreshes) the old entry instead of leaving a duplicate, and
// uninstall removes it.
const RUNNER_MARKER = 'claude-atone/on-stop.mjs';
const LEGACY_MARKER = 'claude-punishment/on-stop.mjs';
const KEEP_BACKUPS = 5;

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const isTTY = process.stdout.isTTY;
const c = (code, str) => (isTTY ? code + str + COLOR.reset : str);

// ── pure helpers (exported for tests) ───────────────────────────────────────

function parseArgs(argv) {
  const flags = {
    install: true,
    uninstall: false,
    test: false,
    doctor: false,
    dryRun: false,
    help: false,
    version: false,
  };
  for (const arg of argv) {
    switch (arg) {
      case '--uninstall': flags.uninstall = true; flags.install = false; break;
      case '--test': flags.test = true; flags.install = false; break;
      case '--doctor': flags.doctor = true; flags.install = false; break;
      case '--dry-run': flags.dryRun = true; break;
      case '--install': flags.install = true; break; // explicit form of the default
      case '-h': case '--help': flags.help = true; flags.install = false; break;
      case '-v': case '--version': flags.version = true; flags.install = false; break;
      default:
        process.stderr.write(`claude-atone: unknown flag: ${arg}\n`);
        process.exit(2);
    }
  }
  return flags;
}

function paths(home) {
  const claudeDir = path.join(home, '.claude');
  const runnerDir = path.join(claudeDir, 'claude-atone');
  return {
    claudeDir,
    settings: path.join(claudeDir, 'settings.json'),
    runnerDir,
    runner: path.join(runnerDir, 'on-stop.mjs'),
    anim: path.join(runnerDir, 'updown.mjs'),
    backupDir: path.join(claudeDir, '.claude-atone-backups'),
    legacyRunnerDir: path.join(claudeDir, 'claude-punishment'),
  };
}

// The command string written into settings.json. We use `node <path>` (rather
// than relying on the runner's exec bit) so the hook fires even if the exec bit
// is lost on copy.
const runnerCommand = (runner) => `node ${runner}`;

function isOurHookEntry(entry) {
  return (
    !!entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some(
      (h) =>
        h &&
        typeof h.command === 'string' &&
        (h.command.includes(RUNNER_MARKER) || h.command.includes(LEGACY_MARKER))
    )
  );
}

function buildOurEntry(runner) {
  return { hooks: [{ type: 'command', command: runnerCommand(runner) }] };
}

// Add (or refresh) our Stop entry, leaving every other Stop hook untouched.
function mergeStopHook(settings, ourEntry) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) next.hooks = {};
  if (!Array.isArray(next.hooks.Stop)) next.hooks.Stop = [];
  const idx = next.hooks.Stop.findIndex((e) => isOurHookEntry(e));
  if (idx === -1) {
    next.hooks.Stop.push(ourEntry);
    return { next, action: 'appended' };
  }
  next.hooks.Stop[idx] = ourEntry;
  return { next, action: 'refreshed' };
}

function removeStopHook(settings) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (!next.hooks || !Array.isArray(next.hooks.Stop)) return { next, removed: false };
  const before = next.hooks.Stop.length;
  next.hooks.Stop = next.hooks.Stop.filter((e) => !isOurHookEntry(e));
  const removed = next.hooks.Stop.length < before;
  if (next.hooks.Stop.length === 0) delete next.hooks.Stop;
  if (next.hooks && Object.keys(next.hooks).length === 0) delete next.hooks;
  return { next, removed };
}

function serializeSettings(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// The runner is copied verbatim, so it can't read our package.json. We bake the
// version into its RUNNER_VERSION constant at copy time; --doctor reads it back
// to flag a runner left stale by a package update.
function stampRunnerVersion(source, version) {
  return source.replace(/const RUNNER_VERSION = '[^']*';/, () => `const RUNNER_VERSION = '${version}';`);
}

function extractRunnerVersion(source) {
  const m = source.match(/const RUNNER_VERSION = '([^']*)';/);
  return m ? m[1] : null;
}

// ── impure helpers ───────────────────────────────────────────────────────────

function fail(msg, code = 1) {
  process.stderr.write(c(COLOR.red, `✗ ${msg}`) + '\n');
  process.exit(code);
}

function ensureMac() {
  if (process.platform !== 'darwin') {
    fail(`claude-atone only supports macOS. Detected platform: ${process.platform}`);
  }
}

function ensureHomedirSafe() {
  const home = os.homedir();
  if (!home || !path.isAbsolute(home)) {
    fail(`Could not resolve a valid home directory (got: ${JSON.stringify(home)})`);
  }
  // The hook command (`node <path>`) is executed by Claude Code via a shell, so
  // a home path with shell metacharacters would be unsafe.
  if (/[;$`"'\\\n\r]/.test(home)) {
    fail(`Home directory contains shell-meta characters and is unsafe for hook installation: ${home}`);
  }
  return home;
}

function ensureDir(dir, mode) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode });
  if (mode !== undefined) {
    try { fs.chmodSync(dir, mode); } catch { /* best effort */ }
  }
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  const stat = fs.lstatSync(settingsPath);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(settingsPath);
    const resolved = path.resolve(path.dirname(settingsPath), target);
    const claudeDir = path.dirname(settingsPath);
    if (!resolved.startsWith(claudeDir + path.sep) && resolved !== claudeDir) {
      fail(`Refusing to write: ~/.claude/settings.json is a symlink pointing outside ~/.claude/ (target: ${resolved})`);
    }
  }
  let raw;
  try { raw = fs.readFileSync(settingsPath, 'utf8'); }
  catch (err) { fail(`Could not read ${settingsPath}: ${err.message}`); }
  if (!raw.trim()) return {};
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { fail(`${settingsPath} is not valid JSON: ${err.message}`); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${settingsPath} is not a JSON object`);
  }
  return parsed;
}

function atomicWrite(filePath, contents, mode = 0o600) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    try {
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Don't leave an orphaned temp file behind on a failed write/rename.
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function isoTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function rotateBackups(dir, keep) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir)
    .filter((n) => n.startsWith('settings.json.'))
    .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { n } of entries.slice(keep)) {
    try { fs.unlinkSync(path.join(dir, n)); } catch { /* ignore */ }
  }
}

function backupSettings(p) {
  if (!fs.existsSync(p.settings)) return null;
  ensureDir(p.backupDir, 0o700);
  const backupPath = path.join(p.backupDir, `settings.json.${isoTimestamp()}`);
  fs.writeFileSync(backupPath, fs.readFileSync(p.settings), { mode: 0o600 });
  rotateBackups(p.backupDir, KEEP_BACKUPS);
  return backupPath;
}

function installRunner(p) {
  ensureDir(p.runnerDir, 0o755);
  const stamped = stampRunnerVersion(fs.readFileSync(path.join(__dirname, 'on-stop.mjs'), 'utf8'), PKG.version);
  fs.writeFileSync(p.runner, stamped, { mode: 0o755 });
  try { fs.chmodSync(p.runner, 0o755); } catch { /* best effort */ }
  fs.copyFileSync(path.join(__dirname, 'updown.mjs'), p.anim);
  try { fs.chmodSync(p.anim, 0o755); } catch { /* best effort */ }
}

function simpleDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(c(COLOR.red, `- ${a[i]}`));
    if (b[i] !== undefined) out.push(c(COLOR.green, `+ ${b[i]}`));
  }
  return out.join('\n');
}

// ── commands ─────────────────────────────────────────────────────────────────

function printHelp() {
  process.stdout.write(`claude-atone — when Claude Code admits a mistake, it does penance squats in a popup

Usage:
  npx claude-atone              Install the Stop hook + runner into ~/.claude
  npx claude-atone --uninstall  Remove the Stop hook and the runner directory
  npx claude-atone --test       Pop the "atone?" dialog now to verify the install
  npx claude-atone --doctor     Diagnose install health
  npx claude-atone --dry-run    Show what would change without writing
  npx claude-atone --help       This text
  npx claude-atone --version    Print version

Docs: ${PKG.homepage || 'https://github.com/aashutosh-prakash/claude-atone'}
`);
}

function cmdInstall(p, flags) {
  // Don't touch the filesystem on a dry run — it must stay read-only.
  if (!flags.dryRun) ensureDir(p.claudeDir, 0o755);
  const before = readSettings(p.settings);
  const { next, action } = mergeStopHook(before, buildOurEntry(p.runner));
  const beforeStr = serializeSettings(before);
  const afterStr = serializeSettings(next);

  if (flags.dryRun) {
    process.stdout.write(c(COLOR.cyan, '── dry-run: proposed changes to ~/.claude/settings.json ──') + '\n');
    process.stdout.write((simpleDiff(beforeStr, afterStr) || c(COLOR.dim, '  (no settings change — hook already present)')) + '\n');
    process.stdout.write(c(COLOR.cyan, '── would also: ──') + '\n');
    process.stdout.write(`  write runner   : ${p.runner}\n`);
    process.stdout.write(`  write animation: ${p.anim}\n`);
    process.stdout.write(`  write backup   : ${p.backupDir}/settings.json.<timestamp>\n`);
    return;
  }

  const backupPath = backupSettings(p);
  installRunner(p);
  atomicWrite(p.settings, afterStr, 0o600);

  const box = [
    c(COLOR.green, '✓ claude-atone installed'),
    `  hook    : Stop  (${action})`,
    `  runner  : ${p.runner}`,
    `  backup  : ${backupPath || '(no previous settings to back up)'}`,
    `  next    : ${c(COLOR.cyan, 'npx claude-atone --test')}  ${c(COLOR.dim, '(pops the "atone?" dialog now)')}`,
  ];
  process.stdout.write(box.join('\n') + '\n');
}

function cmdUninstall(p, flags) {
  if (!fs.existsSync(p.settings)) {
    process.stdout.write('Nothing to uninstall: ~/.claude/settings.json does not exist.\n');
    return;
  }
  const before = readSettings(p.settings);
  const { next, removed } = removeStopHook(before);
  const beforeStr = serializeSettings(before);
  const afterStr = serializeSettings(next);

  if (flags.dryRun) {
    process.stdout.write(c(COLOR.cyan, '── dry-run: proposed uninstall changes ──') + '\n');
    process.stdout.write((simpleDiff(beforeStr, afterStr) || c(COLOR.dim, '  (no hook from claude-atone found)')) + '\n');
    process.stdout.write(`  would remove runner dir: ${p.runnerDir}\n`);
    return;
  }

  const backupPath = backupSettings(p);
  if (removed) atomicWrite(p.settings, afterStr, 0o600);
  if (fs.existsSync(p.runnerDir)) fs.rmSync(p.runnerDir, { recursive: true, force: true });
  // Also clean up a pre-rename install dir, if present.
  if (fs.existsSync(p.legacyRunnerDir)) fs.rmSync(p.legacyRunnerDir, { recursive: true, force: true });

  process.stdout.write([
    c(COLOR.green, '✓ claude-atone uninstalled'),
    `  hook    : ${removed ? 'removed' : '(not found — nothing to remove)'}`,
    `  runner  : ${p.runnerDir} removed`,
    `  backup  : ${backupPath || '(none)'}  ${c(COLOR.dim, '(kept in ' + p.backupDir + ')')}`,
  ].join('\n') + '\n');
}

function cmdTest(p) {
  if (!fs.existsSync(p.runner)) fail('Runner not installed yet. Run `npx claude-atone` first.');
  // Drive the real runner end-to-end with a triggering payload. CLAUDE_ATONE_TEST
  // bypasses the cooldown so --test always fires (and doesn't touch real state).
  const payload = JSON.stringify({ last_assistant_message: "You're right — my mistake. Good catch." });
  try {
    execFileSync(process.execPath, [p.runner], {
      input: payload,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, CLAUDE_ATONE_TEST: '1' },
    });
    process.stdout.write(c(COLOR.green, '✓ test trigger fired') + '\n');
    process.stdout.write(c(COLOR.dim, '  A native dialog should appear. Click "Yes" to watch the animation.') + '\n');
  } catch (err) {
    fail(`Failed to fire test trigger: ${err.message}`);
  }
}

function check(label, ok, hint) {
  const mark = ok ? c(COLOR.green, '✓') : c(COLOR.red, '✗');
  process.stdout.write(`  ${mark} ${label}${ok ? '' : c(COLOR.dim, '  — ' + hint)}\n`);
  return ok;
}

function cmdDoctor(p) {
  process.stdout.write(c(COLOR.cyan, 'claude-atone doctor') + '\n');
  let allOk = true;
  allOk = check('platform is macOS', process.platform === 'darwin', `detected ${process.platform}`) && allOk;
  allOk = check('node >= 18', Number(process.versions.node.split('.')[0]) >= 18, `detected ${process.versions.node}`) && allOk;

  const settingsExists = fs.existsSync(p.settings);
  allOk = check('~/.claude/settings.json exists', settingsExists, 'run `npx claude-atone` to create') && allOk;

  if (settingsExists) {
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(p.settings, 'utf8') || '{}'); check('settings.json parses as JSON', true); }
    catch (err) { allOk = check('settings.json parses as JSON', false, err.message) && allOk; }

    const arr = settings.hooks && Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
    const ours = arr.find((e) => isOurHookEntry(e));
    allOk = check('Stop hook entry present (→ claude-atone)', !!ours, 'not installed; run `npx claude-atone`') && allOk;
  }

  const runnerExists = fs.existsSync(p.runner);
  allOk = check(`runner exists: ${p.runner}`, runnerExists, 'reinstall with `npx claude-atone`') && allOk;
  allOk = check(`animation exists: ${p.anim}`, fs.existsSync(p.anim), 'reinstall with `npx claude-atone`') && allOk;

  if (runnerExists) {
    let rv = null;
    try { rv = extractRunnerVersion(fs.readFileSync(p.runner, 'utf8')); } catch { /* ignore */ }
    if (!rv || rv === '0.0.0-dev') {
      process.stdout.write(`  ${c(COLOR.dim, '·')} ${c(COLOR.dim, `runner version: ${rv || 'unknown'} (installed before version stamping)`)}\n`);
    } else if (rv === PKG.version) {
      check(`runner version: ${rv} (matches package)`, true);
    } else {
      check(`runner version: ${rv}`, true);
      process.stdout.write(c(COLOR.yellow, `    ⚠ package is ${PKG.version} — runner is stale; run \`npx claude-atone@latest\` to update it`) + '\n');
    }
  }

  let osascriptOk = false;
  try { execFileSync('which', ['osascript'], { stdio: 'ignore' }); osascriptOk = true; } catch { /* noop */ }
  allOk = check('osascript is available', osascriptOk, 'macOS normally ships this — check PATH') && allOk;

  process.stdout.write('\n');
  if (allOk) process.stdout.write(c(COLOR.green, 'All checks passed.') + '\n');
  else { process.stdout.write(c(COLOR.yellow, 'Some checks failed. See hints above.') + '\n'); process.exit(1); }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) { printHelp(); return; }
  if (flags.version) { process.stdout.write(PKG.version + '\n'); return; }

  if (flags.dryRun && process.platform !== 'darwin') {
    process.stdout.write(c(COLOR.yellow, `⚠  --dry-run on non-macOS (${process.platform}) — showing what would happen on macOS\n`));
  } else {
    ensureMac();
  }
  const p = paths(ensureHomedirSafe());

  if (flags.doctor) return cmdDoctor(p);
  if (flags.test) return cmdTest(p);
  if (flags.uninstall) return cmdUninstall(p, flags);
  return cmdInstall(p, flags);
}

// `npx claude-atone` runs this through a node_modules/.bin symlink, so argv[1]
// is the symlink path while import.meta.url is realpath-resolved — canonicalize
// argv[1] before comparing, or the CLI silently does nothing when invoked.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(c(COLOR.red, `✗ ${err && (err.stack || err.message) ? err.stack || err.message : err}`) + '\n');
    process.exit(1);
  }
}

export {
  parseArgs,
  isOurHookEntry,
  buildOurEntry,
  mergeStopHook,
  removeStopHook,
  serializeSettings,
  stampRunnerVersion,
  extractRunnerVersion,
  runnerCommand,
  RUNNER_MARKER,
  LEGACY_MARKER,
};
