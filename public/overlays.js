import {
  extractWindSpeed,
  getPointActivity,
  shouldSkipConnection
} from './data.js';

export const SAILING_HIGHLIGHT_COLOR = '#ef4444';
export const NON_SAIL_HIGHLIGHT_COLOR = '#facc15';
export const ANCHORED_HIGHLIGHT_COLOR = '#10b981';

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
const MIN_WIND_ARROW_SPACING_METERS = 1852;
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

function interpolateHexColor(c1, c2, factor) {
  const norm1 = normalizeHexColor(c1);
  const norm2 = normalizeHexColor(c2);
  if (!norm1 || !norm2) return c1 || '#000000';
  
  const f = Math.max(0, Math.min(1, factor));
  
  const r1 = parseInt(norm1.slice(0, 2), 16);
  const g1 = parseInt(norm1.slice(2, 4), 16);
  const b1 = parseInt(norm1.slice(4, 6), 16);
  
  const r2 = parseInt(norm2.slice(0, 2), 16);
  const g2 = parseInt(norm2.slice(2, 4), 16);
  const b2 = parseInt(norm2.slice(4, 6), 16);
  
  const r = Math.round(r1 + (r2 - r1) * f).toString(16).padStart(2, '0');
  const g = Math.round(g1 + (g2 - g1) * f).toString(16).padStart(2, '0');
  const b = Math.round(b1 + (b2 - b1) * f).toString(16).padStart(2, '0');
  
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

/**
 * Function: parseWindDirection
 * Description: Extract a numeric wind direction from a voyage point record.
 * Parameters:
 *   point (object): Voyage point containing wind metadata.
 * Returns: number|null - Wind direction in degrees or null when unavailable.
 */
function parseWindDirection(point) {
  const entry = point?.entry || point || {};
  const raw = entry?.wind?.direction ?? entry?.windDirection ?? point?.wind?.direction;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  let baseColor = SAILING_HIGHLIGHT_COLOR;
  if (activity === 'anchored') {
    baseColor = ANCHORED_HIGHLIGHT_COLOR;
  } else if (activity === 'motoring') {
    baseColor = NON_SAIL_HIGHLIGHT_COLOR;
  }
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

function getActivityColor(activity) {
  switch (activity) {
    case 'anchored': return ANCHORED_HIGHLIGHT_COLOR;
    case 'motoring': return NON_SAIL_HIGHLIGHT_COLOR;
    case 'sailing': return SAILING_HIGHLIGHT_COLOR;
    default: return SAILING_HIGHLIGHT_COLOR;
  }
}

/**
 * Function: createActivityHighlightPolylines
 * Description: Build activity-based polylines for the supplied voyage points and add them to the Leaflet map.
 * Parameters:
 *   map (L.Map): Leaflet map instance receiving the polylines.
 *   points (object[]): Voyage points used to derive segments.
 *   options (object): Optional overrides for line weight, opacity, and closeLoop.
 * Returns: object[] - Array of Leaflet polylines added to the map.
 */
export function createActivityHighlightPolylines(map, points, options = {}) {
  if (!map || !Array.isArray(points) || points.length < 2) return [];
  
  const weight = typeof options.weight === 'number' ? options.weight : DEFAULT_HIGHLIGHT_WEIGHT;
  const opacity = typeof options.opacity === 'number' ? options.opacity : DEFAULT_HIGHLIGHT_OPACITY;
  const closeLoop = Boolean(options.closeLoop);
  const polylines = [];
  
  let currentPoints = [points[0]];
  let currentColor = null;
  
  const flushCurrent = () => {
    if (currentPoints.length >= 2 && currentColor) {
      const latLngs = currentPoints.map(p => [p.lat, p.lon]);
      const polyline = L.polyline(latLngs, {
        color: currentColor,
        weight,
        opacity,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      polyline._activityHighlight = true;
      if (polyline.bringToFront) polyline.bringToFront();
      polylines.push(polyline);
    }
  };

  const totalPairs = closeLoop ? points.length : points.length - 1;
  
  for (let i = 0; i < totalPairs; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    
    if (shouldSkipConnection(start, end)) {
      flushCurrent();
      currentPoints = [end];
      currentColor = null;
      continue;
    }

    const startAct = getPointActivity(start);
    const endAct = getPointActivity(end);
    
    // Determine segment type and color
    let segmentColor = null;
    let isGradient = false;
    
    if (startAct === endAct) {
      segmentColor = getActivityColor(startAct);
    } else {
      isGradient = true;
    }
    
    if (!isGradient) {
      // Solid color handling
      if (currentColor === segmentColor) {
        currentPoints.push(end);
      } else {
        flushCurrent();
        currentPoints = [start, end];
        currentColor = segmentColor;
      }
    } else {
      // Gradient handling (mixed activity)
      flushCurrent();
      
      const startColor = getActivityColor(startAct);
      const endColor = getActivityColor(endAct);
      const steps = 10;
      
      for (let j = 0; j < steps; j++) {
        const t1 = j / steps;
        const t2 = (j + 1) / steps;
        
        const lat1 = start.lat + (end.lat - start.lat) * t1;
        const lon1 = start.lon + (end.lon - start.lon) * t1;
        const lat2 = start.lat + (end.lat - start.lat) * t2;
        const lon2 = start.lon + (end.lon - start.lon) * t2;
        
        const stepColor = interpolateHexColor(startColor, endColor, t1);
        
        const polyline = L.polyline([[lat1, lon1], [lat2, lon2]], {
          color: stepColor,
          weight,
          opacity,
          lineCap: 'butt', // butt cap for seamless joints
          lineJoin: 'round'
        }).addTo(map);
        
        polyline._activityHighlight = true;
        if (polyline.bringToFront) polyline.bringToFront();
        polylines.push(polyline);
      }
      
      // Reset for next segment
      currentPoints = [end];
      currentColor = null;
    }
  }
  
  flushCurrent();
  
  return polylines;
}

/**
 * Function: createWindIntensityLayer
 * Description: Create a non-interactive wind arrow layer for the supplied voyage points.
 * Parameters:
 *   points (object[]): Voyage points containing wind speed data.
 * Returns: L.Layer|null - Layer group with per-point wind markers, or null when no markers apply.
 */
export function createWindIntensityLayer(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const layer = L.layerGroup();
  let rendered = 0;
  let lastArrowLatLng = null;
  points.forEach((point) => {
    const speed = extractWindSpeed(point);
    if (speed === null || speed <= 0) return;
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') return;
    const direction = parseWindDirection(point);
    if (direction === null) return;
    const currentLatLng = L.latLng(point.lat, point.lon);
    if (lastArrowLatLng) {
      const spacing = currentLatLng.distanceTo(lastArrowLatLng);
      if (spacing < MIN_WIND_ARROW_SPACING_METERS) return;
    }
    const angle = (direction + 180) % 360;
    const size = calculateWindArrowSize(speed);
    const center = size / 2;
    const tipY = 6;
    const headLength = 10;
    const headHalf = 6;
    const headBaseY = tipY + headLength;
    const shaftTopY = tipY + Math.round(headLength * 0.6);
    const strokeW = 2;
    const arrowColor = windSpeedToColor(speed);
    const html = `
      <div class="wind-arrow" style="width:${size}px;height:${size}px;transform: rotate(${angle}deg);">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
          <line x1="${center}" y1="${center}" x2="${center}" y2="${shaftTopY}" stroke="${arrowColor}" stroke-width="${strokeW}" stroke-linecap="round" />
          <polygon points="${center},${tipY} ${center - headHalf},${headBaseY} ${center + headHalf},${headBaseY}" fill="${arrowColor}" />
        </svg>
      </div>`;
    const marker = L.marker([point.lat, point.lon], {
      icon: L.divIcon({
        className: '',
        html,
        iconSize: [size, size],
        iconAnchor: [center, center]
      }),
      interactive: false
    });
    marker.addTo(layer);
    rendered += 1;
    lastArrowLatLng = currentLatLng;
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
