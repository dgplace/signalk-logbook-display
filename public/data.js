/**
 * Module Responsibilities:
 * - Provide utilities for normalising voyage datasets returned by the back-end.
 * - Calculate derived metrics such as voyage totals, per-leg segments, and wind statistics.
 * - Expose fetch helpers with consistent caching behaviour for the front-end.
 *
 * Exported API:
 * - Extraction helpers: `getVoyagePoints`, `getPointActivity`, `shouldSkipConnection`, `extractWindSpeed`.
 * - Aggregation helpers: `computeVoyageTotals`, `computeDaySegments`, `circularMean`.
 * - Formatting helpers: `formatDurationMs`.
 * - Data loading: `fetchVoyagesData`.
 *
 * @typedef {import('./types.js').Voyage} Voyage
 * @typedef {import('./types.js').VoyagePoint} VoyagePoint
 * @typedef {import('./types.js').VoyageSegment} VoyageSegment
 * @typedef {import('./types.js').VoyageTotals} VoyageTotals
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
 * Function: computeVoyageTotals
 * Description: Aggregate voyage distance and activity durations across the full voyage list.
 * Parameters:
 *   voyages (object[]): Voyage summaries containing point data and statistics.
 * Returns: object - Accumulated totals for distance (NM) and activity durations (milliseconds).
 */
export function computeVoyageTotals(voyages) {
  if (!Array.isArray(voyages) || voyages.length === 0) {
    return { totalDistanceNm: 0, totalActiveMs: 0, totalSailingMs: 0 };
  }

  let totalDistanceNm = 0;
  let totalActiveMs = 0;
  let totalSailingMs = 0;
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
    const points = getVoyagePoints(voyage);
    if (!Array.isArray(points) || points.length < 2) return;
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
        totalActiveMs += gap;
        if (prevAct === 'sailing' && currAct === 'sailing') {
          totalSailingMs += gap;
        }
      }
    }
  });

  return { totalDistanceNm, totalActiveMs, totalSailingMs };
}

/**
 * Function: formatDurationMs
 * Description: Convert a duration in milliseconds to a human-readable days, hours, and minutes string.
 * Parameters:
 *   durationMs (number): Duration expressed in milliseconds.
 * Returns: string - Formatted "Xd Yh Zm" duration string.
 */
export function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0d 0h 0m';
  const totalMinutes = Math.round(durationMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const remainingMinutes = totalMinutes - (days * 24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
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
 * Description: Decide whether a point ends a trip based on an anchored gap to the next point.
 * Parameters:
 *   point (object): Current voyage point.
 *   nextPoint (object|null): Next voyage point when available.
 *   stopActive (boolean): True when the vessel is in a stopped/anchored state.
 *   minGapMs (number): Minimum inactivity gap in milliseconds required to split a trip.
 * Returns: boolean - True when the trip should split after the current point.
 */
function shouldSplitTripAfterPoint(point, nextPoint, stopActive, minGapMs) {
  if (!stopActive || !nextPoint || !Number.isFinite(minGapMs)) return false;
  const currentMs = getPointTimeMs(point);
  const nextMs = getPointTimeMs(nextPoint);
  if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs)) return false;
  return (nextMs - currentMs) >= minGapMs;
}

/**
 * Function: buildSegmentSummary
 * Description: Compute statistics for a segment made of ordered voyage points.
 * Parameters:
 *   segmentPoints (object[]): Ordered points belonging to the segment.
 * Returns: object|null - Segment summary or null when input points are missing.
 */
function buildSegmentSummary(segmentPoints) {
  if (!Array.isArray(segmentPoints) || segmentPoints.length === 0) return null;
  const startTime = segmentPoints[0]?.entry?.datetime || segmentPoints[0]?.datetime;
  const endTime = segmentPoints[segmentPoints.length - 1]?.entry?.datetime || segmentPoints[segmentPoints.length - 1]?.datetime;
  let nm = 0;
  let maxSpeed = 0;
  let maxSpeedCoord = null;
  let speedSum = 0;
  let speedCount = 0;
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
      speedSum += speed;
      speedCount += 1;
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

  const totalHours = totalDurationMs > 0 ? (totalDurationMs / (1000 * 60 * 60)) : 0;
  const avgSpeed = totalHours > 0 ? (nm / totalHours) : (speedCount ? (speedSum / speedCount) : 0);
  const avgWindSpeed = windSpeedCount ? (windSpeedSum / windSpeedCount) : 0;
  const avgWindHeading = windHeadings.length ? circularMean(windHeadings) : null;

  return {
    startTime,
    endTime,
    nm: parseFloat(nm.toFixed(1)),
    maxSpeed,
    avgSpeed,
    maxWind,
    avgWindSpeed,
    avgWindHeading,
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
 * Returns: object[] - Ordered segment summaries for each trip in the voyage.
 */
export function computeDaySegments(voyage) {
  const points = Array.isArray(voyage?.points) && voyage.points.length ? voyage.points : null;
  if (!points) return [];
  const MIN_ANCHORED_GAP_MS = 60 * 60 * 1000;
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
  let stopActive = false;

  for (let i = 0; i < orderedPoints.length; i += 1) {
    const point = orderedPoints[i];
    if (pointIndicatesStopped(point)) stopActive = true;
    if (pointIndicatesSailing(point)) stopActive = false;
    segmentPoints.push(point);
    const nextPoint = orderedPoints[i + 1];
    if (nextPoint && shouldSplitTripAfterPoint(point, nextPoint, stopActive, MIN_ANCHORED_GAP_MS)) {
      const summary = buildSegmentSummary(segmentPoints);
      if (summary) segments.push(summary);
      segmentPoints = [];
    }
  }

  if (segmentPoints.length) {
    const summary = buildSegmentSummary(segmentPoints);
    if (summary) segments.push(summary);
  }

  return segments;
}

/**
 * Function: fetchVoyagesData
 * Description: Retrieve the voyages JSON payload from the server with cache disabled.
 * Parameters: None.
 * Returns: Promise<object> - Parsed voyage dataset payload.
 */
export async function fetchVoyagesData() {
  const response = await fetch('voyages.json', { cache: 'no-cache' });
  return response.json();
}
