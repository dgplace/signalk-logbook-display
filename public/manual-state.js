/**
 * Module Responsibilities:
 * - Provide a state container for manual voyage panel data.
 * - Enable testable state mutations independent of DOM.
 *
 * Exported API:
 * - ManualVoyageState class
 *
 * @typedef {import('./types.js').ManualVoyageStop} ManualVoyageStop
 * @typedef {import('./types.js').ManualRoutePoint} ManualRoutePoint
 */

import {
  normalizeRoutePoints,
  calculateRouteDistanceNm,
  calculateOutboundDistanceNm,
  isSameCoordinate
} from './manual-logic.js';
import { calculateDistanceNm, MANUAL_AVG_SPEED_KN } from './data.js';

/**
 * @typedef {Object} ManualVoyageStateData
 * @property {ManualVoyageStop[]} stops - Ordered list of voyage stops
 * @property {ManualRoutePoint[]} routePoints - Optional route points for day trips
 * @property {number|null} routeTurnIndex - Index of turnaround point for day trips
 * @property {boolean} returnTrip - Whether this is a return/day trip
 * @property {string|null} editId - ID of voyage being edited, or null for new
 */

/**
 * Class: ManualVoyageState
 * Description: State container for manual voyage panel, enabling testable state mutations.
 */
export class ManualVoyageState {
  constructor() {
    /** @type {ManualVoyageStop[]} */
    this.stops = [];

    /** @type {ManualRoutePoint[]} */
    this.routePoints = [];

    /** @type {number|null} */
    this.routeTurnIndex = null;

    /** @type {boolean} */
    this.returnTrip = false;

    /** @type {string|null} */
    this.editId = null;
  }

  /**
   * Method: addStop
   * Description: Add a new stop to the voyage.
   * Parameters:
   *   data (object): Stop data with name, lat, lon, and optional time.
   *   insertIndex (number|null): Position to insert at, or null to append.
   * Returns: number - Index of the inserted stop.
   */
  addStop(data, insertIndex = null) {
    const stop = this._normalizeStopData(data);
    if (insertIndex !== null && Number.isInteger(insertIndex) && insertIndex >= 0 && insertIndex <= this.stops.length) {
      this.stops.splice(insertIndex, 0, stop);
      return insertIndex;
    }
    this.stops.push(stop);
    return this.stops.length - 1;
  }

  /**
   * Method: removeStop
   * Description: Remove a stop from the voyage.
   * Parameters:
   *   index (number): Index of the stop to remove.
   * Returns: boolean - True if a stop was removed.
   */
  removeStop(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.stops.length) {
      return false;
    }
    this.stops.splice(index, 1);
    return true;
  }

  /**
   * Method: updateStop
   * Description: Update an existing stop's data.
   * Parameters:
   *   index (number): Index of the stop to update.
   *   data (object): Partial stop data to merge.
   * Returns: boolean - True if the stop was updated.
   */
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

  /**
   * Method: setReturnTrip
   * Description: Set whether this is a return/day trip.
   * Parameters:
   *   value (boolean): True for return trips.
   * Returns: void.
   */
  setReturnTrip(value) {
    this.returnTrip = Boolean(value);
    if (!this.returnTrip) {
      this.routePoints = [];
      this.routeTurnIndex = null;
    }
  }

  /**
   * Method: setRoutePoints
   * Description: Set the route points for a day trip.
   * Parameters:
   *   points (object[]): Array of route points with lat/lon.
   *   turnIndex (number|null): Index of the turnaround point.
   * Returns: boolean - True if route points were set successfully.
   */
  setRoutePoints(points, turnIndex = null) {
    const normalized = normalizeRoutePoints(points);
    if (!normalized) {
      this.routePoints = [];
      this.routeTurnIndex = null;
      return false;
    }

    this.routePoints = normalized;
    this.routeTurnIndex = this._clampTurnIndex(turnIndex);
    return true;
  }

  /**
   * Method: getDistanceSummary
   * Description: Calculate total distance and per-leg distances.
   * Parameters: None.
   * Returns: object - Distance summary with totalNm, legs array, and outboundNm.
   */
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

    // For return trips with route points, use the route distance
    if (this.returnTrip && this.routePoints.length >= 2) {
      const totalNm = calculateRouteDistanceNm(this.routePoints, true) || 0;
      const outboundNm = calculateOutboundDistanceNm(this.routePoints, this.routeTurnIndex) || 0;
      const returnNm = totalNm - outboundNm;

      return {
        totalNm,
        legs: [{ nm: totalNm, isLoop: true }],
        outboundNm,
        returnNm
      };
    }

    // For return trips without route points
    if (this.returnTrip && this.stops.length === 2) {
      const start = this.stops[0];
      const turn = this.stops[1];
      const oneWay = calculateDistanceNm(start.lat, start.lon, turn.lat, turn.lon) || 0;
      const totalNm = oneWay * 2;

      return {
        totalNm,
        legs: [{ nm: totalNm, isLoop: true }],
        outboundNm: oneWay,
        returnNm: oneWay
      };
    }

    // For multi-leg voyages
    for (let i = 1; i < this.stops.length; i++) {
      const prev = this.stops[i - 1];
      const curr = this.stops[i];
      const legNm = calculateDistanceNm(prev.lat, prev.lon, curr.lat, curr.lon) || 0;
      summary.legs.push({ nm: legNm, isLoop: false });
      summary.totalNm += legNm;
    }

    return summary;
  }

  /**
   * Method: getDurationHours
   * Description: Calculate estimated duration based on default speed.
   * Parameters: None.
   * Returns: number - Estimated hours for the voyage.
   */
  getDurationHours() {
    const { totalNm } = this.getDistanceSummary();
    if (!totalNm || MANUAL_AVG_SPEED_KN <= 0) return 0;
    return totalNm / MANUAL_AVG_SPEED_KN;
  }

  /**
   * Method: toPayload
   * Description: Convert the state to an API payload for saving.
   * Parameters: None.
   * Returns: object - Payload suitable for the manual voyages API.
   */
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

  /**
   * Method: loadFromVoyage
   * Description: Load state from an existing voyage record.
   * Parameters:
   *   voyage (object): Voyage record to load.
   * Returns: boolean - True if the voyage was loaded successfully.
   */
  loadFromVoyage(voyage) {
    if (!voyage) return false;

    this.reset();
    this.editId = voyage.manualId || voyage.id || null;
    this.returnTrip = Boolean(voyage.returnTrip);

    // Load stops from locations or manual locations
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
      // Fallback to start/end locations
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

    // Load route points for day trips
    if (this.returnTrip) {
      const routePoints = voyage.manualRoutePoints || voyage.routePoints || [];
      const routeTurnIndex = voyage.manualRouteTurnIndex ?? voyage.routeTurnIndex ?? null;
      if (Array.isArray(routePoints) && routePoints.length >= 2) {
        this.setRoutePoints(routePoints, routeTurnIndex);
      }
    }

    return this.stops.length >= 2;
  }

  /**
   * Method: reset
   * Description: Reset the state to initial values.
   * Parameters: None.
   * Returns: void.
   */
  reset() {
    this.stops = [];
    this.routePoints = [];
    this.routeTurnIndex = null;
    this.returnTrip = false;
    this.editId = null;
  }

  /**
   * Method: isValid
   * Description: Check if the state represents a valid voyage.
   * Parameters: None.
   * Returns: boolean - True if the state is valid for saving.
   */
  isValid() {
    if (this.stops.length < 2) return false;

    for (const stop of this.stops) {
      if (!stop.name || stop.name.trim() === '') return false;
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return false;
    }

    // First stop must have a time
    if (!this.stops[0].time) return false;

    return true;
  }

  /**
   * Method: clone
   * Description: Create a deep copy of the state.
   * Parameters: None.
   * Returns: ManualVoyageState - A new state instance with copied data.
   */
  clone() {
    const copy = new ManualVoyageState();
    copy.stops = this.stops.map(s => ({ ...s }));
    copy.routePoints = this.routePoints.map(p => ({ ...p }));
    copy.routeTurnIndex = this.routeTurnIndex;
    copy.returnTrip = this.returnTrip;
    copy.editId = this.editId;
    return copy;
  }

  /**
   * Method: getStopCount
   * Description: Get the number of stops.
   * Parameters: None.
   * Returns: number - Number of stops in the voyage.
   */
  getStopCount() {
    return this.stops.length;
  }

  /**
   * Method: getStop
   * Description: Get a stop by index.
   * Parameters:
   *   index (number): Index of the stop.
   * Returns: object|null - The stop data or null if not found.
   */
  getStop(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.stops.length) {
      return null;
    }
    return { ...this.stops[index] };
  }

  /**
   * Method: _normalizeStopData
   * Description: Normalize raw stop input data.
   * Parameters:
   *   data (object): Raw stop data.
   * Returns: object - Normalized stop object.
   */
  _normalizeStopData(data) {
    return {
      name: typeof data?.name === 'string' ? data.name.trim() : '',
      lat: Number.isFinite(Number(data?.lat)) ? Number(data.lat) : null,
      lon: Number.isFinite(Number(data?.lon)) ? Number(data.lon) : null,
      time: data?.time || null
    };
  }

  /**
   * Method: _clampTurnIndex
   * Description: Clamp the turn index to valid bounds.
   * Parameters:
   *   turnIndex (number|null): Proposed turn index.
   * Returns: number - Clamped turn index.
   */
  _clampTurnIndex(turnIndex) {
    const maxIndex = this.routePoints.length - 1;
    if (!Number.isInteger(turnIndex)) {
      return Math.max(1, maxIndex);
    }
    return Math.max(1, Math.min(turnIndex, maxIndex));
  }
}
