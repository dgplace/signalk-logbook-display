/**
 * Module Responsibilities:
 * - Provide utilities for normalising voyage datasets returned by the back-end.
 * - Calculate derived metrics such as voyage totals, per-leg segments, and wind statistics.
 * - Expose fetch helpers with consistent caching behaviour for the front-end.
 *
 * Exported API:
 * - Extraction helpers: `getVoyagePoints`, `getPointActivity`, `shouldSkipConnection`, `extractWindSpeed`.
 * - Aggregation helpers: `computeVoyageTotals`, `computeVoyageNightMs`, `computeDaySegments`, `applyVoyageTimeMetrics`, `circularMean`.
 * - Formatting helpers: `formatDurationMs`.
 * - Manual helpers: `calculateDistanceNm`, `buildManualVoyageFromRecord`, `buildManualSegmentsFromStops`, `buildManualReturnSegmentFromStops`.
 * - Data loading: `fetchVoyagesData`, `fetchManualVoyagesData`.
 *
 * @typedef {import('./types.js').Voyage} Voyage
 * @typedef {import('./types.js').VoyagePoint} VoyagePoint
 * @typedef {import('./types.js').VoyageSegment} VoyageSegment
 * @typedef {import('./types.js').VoyageTotals} VoyageTotals
 * @typedef {import('./types.js').ManualVoyageRecord} ManualVoyageRecord
 */

/**
 * Function: getVoyagePoints
 * Description: Retrieve the best available array of points for a voyage regardless of source field.
 * Parameters:
 *   voyage (object): Voyage summary that may store points under multiple property names.
 * Returns: object[] - Array of point objects prepared for mapping.
 */
export function getVoyagePoints(voyage) {
  if (Array.isArray(voyage?.points) && voyage.points.length) return voyage.points;
  if (Array.isArray(voyage?.entries) && voyage.entries.length) return voyage.entries;
  if (Array.isArray(voyage?.coords) && voyage.coords.length) {
    return voyage.coords.map(([lon, lat]) => ({ lon, lat }));
  }
  return [];
}

/**
 * Function: getPointActivity
 * Description: Determine the activity type for a voyage point, falling back to sailing.
 * Parameters:
 *   point (object): Voyage point potentially containing activity metadata.
 * Returns: string - Activity label such as 'sailing', 'motoring', or 'anchored'.
 */
export function getPointActivity(point) {
  const activity = point?.activity ?? point?.entry?.activity;
  if (activity === 'sailing' || activity === 'motoring' || activity === 'anchored') return activity;
  return 'sailing';
}

/**
 * Function: readPointActivity
 * Description: Extract the explicit activity label from a point without applying defaults.
 * Parameters:
 *   point (object): Voyage point to inspect for activity metadata.
 * Returns: string - Activity label or empty string when unavailable.
 */
function readPointActivity(point) {
  const activity = point?.activity ?? point?.entry?.activity;
  if (activity === 'sailing' || activity === 'motoring' || activity === 'anchored') return activity;
  return '';
}

/**
 * Function: shouldSkipConnection
 * Description: Decide if two sequential points should not be connected when drawing or analysing a track.
 * Parameters:
 *   start (object): Point containing metadata for the segment start.
 *   end (object): Point containing metadata for the segment end.
 * Returns: boolean - True when the connection should be skipped due to stop markers.
 */
export function shouldSkipConnection(start, end) {
  if (!start || !end) return false;
  if (start && typeof start === 'object') {
    if (start.skipConnectionToNext) return true;
    if (start.entry && start.entry.skipConnectionToNext) return true;
  }
  if (end && typeof end === 'object') {
    if (end.skipConnectionFromPrev) return true;
    if (end.entry && end.entry.skipConnectionFromPrev) return true;
  }
  return false;
}

/**
 * Function: extractWindSpeed
 * Description: Resolve the wind speed in knots for a voyage point if available.
 * Parameters:
 *   point (object): Voyage point with optional wind metadata.
 * Returns: number|null - Wind speed in knots or null when missing.
 */
export function extractWindSpeed(point) {
  if (!point || typeof point !== 'object') return null;
  if (typeof point.windSpeed === 'number') return point.windSpeed;
  const windObj = point.entry?.wind;
  if (windObj && typeof windObj.speed === 'number') return windObj.speed;
  return null;
}

/**
 * Function: sumSegmentDurationMs
 * Description: Accumulate segment durations into a single millisecond total.
 * Parameters:
 *   segments (object[]): Segment list containing totalHours values.
 * Returns: number - Total duration in milliseconds.
 */
function sumSegmentDurationMs(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  return segments.reduce((sum, segment) => {
    const hours = Number.isFinite(segment?.totalHours) ? segment.totalHours : 0;
    return sum + (hours * 60 * 60 * 1000);
  }, 0);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SOLAR_OFFSET_MS_PER_DEG = 4 * 60 * 1000;

/**
 * Function: getLocalSolarDayStartMs
 * Description: Convert a timestamp into the UTC start of its local solar day using longitude offset.
 * Parameters:
 *   timestampMs (number): Epoch milliseconds to convert.
 *   longitude (number): Longitude in decimal degrees.
 * Returns: number - UTC timestamp for the start of the local solar day.
 */
function getLocalSolarDayStartMs(timestampMs, longitude) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(longitude)) return Number.NaN;
  const offsetMs = longitude * SOLAR_OFFSET_MS_PER_DEG;
  const localDate = new Date(timestampMs + offsetMs);
  const utcStartMs = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate()
  );
  return utcStartMs - offsetMs;
}

/**
 * Function: getCivilTwilightTimes
 * Description: Calculate civil dawn and dusk for a local date at a given location.
 * Parameters:
 *   date (Date): Date representing the local solar day.
 *   latitude (number): Latitude in decimal degrees.
 *   longitude (number): Longitude in decimal degrees.
 * Returns: object - Dawn/dusk timestamps with flags for polar day/night conditions.
 */
function getCivilTwilightTimes(date, latitude, longitude) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return { dawnMs: null, duskMs: null, alwaysDay: false, alwaysNight: false };
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { dawnMs: null, duskMs: null, alwaysDay: false, alwaysNight: false };
  }

  const rad = Math.PI / 180;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const dateMs = date.getTime();
  const d = (dateMs / DAY_MS - 0.5 + J1970) - J2000;
  const lw = rad * -longitude;
  const phi = rad * latitude;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + (lw / (2 * Math.PI)) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372;
  const L = M + C + P + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h = rad * -6;
  const numerator = Math.sin(h) - Math.sin(phi) * Math.sin(dec);
  const denominator = Math.cos(phi) * Math.cos(dec);
  if (!Number.isFinite(denominator) || denominator === 0) {
    if (numerator > 0) {
      return { dawnMs: null, duskMs: null, alwaysDay: false, alwaysNight: true };
    }
    if (numerator < 0) {
      return { dawnMs: null, duskMs: null, alwaysDay: true, alwaysNight: false };
    }
    return { dawnMs: null, duskMs: null, alwaysDay: false, alwaysNight: false };
  }
  const cosH = numerator / denominator;
  if (cosH > 1) {
    return { dawnMs: null, duskMs: null, alwaysDay: false, alwaysNight: true };
  }
  if (cosH < -1) {
    return { dawnMs: null, duskMs: null, alwaysDay: true, alwaysNight: false };
  }
  const w = Math.acos(cosH);
  const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  const dawnMs = (Jrise + 0.5 - J1970) * DAY_MS;
  const duskMs = (Jset + 0.5 - J1970) * DAY_MS;
  return { dawnMs, duskMs, alwaysDay: false, alwaysNight: false };
}

/**
 * Function: calculateNightOverlapMs
 * Description: Calculate the overlap between a time range and night hours at a given location.
 * Parameters:
 *   startMs (number): Range start time in milliseconds.
 *   endMs (number): Range end time in milliseconds.
 *   latitude (number): Latitude for the segment midpoint.
 *   longitude (number): Longitude for the segment midpoint.
 * Returns: number - Milliseconds of the range that occur at night.
 */
function calculateNightOverlapMs(startMs, endMs, latitude, longitude) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 0;
  const offsetMs = longitude * SOLAR_OFFSET_MS_PER_DEG;
  let dayStartMs = getLocalSolarDayStartMs(startMs, longitude);
  if (!Number.isFinite(dayStartMs)) return 0;
  let totalNightMs = 0;
  let safety = 0;
  while (dayStartMs < endMs && safety < 4000) {
    const dayEndMs = dayStartMs + DAY_MS;
    const overlapStart = Math.max(startMs, dayStartMs);
    const overlapEnd = Math.min(endMs, dayEndMs);
    if (overlapEnd > overlapStart) {
      const sunTimes = getCivilTwilightTimes(new Date(dayStartMs + offsetMs), latitude, longitude);
      if (sunTimes.alwaysNight) {
        totalNightMs += overlapEnd - overlapStart;
      } else if (!sunTimes.alwaysDay) {
        const dawnMs = sunTimes.dawnMs;
        const duskMs = sunTimes.duskMs;
        if (Number.isFinite(dawnMs) && Number.isFinite(duskMs) && dawnMs < duskMs) {
          const dawnStart = dayStartMs;
          const dawnEnd = Math.min(Math.max(dawnMs, dayStartMs), dayEndMs);
          const duskStart = Math.min(Math.max(duskMs, dayStartMs), dayEndMs);
          const duskEnd = dayEndMs;
          if (dawnEnd > dawnStart) {
            totalNightMs += Math.max(0, Math.min(overlapEnd, dawnEnd) - Math.max(overlapStart, dawnStart));
          }
          if (duskEnd > duskStart) {
            totalNightMs += Math.max(0, Math.min(overlapEnd, duskEnd) - Math.max(overlapStart, duskStart));
          }
        } else {
          totalNightMs += overlapEnd - overlapStart;
        }
      }
    }
    dayStartMs += DAY_MS;
    safety += 1;
  }
  return totalNightMs;
}

/**
 * Function: sumNightDurationMs
 * Description: Sum the night-time duration between consecutive points in a voyage path.
 * Parameters:
 *   points (object[]): Ordered voyage points with timestamps and coordinates.
 *   options (object): Options controlling activity filtering and connection skips.
 * Returns: number - Milliseconds of night travel across the points.
 */
function sumNightDurationMs(points, options = {}) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const useActivityFilter = options.useActivityFilter === true;
  const activeActivities = options.activeActivities instanceof Set ? options.activeActivities : new Set();
  const respectSkipConnection = options.respectSkipConnection !== false;
  let totalNightMs = 0;

  for (let idx = 1; idx < points.length; idx += 1) {
    const prev = points[idx - 1];
    const curr = points[idx];
    if (respectSkipConnection && shouldSkipConnection(prev, curr)) continue;
    const prevMs = getPointTimeMs(prev);
    const currMs = getPointTimeMs(curr);
    if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) continue;
    const gap = currMs - prevMs;
    if (!(gap > 0)) continue;
    if (useActivityFilter) {
      const prevAct = readPointActivity(prev);
      const currAct = readPointActivity(curr);
      if (!activeActivities.has(prevAct) || !activeActivities.has(currAct)) {
        continue;
      }
    }
    const prevLat = Number.isFinite(prev?.lat) ? prev.lat : null;
    const prevLon = Number.isFinite(prev?.lon) ? prev.lon : null;
    const currLat = Number.isFinite(curr?.lat) ? curr.lat : null;
    const currLon = Number.isFinite(curr?.lon) ? curr.lon : null;
    const hasPrev = Number.isFinite(prevLat) && Number.isFinite(prevLon);
    const hasCurr = Number.isFinite(currLat) && Number.isFinite(currLon);
    if (!hasPrev && !hasCurr) continue;
    const midLat = hasPrev && hasCurr ? (prevLat + currLat) / 2 : (hasPrev ? prevLat : currLat);
    const midLon = hasPrev && hasCurr ? (prevLon + currLon) / 2 : (hasPrev ? prevLon : currLon);
    totalNightMs += calculateNightOverlapMs(prevMs, currMs, midLat, midLon);
  }

  return totalNightMs;
}

/**
 * Function: computeVoyageNightMs
 * Description: Compute night-time travel duration for a voyage based on sailing/motoring point gaps.
 * Parameters:
 *   voyage (object): Voyage summary containing point data and timestamps.
 * Returns: number - Night-time travel duration in milliseconds.
 */
export function computeVoyageNightMs(voyage) {
  if (voyage && voyage.manual) return 0;
  const points = getVoyagePoints(voyage);
  if (!Array.isArray(points) || points.length < 2) return 0;
  const travelActivities = new Set(['sailing', 'motoring']);
  return sumNightDurationMs(points, {
    useActivityFilter: true,
    activeActivities: travelActivities,
    respectSkipConnection: true
  });
}

/**
 * Function: computeVoyageTotals
 * Description: Aggregate voyage distance plus active time from voyage total hours or leg durations and sailing/night activity durations.
 * Parameters:
 *   voyages (object[]): Voyage summaries containing point data and statistics.
 * Returns: object - Accumulated totals for distance (NM) and activity durations (milliseconds).
 */
export function computeVoyageTotals(voyages) {
  if (!Array.isArray(voyages) || voyages.length === 0) {
    return { totalDistanceNm: 0, totalActiveMs: 0, totalSailingMs: 0, totalNightMs: 0 };
  }

  let totalDistanceNm = 0;
  let totalActiveMs = 0;
  let totalSailingMs = 0;
  let totalNightMs = 0;
  const activeActivities = new Set(['sailing', 'motoring', 'anchored']);

  const readActivity = (point) => {
    const activity = point?.activity ?? point?.entry?.activity;
    if (typeof activity !== 'string') return '';
    return activity.toLowerCase();
  };

  voyages.forEach((voyage) => {
    if (typeof voyage?.nm === 'number' && Number.isFinite(voyage.nm)) {
      totalDistanceNm += voyage.nm;
    }
    const segments = Array.isArray(voyage?._segments) ? voyage._segments : [];
    const segmentDurationMs = sumSegmentDurationMs(segments);
    const points = getVoyagePoints(voyage);
    let pointsActiveMs = 0;
    let pointsSailingMs = 0;
    if (Array.isArray(points) && points.length >= 2) {
      for (let idx = 1; idx < points.length; idx += 1) {
        const prev = points[idx - 1];
        const curr = points[idx];
        if (shouldSkipConnection(prev, curr)) continue;
        const prevDt = prev?.entry?.datetime || prev?.datetime;
        const currDt = curr?.entry?.datetime || curr?.datetime;
        if (!prevDt || !currDt) continue;
        const prevDate = new Date(prevDt);
        const currDate = new Date(currDt);
        const prevMs = prevDate.getTime();
        const currMs = currDate.getTime();
        if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) continue;
        const gap = currMs - prevMs;
        if (!(gap > 0)) continue;
        const prevAct = readActivity(prev);
        const currAct = readActivity(curr);
        if (activeActivities.has(prevAct) && activeActivities.has(currAct)) {
          pointsActiveMs += gap;
          if (prevAct === 'sailing' && currAct === 'sailing') {
            pointsSailingMs += gap;
          }
        }
      }
    }

    let voyageActiveMs = 0;
    if (Number.isFinite(voyage?.totalHours)) {
      voyageActiveMs = voyage.totalHours * 60 * 60 * 1000;
    } else if (segmentDurationMs > 0) {
      voyageActiveMs = segmentDurationMs;
    } else {
      voyageActiveMs = pointsActiveMs;
    }
    totalActiveMs += voyageActiveMs;

    let voyageSailingMs = pointsSailingMs;
    if (voyageActiveMs > 0 && voyageSailingMs > voyageActiveMs) {
      voyageSailingMs = voyageActiveMs;
    }
    totalSailingMs += voyageSailingMs;

    let voyageNightMs = computeVoyageNightMs(voyage);
    if (voyageActiveMs > 0 && voyageNightMs > voyageActiveMs) {
      voyageNightMs = voyageActiveMs;
    }
    totalNightMs += voyageNightMs;
  });

  return { totalDistanceNm, totalActiveMs, totalSailingMs, totalNightMs };
}

/**
 * Function: formatDurationMs
 * Description: Convert a duration in milliseconds to a human-readable hours/minutes string, adding days when needed.
 * Parameters:
 *   durationMs (number): Duration expressed in milliseconds.
 * Returns: string - Formatted "Xd Yh Zm" or "Yh Zm" duration string.
 */
export function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0h 0m';
  const totalMinutes = Math.round(durationMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const remainingMinutes = totalMinutes - (days * 24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Function: resolveRelativeUrl
 * Description: Resolve a relative resource URL against the current page location.
 * Parameters:
 *   relativePath (string): Relative path to resolve.
 * Returns: string - Fully resolved URL or the input path when unavailable.
 */
function resolveRelativeUrl(relativePath) {
  if (typeof window === 'undefined') return relativePath;
  try {
    return new URL(relativePath, window.location.href).toString();
  } catch (err) {
    return relativePath;
  }
}

/**
 * Function: calculateDistanceNm
 * Description: Compute nautical mile distance between two coordinate pairs.
 * Parameters:
 *   startLat (number): Start latitude in decimal degrees.
 *   startLon (number): Start longitude in decimal degrees.
 *   endLat (number): End latitude in decimal degrees.
 *   endLon (number): End longitude in decimal degrees.
 * Returns: number|null - Distance in nautical miles or null when inputs are invalid.
 */
export function calculateDistanceNm(startLat, startLon, endLat, endLon) {
  if (!Number.isFinite(startLat) || !Number.isFinite(startLon) || !Number.isFinite(endLat) || !Number.isFinite(endLon)) {
    return null;
  }
  if (typeof L !== 'undefined' && typeof L.latLng === 'function') {
    const a = L.latLng(startLat, startLon);
    const b = L.latLng(endLat, endLon);
    return a.distanceTo(b) / 1852;
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
}

export const MANUAL_AVG_SPEED_KN = 5;

/**
 * Function: extractManualStops
 * Description: Build an ordered list of manual stops from a stored record.
 * Parameters:
 *   record (ManualVoyageRecord): Manual voyage record containing locations or start/end data.
 * Returns: object[] - Ordered manual stop descriptors with time and coordinates.
 */
function extractManualStops(record) {
  if (!record || typeof record !== 'object') return [];
  if (Array.isArray(record.locations) && record.locations.length >= 2) {
    const stops = record.locations.map((location) => {
      if (!location || typeof location !== 'object') return null;
      const name = typeof location.name === 'string' ? location.name.trim() : '';
      const lat = Number(location.lat);
      const lon = Number(location.lon);
      const timeValue = location.time || location.datetime;
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || typeof timeValue !== 'string') return null;
      const dt = new Date(timeValue);
      if (Number.isNaN(dt.getTime())) return null;
      let routePoints;
      if (Array.isArray(location.routePoints) && location.routePoints.length >= 2) {
        const normalized = location.routePoints.map((point) => {
          const pointLat = Number(point?.lat);
          const pointLon = Number(point?.lon);
          if (!Number.isFinite(pointLat) || !Number.isFinite(pointLon)) return null;
          return { lat: pointLat, lon: pointLon };
        });
        if (normalized.every(point => point)) {
          routePoints = normalized;
        }
      }
      const stop = {
        name,
        lat,
        lon,
        time: dt.toISOString()
      };
      if (routePoints) {
        stop.routePoints = routePoints;
      }
      return stop;
    });
    if (stops.some(stop => !stop)) return [];
    return stops;
  }
  const startTime = record.startTime;
  const endTime = record.endTime;
  const startLocation = record.startLocation;
  const endLocation = record.endLocation;
  if (!startTime || !endTime || !startLocation || !endLocation) return [];
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];
  const startLat = Number(startLocation.lat);
  const startLon = Number(startLocation.lon);
  const endLat = Number(endLocation.lat);
  const endLon = Number(endLocation.lon);
  if (!Number.isFinite(startLat) || !Number.isFinite(startLon) || !Number.isFinite(endLat) || !Number.isFinite(endLon)) {
    return [];
  }
  return [
    {
      name: startLocation.name,
      lat: startLat,
      lon: startLon,
      time: startDate.toISOString()
    },
    {
      name: endLocation.name,
      lat: endLat,
      lon: endLon,
      time: endDate.toISOString()
    }
  ];
}

/**
 * Function: isSameCoordinate
 * Description: Compare two latitude/longitude pairs with a small tolerance.
 * Parameters:
 *   a (object): First coordinate with lat/lon values.
 *   b (object): Second coordinate with lat/lon values.
 *   epsilon (number): Optional tolerance for coordinate comparisons.
 * Returns: boolean - True when the coordinates are effectively the same.
 */
function isSameCoordinate(a, b, epsilon = 1e-6) {
  if (!a || !b) return false;
  const latA = Number(a.lat);
  const lonA = Number(a.lon);
  const latB = Number(b.lat);
  const lonB = Number(b.lon);
  if (!Number.isFinite(latA) || !Number.isFinite(lonA) || !Number.isFinite(latB) || !Number.isFinite(lonB)) return false;
  return Math.abs(latA - latB) <= epsilon && Math.abs(lonA - lonB) <= epsilon;
}

/**
 * Function: normalizeManualRoutePoints
 * Description: Validate and align stored day-trip route points for return voyages.
 * Parameters:
 *   record (ManualVoyageRecord): Manual voyage record containing optional route metadata.
 *   start (object): Start stop containing lat/lon coordinates.
 *   turn (object): Turnaround stop containing lat/lon coordinates.
 * Returns: object|null - Normalized route metadata or null when unavailable.
 */
function normalizeManualRoutePoints(record, start, turn) {
  if (!record || !start || !turn) return null;
  const rawPoints = Array.isArray(record.routePoints) ? record.routePoints : null;
  if (!rawPoints || rawPoints.length < 2) return null;
  const normalized = rawPoints.map((point) => {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  });
  if (normalized.some(point => !point) || normalized.length < 2) return null;
  let turnIndex = Number.isInteger(record.routeTurnIndex) ? record.routeTurnIndex : null;
  if (turnIndex === null || turnIndex < 1 || turnIndex >= normalized.length) {
    turnIndex = 1;
  }
  normalized[0] = { lat: start.lat, lon: start.lon };
  normalized[turnIndex] = { lat: turn.lat, lon: turn.lon };
  if (normalized.length > 2 && isSameCoordinate(normalized[normalized.length - 1], normalized[0])) {
    normalized.pop();
    if (turnIndex >= normalized.length) {
      turnIndex = Math.max(1, normalized.length - 1);
      normalized[turnIndex] = { lat: turn.lat, lon: turn.lon };
    }
  }
  return { points: normalized, turnIndex };
}

/**
 * Function: calculateRouteDistanceNm
 * Description: Sum the total route distance across points, optionally closing the loop.
 * Parameters:
 *   points (object[]): Ordered route points with lat/lon values.
 *   closeLoop (boolean): When true, include the final leg back to the start.
 * Returns: number|null - Route distance in nautical miles or null when invalid.
 */
function calculateRouteDistanceNm(points, closeLoop) {
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
 * Function: buildRoutePointEntries
 * Description: Build manual point entries from route points using a constant speed.
 * Parameters:
 *   points (object[]): Ordered route points with lat/lon values.
 *   startTime (string): ISO timestamp for the route start time.
 *   turnIndex (number|null): Index of the turnaround point.
 *   startName (string): Label for the starting point.
 *   turnName (string): Label for the turnaround point.
 * Returns: object[] - Array of point entries with optional timing metadata.
 */
function buildRoutePointEntries(points, startTime, turnIndex, startName, turnName) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const startDate = new Date(startTime);
  const hasStartTime = !Number.isNaN(startDate.getTime());
  const cumulativeDistances = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const legDistance = calculateDistanceNm(prev.lat, prev.lon, next.lat, next.lon);
    const increment = Number.isFinite(legDistance) ? legDistance : 0;
    cumulativeDistances[i] = (cumulativeDistances[i - 1] || 0) + increment;
  }
  return points.map((point, index) => {
    const offsetHours = MANUAL_AVG_SPEED_KN > 0 ? (cumulativeDistances[index] / MANUAL_AVG_SPEED_KN) : 0;
    const time = hasStartTime
      ? new Date(startDate.getTime() + offsetHours * 60 * 60 * 1000).toISOString()
      : '';
    const entry = time ? { datetime: time, activity: 'sailing' } : { activity: 'sailing' };
    const manualLocationName = index === 0
      ? startName
      : (Number.isInteger(turnIndex) && index === turnIndex ? turnName : undefined);
    return {
      lat: point.lat,
      lon: point.lon,
      entry,
      manualLocationName
    };
  });
}

/**
 * Function: buildManualVoyageFromRecord
 * Description: Convert a manual voyage record into the voyage shape used by the UI.
 * Parameters:
 *   record (ManualVoyageRecord): Manual voyage record containing times and locations.
 * Returns: object|null - Normalised voyage object or null when invalid.
 */
export function buildManualVoyageFromRecord(record) {
  const stops = extractManualStops(record);
  if (stops.length < 2) return null;
  const isReturnTrip = Boolean(record.returnTrip);
  const startStop = stops[0];
  const turnStop = stops[1];
  const manualRoute = isReturnTrip && startStop && turnStop
    ? normalizeManualRoutePoints(record, startStop, turnStop)
    : null;
  let tripStops = stops.slice();
  let distanceNm = 0;
  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1];
    const curr = stops[i];
    const routePoints = normalizeLegRoutePoints(prev.routePoints, prev, curr);
    const legDistance = routePoints
      ? calculateRouteDistanceNm(routePoints, false)
      : calculateDistanceNm(prev.lat, prev.lon, curr.lat, curr.lon);
    distanceNm += Number.isFinite(legDistance) ? legDistance : 0;
  }

  if (manualRoute && Array.isArray(manualRoute.points)) {
    const routeDistance = calculateRouteDistanceNm(manualRoute.points, true);
    if (Number.isFinite(routeDistance)) {
      distanceNm = routeDistance;
    }
  }

  if (isReturnTrip && stops.length === 2) {
    const legDistance = manualRoute && Array.isArray(manualRoute.points)
      ? calculateRouteDistanceNm(manualRoute.points.slice(0, manualRoute.turnIndex + 1), false)
      : calculateDistanceNm(startStop.lat, startStop.lon, turnStop.lat, turnStop.lon);
    if (Number.isFinite(legDistance)) {
      const totalLoop = Number.isFinite(distanceNm) ? distanceNm : legDistance * 2;
      distanceNm = totalLoop;
      const startDate = new Date(startStop.time);
      const totalHours = MANUAL_AVG_SPEED_KN > 0 ? (totalLoop / MANUAL_AVG_SPEED_KN) : 0;
      if (!Number.isNaN(startDate.getTime()) && totalHours > 0) {
        const returnDate = new Date(startDate.getTime() + totalHours * 60 * 60 * 1000);
        tripStops = [
          startStop,
          turnStop,
          {
            name: startStop.name,
            lat: startStop.lat,
            lon: startStop.lon,
            time: returnDate.toISOString()
          }
        ];
      }
    }
  }

  const start = tripStops[0];
  const end = tripStops[tripStops.length - 1];
  const startTime = start.time;
  const endTime = end.time;
  const startLocation = { name: start.name, lat: start.lat, lon: start.lon };
  const endLocation = { name: end.name, lat: end.lat, lon: end.lon };
  const totalHours = MANUAL_AVG_SPEED_KN > 0 ? (distanceNm / MANUAL_AVG_SPEED_KN) : 0;
  const avgSpeed = distanceNm > 0 ? MANUAL_AVG_SPEED_KN : 0;
  const maxSpeedCoord = null;
  const routePoints = manualRoute?.points || null;
  const routeTurnIndex = Number.isInteger(manualRoute?.turnIndex) ? manualRoute.turnIndex : null;
  const routePointEntries = routePoints
    ? buildRoutePointEntries(routePoints, startTime, routeTurnIndex, start?.name, turnStop?.name)
    : null;
  const legRoutePointEntries = !isReturnTrip ? buildManualLegRoutePointEntries(tripStops) : null;
  const points = routePointEntries || legRoutePointEntries || tripStops.map(stop => ({
    lat: stop.lat,
    lon: stop.lon,
    entry: { datetime: stop.time, activity: 'sailing' },
    manualLocationName: stop.name
  }));
  const coords = routePointEntries
    ? routePoints.map(point => [point.lon, point.lat])
    : (legRoutePointEntries
      ? legRoutePointEntries.map(point => [point.lon, point.lat])
      : tripStops.map(stop => [stop.lon, stop.lat]));
  return {
    manual: true,
    manualId: record.id || null,
    returnTrip: isReturnTrip,
    startTime,
    endTime,
    startLocation,
    endLocation,
    manualLocations: tripStops,
    manualRoutePoints: routePoints || undefined,
    manualRouteTurnIndex: routeTurnIndex ?? undefined,
    nm: Number(distanceNm.toFixed(1)),
    maxSpeed: 0,
    avgSpeed,
    maxSpeedCoord,
    maxWind: 0,
    avgWindSpeed: 0,
    avgWindHeading: null,
    totalHours,
    points,
    coords
  };
}

/**
 * Function: normalizeLegRoutePoints
 * Description: Validate and align stored route points for a leg.
 * Parameters:
 *   points (object[]): Raw route points payload for a leg.
 *   start (object): Start stop containing lat/lon coordinates.
 *   end (object): End stop containing lat/lon coordinates.
 * Returns: object[]|null - Normalized route points or null when invalid.
 */
function normalizeLegRoutePoints(points, start, end) {
  if (!Array.isArray(points) || points.length < 2 || !start || !end) return null;
  const startLat = Number(start.lat);
  const startLon = Number(start.lon);
  const endLat = Number(end.lat);
  const endLon = Number(end.lon);
  if (!Number.isFinite(startLat) || !Number.isFinite(startLon) || !Number.isFinite(endLat) || !Number.isFinite(endLon)) {
    return null;
  }
  const normalized = points.map((point) => {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  });
  if (normalized.some(point => !point) || normalized.length < 2) return null;
  normalized[0] = { lat: startLat, lon: startLon };
  normalized[normalized.length - 1] = { lat: endLat, lon: endLon };
  return normalized;
}

/**
 * Function: buildLegRoutePointEntries
 * Description: Build voyage point entries for a leg route using interpolated times.
 * Parameters:
 *   points (object[]): Normalized route points for the leg.
 *   start (object): Start stop containing name and time.
 *   end (object): End stop containing name and time.
 * Returns: object[] - Voyage point entries for the leg.
 */
function buildLegRoutePointEntries(points, start, end) {
  if (!Array.isArray(points) || points.length < 2 || !start || !end) return [];
  const cumulativeDistances = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const legDistance = calculateDistanceNm(prev.lat, prev.lon, next.lat, next.lon);
    const increment = Number.isFinite(legDistance) ? legDistance : 0;
    cumulativeDistances[i] = (cumulativeDistances[i - 1] || 0) + increment;
  }
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] || 0;
  const startMs = new Date(start.time).getTime();
  const endMs = new Date(end.time).getTime();
  const canInterpolate = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && totalDistance > 0;
  const lastIndex = points.length - 1;
  return points.map((point, index) => {
    let time = '';
    if (canInterpolate) {
      const ratio = cumulativeDistances[index] / totalDistance;
      const ms = startMs + ratio * (endMs - startMs);
      time = new Date(ms).toISOString();
    } else if (index === 0 && start.time) {
      time = start.time;
    } else if (index === lastIndex && end.time) {
      time = end.time;
    }
    const entry = time ? { datetime: time, activity: 'sailing' } : { activity: 'sailing' };
    const manualLocationName = index === 0 ? start.name : (index === lastIndex ? end.name : undefined);
    return {
      lat: point.lat,
      lon: point.lon,
      entry,
      manualLocationName
    };
  });
}

/**
 * Function: buildManualLegRoutePointEntries
 * Description: Build a continuous point list for multi-leg manual voyages.
 * Parameters:
 *   stops (object[]): Ordered manual stop descriptors.
 * Returns: object[]|null - Continuous route point entries or null when unavailable.
 */
function buildManualLegRoutePointEntries(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return null;
  const entries = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const start = stops[i];
    const end = stops[i + 1];
    if (!start || !end) continue;
    const routePoints = normalizeLegRoutePoints(start.routePoints, start, end);
    const legPoints = routePoints || [
      { lat: start.lat, lon: start.lon },
      { lat: end.lat, lon: end.lon }
    ];
    let legEntries = buildLegRoutePointEntries(legPoints, start, end);
    if (!legEntries.length) continue;
    if (entries.length) {
      const last = entries[entries.length - 1];
      const first = legEntries[0];
      if (isSameCoordinate(last, first)) {
        legEntries = legEntries.slice(1);
      }
    }
    entries.push(...legEntries);
  }
  return entries.length >= 2 ? entries : null;
}

/**
 * Function: buildManualSegmentsFromStops
 * Description: Build leg segments from ordered manual stop locations.
 * Parameters:
 *   stops (object[]): Ordered manual stop descriptors.
 * Returns: object[] - Manual segment summaries.
 */
export function buildManualSegmentsFromStops(stops = []) {
  if (!Array.isArray(stops) || stops.length < 2) return [];
  const segments = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const start = stops[i];
    const end = stops[i + 1];
    if (!start || !end) continue;
    const routePoints = normalizeLegRoutePoints(start.routePoints, start, end);
    const routeDistance = routePoints ? calculateRouteDistanceNm(routePoints, false) : null;
    const distanceNm = Number.isFinite(routeDistance)
      ? routeDistance
      : (calculateDistanceNm(start.lat, start.lon, end.lat, end.lon) ?? 0);
    const startTime = start.time;
    const endTime = end.time;
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const totalHours = (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate > startDate)
      ? ((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
      : 0;
    const avgSpeed = totalHours > 0 ? (distanceNm / totalHours) : 0;
    const points = routePoints
      ? buildLegRoutePointEntries(routePoints, start, end)
      : [
        {
          lat: start.lat,
          lon: start.lon,
          entry: { datetime: start.time, activity: 'sailing' },
          manualLocationName: start.name
        },
        {
          lat: end.lat,
          lon: end.lon,
          entry: { datetime: end.time, activity: 'sailing' },
          manualLocationName: end.name
        }
      ];
    segments.push({
      startTime,
      endTime,
      nm: Number(distanceNm.toFixed(1)),
      maxSpeed: 0,
      avgSpeed,
      maxWind: 0,
      avgWindSpeed: 0,
      avgWindHeading: null,
      totalHours,
      points,
      maxSpeedCoord: null,
      polyline: null
    });
  }
  return segments;
}

/**
 * Function: buildManualReturnSegmentFromStops
 * Description: Build a single segment for a return trip using all stops as points.
 * Parameters:
 *   stops (object[]): Ordered manual stop descriptors.
 * Returns: object|null - Manual segment summary or null when invalid.
 */
export function buildManualReturnSegmentFromStops(stops = [], options = {}) {
  if (!Array.isArray(stops) || stops.length < 2) return null;
  const routePoints = Array.isArray(options.routePoints) ? options.routePoints : null;
  const routeTurnIndex = Number.isInteger(options.routeTurnIndex) ? options.routeTurnIndex : null;
  const startName = options.startName || stops[0]?.name || '';
  const turnName = options.turnName || stops[1]?.name || '';
  const distanceNm = routePoints
    ? calculateRouteDistanceNm(routePoints, true) ?? 0
    : stops.reduce((sum, stop, index) => {
      if (index === 0) return 0;
      const prev = stops[index - 1];
      const legDistance = calculateDistanceNm(prev.lat, prev.lon, stop.lat, stop.lon);
      return sum + (Number.isFinite(legDistance) ? legDistance : 0);
    }, 0);
  const startTime = stops[0].time;
  const endTime = stops[stops.length - 1].time;
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const totalHours = (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate > startDate)
    ? ((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
    : 0;
  const pointEntries = routePoints
    ? buildRoutePointEntries(routePoints, startTime, routeTurnIndex, startName, turnName)
    : stops.map(stop => ({
      lat: stop.lat,
      lon: stop.lon,
      entry: { datetime: stop.time, activity: 'sailing' },
      manualLocationName: stop.name
    }));
  return {
    startTime,
    endTime,
    nm: Number(distanceNm.toFixed(1)),
    maxSpeed: 0,
    avgSpeed: totalHours > 0 ? (distanceNm / totalHours) : 0,
    maxWind: 0,
    avgWindSpeed: 0,
    avgWindHeading: null,
    totalHours,
    points: pointEntries,
    maxSpeedCoord: null,
    polyline: null,
    closeLoop: Boolean(routePoints)
  };
}

/**
 * Function: circularMean
 * Description: Compute the average direction of a set of angles in degrees.
 * Parameters:
 *   degrees (number[]): Collection of angles in degrees.
 * Returns: number - Mean direction normalized to [0, 360).
 */
export function circularMean(degrees) {
  let sumSin = 0;
  let sumCos = 0;
  for (const deg of degrees) {
    const rad = deg * Math.PI / 180;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }
  const avgRad = Math.atan2(sumSin / degrees.length, sumCos / degrees.length);
  let deg = avgRad * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Function: getPointDate
 * Description: Resolve a Date instance from a voyage point.
 * Parameters:
 *   point (object): Voyage point containing a datetime field.
 * Returns: Date|null - Parsed Date instance or null when unavailable.
 */
function getPointDate(point) {
  const dtStr = point?.entry?.datetime || point?.datetime;
  if (!dtStr) return null;
  const dt = new Date(dtStr);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * Function: getPointText
 * Description: Return the lower-cased text content for a voyage point.
 * Parameters:
 *   point (object): Voyage point containing a text field.
 * Returns: string - Lower-cased text or an empty string when unavailable.
 */
function getPointText(point) {
  const text = point?.entry?.text ?? point?.text;
  if (typeof text !== 'string') return '';
  return text.toLowerCase();
}

/**
 * Function: pointIndicatesStopped
 * Description: Determine whether a point's text marks the vessel as stopped.
 * Parameters:
 *   point (object): Voyage point to inspect.
 * Returns: boolean - True when the point text includes "stopped".
 */
function pointIndicatesStopped(point) {
  return getPointText(point).includes('stopped');
}

/**
 * Function: pointIndicatesSailing
 * Description: Determine whether a point's text marks the vessel as sailing.
 * Parameters:
 *   point (object): Voyage point to inspect.
 * Returns: boolean - True when the point text includes "sailing".
 */
function pointIndicatesSailing(point) {
  return getPointText(point).includes('sailing');
}

/**
 * Function: isAnchoredPoint
 * Description: Determine whether a voyage point should be treated as anchored using activity metadata and text cues.
 * Parameters:
 *   point (object): Voyage point to inspect.
 * Returns: boolean - True when the point represents an anchored state.
 */
function isAnchoredPoint(point) {
  const activity = readPointActivity(point);
  if (activity === 'anchored') return true;
  if (activity === 'sailing' || activity === 'motoring') return false;
  if (pointIndicatesStopped(point)) return true;
  if (pointIndicatesSailing(point)) return false;
  return false;
}

/**
 * Function: getPointTimeMs
 * Description: Return a millisecond timestamp for a voyage point.
 * Parameters:
 *   point (object): Voyage point containing a datetime field.
 * Returns: number|null - Millisecond timestamp or null when unavailable.
 */
function getPointTimeMs(point) {
  const dt = getPointDate(point);
  return dt ? dt.getTime() : null;
}

/**
 * Function: shouldSplitTripAfterPoint
 * Description: Decide whether a point ends a trip based on explicit stop markers or anchored gaps.
 * Parameters:
 *   point (object): Current voyage point.
 *   nextPoint (object|null): Next voyage point when available.
 *   minGapMs (number): Minimum inactivity gap in milliseconds required to split a trip.
 * Returns: boolean - True when the trip should split after the current point.
 */
function shouldSplitTripAfterPoint(point, nextPoint, minGapMs) {
  if (!nextPoint || !Number.isFinite(minGapMs)) return false;
  if (shouldSkipConnection(point, nextPoint)) return true;
  const anchoredGap = isAnchoredPoint(point) || isAnchoredPoint(nextPoint);
  if (!anchoredGap) return false;
  const currentMs = getPointTimeMs(point);
  const nextMs = getPointTimeMs(nextPoint);
  if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs)) return false;
  return (nextMs - currentMs) >= minGapMs;
}

/**
 * Function: buildSegmentSummary
 * Description: Compute statistics for a segment made of ordered voyage points, filtering short legs when needed.
 * Parameters:
 *   segmentPoints (object[]): Ordered points belonging to the segment.
 *   minLegDistanceNm (number): Minimum leg distance in nautical miles required to keep a segment.
 * Returns: object|null - Segment summary or null when input points are missing or too short.
 */
function buildSegmentSummary(segmentPoints, minLegDistanceNm) {
  if (!Array.isArray(segmentPoints) || segmentPoints.length === 0) return null;
  const startTime = segmentPoints[0]?.entry?.datetime || segmentPoints[0]?.datetime;
  const endTime = segmentPoints[segmentPoints.length - 1]?.entry?.datetime || segmentPoints[segmentPoints.length - 1]?.datetime;
  let nm = 0;
  let maxSpeed = 0;
  let maxSpeedCoord = null;
  let maxWind = 0;
  let windSpeedSum = 0;
  let windSpeedCount = 0;
  const windHeadings = [];
  let totalDurationMs = 0;

  for (let i = 0; i < segmentPoints.length; i += 1) {
    if (i > 0) {
      const prev = segmentPoints[i - 1];
      const curr = segmentPoints[i];
      const prevValid = typeof prev?.lat === 'number' && typeof prev?.lon === 'number';
      const currValid = typeof curr?.lat === 'number' && typeof curr?.lon === 'number';
      if (prevValid && currValid && !shouldSkipConnection(prev, curr)) {
        const a = L.latLng(prev.lat, prev.lon);
        const b = L.latLng(curr.lat, curr.lon);
        nm += a.distanceTo(b) / 1852;
      }
      const prevMs = getPointTimeMs(prev);
      const currMs = getPointTimeMs(curr);
      if (Number.isFinite(prevMs) && Number.isFinite(currMs)) {
        const gap = currMs - prevMs;
        if (Number.isFinite(gap) && gap > 0) {
          totalDurationMs += gap;
        }
      }
    }
    const entry = segmentPoints[i].entry || segmentPoints[i];
    const speed = entry?.speed?.sog ?? entry?.speed?.stw;
    if (typeof speed === 'number') {
      if (speed > maxSpeed) {
        maxSpeed = speed;
        maxSpeedCoord = [segmentPoints[i].lon, segmentPoints[i].lat];
      }
    }
    const windSpeed = entry?.wind?.speed;
    if (typeof windSpeed === 'number') {
      if (windSpeed > maxWind) {
        maxWind = windSpeed;
      }
      windSpeedSum += windSpeed;
      windSpeedCount += 1;
    }
    const windDir = entry?.wind?.direction;
    if (typeof windDir === 'number') {
      windHeadings.push(windDir);
    }
  }

  const minLegNm = Number.isFinite(minLegDistanceNm) ? minLegDistanceNm : 0;
  if (minLegNm > 0 && nm < minLegNm) {
    return null;
  }

  const roundedNm = parseFloat(nm.toFixed(1));
  const totalHours = totalDurationMs > 0 ? (totalDurationMs / (1000 * 60 * 60)) : 0;
  const avgSpeed = totalHours > 0 ? (roundedNm / totalHours) : 0;
  const avgWindSpeed = windSpeedCount ? (windSpeedSum / windSpeedCount) : 0;
  const avgWindHeading = windHeadings.length ? circularMean(windHeadings) : null;

  return {
    startTime,
    endTime,
    nm: roundedNm,
    maxSpeed,
    avgSpeed,
    maxWind,
    avgWindSpeed,
    avgWindHeading,
    totalHours,
    points: segmentPoints,
    maxSpeedCoord,
    polyline: null
  };
}

/**
 * Function: computeDaySegments
 * Description: Break a voyage into trip segments with per-leg statistics while respecting stop gaps.
 * Parameters:
 *   voyage (object): Voyage summary containing point data.
 *   options (object): Optional overrides for segment calculation.
 * Returns: object[] - Ordered segment summaries for each trip in the voyage.
 */
export function computeDaySegments(voyage, options = {}) {
  const points = Array.isArray(voyage?.points) && voyage.points.length ? voyage.points : null;
  if (!points) return [];
  const MIN_ANCHORED_GAP_MS = 60 * 60 * 1000;
  const defaultMinLeg = 1;
  const minLegDistanceNm = Number.isFinite(options.minLegDistanceNm) ? options.minLegDistanceNm : defaultMinLeg;
  const orderedPoints = [...points].sort((a, b) => {
    const aMs = getPointTimeMs(a);
    const bMs = getPointTimeMs(b);
    if (!Number.isFinite(aMs) && !Number.isFinite(bMs)) return 0;
    if (!Number.isFinite(aMs)) return 1;
    if (!Number.isFinite(bMs)) return -1;
    return aMs - bMs;
  });
  const segments = [];
  let segmentPoints = [];

  for (let i = 0; i < orderedPoints.length; i += 1) {
    const point = orderedPoints[i];
    segmentPoints.push(point);
    const nextPoint = orderedPoints[i + 1];
    if (nextPoint && shouldSplitTripAfterPoint(point, nextPoint, MIN_ANCHORED_GAP_MS)) {
      const summary = buildSegmentSummary(segmentPoints, minLegDistanceNm);
      if (summary) segments.push(summary);
      segmentPoints = [];
    }
  }

  if (segmentPoints.length) {
    const summary = buildSegmentSummary(segmentPoints, minLegDistanceNm);
    if (summary) segments.push(summary);
  }

  return segments;
}

/**
 * Function: applyVoyageTimeMetrics
 * Description: Update voyage average speed and total hours using the computed leg segments.
 * Parameters:
 *   voyage (object): Voyage summary to update with display metrics.
 * Returns: void.
 */
export function applyVoyageTimeMetrics(voyage) {
  if (!voyage || typeof voyage !== 'object') return;
  const segments = Array.isArray(voyage._segments) ? voyage._segments : [];
  if (segments.length === 0) {
    voyage.totalHours = null;
    return;
  }

  const totalHours = segments.reduce((sum, segment) => {
    const hours = Number.isFinite(segment?.totalHours) ? segment.totalHours : 0;
    return sum + hours;
  }, 0);
  voyage.totalHours = totalHours;

  if (segments.length === 1) {
    voyage.avgSpeed = totalHours > 0 ? (voyage.nm / totalHours) : 0;
    return;
  }

  const speedSum = segments.reduce((sum, segment) => {
    const speed = Number.isFinite(segment.avgSpeed) ? segment.avgSpeed : 0;
    return sum + speed;
  }, 0);
  voyage.avgSpeed = segments.length ? (speedSum / segments.length) : 0;
}

/**
 * Function: fetchVoyagesData
 * Description: Retrieve the voyages JSON payload from the server with cache disabled.
 * Parameters: None.
 * Returns: Promise<object> - Parsed voyage dataset payload.
 */
export async function fetchVoyagesData() {
  const response = await fetch(resolveRelativeUrl('voyages.json'), { cache: 'no-cache' });
  return response.json();
}

/**
 * Function: fetchManualVoyagesData
 * Description: Retrieve manual voyage data from a static JSON file, falling back to the API when needed.
 * Parameters:
 *   apiBasePath (string): Optional API base path when running inside the plugin.
 * Returns: Promise<object> - Parsed manual voyage payload.
 */
export async function fetchManualVoyagesData(apiBasePath = '') {
  const staticUrl = resolveRelativeUrl('manual-voyages.json');
  try {
    const response = await fetch(staticUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Manual voyage request failed with status ${response.status}`);
    }
    return response.json();
  } catch (err) {
    const base = typeof apiBasePath === 'string' ? apiBasePath.replace(/\/$/, '') : '';
    if (!base) {
      console.warn('[voyage-webapp] Failed to fetch manual voyages', err);
      return { voyages: [] };
    }
    try {
      const apiUrl = `${base}/manual-voyages`;
      const response = await fetch(apiUrl, { cache: 'no-cache', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Manual voyage request failed with status ${response.status}`);
      }
      return response.json();
    } catch (apiErr) {
      console.warn('[voyage-webapp] Failed to fetch manual voyages', apiErr);
      return { voyages: [] };
    }
  }
}
