/**
 * Function: toDMS
 * Description: Format a latitude or longitude value as degrees, minutes, and seconds.
 * Parameters:
 *   value (number): Coordinate component in decimal degrees.
 *   isLat (boolean): True when formatting a latitude value, false for longitude.
 * Returns: string - Formatted DMS representation or an em dash when invalid.
 */
export function toDMS(value, isLat) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutesFloat = (abs - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60);
  if (seconds === 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes === 60) {
    minutes = 0;
    degrees += 1;
  }
  const direction = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const minutesText = String(minutes).padStart(2, '0');
  const secondsText = String(seconds).padStart(2, '0');
  return `${degrees}°${minutesText}′${secondsText}″${direction}`;
}

/**
 * Function: formatPosition
 * Description: Produce a formatted position string that combines latitude and longitude values.
 * Parameters:
 *   lat (number): Latitude in decimal degrees.
 *   lon (number): Longitude in decimal degrees.
 * Returns: string - Combined DMS formatted position.
 */
export function formatPosition(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return '—';
  return `${toDMS(lat, true)} ${toDMS(lon, false)}`;
}

/**
 * Function: degToCompass
 * Description: Convert a heading in degrees to a cardinal or intercardinal compass label.
 * Parameters:
 *   deg (number): Heading in degrees from 0 through 359.
 * Returns: string - Compass label representing the supplied heading.
 */
export function degToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Function: degToCompassLocal
 * Description: Convert degrees to a localized compass heading used within the details panel.
 * Parameters:
 *   deg (number): Heading in degrees.
 * Returns: string - Compass label representing the supplied heading.
 */
export function degToCompassLocal(deg) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(deg / 45) % 8];
}

/**
 * Function: extractHeadingDegrees
 * Description: Extract a heading measurement from an entry when available.
 * Parameters:
 *   entry (object): Voyage entry containing heading-related properties.
 * Returns: number|undefined - Heading in degrees or undefined when not present.
 */
export function extractHeadingDegrees(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const heading = entry.heading;
  if (typeof heading !== 'number' || Number.isNaN(heading)) return undefined;
  return ((heading % 360) + 360) % 360;
}

/**
 * Function: nearestHour
 * Description: Round a timestamp to the nearest hour and return the adjusted Date and label.
 * Parameters:
 *   dateStr (string): ISO datetime string to round.
 * Returns: object|string - Object with rounded Date and label or an em dash when invalid.
 */
export function nearestHour(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d)) return '—';
  d.setMinutes(d.getMinutes() + 30);
  d.setMinutes(0, 0, 0);
  let hours = d.getHours();
  const suffix = hours >= 12 ? 'pm' : 'am';
  hours %= 12;
  if (hours === 0) hours = 12;
  return { d, label: `${hours}${suffix}` };
}

/**
 * Function: dateHourLabel
 * Description: Format a timestamp into a combined date and nearest-hour label.
 * Parameters:
 *   dateStr (string): ISO datetime string to format.
 * Returns: string - Formatted label or em dash when invalid.
 */
export function dateHourLabel(dateStr) {
  const result = nearestHour(dateStr);
  if (result === '—') return result;
  const { d, label } = result;
  const dateTxt = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${dateTxt} ${label}`;
}

/**
 * Function: weekdayShort
 * Description: Produce a short weekday label for the supplied timestamp.
 * Parameters:
 *   dateStr (string): ISO datetime string to format.
 * Returns: string - Abbreviated weekday or empty string when invalid.
 */
export function weekdayShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
