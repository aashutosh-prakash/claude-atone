#!/usr/bin/env node
// on-stop.mjs — Claude Code `Stop` hook runner for claude-atone.
//
// Fires when Claude finishes a reply. Reads the transcript, looks at Claude's
// last message, and if it sounds like Claude is admitting a mistake, pops a
// new terminal window that plays the up-down "punishment" animation.
//
// macOS only (uses osascript to open a Terminal window). On other platforms it
// exits quietly. It always exits 0 so it never blocks Claude Code.

import { readFileSync, writeFileSync, appendFileSync, openSync, fstatSync, readSync, closeSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Stamped by the installer (bin/cli.mjs) at copy time; `npx claude-atone
// --doctor` reads it back to flag a runner left stale by a package update.
const RUNNER_VERSION = '0.0.0-dev';

// Debug log — only writes when CLAUDE_ATONE_DEBUG is set, so normal use
// doesn't accumulate a log on every reply. Created 0600 (may contain payload
// snippets) so it isn't world-readable.
const LOG = join(homedir(), '.claude', 'claude-atone', 'run.log');
function logRun(s) {
  if (!process.env.CLAUDE_ATONE_DEBUG) return;
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`, { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

// Cooldown so a burst of apologetic replies can't stack dialogs/Terminal
// windows — at most one trigger per window.
const COOLDOWN_MS = 60_000;
const STATE = join(homedir(), '.claude', 'claude-atone', '.last-trigger');
function onCooldown() {
  try {
    const last = Number(readFileSync(STATE, 'utf8').trim());
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return true;
  } catch {
    /* no state yet */
  }
  return false;
}
function markTriggered() {
  try {
    writeFileSync(STATE, String(Date.now()), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

// Read at most the last `maxBytes` of a file (we only need the tail of the
// transcript to find the last assistant message). Avoids reading a multi-MB
// session into memory on every Stop event.
function readTail(path, maxBytes) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    // readSync may return fewer bytes than requested; allocUnsafe is
    // uninitialized, so decode only the bytes actually read.
    const bytesRead = readSync(fd, buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// Phrases that signal "I (Claude) was wrong / I'm sorry". Case-insensitive.
const TRIGGERS = [
  "you're right",
  'you are right',
  'my mistake',
  'i apologi', // apologize / apologise
  "i'm sorry",
  'i am sorry',
  'i was wrong',
  'good catch',
  'my bad',
  'i made a mistake',
  'i made an error',
  'that was wrong',
  'i messed up',
  'oops',
];

// Case-insensitive substring match of the assistant text against TRIGGERS.
// This is the ONLY thing untrusted text is used for — it never reaches any
// executed command.
function matchesTrigger(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return TRIGGERS.some((t) => lower.includes(t));
}

// Read the whole hook payload from stdin (JSON), then act.
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Normalize whatever shape the assistant message comes in (string, content
// array, or {content:[...]}) down to plain text.
function extractText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const content = v.content ?? v;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ');
  }
  return '';
}

// Fallback: pull Claude's most recent assistant text out of the JSONL transcript.
const MAX_TRANSCRIPT_BYTES = 256 * 1024;
function lastAssistantText(transcriptPath) {
  let raw;
  try {
    raw = readTail(transcriptPath, MAX_TRANSCRIPT_BYTES);
  } catch {
    return '';
  }
  // If we started mid-file the first line may be a partial JSON fragment; the
  // per-line JSON.parse below simply skips it, which is fine for matching.
  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const msg = entry.message ?? entry;
    const role = msg.role ?? entry.type;
    if (role !== 'assistant') continue;
    const text = extractText(msg);
    if (text) return text;
  }
  return '';
}

// Ask the user (native macOS dialog) and, only on "Yes", open a small Terminal
// window, play the animation (~5s) and auto-close it. Runs as ONE detached
// osascript so it outlives this hook process while the user decides. Window is
// closed by id (saving no) — avoids a macOS coercion bug with
// `(tabs of w) contains t`. `clear` hides the echoed command before painting;
// a custom title keeps the tab header clean.
function playAnimation() {
  const anim = join(homedir(), '.claude', 'claude-atone', 'updown.mjs');
  if (process.env.CLAUDE_ATONE_DRYRUN) {
    console.log(`[dry-run] would prompt "atone?" then (on Yes) play: ${anim}`);
    return;
  }
  // Single-quote the path for the shell (handles spaces / metacharacters), then
  // escape the whole command for the double-quoted AppleScript string literal.
  const shellCmd = `clear; node '${anim.replace(/'/g, "'\\''")}' --once`;
  const cmd = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const osa = [
    'set doIt to false',
    'try',
    '  set ans to button returned of (display dialog "Do you want me to atone? 🙏" buttons {"No", "Yes"} default button "Yes" with title "claude-atone" giving up after 30)',
    '  if ans is "Yes" then set doIt to true',
    'end try',
    'if doIt then',
    '  tell application "Terminal"',
    '    activate',
    `    set t to do script "${cmd}"`,
    '    set winID to id of window 1',
    '    set custom title of t to "claude-atone 🙇"',
    '    set number of columns of window 1 to 28',
    '    set number of rows of window 1 to 18',
    '    repeat',
    '      delay 0.3',
    '      if not busy of t then exit repeat',
    '    end repeat',
    '    close (every window whose id is winID) saving no',
    '  end tell',
    'end if',
  ].join('\n');
  spawn('osascript', ['-e', osa], { detached: true, stdio: 'ignore' }).unref();
}

function main() {
  logRun(`fired platform=${platform()}`); // logged only when CLAUDE_ATONE_DEBUG is set
  if (platform() !== 'darwin') return; // macOS only for now
  const payload = readStdin();
  logRun(`payload(${payload.length})=${payload.slice(0, 400).replace(/\s+/g, ' ')}`);
  let data = {};
  try {
    data = JSON.parse(payload);
  } catch {
    logRun('bad-payload');
    return;
  }
  // Prefer the last_assistant_message Claude Code provides; fall back to the
  // transcript only if it's absent (avoids the file-write race at Stop time).
  let text = extractText(data.last_assistant_message);
  if (!text) text = lastAssistantText(data.transcript_path ?? '');
  const matched = matchesTrigger(text);
  logRun(`textlen=${text.length} matched=${matched}`);
  if (matched) {
    // --test (CLAUDE_ATONE_TEST) bypasses the cooldown and leaves real state
    // untouched, so verifying the install always fires.
    const testing = !!process.env.CLAUDE_ATONE_TEST;
    if (!testing && onCooldown()) {
      logRun('skipped (cooldown)');
      return;
    }
    if (!testing) markTriggered();
    playAnimation();
  }
}

// Only run the hook when executed directly (node on-stop.mjs); stays inert when
// imported by the test suite. argv[1] is canonicalized with realpathSync because
// import.meta.url is already realpath-resolved by Node — without it, a symlinked
// $HOME (or ancestor) makes the two URLs differ and the hook silently no-ops.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  try {
    main();
  } catch {
    // never block Claude Code
  }
  process.exit(0);
}

export { TRIGGERS, matchesTrigger, extractText, lastAssistantText, RUNNER_VERSION };
