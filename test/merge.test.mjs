import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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
} from '../bin/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = '/Users/test/.claude/claude-atone/on-stop.mjs';
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

test('buildOurEntry: produces a no-matcher Stop entry with our marker', () => {
  const e = buildOurEntry(RUNNER);
  assert.equal(e.matcher, undefined);
  assert.equal(e.hooks.length, 1);
  assert.equal(e.hooks[0].type, 'command');
  assert.ok(e.hooks[0].command.includes(RUNNER_MARKER));
  assert.equal(e.hooks[0].command, runnerCommand(RUNNER));
});

test('isOurHookEntry: matches our entry, rejects foreign and malformed', () => {
  assert.equal(isOurHookEntry(buildOurEntry(RUNNER)), true);
  assert.equal(isOurHookEntry({ hooks: [{ type: 'command', command: 'node /x/claude-nudge/notify.js' }] }), false);
  assert.equal(isOurHookEntry(null), false);
  assert.equal(isOurHookEntry({}), false);
  assert.equal(isOurHookEntry({ hooks: 'nope' }), false);
});

test('mergeStopHook: appends into empty settings', () => {
  const { next, action } = mergeStopHook(loadFixture('empty.json'), buildOurEntry(RUNNER));
  assert.equal(action, 'appended');
  assert.equal(next.hooks.Stop.length, 1);
  assert.ok(isOurHookEntry(next.hooks.Stop[0]));
});

test('mergeStopHook: preserves a foreign Stop hook (e.g. claude-nudge)', () => {
  const { next } = mergeStopHook(loadFixture('with-other-stop.json'), buildOurEntry(RUNNER));
  assert.equal(next.hooks.Stop.length, 2);
  assert.equal(next.theme, 'dark');
  assert.ok(next.hooks.Stop.some((e) => e.hooks[0].command.includes('claude-nudge')));
  assert.ok(next.hooks.Stop.some(isOurHookEntry));
});

test('mergeStopHook: idempotent — refreshes instead of duplicating', () => {
  const once = mergeStopHook(loadFixture('empty.json'), buildOurEntry(RUNNER)).next;
  const { next, action } = mergeStopHook(once, buildOurEntry(RUNNER));
  assert.equal(action, 'refreshed');
  assert.equal(next.hooks.Stop.filter(isOurHookEntry).length, 1);
});

const legacyEntry = () => ({ hooks: [{ type: 'command', command: `node /Users/test/.claude/claude-punishment/on-stop.mjs` }] });

test('isOurHookEntry: also matches a pre-rename (claude-punishment) entry', () => {
  assert.ok(LEGACY_MARKER.includes('claude-punishment'));
  assert.equal(isOurHookEntry(legacyEntry()), true);
});

test('mergeStopHook: migrates a legacy entry in place (no duplicate)', () => {
  const settings = { hooks: { Stop: [legacyEntry()] } };
  const { next, action } = mergeStopHook(settings, buildOurEntry(RUNNER));
  assert.equal(action, 'refreshed');
  assert.equal(next.hooks.Stop.length, 1);
  assert.ok(next.hooks.Stop[0].hooks[0].command.includes(RUNNER_MARKER));
});

test('removeStopHook: removes a legacy (claude-punishment) entry too', () => {
  const { next, removed } = removeStopHook({ hooks: { Stop: [legacyEntry()] } });
  assert.equal(removed, true);
  assert.equal(next.hooks, undefined);
});

test('mergeStopHook: type-normalizes a wrong-typed hooks/Stop', () => {
  assert.doesNotThrow(() => mergeStopHook({ hooks: 'oops' }, buildOurEntry(RUNNER)));
  const { next } = mergeStopHook({ hooks: { Stop: 'nope' } }, buildOurEntry(RUNNER));
  assert.ok(Array.isArray(next.hooks.Stop));
  assert.equal(next.hooks.Stop.filter(isOurHookEntry).length, 1);
});

test('removeStopHook: removes ours, keeps foreign, prunes empties', () => {
  const added = mergeStopHook(loadFixture('with-other-stop.json'), buildOurEntry(RUNNER)).next;
  const { next, removed } = removeStopHook(added);
  assert.equal(removed, true);
  assert.equal(next.hooks.Stop.length, 1);
  assert.ok(next.hooks.Stop[0].hooks[0].command.includes('claude-nudge'));
});

test('removeStopHook: deletes hooks key entirely when only ours existed', () => {
  const added = mergeStopHook(loadFixture('empty.json'), buildOurEntry(RUNNER)).next;
  const { next, removed } = removeStopHook(added);
  assert.equal(removed, true);
  assert.equal(next.hooks, undefined);
});

test('removeStopHook: no-op when nothing of ours present', () => {
  const { next, removed } = removeStopHook(loadFixture('with-other-stop.json'));
  assert.equal(removed, false);
  assert.equal(next.hooks.Stop.length, 1);
});

test('round-trip add → remove restores the original settings', () => {
  const original = loadFixture('with-other-stop.json');
  const added = mergeStopHook(original, buildOurEntry(RUNNER)).next;
  const back = removeStopHook(added).next;
  assert.equal(serializeSettings(back), serializeSettings(original));
});

test('runner version stamping round-trips', () => {
  const src = "const RUNNER_VERSION = '0.0.0-dev';\n";
  const stamped = stampRunnerVersion(src, '1.2.3');
  assert.equal(extractRunnerVersion(stamped), '1.2.3');
});

test('parseArgs: defaults to install', () => {
  assert.deepEqual(parseArgs([]).install, true);
});

test('parseArgs: recognizes each flag', () => {
  assert.equal(parseArgs(['--uninstall']).uninstall, true);
  assert.equal(parseArgs(['--uninstall']).install, false);
  assert.equal(parseArgs(['--test']).test, true);
  assert.equal(parseArgs(['--doctor']).doctor, true);
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--version']).version, true);
  assert.equal(parseArgs(['-v']).version, true);
});
