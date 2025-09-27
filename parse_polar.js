'use strict';

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundToDecimals(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeRelativeAngle(angle) {
  if (!Number.isFinite(angle)) return null;
  let normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  if (normalized === -180) {
    normalized = 180;
  }
  return normalized;
}

function normalizeAngle360(angle) {
  if (!Number.isFinite(angle)) return null;
  const normalized = ((angle % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

function roundToIncrement(value, increment, options = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return null;
  const { wrap360 = false } = options;
  const rounded = Math.round(value / increment) * increment;
  if (wrap360 && rounded === 360) return 0;
  return rounded;
}

function degToRad(deg) {
  if (!Number.isFinite(deg)) return null;
  return (deg * Math.PI) / 180;
}

function selectCourse(entry) {
  if (!entry) return null;
  const course = asNumber(entry.course);
  if (course !== null) return course;
  return asNumber(entry.heading);
}

function selectTrueWindDirection(entry) {
  if (!entry || !entry.wind) return null;
  const { wind } = entry;
  const directionTrue = asNumber(wind.directionTrue);
  if (directionTrue !== null) return directionTrue;
  return asNumber(wind.direction);
}

function selectTrueWindSpeed(entry) {
  if (!entry || !entry.wind) return null;
  const { wind } = entry;
  const speedTrue = asNumber(wind.speedTrue);
  if (speedTrue !== null) return speedTrue;
  return asNumber(wind.speed);
}

function selectSpeed(entry, key) {
  if (!entry || !entry.speed) return null;
  return asNumber(entry.speed[key]);
}

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

module.exports = function generatePolar(voyagesData) {
  return {
    points: buildPolarPoints(voyagesData)
  };
};
