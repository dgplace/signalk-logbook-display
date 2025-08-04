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
  for (const entry of entries) {
    if (!current) {
      current = { 
        startTime: entry.datetime,
        endTime: entry.datetime,
        distance: 0, maxSpeed: 0, maxWind: 0,
        coords: []
      };
    }
    current.endTime = entry.datetime;
    if (entry.position && typeof entry.position.longitude === 'number' &&
        typeof entry.position.latitude === 'number') {
      const coord = [entry.position.longitude, entry.position.latitude];
      if (current.coords.length > 0) {
        current.distance += haversine(current.coords[current.coords.length-1], coord);
      }
      current.coords.push(coord);
    }
    if (entry.speed) {
      const s = entry.speed.sog ?? entry.speed.stw;
      if (typeof s === 'number' && s > current.maxSpeed) current.maxSpeed = s;
    }
    if (entry.wind && typeof entry.wind.speed === 'number') {
      if (entry.wind.speed > current.maxWind) current.maxWind = entry.wind.speed;
    }
    if (entry.end) {
      voyages.push({
        startTime: current.startTime.toISOString(),
        endTime:   current.endTime.toISOString(),
        nm:        parseFloat(current.distance.toFixed(1)),
        maxSpeed:  current.maxSpeed,
        maxWind:   current.maxWind,
        coords:    current.coords
      });
      current = null;
    }
  }
  if (current) {
    voyages.push({
      startTime: current.startTime.toISOString(),
      endTime:   current.endTime.toISOString(),
      nm:        parseFloat(current.distance.toFixed(1)),
      maxSpeed:  current.maxSpeed,
      maxWind:   current.maxWind,
      coords:    current.coords
    });
  }
  return voyages;
}

(async () => {
  const dir     = process.argv[2];
  const entries = await readEntries(dir);
  const voyages = groupVoyages(entries);
  console.log(JSON.stringify({ voyages }, null, 2));
})();
