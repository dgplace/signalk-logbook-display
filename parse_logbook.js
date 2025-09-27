// save as parse_logbook.js and run with:
//   node parse_logbook.js ~/.signalk/plugin-config-data/signalk-logbook > voyages.json

const fs   = require('fs').promises;
const path = require('path');
const yaml = require('yaml');

// convert degrees to radians
function degToRad(d) { return (d * Math.PI) / 180; }
// compute haversine distance in nautical miles
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

function getSog(entry) {
  if (!entry || !entry.speed) return null;
  const { speed } = entry;
  if (typeof speed.sog === 'number') return speed.sog;
  if (typeof speed.stw === 'number') return speed.stw;
  return null;
}

function getWindSpeed(entry) {
  if (!entry || !entry.wind) return null;
  const { wind } = entry;
  if (typeof wind.speedTrue === 'number') return wind.speedTrue;
  if (typeof wind.speed === 'number') return wind.speed;
  if (typeof wind.speedApparent === 'number') return wind.speedApparent;
  return null;
}

function parseEntryDate(entry) {
  if (!entry) return null;
  const raw = entry.datetime ?? entry.time ?? entry.timestamp;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const entry = point.entry || {};
    const coord = (typeof point.lon === 'number' && typeof point.lat === 'number') ? [point.lon, point.lat] : null;

    const currentTime = parseEntryDate(entry);
    const nextTime = i < points.length - 1 ? parseEntryDate(points[i + 1]?.entry) : null;
    const sog = getSog(entry);

    const gapHours = currentTime && nextTime ? (nextTime.getTime() - currentTime.getTime()) / (1000 * 60 * 60) : null;
    const gapAnchored = gapHours !== null && gapHours > GAP_HOURS_THRESHOLD && (sog ?? 0) < GAP_SOG_THRESHOLD;
    const nextDayBreak = currentTime && nextTime
      ? (currentTime.getUTCFullYear() !== nextTime.getUTCFullYear() ||
         currentTime.getUTCMonth() !== nextTime.getUTCMonth() ||
         currentTime.getUTCDate() !== nextTime.getUTCDate())
      : false;
    const endOfDayAnchored = nextDayBreak && (sog ?? 0) < GAP_SOG_THRESHOLD;

    let directDistanceFromAnchor = null;
    if (coord && lastAnchoredCoord) {
      directDistanceFromAnchor = haversine(lastAnchoredCoord, coord);
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
    } else if (directDistanceFromAnchor !== null && directDistanceFromAnchor <= MOVE_THRESHOLD_NM) {
      isAnchored = true;
    }

    point.__isAnchored = isAnchored;
    if (isAnchored && coord) {
      lastAnchoredCoord = coord;
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
  let previousCoord = null;
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

    if (point.__isAnchored) {
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
    speedCount: 0
  };
}

function finalizeVoyage(current) {
  classifyVoyagePoints(current.points);
  const avgSpeed = current.speedCount > 0 ? current.speedSum / current.speedCount : 0;
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

function groupVoyages(entries) {
  const voyages = [];
  let current = null;
  let lastDate = null;

  function isConsecutiveDay(d1, d2) {
    const oneDay = 24 * 60 * 60 * 1000;
    const diff = d2.getTime() - d1.getTime();
    return diff >= 0 && diff <= oneDay;
  }

  for (const entry of entries) {
    const entryDate = new Date(entry.datetime.getFullYear(), entry.datetime.getMonth(), entry.datetime.getDate());

    if (!current) {
      current = createVoyageAccumulator(entry);
    } else {
      if (!lastDate || !isConsecutiveDay(lastDate, entryDate)) {
        voyages.push(finalizeVoyage(current));
        current = createVoyageAccumulator(entry);
      }
    }

    current.endTime = entry.datetime;

    let coord = null;
    if (entry.position && typeof entry.position.longitude === 'number' &&
        typeof entry.position.latitude === 'number') {
      coord = [entry.position.longitude, entry.position.latitude];
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
        lon: entry.position.longitude,
        lat: entry.position.latitude,
        entry: sanitized
      });
    }
    if (entry.speed) {
      const s = entry.speed.sog ?? entry.speed.stw;
      if (typeof s === 'number') {
        if (s > current.maxSpeed) {
          current.maxSpeed = s;
          if (coord) current.maxSpeedCoord = coord;
        }
        current.speedSum += s;
        current.speedCount++;
      }
    }
    if (entry.wind && typeof entry.wind.speed === 'number') {
      if (entry.wind.speed > current.maxWind) current.maxWind = entry.wind.speed;
      current.windSpeedSum += entry.wind.speed;
      current.windSpeedCount++;
      if (typeof entry.wind.direction === 'number') {
        current.windHeadings.push(entry.wind.direction);
      }
    }

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
