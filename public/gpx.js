
import { getVoyagePoints } from './data.js';

/**
 * Function: escapeXmlValue
 * Description: Escape special characters for safe XML output.
 * Parameters:
 *   value (any): Value to convert into escaped XML text.
 * Returns: string - XML-safe string.
 */
function escapeXmlValue(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Function: lowerFirstChar
 * Description: Lower-case the first character of a string.
 * Parameters:
 *   text (string): Input string.
 * Returns: string - String with lower-cased first character.
 */
function lowerFirstChar(text) {
  if (!text) return '';
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Function: upperFirstChar
 * Description: Upper-case the first character of a string.
 * Parameters:
 *   text (string): Input string.
 * Returns: string - String with upper-cased first character.
 */
function upperFirstChar(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Function: buildExtensionName
 * Description: Build a safe extension tag name from a list of path segments.
 * Parameters:
 *   segments (string[]): Path segments describing the value.
 * Returns: string|null - Sanitized extension tag name or null when invalid.
 */
function buildExtensionName(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const safeSegments = segments
    .map(segment => String(segment).trim())
    .filter(Boolean)
    .map(segment => segment.split(/[^a-zA-Z0-9]+/).filter(Boolean))
    .flat();
  if (safeSegments.length === 0) return null;
  const [first, ...rest] = safeSegments;
  let name = lowerFirstChar(first);
  rest.forEach(part => {
    name += upperFirstChar(part);
  });
  if (!/^[A-Za-z_]/.test(name)) {
    name = `meta${upperFirstChar(name)}`;
  }
  return name || null;
}

/**
 * Function: normalizeExtensionValue
 * Description: Normalize an extension value into a string for XML output.
 * Parameters:
 *   value (any): Value to normalize.
 * Returns: string|null - Normalized value or null when empty/invalid.
 */
function normalizeExtensionValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

/**
 * Function: addExtensionValue
 * Description: Append an extension entry when the value is valid.
 * Parameters:
 *   entries (object[]): Extension entries array to append to.
 *   name (string): Extension tag name.
 *   value (any): Value to record.
 * Returns: void.
 */
function addExtensionValue(entries, name, value) {
  if (!name) return;
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    value.forEach(item => addExtensionValue(entries, name, item));
    return;
  }
  const normalized = normalizeExtensionValue(value);
  if (normalized === null || normalized === '') return;
  entries.push({ name, value: normalized });
}

/**
 * Function: addNestedFallback
 * Description: Add extension entries for nested object keys not explicitly mapped.
 * Parameters:
 *   entries (object[]): Extension entries array to append to.
 *   source (object): Nested object to inspect.
 *   prefix (string): Prefix to apply to extension tag names.
 *   skipKeys (Set<string>): Keys to skip within the nested object.
 * Returns: void.
 */
function addNestedFallback(entries, source, prefix, skipKeys = new Set()) {
  if (!source || typeof source !== 'object') return;
  Object.entries(source).forEach(([key, value]) => {
    if (skipKeys.has(key)) return;
    const name = buildExtensionName([prefix, key]);
    addExtensionValue(entries, name, value);
  });
}

/**
 * Function: addObjectFallback
 * Description: Add extension entries for object keys not explicitly mapped.
 * Parameters:
 *   entries (object[]): Extension entries array to append to.
 *   source (object): Source object to inspect.
 *   prefix (string): Prefix to apply to extension tag names.
 *   skipKeys (Set<string>): Keys to skip within the object.
 * Returns: void.
 */
function addObjectFallback(entries, source, prefix, skipKeys = new Set()) {
  if (!source || typeof source !== 'object') return;
  Object.entries(source).forEach(([key, value]) => {
    if (skipKeys.has(key)) return;
    const name = buildExtensionName([prefix, key]);
    addExtensionValue(entries, name, value);
  });
}

/**
 * Function: buildPointExtensions
 * Description: Build GPX extension entries from a voyage point.
 * Parameters:
 *   point (object): Voyage point containing entry metadata.
 * Returns: object[] - Array of extension entries.
 */
function buildPointExtensions(point) {
  const entries = [];
  const entry = (point && typeof point.entry === 'object') ? point.entry : {};

  const activity = point?.activity ?? entry.activity;
  addExtensionValue(entries, 'activity', activity);

  const distanceFromAnchor = point?.distanceFromAnchor ?? entry.distanceFromAnchor;
  addExtensionValue(entries, 'distanceFromAnchorNm', distanceFromAnchor);

  const skipConnectionToNext = point?.skipConnectionToNext ?? entry.skipConnectionToNext;
  addExtensionValue(entries, 'skipConnectionToNext', skipConnectionToNext);

  const skipConnectionFromPrev = point?.skipConnectionFromPrev ?? entry.skipConnectionFromPrev;
  addExtensionValue(entries, 'skipConnectionFromPrev', skipConnectionFromPrev);

  addExtensionValue(entries, 'logText', entry.text);
  addExtensionValue(entries, 'logAuthor', entry.author);
  addExtensionValue(entries, 'logCategory', entry.category);
  addExtensionValue(entries, 'entryEnd', entry.end);

  addExtensionValue(entries, 'headingDeg', entry.heading);
  addExtensionValue(entries, 'courseDeg', entry.course);
  addExtensionValue(entries, 'barometerHpa', entry.barometer);
  addExtensionValue(entries, 'logNm', entry.log);

  if (Array.isArray(entry.crewNames)) {
    addExtensionValue(entries, 'crewName', entry.crewNames);
  }

  const speed = entry.speed || {};
  addExtensionValue(entries, 'speedOverGroundKn', speed.sog);
  addExtensionValue(entries, 'speedThroughWaterKn', speed.stw);

  const wind = entry.wind || point?.wind || {};
  addExtensionValue(entries, 'windSpeedKn', wind.speed);
  addExtensionValue(entries, 'windSpeedTrueKn', wind.speedTrue);
  addExtensionValue(entries, 'windSpeedApparentKn', wind.speedApparent);
  addExtensionValue(entries, 'windDirectionDeg', wind.direction);

  const position = entry.position || {};
  addExtensionValue(entries, 'positionSource', position.source);

  const waypoint = entry.waypoint || {};
  addExtensionValue(entries, 'waypointLat', waypoint.latitude);
  addExtensionValue(entries, 'waypointLon', waypoint.longitude);

  addExtensionValue(entries, 'manualLocationName', point?.manualLocationName);

  addExtensionValue(entries, 'customLogbookMaxHeel', entry['custom.logbook.maxHeel']);
  addExtensionValue(entries, 'customLogbookMaxSpeed', entry['custom.logbook.maxSpeed']);
  addExtensionValue(entries, 'customLogbookMaxWind', entry['custom.logbook.maxWind']);

  const entrySkipKeys = new Set([
    'activity',
    'author',
    'barometer',
    'category',
    'course',
    'crewNames',
    'custom.logbook.maxHeel',
    'custom.logbook.maxSpeed',
    'custom.logbook.maxWind',
    'datetime',
    'distanceFromAnchor',
    'end',
    'heading',
    'log',
    'position',
    'skipConnectionFromPrev',
    'skipConnectionToNext',
    'speed',
    'text',
    'waypoint',
    'wind'
  ]);
  addObjectFallback(entries, entry, 'entry', entrySkipKeys);

  const pointSkipKeys = new Set([
    'activity',
    'distanceFromAnchor',
    'entry',
    'lat',
    'lon',
    'manualLocationName',
    'skipConnectionFromPrev',
    'skipConnectionToNext',
    'wind'
  ]);
  addObjectFallback(entries, point, 'point', pointSkipKeys);

  addNestedFallback(entries, wind, 'wind', new Set(['speed', 'speedTrue', 'speedApparent', 'direction']));
  addNestedFallback(entries, speed, 'speed', new Set(['sog', 'stw']));
  addNestedFallback(entries, position, 'position', new Set(['latitude', 'longitude', 'source']));
  addNestedFallback(entries, waypoint, 'waypoint', new Set(['latitude', 'longitude']));

  return entries;
}

/**
 * Function: buildExtensionsXml
 * Description: Build an XML snippet containing GPX extensions for a point.
 * Parameters:
 *   point (object): Voyage point containing entry metadata.
 * Returns: string - XML snippet or empty string when no extensions exist.
 */
function buildExtensionsXml(point) {
  const entries = buildPointExtensions(point);
  if (entries.length === 0) return '';
  let xml = '        <extensions>\n';
  entries.forEach(({ name, value }) => {
    xml += `          <sk:${name}>${escapeXmlValue(value)}</sk:${name}>\n`;
  });
  xml += '        </extensions>\n';
  return xml;
}

/**
 * Function: generateGPX
 * Description: Generates a GPX string for a given voyage.
 * Parameters:
 *   voyage (object): The voyage object to export.
 * Returns: string - The generated GPX XML content.
 */
export function generateGPX(voyage) {
  const points = getVoyagePoints(voyage);
  const startTime = voyage.startTime || (points.length > 0 ? (points[0].entry?.datetime || points[0].datetime) : new Date().toISOString());
  
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx version="1.1" creator="Signalk Logbook" xmlns="http://www.topografix.com/GPX/1/1" xmlns:sk="https://signalk.org/logbook">\n';
  gpx += `  <metadata>\n    <time>${startTime}</time>\n  </metadata>\n`;
  gpx += '  <trk>\n';
  gpx += `    <name>Voyage ${voyage._tripIndex || ''}</name>\n`;
  gpx += '    <trkseg>\n';

  points.forEach(point => {
    const lat = point.lat;
    const lon = point.lon;
    const time = point.entry?.datetime || point.datetime;
    
    if (lat !== undefined && lon !== undefined) {
      gpx += `      <trkpt lat="${lat}" lon="${lon}">\n`;
      if (time) {
        gpx += `        <time>${time}</time>\n`;
      }
      gpx += buildExtensionsXml(point);
      gpx += '      </trkpt>\n';
    }
  });

  gpx += '    </trkseg>\n';
  gpx += '  </trk>\n';
  gpx += '</gpx>';

  return gpx;
}

/**
 * Function: downloadGPX
 * Description: Triggers a browser download for the GPX content.
 * Parameters:
 *   filename (string): The name of the file to download.
 *   content (string): The GPX content.
 * Returns: void
 */
export function downloadGPX(filename, content) {
  const blob = new Blob([content], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Function: handleExportGPX
 * Description: Orchestrates the GPX export process for a voyage.
 * Parameters:
 *   voyage (object): The voyage to export.
 * Returns: void
 */
export function handleExportGPX(voyage) {
  const gpxContent = generateGPX(voyage);
  const tripIndex = voyage._tripIndex || 'voyage';
  const dateStr = voyage.startTime ? new Date(voyage.startTime).toISOString().split('T')[0] : 'unknown_date';
  const filename = `voyage_${tripIndex}_${dateStr}.gpx`;
  downloadGPX(filename, gpxContent);
}
