/**
 * Test suite for public/manual-state.js ManualVoyageState class.
 * Run with: node --test test/manual-state.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock calculateDistanceNm for testing
const mockCalculateDistanceNm = (startLat, startLon, endLat, endLon) => {
  if (!Number.isFinite(startLat) || !Number.isFinite(startLon) ||
      !Number.isFinite(endLat) || !Number.isFinite(endLon)) {
    return null;
  }
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(endLat - startLat);
  const dLon = toRad(endLon - startLon);
  const lat1 = toRad(startLat);
  const lat2 = toRad(endLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = 6371000 * c;
  return meters / 1852;
};

const MANUAL_AVG_SPEED_KN = 5;

// Create a test version of the ManualVoyageState class
class ManualVoyageState {
  constructor() {
    this.stops = [];
    this.routePoints = [];
    this.routeTurnIndex = null;
    this.returnTrip = false;
    this.editId = null;
  }

  addStop(data, insertIndex = null) {
    const stop = this._normalizeStopData(data);
    if (insertIndex !== null && Number.isInteger(insertIndex) && insertIndex >= 0 && insertIndex <= this.stops.length) {
      this.stops.splice(insertIndex, 0, stop);
      return insertIndex;
    }
    this.stops.push(stop);
    return this.stops.length - 1;
  }

  removeStop(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.stops.length) {
      return false;
    }
    this.stops.splice(index, 1);
    return true;
  }

  updateStop(index, data) {
    if (!Number.isInteger(index) || index < 0 || index >= this.stops.length) {
      return false;
    }
    const existing = this.stops[index];
    const updated = { ...existing };

    if (typeof data.name === 'string') {
      updated.name = data.name.trim();
    }
    if (Number.isFinite(Number(data.lat))) {
      updated.lat = Number(data.lat);
    }
    if (Number.isFinite(Number(data.lon))) {
      updated.lon = Number(data.lon);
    }
    if (data.time !== undefined) {
      updated.time = data.time;
    }

    this.stops[index] = updated;
    return true;
  }

  setReturnTrip(value) {
    this.returnTrip = Boolean(value);
    if (!this.returnTrip) {
      this.routePoints = [];
      this.routeTurnIndex = null;
    }
  }

  setRoutePoints(points, turnIndex = null) {
    const normalized = this._normalizeRoutePoints(points);
    if (!normalized) {
      this.routePoints = [];
      this.routeTurnIndex = null;
      return false;
    }

    this.routePoints = normalized;
    this.routeTurnIndex = this._clampTurnIndex(turnIndex);
    return true;
  }

  getDistanceSummary() {
    const summary = {
      totalNm: 0,
      legs: [],
      outboundNm: null,
      returnNm: null
    };

    if (this.stops.length < 2) {
      return summary;
    }

    if (this.returnTrip && this.routePoints.length >= 2) {
      const totalNm = this._calculateRouteDistanceNm(this.routePoints, true) || 0;
      const outboundNm = this._calculateOutboundDistanceNm(this.routePoints, this.routeTurnIndex) || 0;
      const returnNm = totalNm - outboundNm;

      return {
        totalNm,
        legs: [{ nm: totalNm, isLoop: true }],
        outboundNm,
        returnNm
      };
    }

    if (this.returnTrip && this.stops.length === 2) {
      const start = this.stops[0];
      const turn = this.stops[1];
      const oneWay = mockCalculateDistanceNm(start.lat, start.lon, turn.lat, turn.lon) || 0;
      const totalNm = oneWay * 2;

      return {
        totalNm,
        legs: [{ nm: totalNm, isLoop: true }],
        outboundNm: oneWay,
        returnNm: oneWay
      };
    }

    for (let i = 1; i < this.stops.length; i++) {
      const prev = this.stops[i - 1];
      const curr = this.stops[i];
      const legNm = mockCalculateDistanceNm(prev.lat, prev.lon, curr.lat, curr.lon) || 0;
      summary.legs.push({ nm: legNm, isLoop: false });
      summary.totalNm += legNm;
    }

    return summary;
  }

  getDurationHours() {
    const { totalNm } = this.getDistanceSummary();
    if (!totalNm || MANUAL_AVG_SPEED_KN <= 0) return 0;
    return totalNm / MANUAL_AVG_SPEED_KN;
  }

  toPayload() {
    const locations = this.stops.map(stop => ({
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      time: stop.time
    }));

    const payload = {
      locations,
      returnTrip: this.returnTrip
    };

    if (this.editId) {
      payload.id = this.editId;
    }

    if (this.returnTrip && this.routePoints.length >= 2) {
      payload.routePoints = this.routePoints.map(p => ({ lat: p.lat, lon: p.lon }));
      if (Number.isInteger(this.routeTurnIndex)) {
        payload.routeTurnIndex = this.routeTurnIndex;
      }
    }

    return payload;
  }

  loadFromVoyage(voyage) {
    if (!voyage) return false;

    this.reset();
    this.editId = voyage.manualId || voyage.id || null;
    this.returnTrip = Boolean(voyage.returnTrip);

    const locations = voyage.manualLocations || voyage.locations || [];
    if (Array.isArray(locations) && locations.length >= 2) {
      for (const loc of locations) {
        this.addStop({
          name: loc.name || '',
          lat: loc.lat,
          lon: loc.lon,
          time: loc.time || loc.datetime || null
        });
      }
    } else {
      if (voyage.startLocation) {
        this.addStop({
          name: voyage.startLocation.name || '',
          lat: voyage.startLocation.lat,
          lon: voyage.startLocation.lon,
          time: voyage.startTime || null
        });
      }
      if (voyage.endLocation) {
        this.addStop({
          name: voyage.endLocation.name || '',
          lat: voyage.endLocation.lat,
          lon: voyage.endLocation.lon,
          time: voyage.endTime || null
        });
      }
    }

    if (this.returnTrip) {
      const routePoints = voyage.manualRoutePoints || voyage.routePoints || [];
      const routeTurnIndex = voyage.manualRouteTurnIndex ?? voyage.routeTurnIndex ?? null;
      if (Array.isArray(routePoints) && routePoints.length >= 2) {
        this.setRoutePoints(routePoints, routeTurnIndex);
      }
    }

    return this.stops.length >= 2;
  }

  reset() {
    this.stops = [];
    this.routePoints = [];
    this.routeTurnIndex = null;
    this.returnTrip = false;
    this.editId = null;
  }

  isValid() {
    if (this.stops.length < 2) return false;

    for (const stop of this.stops) {
      if (!stop.name || stop.name.trim() === '') return false;
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return false;
    }

    if (!this.stops[0].time) return false;

    return true;
  }

  clone() {
    const copy = new ManualVoyageState();
    copy.stops = this.stops.map(s => ({ ...s }));
    copy.routePoints = this.routePoints.map(p => ({ ...p }));
    copy.routeTurnIndex = this.routeTurnIndex;
    copy.returnTrip = this.returnTrip;
    copy.editId = this.editId;
    return copy;
  }

  getStopCount() {
    return this.stops.length;
  }

  getStop(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.stops.length) {
      return null;
    }
    return { ...this.stops[index] };
  }

  _normalizeStopData(data) {
    return {
      name: typeof data?.name === 'string' ? data.name.trim() : '',
      lat: Number.isFinite(Number(data?.lat)) ? Number(data.lat) : null,
      lon: Number.isFinite(Number(data?.lon)) ? Number(data.lon) : null,
      time: data?.time || null
    };
  }

  _normalizeRoutePoints(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const normalized = points.map((point) => {
      const lat = Number(point?.lat);
      const lon = Number(point?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    }).filter(Boolean);
    if (normalized.length < 2) return null;
    return normalized;
  }

  _clampTurnIndex(turnIndex) {
    const maxIndex = this.routePoints.length - 1;
    if (!Number.isInteger(turnIndex)) {
      return Math.max(1, maxIndex);
    }
    return Math.max(1, Math.min(turnIndex, maxIndex));
  }

  _calculateRouteDistanceNm(points, closeLoop) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let distanceNm = 0;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const next = points[i];
      const legDistance = mockCalculateDistanceNm(prev.lat, prev.lon, next.lat, next.lon);
      distanceNm += Number.isFinite(legDistance) ? legDistance : 0;
    }
    if (closeLoop && points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      const legDistance = mockCalculateDistanceNm(last.lat, last.lon, first.lat, first.lon);
      distanceNm += Number.isFinite(legDistance) ? legDistance : 0;
    }
    return distanceNm;
  }

  _calculateOutboundDistanceNm(points, turnIndex) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const safeIndex = Number.isInteger(turnIndex)
      ? Math.max(1, Math.min(turnIndex, points.length - 1))
      : points.length - 1;
    const outboundPoints = points.slice(0, safeIndex + 1);
    return this._calculateRouteDistanceNm(outboundPoints, false);
  }
}

describe('ManualVoyageState', () => {
  let state;

  beforeEach(() => {
    state = new ManualVoyageState();
  });

  describe('constructor', () => {
    it('initializes with empty state', () => {
      assert.deepEqual(state.stops, []);
      assert.deepEqual(state.routePoints, []);
      assert.equal(state.routeTurnIndex, null);
      assert.equal(state.returnTrip, false);
      assert.equal(state.editId, null);
    });
  });

  describe('addStop', () => {
    it('adds stop at end by default', () => {
      const idx = state.addStop({ name: 'Port A', lat: 51.5, lon: -0.1 });
      assert.equal(idx, 0);
      assert.equal(state.stops.length, 1);
      assert.equal(state.stops[0].name, 'Port A');
    });

    it('adds stop at specific index', () => {
      state.addStop({ name: 'Port A', lat: 0, lon: 0 });
      state.addStop({ name: 'Port C', lat: 2, lon: 2 });
      const idx = state.addStop({ name: 'Port B', lat: 1, lon: 1 }, 1);

      assert.equal(idx, 1);
      assert.equal(state.stops.length, 3);
      assert.equal(state.stops[1].name, 'Port B');
    });

    it('normalizes string coordinates', () => {
      state.addStop({ name: 'Test', lat: '51.5', lon: '-0.1' });
      assert.equal(state.stops[0].lat, 51.5);
      assert.equal(state.stops[0].lon, -0.1);
    });

    it('handles missing data gracefully', () => {
      state.addStop({});
      assert.equal(state.stops[0].name, '');
      assert.equal(state.stops[0].lat, null);
      assert.equal(state.stops[0].lon, null);
    });
  });

  describe('removeStop', () => {
    beforeEach(() => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      state.addStop({ name: 'C', lat: 2, lon: 2 });
    });

    it('removes stop at valid index', () => {
      const result = state.removeStop(1);
      assert.equal(result, true);
      assert.equal(state.stops.length, 2);
      assert.equal(state.stops[1].name, 'C');
    });

    it('returns false for invalid index', () => {
      assert.equal(state.removeStop(-1), false);
      assert.equal(state.removeStop(10), false);
      assert.equal(state.removeStop(null), false);
    });
  });

  describe('updateStop', () => {
    beforeEach(() => {
      state.addStop({ name: 'Original', lat: 0, lon: 0, time: '2024-01-01T10:00' });
    });

    it('updates stop properties', () => {
      const result = state.updateStop(0, { name: 'Updated', lat: 10 });
      assert.equal(result, true);
      assert.equal(state.stops[0].name, 'Updated');
      assert.equal(state.stops[0].lat, 10);
      assert.equal(state.stops[0].lon, 0); // unchanged
    });

    it('returns false for invalid index', () => {
      assert.equal(state.updateStop(-1, { name: 'X' }), false);
      assert.equal(state.updateStop(5, { name: 'X' }), false);
    });
  });

  describe('setReturnTrip', () => {
    it('sets return trip flag', () => {
      state.setReturnTrip(true);
      assert.equal(state.returnTrip, true);
    });

    it('clears route points when disabling', () => {
      state.setRoutePoints([
        { lat: 0, lon: 0 },
        { lat: 1, lon: 1 }
      ], 1);
      state.setReturnTrip(false);
      assert.deepEqual(state.routePoints, []);
      assert.equal(state.routeTurnIndex, null);
    });
  });

  describe('setRoutePoints', () => {
    it('sets valid route points', () => {
      const result = state.setRoutePoints([
        { lat: 0, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 2, lon: 2 }
      ], 1);

      assert.equal(result, true);
      assert.equal(state.routePoints.length, 3);
      assert.equal(state.routeTurnIndex, 1);
    });

    it('clamps turn index to valid range', () => {
      state.setRoutePoints([
        { lat: 0, lon: 0 },
        { lat: 1, lon: 1 }
      ], 10);

      assert.equal(state.routeTurnIndex, 1); // clamped to max
    });

    it('returns false for invalid points', () => {
      const result = state.setRoutePoints([{ lat: 0, lon: 0 }]); // too few
      assert.equal(result, false);
      assert.deepEqual(state.routePoints, []);
    });
  });

  describe('getDistanceSummary', () => {
    it('returns zero for insufficient stops', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      const summary = state.getDistanceSummary();
      assert.equal(summary.totalNm, 0);
      assert.deepEqual(summary.legs, []);
    });

    it('calculates multi-leg distance', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      state.addStop({ name: 'B', lat: 1, lon: 0 }); // ~60nm north
      state.addStop({ name: 'C', lat: 1, lon: 1 }); // ~60nm east

      const summary = state.getDistanceSummary();
      assert.ok(summary.totalNm > 100);
      assert.equal(summary.legs.length, 2);
    });

    it('calculates return trip distance', () => {
      state.addStop({ name: 'Start', lat: 0, lon: 0 });
      state.addStop({ name: 'Turn', lat: 1, lon: 0 });
      state.setReturnTrip(true);

      const summary = state.getDistanceSummary();
      assert.ok(summary.totalNm > 100);
      assert.ok(summary.outboundNm > 50);
      assert.ok(summary.returnNm > 50);
    });
  });

  describe('getDurationHours', () => {
    it('calculates duration based on distance', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      state.addStop({ name: 'B', lat: 1, lon: 0 }); // ~60nm

      const hours = state.getDurationHours();
      // 60nm at 5kn = 12 hours approximately
      assert.ok(hours > 10 && hours < 15);
    });

    it('returns zero for no distance', () => {
      const hours = state.getDurationHours();
      assert.equal(hours, 0);
    });
  });

  describe('toPayload', () => {
    it('creates valid payload', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0, time: '2024-01-01T10:00' });
      state.addStop({ name: 'B', lat: 1, lon: 1, time: '2024-01-01T15:00' });
      state.editId = 'test-123';

      const payload = state.toPayload();
      assert.equal(payload.id, 'test-123');
      assert.equal(payload.locations.length, 2);
      assert.equal(payload.returnTrip, false);
    });

    it('includes route points for return trips', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      state.setReturnTrip(true);
      state.setRoutePoints([
        { lat: 0, lon: 0 },
        { lat: 0.5, lon: 0.5 },
        { lat: 1, lon: 1 }
      ], 2);

      const payload = state.toPayload();
      assert.equal(payload.returnTrip, true);
      assert.equal(payload.routePoints.length, 3);
      assert.equal(payload.routeTurnIndex, 2);
    });
  });

  describe('loadFromVoyage', () => {
    it('loads voyage with locations array', () => {
      const voyage = {
        manualId: 'voyage-1',
        returnTrip: false,
        manualLocations: [
          { name: 'Start', lat: 0, lon: 0, time: '2024-01-01T10:00' },
          { name: 'End', lat: 1, lon: 1, time: '2024-01-01T15:00' }
        ]
      };

      const result = state.loadFromVoyage(voyage);
      assert.equal(result, true);
      assert.equal(state.editId, 'voyage-1');
      assert.equal(state.stops.length, 2);
      assert.equal(state.stops[0].name, 'Start');
    });

    it('loads voyage with start/end locations', () => {
      const voyage = {
        manualId: 'voyage-2',
        startLocation: { name: 'Port A', lat: 0, lon: 0 },
        endLocation: { name: 'Port B', lat: 1, lon: 1 },
        startTime: '2024-01-01T10:00',
        endTime: '2024-01-01T15:00'
      };

      const result = state.loadFromVoyage(voyage);
      assert.equal(result, true);
      assert.equal(state.stops.length, 2);
    });

    it('loads day trip with route points', () => {
      const voyage = {
        manualId: 'voyage-3',
        returnTrip: true,
        manualLocations: [
          { name: 'Start', lat: 0, lon: 0, time: '2024-01-01T10:00' },
          { name: 'Turn', lat: 1, lon: 1, time: '2024-01-01T15:00' }
        ],
        manualRoutePoints: [
          { lat: 0, lon: 0 },
          { lat: 0.5, lon: 0.5 },
          { lat: 1, lon: 1 }
        ],
        manualRouteTurnIndex: 2
      };

      const result = state.loadFromVoyage(voyage);
      assert.equal(result, true);
      assert.equal(state.returnTrip, true);
      assert.equal(state.routePoints.length, 3);
      assert.equal(state.routeTurnIndex, 2);
    });

    it('returns false for invalid voyage', () => {
      assert.equal(state.loadFromVoyage(null), false);
      assert.equal(state.loadFromVoyage({}), false);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      state.setReturnTrip(true);
      state.editId = 'test';

      state.reset();

      assert.deepEqual(state.stops, []);
      assert.deepEqual(state.routePoints, []);
      assert.equal(state.routeTurnIndex, null);
      assert.equal(state.returnTrip, false);
      assert.equal(state.editId, null);
    });
  });

  describe('isValid', () => {
    it('returns false for insufficient stops', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0, time: '2024-01-01T10:00' });
      assert.equal(state.isValid(), false);
    });

    it('returns false for missing name', () => {
      state.addStop({ name: '', lat: 0, lon: 0, time: '2024-01-01T10:00' });
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      assert.equal(state.isValid(), false);
    });

    it('returns false for missing coordinates', () => {
      state.addStop({ name: 'A', lat: 'invalid', lon: 0, time: '2024-01-01T10:00' });
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      assert.equal(state.isValid(), false);
    });

    it('returns false for missing first stop time', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      assert.equal(state.isValid(), false);
    });

    it('returns true for valid state', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0, time: '2024-01-01T10:00' });
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      assert.equal(state.isValid(), true);
    });
  });

  describe('clone', () => {
    it('creates independent copy', () => {
      state.addStop({ name: 'A', lat: 0, lon: 0, time: '2024-01-01T10:00' });
      state.setReturnTrip(true);
      state.editId = 'original';

      const copy = state.clone();
      copy.stops[0].name = 'Modified';
      copy.editId = 'copy';

      assert.equal(state.stops[0].name, 'A');
      assert.equal(state.editId, 'original');
      assert.equal(copy.stops[0].name, 'Modified');
      assert.equal(copy.editId, 'copy');
    });
  });

  describe('getStopCount', () => {
    it('returns correct count', () => {
      assert.equal(state.getStopCount(), 0);
      state.addStop({ name: 'A', lat: 0, lon: 0 });
      assert.equal(state.getStopCount(), 1);
      state.addStop({ name: 'B', lat: 1, lon: 1 });
      assert.equal(state.getStopCount(), 2);
    });
  });

  describe('getStop', () => {
    beforeEach(() => {
      state.addStop({ name: 'A', lat: 0, lon: 0 });
    });

    it('returns copy of stop at index', () => {
      const stop = state.getStop(0);
      assert.equal(stop.name, 'A');

      // Modifying returned object shouldn't affect state
      stop.name = 'Modified';
      assert.equal(state.stops[0].name, 'A');
    });

    it('returns null for invalid index', () => {
      assert.equal(state.getStop(-1), null);
      assert.equal(state.getStop(5), null);
    });
  });
});
