import test from 'node:test';
import assert from 'node:assert/strict';

import { supportsTruecolor, rgbTo256, colorSeq } from '../bin/updown.mjs';

const ESC = '\x1b[';

test('supportsTruecolor: only true when COLORTERM advertises 24-bit color', () => {
  assert.equal(supportsTruecolor({ COLORTERM: 'truecolor' }), true);
  assert.equal(supportsTruecolor({ COLORTERM: '24bit' }), true);
  assert.equal(supportsTruecolor({ COLORTERM: 'TrueColor' }), true);
  assert.equal(supportsTruecolor({ COLORTERM: ' truecolor ' }), true); // tolerate whitespace
  // A fresh Apple Terminal login shell sets no COLORTERM -> must fall back.
  assert.equal(supportsTruecolor({}), false);
  assert.equal(supportsTruecolor({ COLORTERM: '' }), false);
  assert.equal(supportsTruecolor({ COLORTERM: 'yes' }), false);
  assert.equal(supportsTruecolor({ COLORTERM: '256color' }), false);
});

test('rgbTo256: maps RGB to a valid xterm-256 index (16..255)', () => {
  for (const c of [[70, 150, 220], [95, 105, 140], [217, 119, 87], [25, 25, 25], [200, 120, 70]]) {
    const idx = rgbTo256(c);
    assert.ok(Number.isInteger(idx), `index must be an integer, got ${idx}`);
    assert.ok(idx >= 16 && idx <= 255, `index out of range: ${idx}`);
  }
  // Cube corners are exact.
  assert.equal(rgbTo256([0, 0, 0]), 16); // bottom of the 6x6x6 cube
  assert.equal(rgbTo256([255, 255, 255]), 231); // top of the cube
  // A neutral gray should pick the grayscale ramp (232..255), not a cube cell.
  const gray = rgbTo256([130, 130, 130]);
  assert.ok(gray >= 232 && gray <= 255, `expected grayscale ramp, got ${gray}`);
});

test('colorSeq: truecolor mode emits 38;2/48;2 direct-color escapes', () => {
  assert.equal(colorSeq([70, 150, 220], { bg: false, truecolor: true }), `${ESC}38;2;70;150;220m`);
  assert.equal(colorSeq([70, 150, 220], { bg: true, truecolor: true }), `${ESC}48;2;70;150;220m`);
});

test('colorSeq: 256-color mode emits 38;5/48;5 indexed escapes (no 38;2)', () => {
  const fg = colorSeq([70, 150, 220], { bg: false, truecolor: false });
  const bg = colorSeq([70, 150, 220], { bg: true, truecolor: false });
  assert.equal(fg, `${ESC}38;5;${rgbTo256([70, 150, 220])}m`);
  assert.equal(bg, `${ESC}48;5;${rgbTo256([70, 150, 220])}m`);
  assert.ok(!fg.includes('38;2'), 'must not emit a 24-bit escape in 256-color mode');
});
