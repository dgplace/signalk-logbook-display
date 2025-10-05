import {
  extractWindSpeed,
  getPointActivity,
  shouldSkipConnection
} from './data.js';

export const SAILING_HIGHLIGHT_COLOR = '#ef4444';
export const NON_SAIL_HIGHLIGHT_COLOR = '#facc15';
const DEFAULT_HIGHLIGHT_WEIGHT = 4;
const DEFAULT_HIGHLIGHT_OPACITY = 0.95;
const WIND_SPEED_COLOR_STOPS = [
  { limit: 0, color: '#0b4f6c' },
  { limit: 6, color: '#1565c0' },
  { limit: 12, color: '#1e88e5' },
  { limit: 18, color: '#00acc1' },
  { limit: 24, color: '#26a69a' },
  { limit: 30, color: '#66bb6a' },
  { limit: 36, color: '#ffee58' },
  { limit: 42, color: '#f9a825' },
  { limit: 48, color: '#f4511e' },
  { limit: Infinity, color: '#d81b60' }
];
const MIN_WIND_RADIUS_PX = 6;
const MAX_WIND_RADIUS_PX = 24;
const POINT_MARKER_SIZE = 5;
const POINT_MARKER_DARKEN_FACTOR = 0.75;

function normalizeHexColor(hex) {
  if (typeof hex !== 'string') return null;
  let value = hex.trim();
  if (value.startsWith('#')) value = value.slice(1);
  if (value.length === 3) {
    value = value.split('').map((ch) => ch + ch).join('');
  }
  if (value.length !== 6 || !/^[0-9a-f]{6}$/i.test(value)) return null;
  return value.toLowerCase();
}

function darkenHexColor(hex, factor = 0.5) {
  const norm = normalizeHexColor(hex);
  if (!norm) return '#000000';
  const clampFactor = Math.max(0, Math.min(1, factor));
  const r = Math.round(parseInt(norm.slice(0, 2), 16) * clampFactor).toString(16).padStart(2, '0');
  const g = Math.round(parseInt(norm.slice(2, 4), 16) * clampFactor).toString(16).padStart(2, '0');
  const b = Math.round(parseInt(norm.slice(4, 6), 16) * clampFactor).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function windSpeedToColor(speed) {
  if (typeof speed !== 'number' || Number.isNaN(speed)) return '#0b4f6c';
  let selected = WIND_SPEED_COLOR_STOPS[0].color;
  for (let i = 0; i < WIND_SPEED_COLOR_STOPS.length; i += 1) {
    const stop = WIND_SPEED_COLOR_STOPS[i];
    selected = stop.color;
    if (speed <= stop.limit) break;
  }
  return selected;
}

function windSpeedToRadiusPx(speed) {
  if (typeof speed !== 'number' || Number.isNaN(speed)) return MIN_WIND_RADIUS_PX;
  const clamped = Math.max(0, Math.min(50, speed));
  const fraction = clamped / 50;
  return MIN_WIND_RADIUS_PX + Math.round((MAX_WIND_RADIUS_PX - MIN_WIND_RADIUS_PX) * fraction);
}

/**
 * Function: createPointMarkerIcon
 * Description: Generate a Leaflet div icon representing a voyage point with activity-specific colouring.
 * Parameters:
 *   point (object): Voyage point carrying activity metadata.
 * Returns: L.DivIcon - Icon instance used for map markers.
 */
export function createPointMarkerIcon(point) {
  const activity = getPointActivity(point);
  const baseColor = activity === 'sailing' ? SAILING_HIGHLIGHT_COLOR : NON_SAIL_HIGHLIGHT_COLOR;
  const fillColor = darkenHexColor(baseColor, POINT_MARKER_DARKEN_FACTOR);
  const size = POINT_MARKER_SIZE;
  const anchor = Math.ceil(size / 2);
  return L.divIcon({
    className: 'point-square-icon',
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
    html: `<span class="point-square-fill" style="background:${fillColor};"></span>`
  });
}

function segmentPointsByActivity(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const segments = [];
  let current = null;

  const flush = () => {
    if (current && Array.isArray(current.latLngs) && current.latLngs.length >= 2) segments.push(current);
    current = null;
  };

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const startValid = typeof start?.lat === 'number' && typeof start?.lon === 'number';
    const endValid = typeof end?.lat === 'number' && typeof end?.lon === 'number';
    if (!startValid || !endValid) {
      flush();
      continue;
    }
    if (shouldSkipConnection(start, end)) {
      flush();
      continue;
    }
    const startLL = [start.lat, start.lon];
    const endLL = [end.lat, end.lon];
    const startAct = getPointActivity(start);
    const endAct = getPointActivity(end);
    const color = (startAct === 'sailing' && endAct === 'sailing') ? SAILING_HIGHLIGHT_COLOR : NON_SAIL_HIGHLIGHT_COLOR;
    if (!current || current.color !== color) {
      flush();
      current = { color, latLngs: [startLL] };
    } else {
      const last = current.latLngs[current.latLngs.length - 1];
      if (!last || last[0] !== startLL[0] || last[1] !== startLL[1]) current.latLngs.push(startLL);
    }
    current.latLngs.push(endLL);
  }
  flush();
  return segments;
}

/**
 * Function: createActivityHighlightPolylines
 * Description: Build activity-based polylines for the supplied voyage points and add them to the Leaflet map.
 * Parameters:
 *   map (L.Map): Leaflet map instance receiving the polylines.
 *   points (object[]): Voyage points used to derive segments.
 *   options (object): Optional overrides for line weight and opacity.
 * Returns: object[] - Array of Leaflet polylines added to the map.
 */
export function createActivityHighlightPolylines(map, points, options = {}) {
  if (!map || !Array.isArray(points) || points.length < 2) return [];
  const weight = typeof options.weight === 'number' ? options.weight : DEFAULT_HIGHLIGHT_WEIGHT;
  const opacity = typeof options.opacity === 'number' ? options.opacity : DEFAULT_HIGHLIGHT_OPACITY;
  const segments = segmentPointsByActivity(points);
  return segments.map((seg) => {
    const polyline = L.polyline(seg.latLngs, {
      color: seg.color,
      weight,
      opacity,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    polyline._activityHighlight = true;
    if (polyline.bringToFront) polyline.bringToFront();
    return polyline;
  });
}

/**
 * Function: createWindIntensityLayer
 * Description: Create a non-interactive wind intensity layer for the supplied voyage points.
 * Parameters:
 *   points (object[]): Voyage points containing wind speed data.
 * Returns: L.Layer|null - Layer group with per-point wind markers, or null when no markers apply.
 */
export function createWindIntensityLayer(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const layer = L.layerGroup();
  let rendered = 0;
  points.forEach((point) => {
    const speed = extractWindSpeed(point);
    if (speed === null) return;
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') return;
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: windSpeedToRadiusPx(speed),
      color: 'rgba(17, 24, 39, 0.35)',
      weight: 1,
      fillColor: windSpeedToColor(speed),
      fillOpacity: 0.45,
      interactive: false
    });
    marker.addTo(layer);
    rendered += 1;
  });
  return rendered > 0 ? layer : null;
}

/**
 * Function: calculateWindArrowSize
 * Description: Determine a wind arrow icon size scaled to the supplied wind speed.
 * Parameters:
 *   speedKn (number): Wind speed in knots.
 * Returns: number - Arrow icon size in pixels.
 */
export function calculateWindArrowSize(speedKn) {
  const small = 60;
  const mid = 180;
  const large = 240;
  if (!(typeof speedKn === 'number') || Number.isNaN(speedKn)) return small;
  if (speedKn <= 5) return small;
  if (speedKn >= 25) return large;
  const t = (speedKn - 5) / 20;
  return Math.round(small + t * (mid - small));
}

/**
 * Function: createBoatIcon
 * Description: Produce a Leaflet div icon representing the vessel at the supplied bearing.
 * Parameters:
 *   bearingDeg (number): Heading in degrees for icon rotation.
 * Returns: L.DivIcon - Configured boat icon instance.
 */
export function createBoatIcon(bearingDeg) {
  const w = 18;
  const h = 36;
  const html = `
    <div class="boat-icon" style="width:${w}px;height:${h}px;transform: rotate(${bearingDeg.toFixed(1)}deg);">
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <polygon points="${w / 2},2 2,${h - 2} ${w - 2},${h - 2}" fill="var(--accent-color, #ef4444)" stroke="#ffffff" stroke-width="1.5" />
      </svg>
    </div>`;
  return L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: [w / 2, h / 2] });
}

export const DEFAULT_ACTIVITY_WEIGHT = DEFAULT_HIGHLIGHT_WEIGHT;
export const DEFAULT_ACTIVITY_OPACITY = DEFAULT_HIGHLIGHT_OPACITY;
