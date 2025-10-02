'use strict';

/**
 * Function: asNumber
 * Description: Return a finite numeric value when the input is a number, otherwise null.
 * Parameters:
 *   value (*): Candidate value to validate.
 * Returns: number|null - Finite numeric value or null when invalid.
 */
function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Function: roundToDecimals
 * Description: Round a numeric value to the requested number of decimal places.
 * Parameters:
 *   value (number): Value to round.
 *   decimals (number): Number of decimal places to keep.
 * Returns: number|null - Rounded value or null when input is not finite.
 */
function roundToDecimals(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Function: normalizeRelativeAngle
 * Description: Normalize an angle to the range [-180, 180] handling wrap-around at boundaries.
 * Parameters:
 *   angle (number): Angle in degrees to normalize.
 * Returns: number|null - Normalized angle or null when the input is not finite.
 */
function normalizeRelativeAngle(angle) {
  if (!Number.isFinite(angle)) return null;
  let normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  if (normalized === -180) {
    normalized = 180;
  }
  return normalized;
}

/**
 * Function: normalizeAngle360
 * Description: Normalize an angle into the [0, 360) range.
 * Parameters:
 *   angle (number): Angle in degrees to normalize.
 * Returns: number|null - Normalized angle or null when the input is not finite.
 */
function normalizeAngle360(angle) {
  if (!Number.isFinite(angle)) return null;
  const normalized = ((angle % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

/**
 * Function: roundToIncrement
 * Description: Round a value to the nearest increment, optionally wrapping 360° to 0°.
 * Parameters:
 *   value (number): Value to round.
 *   increment (number): Increment size to use for rounding.
 *   options (object): Optional settings such as wrap360 for angle rounding.
 * Returns: number|null - Rounded value or null when inputs are invalid.
 */
function roundToIncrement(value, increment, options = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return null;
  const { wrap360 = false } = options;
  const rounded = Math.round(value / increment) * increment;
  if (wrap360 && rounded === 360) return 0;
  return rounded;
}

/**
 * Function: degToRad
 * Description: Convert an angle in degrees to radians.
 * Parameters:
 *   deg (number): Angle in degrees.
 * Returns: number|null - Angle expressed in radians or null when input is not finite.
 */
function degToRad(deg) {
  if (!Number.isFinite(deg)) return null;
  return (deg * Math.PI) / 180;
}

/**
 * Function: selectCourse
 * Description: Choose the best available course or heading value from a log entry.
 * Parameters:
 *   entry (object): Voyage log entry containing navigation data.
 * Returns: number|null - Selected course in degrees or null when unavailable.
 */
function selectCourse(entry) {
  if (!entry) return null;
  const course = asNumber(entry.course);
  if (course !== null) return course;
  return asNumber(entry.heading);
}

/**
 * Function: selectTrueWindDirection
 * Description: Extract the true wind direction from a log entry when present.
 * Parameters:
 *   entry (object): Voyage log entry containing wind data.
 * Returns: number|null - True wind direction in degrees or null when not available.
 */
function selectTrueWindDirection(entry) {
  if (!entry || !entry.wind) return null;
  const { wind } = entry;
  const directionTrue = asNumber(wind.directionTrue);
  if (directionTrue !== null) return directionTrue;
  return asNumber(wind.direction);
}

/**
 * Function: selectTrueWindSpeed
 * Description: Extract the true wind speed from a log entry when present.
 * Parameters:
 *   entry (object): Voyage log entry containing wind data.
 * Returns: number|null - True wind speed in knots or null when not available.
 */
function selectTrueWindSpeed(entry) {
  if (!entry || !entry.wind) return null;
  const { wind } = entry;
  const speedTrue = asNumber(wind.speedTrue);
  if (speedTrue !== null) return speedTrue;
  return asNumber(wind.speed);
}

/**
 * Function: selectSpeed
 * Description: Retrieve a named speed metric from a log entry when available.
 * Parameters:
 *   entry (object): Voyage log entry containing speed data.
 *   key (string): Speed property name such as 'stw' or 'sog'.
 * Returns: number|null - Speed in knots or null when not available.
 */
function selectSpeed(entry, key) {
  if (!entry || !entry.speed) return null;
  return asNumber(entry.speed[key]);
}

/**
 * Function: computeTwa
 * Description: Calculate the true wind angle relative to vessel course, including rounded display value.
 * Parameters:
 *   entry (object): Voyage log entry containing heading and wind direction data.
 * Returns: object - Contains raw relative angle and a rounded TWA suitable for binning.
 */
function computeTwa(entry) {
  const course = selectCourse(entry);
  const windDir = selectTrueWindDirection(entry);
  if (course === null || windDir === null) return { raw: null, twa: null };
  const relative = normalizeRelativeAngle(windDir - course);
  if (relative === null) return { raw: null, twa: null };
  const displayAngle = normalizeAngle360(relative);
  const twaRounded = displayAngle === null ? null : roundToIncrement(displayAngle, 5, { wrap360: true });
  return {
    raw: relative,
    twa: twaRounded
  };
}

/**
 * Function: computeAws
 * Description: Derive apparent wind speed from true wind angle, speed over ground, and true wind speed.
 * Parameters:
 *   twaRaw (number): Raw true wind angle relative to vessel heading in degrees.
 *   sog (number): Speed over ground in knots.
 *   tws (number): True wind speed in knots.
 * Returns: number|null - Apparent wind speed in knots or null when inputs are invalid.
 */
function computeAws(twaRaw, sog, tws) {
  if (!Number.isFinite(twaRaw) || !Number.isFinite(sog) || !Number.isFinite(tws)) return null;
  const absTwa = Math.min(Math.abs(twaRaw), 180);
  const angle = 180 - absTwa;
  const rad = degToRad(angle);
  if (rad === null) return null;
  const awsSquared = tws ** 2 + sog ** 2 - 2 * tws * sog * Math.cos(rad);
  if (!Number.isFinite(awsSquared)) return null;
  const aws = Math.sqrt(Math.max(awsSquared, 0));
  return roundToDecimals(aws, 2);
}

/**
 * Function: buildPolarPoints
 * Description: Extract polar data points from voyage logs, filtering for sailing activity and valid metrics.
 * Parameters:
 *   voyagesData (object): Parsed voyages dataset containing voyage point entries.
 * Returns: object[] - List of polar points including TWA, STW, SOG, TWS, and AWS values.
 */
function buildPolarPoints(voyagesData) {
  const points = [];
  if (!voyagesData || !Array.isArray(voyagesData.voyages)) {
    return points;
  }

  voyagesData.voyages.forEach(voyage => {
    if (!voyage || !Array.isArray(voyage.points)) return;

    voyage.points.forEach(point => {
      if (!point) return;
      const activity = point.activity ?? point.entry?.activity;
      if (activity !== 'sailing') return;

      const entry = point.entry || {};
      const { raw: twaRaw, twa } = computeTwa(entry);
      const stw = selectSpeed(entry, 'stw');
      const sog = selectSpeed(entry, 'sog');
      const tws = selectTrueWindSpeed(entry);
      const aws = computeAws(twaRaw, sog, tws);

      points.push({
        twa: twa === null ? null : (twa > 180 ? 360 - twa : twa),
        stw: stw === null ? null : roundToDecimals(stw, 2),
        sog: sog === null ? null : roundToDecimals(sog, 2),
        tws: tws === null ? null : roundToIncrement(tws, 5),
        aws: aws === null ? null : roundToDecimals(aws, 2)
      });
    });
  });

  return points;
}

/**
 * Function: generatePolar
 * Description: Build the polar dataset consumed by the front-end polar visualisation.
 * Parameters:
 *   voyagesData (object): Parsed voyages dataset that includes voyage points.
 * Returns: object - Polar data containing the derived list of points.
 */
module.exports = function generatePolar(voyagesData) {
  return {
    points: buildPolarPoints(voyagesData)
  };
};
