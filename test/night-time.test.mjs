import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeVoyageNightMs, formatDurationMs } from '../public/data.js';

/**
 * Function: loadVoyagesFixture
 * Description: Load the voyages JSON fixture from the public directory.
 * Parameters: None.
 * Returns: object[] - Array of voyage records.
 */
function loadVoyagesFixture() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(here, '../public/voyages.json');
  const payload = JSON.parse(readFileSync(fixturePath, 'utf8'));
  return Array.isArray(payload?.voyages) ? payload.voyages : [];
}

/**
 * Function: formatVoyageLabel
 * Description: Build a human-readable label for a voyage based on timestamps.
 * Parameters:
 *   voyage (object): Voyage record to label.
 * Returns: string - Label containing start/end timestamps when available.
 */
function formatVoyageLabel(voyage) {
  const start = voyage?.startTime || 'unknown start';
  const end = voyage?.endTime || 'unknown end';
  return `${start} → ${end}`;
}

test('night time per voyage is computed and reported', () => {
  const voyages = loadVoyagesFixture();
  assert.ok(voyages.length > 0, 'Expected voyages fixture to contain at least one voyage.');

  const results = voyages.map((voyage, index) => {
    const nightMs = computeVoyageNightMs(voyage);
    return {
      index: index + 1,
      nightMs
    };
  });

  assert.equal(results.length, voyages.length);
  results.forEach((result) => {
    assert.ok(Number.isFinite(result.nightMs), `Voyage ${result.index} night time should be finite.`);
    assert.ok(result.nightMs >= 0, `Voyage ${result.index} night time should be non-negative.`);
  });

  console.log('Night time per voyage (sailing/motoring only):');
  results.forEach((result) => {
    const voyage = voyages[result.index - 1];
    console.log(
      `#${result.index} ${formatVoyageLabel(voyage)} | night=${formatDurationMs(result.nightMs)}`
    );
  });

  const totalNightMs = results.reduce((sum, result) => sum + result.nightMs, 0);
  console.log(`Total night time across voyages: ${formatDurationMs(totalNightMs)}`);
});
