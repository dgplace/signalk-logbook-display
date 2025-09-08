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
      current = {
        startTime: entry.datetime,
        endTime: entry.datetime,
        distance: 0, maxSpeed: 0, maxWind: 0,
        maxSpeedCoord: null,
        coords: [],
        windHeadings: [],
        windSpeedSum: 0,
        windSpeedCount: 0,
        speedSum: 0,
        speedCount: 0
      };
    } else {
      if (!lastDate || !isConsecutiveDay(lastDate, entryDate)) {
        const avgSpeed = current.speedCount > 0 ? current.speedSum / current.speedCount : 0;
        const avgWindSpeed = current.windSpeedCount > 0 ? current.windSpeedSum / current.windSpeedCount : 0;
        voyages.push({
          startTime: current.startTime.toISOString(),
          endTime:   current.endTime.toISOString(),
          nm:        parseFloat(current.distance.toFixed(1)),
          maxSpeed:  current.maxSpeed,
          avgSpeed:  avgSpeed,
          maxWind:   current.maxWind,
          avgWindSpeed: avgWindSpeed,
          avgWindHeading: current.windHeadings.length > 0 ? circularMean(current.windHeadings) : null,
          coords:    current.coords,
          maxSpeedCoord: current.maxSpeedCoord
        });
        current = {
          startTime: entry.datetime,
          endTime: entry.datetime,
          distance: 0, maxSpeed: 0, maxWind: 0,
          maxSpeedCoord: null,
          coords: [],
          windHeadings: [],
          windSpeedSum: 0,
          windSpeedCount: 0,
          speedSum: 0,
          speedCount: 0
        };
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
    const avgSpeed = current.speedCount > 0 ? current.speedSum / current.speedCount : 0;
    const avgWindSpeed = current.windSpeedCount > 0 ? current.windSpeedSum / current.windSpeedCount : 0;
    voyages.push({
      startTime: current.startTime.toISOString(),
      endTime:   current.endTime.toISOString(),
      nm:        parseFloat(current.distance.toFixed(1)),
      maxSpeed:  current.maxSpeed,
      avgSpeed:  avgSpeed,
      maxWind:   current.maxWind,
      avgWindSpeed: avgWindSpeed,
      avgWindHeading: current.windHeadings.length > 0 ? circularMean(current.windHeadings) : null,
      coords:    current.coords,
      maxSpeedCoord: current.maxSpeedCoord
    });
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
