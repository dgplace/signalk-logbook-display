// save as parse_logbook.js and run with:
//   node parse_logbook.js ~/.signalk/plugin-config-data/signalk-logbook > voyages.json

const fs   = require('fs').promises;
const path = require('path');
const yaml = require('yaml');

/**
 * @typedef {Object} Position
 * @property {number} longitude - Longitude in decimal degrees.
 * @property {number} latitude - Latitude in decimal degrees.
 * @property {string} [source] - Optional position source identifier.
 *
 * @typedef {Object} SpeedMetrics
 * @property {number} [sog] - Speed over ground in knots.
 * @property {number} [stw] - Speed through water in knots.
 *
 * @typedef {Object} WindMetrics
 * @property {number} [speedTrue] - True wind speed in knots.
 * @property {number} [speed] - Reported wind speed in knots.
 * @property {number} [speedApparent] - Apparent wind speed in knots.
 * @property {number} [direction] - Wind direction in degrees.
 *
 * @typedef {Object} LogEntry
 * @property {Date|string} datetime - ISO datetime string or Date instance.
 * @property {Position} [position] - Vessel position for the entry.
 * @property {SpeedMetrics} [speed] - Speed metrics recorded for the entry.
 * @property {WindMetrics} [wind] - Wind metrics recorded for the entry.
 * @property {string} [text] - Free-form log text content.
 */

/**
 * Function: degToRad
 * Description: Convert an angle in degrees to radians.
 * Parameters:
 *   d (number): Angle expressed in degrees.
 * Returns: number - Angle converted to radians.
 */
function degToRad(d) { return (d * Math.PI) / 180; }
/**
 * Function: haversine
 * Description: Compute the great-circle distance between two coordinates in nautical miles.
 * Parameters:
 *   [lon1, lat1] (number[]): Longitude and latitude of the first point.
 *   [lon2, lat2] (number[]): Longitude and latitude of the second point.
 * Returns: number - Great-circle distance separating the two coordinates.
 */
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371e3; // metres
  const φ1 = degToRad(lat1);
  const φ2 = degToRad(lat2);
  const Δφ = degToRad(lat2 - lat1);
  const Δλ = degToRad(lon2 - lon1);
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c  = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R * c) / 1852; // nautical miles
}

/**
 * Function: circularMean
 * Description: Calculate the mean direction of a collection of angles.
 * Parameters:
 *   angles (number[]): Angles in degrees that should be averaged using circular statistics.
 * Returns: number - Average angle in degrees normalized to [0, 360).
 */
function circularMean(angles) {
  const sum = angles.reduce((acc, angle) => {
    const rad = degToRad(angle);
    acc.x += Math.cos(rad);
    acc.y += Math.sin(rad);
    return acc;
  }, {x: 0, y: 0});
  const avg = Math.atan2(sum.y, sum.x) * (180 / Math.PI);
  return (avg + 360) % 360;
}

/**
 * Function: getEntryText
 * Description: Retrieve the lower-cased text content of a log entry.
 * Parameters:
 *   entry (object): Log entry object that may contain a text field.
 * Returns: string - Lower-cased text content or an empty string when unavailable.
 */
function getEntryText(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const { text } = entry;
  if (typeof text !== 'string') return '';
  return text.toLowerCase();
}

/**
 * Function: entryIndicatesStopped
 * Description: Determine whether an entry marks the vessel as stopped.
 * Parameters:
 *   entry (object): Log entry object to inspect.
 * Returns: boolean - True when the entry text contains "stopped".
 */
function entryIndicatesStopped(entry) {
  return getEntryText(entry).includes('stopped');
}

/**
 * Function: entryIndicatesSailing
 * Description: Determine whether an entry marks the vessel as sailing.
 * Parameters:
 *   entry (object): Log entry object to inspect.
 * Returns: boolean - True when the entry text contains "sailing".
 */
function entryIndicatesSailing(entry) {
  return getEntryText(entry).includes('sailing');
}

/**
 * Function: getSog
 * Description: Extract the speed over ground or speed through water from an entry when present.
 * Parameters:
 *   entry (object): Log entry containing speed metrics.
 * Returns: number|null - Speed value in knots or null when unavailable.
 */
function getSog(entry) {
  if (!entry || !entry.speed) return null;
  const { speed } = entry;
  if (typeof speed.sog === 'number') return speed.sog;
  if (typeof speed.stw === 'number') return speed.stw;
  return null;
}

/**
 * Function: getWindSpeed
 * Description: Extract the best available wind speed metric from an entry.
 * Parameters:
 *   entry (object): Log entry containing wind data.
 * Returns: number|null - Wind speed in knots or null when unavailable.
 */
function getWindSpeed(entry) {
  if (!entry || !entry.wind) return null;
  const { wind } = entry;
  if (typeof wind.speedTrue === 'number') return wind.speedTrue;
  if (typeof wind.speed === 'number') return wind.speed;
  if (typeof wind.speedApparent === 'number') return wind.speedApparent;
  return null;
}

/**
 * Function: parseEntryDate
 * Description: Resolve a Date object from the datetime-like fields on an entry.
 * Parameters:
 *   entry (object): Log entry with potential datetime, time, or timestamp values.
 * Returns: Date|null - Parsed Date instance or null when parsing fails.
 */
function parseEntryDate(entry) {
  if (!entry) return null;
  const raw = entry.datetime ?? entry.time ?? entry.timestamp;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Function: getPositionCoord
 * Description: Extract a [longitude, latitude] pair when the entry includes numeric position data.
 * Parameters:
 *   entry (object): Log entry that may contain a position object.
 * Returns: number[]|null - Coordinate tuple or null when unavailable.
 */
function getPositionCoord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const pos = entry.position;
  if (!pos || typeof pos !== 'object') return null;
  const { longitude, latitude } = pos;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
}

/**
 * Function: classifyVoyagePoints
 * Description: Enrich voyage points with activity metadata such as anchored, motoring, or sailing.
 * Parameters:
 *   points (object[]): Ordered list of points in a voyage, each containing coordinates and entry data.
 * Returns: void - Mutates points to include activity metadata.
 */
function classifyVoyagePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return;

  const MOVE_THRESHOLD_NM = 0.25;
  const NEAR_ANCHOR_THRESHOLD_NM = 0.5;
  const GAP_HOURS_THRESHOLD = 4;
  const GAP_SOG_THRESHOLD = 1;
  const LOW_WIND_THRESHOLD = 7;
  const FAST_SPEED_THRESHOLD = 4;

  // Forward pass: initial anchored classification
  let lastAnchoredCoord = null;
  let previousCoord = null;
  let distanceSinceAnchorPath = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const entry = point.entry || {};
    const coord = (typeof point.lon === 'number' && typeof point.lat === 'number') ? [point.lon, point.lat] : null;

    const currentTime = parseEntryDate(entry);
    const nextTime = i < points.length - 1 ? parseEntryDate(points[i + 1]?.entry) : null;
    const sog = getSog(entry);
    const textIndicatesStopped = entryIndicatesStopped(entry);

    const gapHours = currentTime && nextTime ? (nextTime.getTime() - currentTime.getTime()) / (1000 * 60 * 60) : null;
    const gapAnchored = gapHours !== null && gapHours > GAP_HOURS_THRESHOLD && (sog ?? 0) < GAP_SOG_THRESHOLD;
    const nextDayBreak = currentTime && nextTime
      ? (currentTime.getUTCFullYear() !== nextTime.getUTCFullYear() ||
         currentTime.getUTCMonth() !== nextTime.getUTCMonth() ||
         currentTime.getUTCDate() !== nextTime.getUTCDate())
      : false;
    const endOfDayAnchored = nextDayBreak && (sog ?? 0) < GAP_SOG_THRESHOLD;

    let segmentDistanceFromPrevious = null;
    if (coord && previousCoord) {
      segmentDistanceFromPrevious = haversine(previousCoord, coord);
    }

    let pathDistanceFromAnchor = distanceSinceAnchorPath;
    if (segmentDistanceFromPrevious !== null) {
      pathDistanceFromAnchor += segmentDistanceFromPrevious;
    }

    let isAnchored = false;
    if (i === 0) {
      isAnchored = true;
    } else if (gapAnchored || endOfDayAnchored) {
      isAnchored = true;
    } else if (!coord) {
      const prevAnchored = i > 0 ? points[i - 1]?.__isAnchored === true : false;
      isAnchored = lastAnchoredCoord === null || prevAnchored;
    } else if (!lastAnchoredCoord) {
      isAnchored = true;
    } else if (pathDistanceFromAnchor <= MOVE_THRESHOLD_NM) {
      isAnchored = true;
    } else if (textIndicatesStopped) {
      isAnchored = true;
    }

    point.__isAnchored = isAnchored;
    if (isAnchored && coord) {
      lastAnchoredCoord = coord;
    }
    if (isAnchored) {
      distanceSinceAnchorPath = 0;
    } else {
      distanceSinceAnchorPath = pathDistanceFromAnchor;
    }
    if (coord) {
      previousCoord = coord;
    }
  }

  // Reverse pass: ensure trailing points are classified correctly
  let nextAnchoredCoord = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    if (!point) continue;
    const entry = point.entry || {};
    const coord = (typeof point.lon === 'number' && typeof point.lat === 'number') ? [point.lon, point.lat] : null;
    const sog = getSog(entry);

    const nextPoint = i < points.length - 1 ? points[i + 1] : null;
    const nextEntry = nextPoint ? nextPoint.entry : null;
    const currentTime = parseEntryDate(entry);
    const nextTime = nextEntry ? parseEntryDate(nextEntry) : null;

    const gapHours = currentTime && nextTime ? (nextTime.getTime() - currentTime.getTime()) / (1000 * 60 * 60) : null;
    const nextDayBreak = currentTime && nextTime
      ? (currentTime.getUTCFullYear() !== nextTime.getUTCFullYear() ||
         currentTime.getUTCMonth() !== nextTime.getUTCMonth() ||
         currentTime.getUTCDate() !== nextTime.getUTCDate())
      : false;

    const nearFutureAnchor = coord && nextAnchoredCoord
      ? haversine(coord, nextAnchoredCoord) <= MOVE_THRESHOLD_NM
      : false;

    const sogValue = sog ?? 0;
    const shouldForceAnchor = (!nextPoint && sogValue < GAP_SOG_THRESHOLD) ||
      (gapHours !== null && gapHours > GAP_HOURS_THRESHOLD && sogValue < GAP_SOG_THRESHOLD) ||
      (nextDayBreak && sogValue < GAP_SOG_THRESHOLD) ||
      nearFutureAnchor;

    if (!point.__isAnchored && shouldForceAnchor) {
      point.__isAnchored = true;
    }

    if (point.__isAnchored && coord) {
      nextAnchoredCoord = coord;
    }
  }

  // Final forward pass: compute activities and distances
  lastAnchoredCoord = null;
  previousCoord = null;
  let distanceSinceAnchor = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const entry = point.entry || {};
    const coord = (typeof point.lon === 'number' && typeof point.lat === 'number') ? [point.lon, point.lat] : null;
    const sog = getSog(entry);
    const windSpeed = getWindSpeed(entry);

    let directDistanceFromAnchor = null;
    if (coord && lastAnchoredCoord) {
      directDistanceFromAnchor = haversine(lastAnchoredCoord, coord);
    }

    let segmentDistance = null;
    if (coord && previousCoord) {
      segmentDistance = haversine(previousCoord, coord);
    }

    let activity;
    let distanceFromAnchor = null;

    const textIndicatesStopped = entryIndicatesStopped(entry);

    if (point.__isAnchored || textIndicatesStopped) {
      activity = 'anchored';
      if (coord) {
        lastAnchoredCoord = coord;
      }
      distanceSinceAnchor = 0;
      distanceFromAnchor = 0;
    } else {
      if (segmentDistance !== null) {
        distanceSinceAnchor += segmentDistance;
      }
      distanceFromAnchor = distanceSinceAnchor;
      const nearAnchor = distanceFromAnchor !== null && distanceFromAnchor <= NEAR_ANCHOR_THRESHOLD_NM;
      const lowWindHighSpeed = (windSpeed != null && windSpeed < LOW_WIND_THRESHOLD) && (sog != null && sog > FAST_SPEED_THRESHOLD);
      activity = (nearAnchor || lowWindHighSpeed) ? 'motoring' : 'sailing';
    }

    point.activity = activity;
    if (distanceFromAnchor !== null) {
      point.distanceFromAnchor = distanceFromAnchor;
    }
    if (entry && typeof entry === 'object') {
      entry.activity = activity;
      if (distanceFromAnchor !== null) {
        entry.distanceFromAnchor = distanceFromAnchor;
      }
    }

    delete point.__isAnchored;

    if (coord) {
      previousCoord = coord;
    }
  }
}

/**
 * Function: markStopGaps
 * Description: Flag point pairs that should not be connected because they bridge a stop-to-sail interval.
 * Parameters:
 *   points (object[]): Ordered list of voyage points to scan for stop and sailing markers.
 * Returns: void - Adds skip connection flags onto affected points and their entries.
 */
function markStopGaps(points) {
  if (!Array.isArray(points) || points.length === 0) return;

  const applyBreakFlags = (fromPoint, toPoint) => {
    if (fromPoint && typeof fromPoint === 'object') {
      fromPoint.skipConnectionToNext = true;
      if (fromPoint.entry && typeof fromPoint.entry === 'object') {
        fromPoint.entry.skipConnectionToNext = true;
      }
    }
    if (toPoint && typeof toPoint === 'object') {
      toPoint.skipConnectionFromPrev = true;
      if (toPoint.entry && typeof toPoint.entry === 'object') {
        toPoint.entry.skipConnectionFromPrev = true;
      }
    }
  };

  let activeStopIndex = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const textLower = getEntryText(point ? point.entry : null);
    if (!textLower) {
      if (activeStopIndex !== null && i > activeStopIndex) {
        applyBreakFlags(points[i - 1], point);
      }
      continue;
    }

    if (entryIndicatesStopped(point.entry)) {
      if (activeStopIndex === null) activeStopIndex = i;
    }

    if (entryIndicatesSailing(point.entry)) {
      if (activeStopIndex !== null) {
        for (let j = activeStopIndex; j < i; j++) {
          applyBreakFlags(points[j], points[j + 1]);
        }
      }
      activeStopIndex = null;
    }
  }

  if (activeStopIndex !== null) {
    for (let j = activeStopIndex; j < points.length - 1; j++) {
      applyBreakFlags(points[j], points[j + 1]);
    }
  }
}

/**
 * Function: createVoyageAccumulator
 * Description: Initialise a voyage aggregation object using the first entry of a voyage.
 * Parameters:
 *   entry (object): Initial log entry that seeds the voyage data.
 * Returns: object - Mutable accumulator tracking voyage statistics.
 */
function createVoyageAccumulator(entry) {
  return {
    startTime: entry.datetime,
    endTime: entry.datetime,
    distance: 0,
    maxSpeed: 0,
    maxWind: 0,
    maxSpeedCoord: null,
    coords: [],
    points: [],
    windHeadings: [],
    windSpeedSum: 0,
    windSpeedCount: 0,
    speedSum: 0,
    speedCount: 0,
    totalDurationMs: 0,
    stoppedDurationMs: 0,
    stopActive: false,
    lastEntry: null
  };
}

/**
 * Function: finalizeVoyage
 * Description: Produce the final voyage summary from an accumulator, computing averages and metadata while excluding stopped time from speed calculations.
 * Parameters:
 *   current (object): Voyage accumulator with aggregated metrics and points.
 * Returns: object - Finalised voyage summary ready for serialisation.
 */
function finalizeVoyage(current) {
  classifyVoyagePoints(current.points);
  markStopGaps(current.points);
  let avgSpeed = 0;
  const movingDurationMs = Math.max(0, current.totalDurationMs - current.stoppedDurationMs);
  if (movingDurationMs > 0) {
    const movingHours = movingDurationMs / (1000 * 60 * 60);
    avgSpeed = current.distance / movingHours;
  } else if (current.speedCount > 0) {
    avgSpeed = current.speedSum / current.speedCount;
  }
  const avgWindSpeed = current.windSpeedCount > 0 ? current.windSpeedSum / current.windSpeedCount : 0;
  return {
    startTime: current.startTime.toISOString(),
    endTime:   current.endTime.toISOString(),
    nm:        parseFloat(current.distance.toFixed(1)),
    maxSpeed:  current.maxSpeed,
    avgSpeed:  avgSpeed,
    maxWind:   current.maxWind,
    avgWindSpeed: avgWindSpeed,
    avgWindHeading: current.windHeadings.length > 0 ? circularMean(current.windHeadings) : null,
    coords:    current.coords,
    points:    current.points,
    maxSpeedCoord: current.maxSpeedCoord
  };
}

/**
 * Function: readEntries
 * Description: Load and parse all YAML log entries found within a directory.
 * Parameters:
 *   dir (string): Filesystem path containing daily YAML log files.
 * Returns: Promise<object[]> - Chronologically ordered log entries.
 */
async function readEntries(dir) {
  const files = await fs.readdir(dir);
  const entries = [];
  for (const file of files) {
    if (!/^\d{4}-\d{2}-\d{2}\.yml$/.test(file)) continue;
    const content = await fs.readFile(path.join(dir, file), 'utf8');
    yaml.parse(content).forEach(e => {
      e.datetime = new Date(e.datetime);
      entries.push(e);
    });
  }
  return entries.sort((a,b) => a.datetime - b.datetime);
}

/**
 * Function: groupVoyages
 * Description: Aggregate chronological entries into voyages spanning consecutive days.
 * Parameters:
 *   entries (object[]): Sorted log entries covering one or more days.
 * Returns: object[] - Array of voyage summaries.
 */
function groupVoyages(entries) {
  const voyages = [];
  let current = null;
  let lastDate = null;

  function isConsecutiveDay(d1, d2) {
    const oneDay = 48 * 60 * 60 * 1000;
    const diff = d2.getTime() - d1.getTime();
    return diff >= 0 && diff <= oneDay;
  }

  for (const entry of entries) {
    const entryDate = new Date(Date.UTC(
      entry.datetime.getUTCFullYear(),
      entry.datetime.getUTCMonth(),
      entry.datetime.getUTCDate()
    ));

    if (!current) {
      current = createVoyageAccumulator(entry);
    } else {
      if (!lastDate || !isConsecutiveDay(lastDate, entryDate)) {
        voyages.push(finalizeVoyage(current));
        current = createVoyageAccumulator(entry);
      }
    }

    current.endTime = entry.datetime;

    if (current.lastEntry && current.lastEntry.datetime instanceof Date && entry.datetime instanceof Date) {
      const durationMs = entry.datetime.getTime() - current.lastEntry.datetime.getTime();
      if (Number.isFinite(durationMs) && durationMs > 0) {
        current.totalDurationMs += durationMs;
        if (current.stopActive) {
          current.stoppedDurationMs += durationMs;
        }
      }
    }

    const coord = getPositionCoord(entry);
    if (coord) {
      if (current.coords.length > 0) {
        current.distance += haversine(current.coords[current.coords.length-1], coord);
      }
      current.coords.push(coord);
      // store a rich point with all entry information for later selection on the map
      const sanitized = JSON.parse(JSON.stringify(entry));
      // ensure datetime is a string in output JSON
      if (sanitized && sanitized.datetime instanceof Date) {
        sanitized.datetime = sanitized.datetime.toISOString();
      } else if (entry.datetime instanceof Date) {
        sanitized.datetime = entry.datetime.toISOString();
      }
      current.points.push({
        lon: coord[0],
        lat: coord[1],
        entry: sanitized
      });
    }

    const hasPosition = Array.isArray(coord);
    if (hasPosition && entry.speed) {
      const s = entry.speed.sog ?? entry.speed.stw;
      if (Number.isFinite(s)) {
        if (s > current.maxSpeed) {
          current.maxSpeed = s;
          current.maxSpeedCoord = coord;
        }
        current.speedSum += s;
        current.speedCount++;
      }
    }

    const windSpeed = entry.wind ? getWindSpeed(entry) : null;
    if (hasPosition && Number.isFinite(windSpeed)) {
      if (windSpeed > current.maxWind) current.maxWind = windSpeed;
      current.windSpeedSum += windSpeed;
      current.windSpeedCount++;
      if (entry.wind && Number.isFinite(entry.wind.direction)) {
        current.windHeadings.push(entry.wind.direction);
      }
    }

    const textIndicatesStopped = entryIndicatesStopped(entry);
    const textIndicatesSailing = entryIndicatesSailing(entry);
    if (textIndicatesStopped) {
      current.stopActive = true;
    }
    if (textIndicatesSailing) {
      current.stopActive = false;
    }

    current.lastEntry = entry;

    lastDate = entryDate;
  }

  if (current) {
    voyages.push(finalizeVoyage(current));
  }
  return voyages;
}

(async () => {
  const dir     = process.argv[2];
  const entries = await readEntries(dir);
  const voyages = groupVoyages(entries);
  // Ensure voyages are emitted in chronological order by start time
  voyages.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  console.log(JSON.stringify({ voyages }, null, 2));
})();
