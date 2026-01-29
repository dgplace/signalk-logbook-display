/**
 * Test suite for manual voyage route persistence in multi-leg trips.
 * Run with: node --test test/manual-route-persistence.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManualVoyageFromRecord,
  buildManualSegmentsFromStops
} from '../public/data.js';

describe('manual voyage route persistence', () => {
  it('preserves per-leg route points for overnight multi-leg voyages', () => {
    const record = {
      id: 'manual-test-overnight',
      returnTrip: false,
      locations: [
        {
          name: 'Start',
          lat: 0,
          lon: 0,
          time: '2025-01-01T00:00:00.000Z',
          routePoints: [
            { lat: 0, lon: 0 },
            { lat: 0.5, lon: 0.5 },
            { lat: 1, lon: 1 }
          ]
        },
        {
          name: 'Middle',
          lat: 1,
          lon: 1,
          time: '2025-01-01T01:00:00.000Z',
          routePoints: [
            { lat: 1, lon: 1 },
            { lat: 1.5, lon: 1.5 },
            { lat: 2, lon: 2 }
          ]
        },
        {
          name: 'End',
          lat: 2,
          lon: 2,
          time: '2025-01-01T02:00:00.000Z'
        }
      ]
    };

    const voyage = buildManualVoyageFromRecord(record);
    assert.ok(voyage);
    assert.ok(Array.isArray(voyage.manualLocations));
    assert.equal(voyage.manualLocations.length, 3);
    assert.equal(voyage.manualLocations[0].routePoints.length, 3);
    assert.equal(voyage.manualLocations[1].routePoints.length, 3);
    assert.equal(voyage.manualLocations[0].routePoints[1].lat, 0.5);
    assert.equal(voyage.manualLocations[1].routePoints[1].lon, 1.5);

    const segments = buildManualSegmentsFromStops(voyage.manualLocations);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].points.length, 3);
    assert.equal(segments[1].points.length, 3);
    assert.equal(segments[0].points[1].lat, 0.5);
    assert.equal(segments[1].points[1].lon, 1.5);

    assert.ok(Array.isArray(voyage.points));
    assert.ok(voyage.points.length > voyage.manualLocations.length);
    assert.equal(voyage.points[1].lat, 0.5);
    assert.equal(voyage.points[2].lon, 1);
  });
});
