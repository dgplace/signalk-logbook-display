/**
 * Module Responsibilities:
 * - Provide pure calculation functions for manual voyage operations.
 * - Enable unit testing of logic independent of DOM or state.
 *
 * Exported API:
 * - normalizeLocationName
 * - parseDateInput
 * - isSameCoordinate
 * - normalizeRoutePoints
 * - calculateRouteDistanceNm
 * - calculateOutboundDistanceNm
 * - stitchRoutePoints
 * - splitRoutePoints
 */

import { calculateDistanceNm } from './data.js';

/**
 * Function: normalizeLocationName
 * Description: Normalize a location name for case-insensitive lookup keys.
 * Parameters:
 *   name (string): Location name to normalize.
 * Returns: string - Normalized lookup key.
 */
export function normalizeLocationName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase();
}

/**
 * Function: parseDateInput
 * Description: Parse a datetime-local input value into a Date object.
 * Parameters:
 *   value (string): Raw input value to parse.
 * Returns: Date|null - Parsed Date instance or null when invalid.
 */
export function parseDateInput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * Function: isSameCoordinate
 * Description: Compare two latitude/longitude pairs with a small tolerance.
 * Parameters:
 *   a (object): First coordinate with lat/lon values.
 *   b (object): Second coordinate with lat/lon values.
 *   epsilon (number): Optional tolerance for comparisons.
 * Returns: boolean - True when the coordinates are effectively the same.
 */
export function isSameCoordinate(a, b, epsilon = 1e-6) {
  if (!a || !b) return false;
  const latA = Number(a.lat);
  const lonA = Number(a.lon);
  const latB = Number(b.lat);
  const lonB = Number(b.lon);
  if (!Number.isFinite(latA) || !Number.isFinite(lonA) || !Number.isFinite(latB) || !Number.isFinite(lonB)) return false;
  return Math.abs(latA - latB) <= epsilon && Math.abs(lonA - lonB) <= epsilon;
}

/**
 * Function: normalizeRoutePoints
 * Description: Normalize a list of route points into lat/lon objects.
 * Parameters:
 *   points (object[]): Raw route point list.
 * Returns: object[]|null - Normalized points or null when invalid.
 */
export function normalizeRoutePoints(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const normalized = points.map((point) => {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  });
  if (normalized.some(point => !point) || normalized.length < 2) return null;
  return normalized;
}

/**
 * Function: calculateRouteDistanceNm
 * Description: Sum the total route distance across points, optionally closing the loop.
 * Parameters:
 *   points (object[]): Ordered route points with lat/lon values.
 *   closeLoop (boolean): When true, include the final leg back to the start.
 * Returns: number|null - Route distance in nautical miles or null when invalid.
 */
export function calculateRouteDistanceNm(points, closeLoop) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let distanceNm = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const legDistance = calculateDistanceNm(prev.lat, prev.lon, next.lat, next.lon);
    distanceNm += Number.isFinite(legDistance) ? legDistance : 0;
  }
  if (closeLoop && points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (!isSameCoordinate(first, last)) {
      const legDistance = calculateDistanceNm(last.lat, last.lon, first.lat, first.lon);
      distanceNm += Number.isFinite(legDistance) ? legDistance : 0;
    }
  }
  return distanceNm;
}

/**
 * Function: calculateOutboundDistanceNm
 * Description: Sum the outbound distance from start to the turnaround index.
 * Parameters:
 *   points (object[]): Ordered route points with lat/lon values.
 *   turnIndex (number): Index of the turnaround point.
 * Returns: number|null - Outbound distance in nautical miles or null when invalid.
 */
export function calculateOutboundDistanceNm(points, turnIndex) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const safeIndex = Number.isInteger(turnIndex)
    ? Math.max(1, Math.min(turnIndex, points.length - 1))
    : points.length - 1;
  const outboundPoints = points.slice(0, safeIndex + 1);
  return calculateRouteDistanceNm(outboundPoints, false);
}

/**
 * Function: stitchRoutePoints
 * Description: Stitch leg arrays into a continuous route by joining shared endpoints.
 * Parameters:
 *   legs (object[][]): Array of leg point arrays, each with lat/lon objects.
 * Returns: object[]|null - Continuous route points or null when invalid.
 */
export function stitchRoutePoints(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const validLegs = legs.filter(leg => Array.isArray(leg) && leg.length >= 2);
  if (validLegs.length === 0) return null;

  const result = [];
  for (let i = 0; i < validLegs.length; i += 1) {
    const leg = validLegs[i];
    const normalizedLeg = normalizeRoutePoints(leg);
    if (!normalizedLeg) continue;

    if (result.length === 0) {
      result.push(...normalizedLeg);
    } else {
      const lastPoint = result[result.length - 1];
      const firstOfLeg = normalizedLeg[0];
      if (isSameCoordinate(lastPoint, firstOfLeg)) {
        result.push(...normalizedLeg.slice(1));
      } else {
        result.push(...normalizedLeg);
      }
    }
  }

  return result.length >= 2 ? result : null;
}

/**
 * Function: splitRoutePoints
 * Description: Split a continuous route into legs at specified stop indices.
 * Parameters:
 *   points (object[]): Continuous route points with lat/lon values.
 *   stopIndices (number[]): Indices where stops occur (leg boundaries).
 * Returns: object[][]|null - Array of leg point arrays or null when invalid.
 */
export function splitRoutePoints(points, stopIndices) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (!Array.isArray(stopIndices) || stopIndices.length === 0) {
    return [normalizeRoutePoints(points)].filter(Boolean);
  }

  const normalized = normalizeRoutePoints(points);
  if (!normalized) return null;

  const sortedIndices = [...new Set(stopIndices)]
    .filter(idx => Number.isInteger(idx) && idx > 0 && idx < normalized.length)
    .sort((a, b) => a - b);

  if (sortedIndices.length === 0) {
    return [normalized];
  }

  const legs = [];
  let startIdx = 0;

  for (const stopIdx of sortedIndices) {
    if (stopIdx > startIdx) {
      const leg = normalized.slice(startIdx, stopIdx + 1);
      if (leg.length >= 2) {
        legs.push(leg);
      }
    }
    startIdx = stopIdx;
  }

  if (startIdx < normalized.length - 1) {
    const finalLeg = normalized.slice(startIdx);
    if (finalLeg.length >= 2) {
      legs.push(finalLeg);
    }
  }

  return legs.length > 0 ? legs : null;
}
