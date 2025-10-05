import {
  extractWindSpeed,
  getPointActivity,
  getVoyagePoints,
  shouldSkipConnection
} from './data.js';
import {
  ensureMobileLayoutReadiness,
  ensureMobileMapView,
  isMobileLayoutActive,
  registerMapResizeCallback
} from './view.js';
import { getVoyageData, getVoyageRows, setSelectedTableRow } from './table.js';
import {
  degToCompassLocal,
  extractHeadingDegrees,
  formatPosition
} from './util.js';

// Map state and configuration
let mapInstance = null;
let polylines = [];
let maxMarker = null;
let activePolylines = [];
let activeLineClickers = [];
let selectedPointMarker = null;
let activePointMarkersGroup = null;
let selectedWindGroup = null;
let windIntensityLayer = null;
let currentVoyagePoints = [];
let allVoyagesBounds = null;
let suppressHistoryUpdate = false;
let windOverlayEnabled = false;

const BASE_TILESET_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const BASE_TILESET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
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

const windOverlayToggleInput = document.getElementById('windOverlayToggle');
const windOverlayToggleWrapper = windOverlayToggleInput ? windOverlayToggleInput.closest('.toggle-switch') : null;

const basePathname = (() => {
  let path = window.location.pathname || '/';
  if (/\/index\.html?$/i.test(path)) path = path.replace(/\/index\.html?$/i, '/');
  if (/\/[0-9]+\/?$/.test(path)) path = path.replace(/\/[0-9]+\/?$/, '/');
  path = path.replace(/\/+$/, '/');
  if (!path.endsWith('/')) path += '/';
  return path;
})();

export const apiBasePath = (() => {
  const pathname = window.location.pathname || '';
  const pluginPrefix = '/plugins/voyage-webapp';
  if (pathname.includes('voyage-webapp')) {
    return pluginPrefix;
  }
  return '';
})();

export const historyUpdatesEnabled = apiBasePath === '';

const MAP_CLICK_SELECT_THRESHOLD_METERS = 1500;

const SAILING_HIGHLIGHT_COLOR = '#ef4444';
const NON_SAIL_HIGHLIGHT_COLOR = '#facc15';
const DEFAULT_HIGHLIGHT_WEIGHT = 4;
const DEFAULT_HIGHLIGHT_OPACITY = 0.95;

/**
 * Function: createBaseLayer
 * Description: Instantiate the Leaflet tile layer using CARTO's default Voyager basemap.
 * Parameters: None.
 * Returns: L.TileLayer - Tile layer configured with balanced-toned cartography.
 */
function createBaseLayer() {
  return L.tileLayer(BASE_TILESET_URL, {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: BASE_TILESET_ATTRIBUTION
  });
}

/**
 * Function: fitMapToBounds
 * Description: Fit the Leaflet map to the supplied bounds, optionally deferring until the mobile layout stabilises.
 * Parameters:
 *   bounds (L.LatLngBounds): Geographic bounds representing the region to display.
 *   options (object): Optional flags controlling scheduling behaviour.
 * Returns: void.
 */
export function fitMapToBounds(bounds, options = {}) {
  if (!mapInstance || !bounds || typeof bounds.isValid !== 'function' || !bounds.isValid()) return;
  const { deferForMobile = false } = options;
  const performFit = () => {
    if (mapInstance && bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
      mapInstance.fitBounds(bounds);
    }
  };
  if (deferForMobile && isMobileLayoutActive()) {
    requestAnimationFrame(() => {
      if (mapInstance) mapInstance.invalidateSize();
      requestAnimationFrame(performFit);
    });
    return;
  }
  performFit();
}

/**
 * Function: normalizeHexColor
 * Description: Normalize a hex colour string into a 6-character RGB representation without the leading hash.
 * Parameters:
 *   hex (string): Hex colour in shorthand or full form.
 * Returns: string|null - Normalised hexadecimal string or null when invalid.
 */
function normalizeHexColor(hex) {
  if (typeof hex !== 'string') return null;
  let value = hex.trim();
  if (value.startsWith('#')) value = value.slice(1);
  if (value.length === 3) {
    value = value.split('').map(ch => ch + ch).join('');
  }
  if (value.length !== 6 || !/^[0-9a-f]{6}$/i.test(value)) return null;
  return value.toLowerCase();
}

/**
 * Function: darkenHexColor
 * Description: Apply a scalar multiplier to each RGB component of a hex colour to produce a darker shade.
 * Parameters:
 *   hex (string): Base hex colour.
 *   factor (number): Multiplier between 0 and 1 controlling darkness intensity.
 * Returns: string - Darkened hex colour including the leading hash.
 */
function darkenHexColor(hex, factor = 0.5) {
  const norm = normalizeHexColor(hex);
  if (!norm) return '#000000';
  const clampFactor = Math.max(0, Math.min(1, factor));
  const r = Math.round(parseInt(norm.slice(0, 2), 16) * clampFactor).toString(16).padStart(2, '0');
  const g = Math.round(parseInt(norm.slice(2, 4), 16) * clampFactor).toString(16).padStart(2, '0');
  const b = Math.round(parseInt(norm.slice(4, 6), 16) * clampFactor).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Function: createPointMarkerIcon
 * Description: Generate a Leaflet divIcon for a voyage point using a darker variant of its segment colour.
 * Parameters:
 *   point (object): Voyage point supplying activity metadata.
 * Returns: L.DivIcon - Icon suitable for map markers.
 */
function createPointMarkerIcon(point) {
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

/**
 * Function: windSpeedToColor
 * Description: Map a wind speed to a Windy-inspired colour stop.
 * Parameters:
 *   speed (number): Wind speed in knots.
 * Returns: string - Hex colour representing the supplied wind speed.
 */
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
 * Function: windSpeedToRadiusPx
 * Description: Convert a wind speed to a circle radius in pixels for the intensity overlay.
 * Parameters:
 *   speed (number): Wind speed in knots.
 * Returns: number - Radius in pixels applied to the circle marker.
 */
function windSpeedToRadiusPx(speed) {
  if (typeof speed !== 'number' || Number.isNaN(speed)) return MIN_WIND_RADIUS_PX;
  const clamped = Math.max(0, Math.min(50, speed));
  const fraction = clamped / 50;
  return MIN_WIND_RADIUS_PX + Math.round((MAX_WIND_RADIUS_PX - MIN_WIND_RADIUS_PX) * fraction);
}

/**
 * Function: clearWindIntensityLayer
 * Description: Remove the wind intensity overlay from the map when present.
 * Parameters: None.
 * Returns: void.
 */
export function clearWindIntensityLayer() {
  if (windIntensityLayer && mapInstance) {
    mapInstance.removeLayer(windIntensityLayer);
  }
  windIntensityLayer = null;
}

/**
 * Function: updateWindOverlayToggleUI
 * Description: Sync the wind overlay toggle button label and pressed state with the current setting.
 * Parameters: None.
 * Returns: void.
 */
function updateWindOverlayToggleUI() {
  if (!windOverlayToggleInput) return;
  windOverlayToggleInput.checked = windOverlayEnabled;
  if (windOverlayToggleWrapper) {
    windOverlayToggleWrapper.classList.toggle('is-active', windOverlayEnabled && !windOverlayToggleInput.disabled);
  }
}

/**
 * Function: setWindOverlayToggleAvailability
 * Description: Enable or disable the wind overlay toggle control.
 * Parameters:
 *   available (boolean): When true the toggle is enabled for interaction.
 * Returns: void.
 */
export function setWindOverlayToggleAvailability(available) {
  if (!windOverlayToggleInput) return;
  windOverlayToggleInput.disabled = !available;
  if (windOverlayToggleWrapper) {
    windOverlayToggleWrapper.classList.toggle('is-disabled', !available);
  }
  if (!available) {
    windOverlayEnabled = false;
    clearWindIntensityLayer();
    updateWindOverlayToggleUI();
  } else {
    updateWindOverlayToggleUI();
  }
}

/**
 * Function: buildWindIntensityOverlay
 * Description: Create a layer group visualising per-point wind speed with Windy-style colouring.
 * Parameters:
 *   points (object[]): Voyage points considered for rendering.
 * Returns: L.Layer|null - Leaflet layer group containing the wind markers, or null when none apply.
 */
function buildWindIntensityOverlay(points) {
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
 * Function: refreshWindOverlay
 * Description: Rebuild the wind intensity overlay for the supplied voyage points when enabled.
 * Parameters:
 *   points (object[]): Voyage points providing wind data; defaults to the current voyage.
 * Returns: void.
 */
export function refreshWindOverlay(points = currentVoyagePoints) {
  clearWindIntensityLayer();
  if (!windOverlayEnabled) return;
  if (!Array.isArray(points) || points.length === 0) return;
  const layer = buildWindIntensityOverlay(points);
  if (!layer) return;
  windIntensityLayer = layer;
  if (mapInstance) {
    windIntensityLayer.addTo(mapInstance);
  }
}

/**
 * Function: setWindOverlayEnabled
 * Description: Toggle the wind overlay visibility and update related UI state.
 * Parameters:
 *   enabled (boolean): When true the overlay renders for the active voyage.
 * Returns: void.
 */
export function setWindOverlayEnabled(enabled) {
  windOverlayEnabled = Boolean(enabled);
  updateWindOverlayToggleUI();
  if (!windOverlayEnabled) {
    clearWindIntensityLayer();
    return;
  }
  refreshWindOverlay();
}

if (windOverlayToggleInput) {
  windOverlayToggleInput.addEventListener('change', (event) => {
    setWindOverlayEnabled(event.target.checked);
  });
  setWindOverlayToggleAvailability(false);
}

/**
 * Function: segmentPointsByActivity
 * Description: Split voyage points into coloured segments based on activity transitions.
 * Parameters:
 *   points (object[]): Voyage points with activity metadata.
 * Returns: object[] - Segment definitions with colour and lat/lon arrays.
 */
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
 * Description: Build polylines that visually highlight voyage activity segments on the map.
 * Parameters:
 *   points (object[]): Voyage points used to generate highlighted polylines.
 *   options (object): Optional styling overrides for line weight and opacity.
 * Returns: object[] - Array of Leaflet polylines added to the map.
 */
export function createActivityHighlightPolylines(points, options = {}) {
  if (!mapInstance || !Array.isArray(points) || points.length < 2) return [];
  const weight = typeof options.weight === 'number' ? options.weight : DEFAULT_HIGHLIGHT_WEIGHT;
  const opacity = typeof options.opacity === 'number' ? options.opacity : DEFAULT_HIGHLIGHT_OPACITY;
  const segments = segmentPointsByActivity(points);
  return segments.map(seg => {
    const polyline = L.polyline(seg.latLngs, {
      color: seg.color,
      weight,
      opacity,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance);
    polyline._activityHighlight = true;
    if (polyline.bringToFront) polyline.bringToFront();
    return polyline;
  });
}

/**
 * Function: removeActivePolylines
 * Description: Remove all active highlight polylines from the map and reset the tracking array.
 * Parameters: None.
 * Returns: void.
 */
export function removeActivePolylines() {
  if (!Array.isArray(activePolylines) || !mapInstance) {
    activePolylines = [];
    return;
  }
  activePolylines.forEach(pl => {
    if (pl && pl._activityHighlight) {
      try { mapInstance.removeLayer(pl); } catch (_) {}
    }
  });
  activePolylines = [];
}

/**
 * Function: setActivePolylines
 * Description: Replace the tracked collection of active highlight polylines.
 * Parameters:
 *   polylinesCollection (object[]): Array of Leaflet polyline instances to track.
 * Returns: void.
 */
export function setActivePolylines(polylinesCollection) {
  activePolylines = Array.isArray(polylinesCollection) ? polylinesCollection : [];
}

/**
 * Function: wirePolylineSelectionHandlers
 * Description: Attach point-selection handlers to the supplied highlight polylines.
 * Parameters:
 *   polylinesCollection (object[]): Array of Leaflet polylines to attach handlers to.
 *   points (object[]): Voyage points that correspond to the polylines.
 * Returns: void.
 */
export function wirePolylineSelectionHandlers(polylinesCollection, points) {
  if (!Array.isArray(polylinesCollection) || !Array.isArray(points) || points.length === 0) return;
  polylinesCollection.forEach((polyline) => {
    if (polyline._voySelect) {
      try { polyline.off('click', polyline._voySelect); } catch (_) {}
      try { polyline.off('tap', polyline._voySelect); } catch (_) {}
    }
    const onLineClick = (event) => onPolylineClick(event, points);
    polyline.on('click', onLineClick);
    polyline.on('tap', onLineClick);
    activeLineClickers.push({ pl: polyline, onLineClick });
  });
}

/**
 * Function: updateHistoryForTrip
 * Description: Update the browser history state to reflect the selected voyage identifier.
 * Parameters:
 *   tripId (number): Voyage identifier to encode into the history state.
 *   options (object): Optional flags including replace to control history mutation.
 * Returns: void.
 */
export function updateHistoryForTrip(tripId, options = {}) {
  if (!Number.isInteger(tripId) || tripId <= 0 || !window.history || !window.history.pushState) return;
  const { replace = false } = options;
  const newPath = `${basePathname}${tripId}`;
  const currentPath = window.location.pathname;
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const newUrl = `${newPath}${search}${hash}`;
  if (replace) {
    window.history.replaceState({ tripId }, '', newUrl);
    return;
  }
  if (currentPath === newPath) return;
  window.history.pushState({ tripId }, '', newUrl);
}

/**
 * Function: addVoyageToMap
 * Description: Render voyage geometry onto the map and attach selection handlers.
 * Parameters:
 *   voyage (object): Voyage entry containing segments or fallback coordinates.
 *   row (HTMLTableRowElement): Table row associated with the voyage.
 * Returns: L.LatLngBounds|null - Bounds covering the rendered voyage or null when unavailable.
 */
export function addVoyageToMap(voyage, row) {
  if (!mapInstance || !voyage) return null;
  let voyageBounds = null;
  const segments = Array.isArray(voyage._segments) ? voyage._segments : [];
  if (segments.length > 0) {
    segments.forEach((seg) => {
      const latLngs = seg.points.map(p => [p.lat, p.lon]);
      const polyline = L.polyline(latLngs, { color: 'blue', weight: 2 }).addTo(mapInstance);
      seg.polyline = polyline;
      polylines.push(polyline);
      const bounds = polyline.getBounds();
      voyageBounds = voyageBounds ? voyageBounds.extend(bounds) : bounds;
      const voySelect = (ev) => {
        L.DomEvent.stopPropagation(ev);
        selectVoyage(voyage, row, { fit: false, scrollIntoView: true });
      };
      polyline.on('click', voySelect);
      polyline.on('tap', voySelect);
      polyline._voySelect = voySelect;
    });
  } else if (Array.isArray(voyage.coords) && voyage.coords.length) {
    const latLngs = voyage.coords.map(([lon, lat]) => [lat, lon]);
    const line = L.polyline(latLngs, { color: 'blue', weight: 2 }).addTo(mapInstance);
    polylines.push(line);
    voyage._fallbackPolyline = line;
    voyageBounds = line.getBounds();
    const voySelect = (ev) => {
      L.DomEvent.stopPropagation(ev);
      selectVoyage(voyage, row, { fit: false, scrollIntoView: true });
    };
    line.on('click', voySelect);
    line.on('tap', voySelect);
    line._voySelect = voySelect;
  }
  return voyageBounds;
}

/**
 * Function: clearMaxSpeedMarker
 * Description: Remove the maximum speed marker and popup from the map when present.
 * Parameters: None.
 * Returns: void.
 */
export function clearMaxSpeedMarker() {
  if (mapInstance && maxMarker) {
    try { mapInstance.removeLayer(maxMarker); } catch (_) {}
  }
  maxMarker = null;
}

/**
 * Function: setCurrentVoyagePoints
 * Description: Update the cached list of points for the active voyage selection.
 * Parameters:
 *   points (object[]): Voyage points to use for selection interactions.
 * Returns: void.
 */
export function setCurrentVoyagePoints(points) {
  currentVoyagePoints = Array.isArray(points) ? points : [];
}

/**
 * Function: drawMaxSpeedMarkerFromCoord
 * Description: Render the maximum speed marker and popup at the supplied coordinate.
 * Parameters:
 *   coord (number[]): Longitude and latitude pair representing the maximum speed location.
 *   speed (number): Speed over ground in knots to present in the popup.
 * Returns: void.
 */
export function drawMaxSpeedMarkerFromCoord(coord, speed) {
  clearMaxSpeedMarker();
  if (!Array.isArray(coord) || coord.length !== 2 || !mapInstance) return;
  const [lon, lat] = coord;
  maxMarker = L.circleMarker([lat, lon], { color: 'orange', radius: 6 }).addTo(mapInstance);
  maxMarker.bindPopup(`Max SoG: ${Number(speed).toFixed(1)} kn`, { autoPan: false, autoClose: false, closeOnClick: false }).openPopup();
  const onMaxSelect = (e) => {
    const clickLL = e.latlng || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0]
      ? mapInstance.mouseEventToLatLng(e.originalEvent.touches[0])
      : null);
    if (!clickLL || !Array.isArray(currentVoyagePoints) || currentVoyagePoints.length === 0) return;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < currentVoyagePoints.length; i += 1) {
      const point = currentVoyagePoints[i];
      if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
      const pll = L.latLng(point.lat, point.lon);
      const d = clickLL.distanceTo(pll);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const selected = currentVoyagePoints[bestIdx];
    updateSelectedPoint(selected, { prev: currentVoyagePoints[bestIdx - 1], next: currentVoyagePoints[bestIdx + 1] });
  };
  maxMarker.on('click', onMaxSelect);
  maxMarker.on('tap', onMaxSelect);
}

/**
 * Function: detachActiveClickers
 * Description: Remove click handlers previously attached to active voyage polylines.
 * Parameters: None.
 * Returns: void.
 */
export function detachActiveClickers() {
  if (Array.isArray(activeLineClickers)) {
    activeLineClickers.forEach(({ pl, onLineClick }) => {
      try { pl.off('click', onLineClick); } catch (_) {}
      try { pl.off('tap', onLineClick); } catch (_) {}
    });
  }
  activeLineClickers = [];
}

/**
 * Function: clearActivePointMarkers
 * Description: Remove the active point markers layer from the map if present.
 * Parameters: None.
 * Returns: void.
 */
export function clearActivePointMarkers() {
  if (activePointMarkersGroup && mapInstance) {
    mapInstance.removeLayer(activePointMarkersGroup);
  }
  activePointMarkersGroup = null;
}

/**
 * Function: renderActivePointMarkers
 * Description: Display clickable point markers for the supplied voyage point collection.
 * Parameters:
 *   points (object[]): Voyage points to visualise on the map.
 * Returns: void.
 */
export function renderActivePointMarkers(points) {
  clearActivePointMarkers();
  if (!Array.isArray(points) || points.length === 0 || !mapInstance) return;
  const layer = L.layerGroup();
  points.forEach((point, idx) => {
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') return;
    const icon = createPointMarkerIcon(point);
    const marker = L.marker([point.lat, point.lon], { icon });
    marker.on('click', (event) => {
      L.DomEvent.stopPropagation(event);
      updateSelectedPoint(point, { prev: points[idx - 1], next: points[idx + 1] });
    });
    marker.addTo(layer);
  });
  activePointMarkersGroup = layer;
  activePointMarkersGroup.addTo(mapInstance);
}

/**
 * Function: clearSelectedWindGraphics
 * Description: Remove the wind overlay associated with the selected point.
 * Parameters: None.
 * Returns: void.
 */
export function clearSelectedWindGraphics() {
  if (selectedWindGroup && mapInstance) {
    mapInstance.removeLayer(selectedWindGroup);
  }
  selectedWindGroup = null;
}

/**
 * Function: arrowSizeFromSpeed
 * Description: Determine a wind arrow icon size scaled by wind speed for readability.
 * Parameters:
 *   kn (number): Wind speed in knots.
 * Returns: number - Size in pixels for the arrow visual.
 */
function arrowSizeFromSpeed(kn) {
  const small = 60;
  const mid = 180;
  const large = 240;
  if (!(typeof kn === 'number') || Number.isNaN(kn)) return small;
  if (kn <= 5) return small;
  if (kn >= 25) return large;
  const t = (kn - 5) / 20;
  return Math.round(small + t * (mid - small));
}

/**
 * Function: makeBoatIcon
 * Description: Create a Leaflet div icon representing the selected vessel at a specific bearing.
 * Parameters:
 *   bearingDeg (number): Heading in degrees for icon rotation.
 * Returns: L.DivIcon - Configured boat icon instance.
 */
function makeBoatIcon(bearingDeg) {
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

/**
 * Function: bearingBetween
 * Description: Calculate the initial bearing from the first coordinate to the second.
 * Parameters:
 *   lat1 (number): Latitude of the starting coordinate.
 *   lon1 (number): Longitude of the starting coordinate.
 *   lat2 (number): Latitude of the destination coordinate.
 *   lon2 (number): Longitude of the destination coordinate.
 * Returns: number|null - Bearing in degrees or null when insufficient data is provided.
 */
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = (toDeg(θ) + 360) % 360;
  return θ;
}

/**
 * Function: courseFromNeighbors
 * Description: Approximate the vessel course using surrounding voyage points when heading data is missing.
 * Parameters:
 *   prev (object): Previous voyage point.
 *   sel (object): Selected voyage point.
 *   next (object): Following voyage point.
 * Returns: number|null - Average bearing derived from neighbours or null when unavailable.
 */
function courseFromNeighbors(prev, sel, next) {
  if (prev && typeof prev.lat === 'number' && typeof prev.lon === 'number' &&
      next && typeof next.lat === 'number' && typeof next.lon === 'number') {
    return bearingBetween(prev.lat, prev.lon, next.lat, next.lon);
  }
  if (prev && typeof prev.lat === 'number' && typeof prev.lon === 'number') {
    return bearingBetween(prev.lat, prev.lon, sel.lat, sel.lon);
  }
  if (next && typeof next.lat === 'number' && typeof next.lon === 'number') {
    return bearingBetween(sel.lat, sel.lon, next.lat, next.lon);
  }
  return 0;
}

/**
 * Function: renderPointDetails
 * Description: Populate the point details panel with data from the selected voyage point.
 * Parameters:
 *   point (object): Voyage point containing entry metadata and coordinates.
 * Returns: void.
 */
function renderPointDetails(point) {
  const panel = document.getElementById('pointDetails');
  if (!panel) return;
  const entry = point.entry || point;
  const when = entry.datetime ? new Date(entry.datetime).toLocaleString() : '—';
  const sog = entry?.speed?.sog;
  const stw = entry?.speed?.stw;
  const windSpd = entry?.wind?.speed;
  const windDir = entry?.wind?.direction;
  const windDirTxt = typeof windDir === 'number' ? `${windDir.toFixed(0)}° (${degToCompassLocal(windDir)})` : '—';
  const posStr = formatPosition(point.lat, point.lon);
  const summary = `
    <dl class="point-details">
      <div class="row"><dt>Time</dt><dd>${when}</dd></div>
      <div class="row"><dt>Position</dt><dd>${posStr}</dd></div>
      <div class="row"><dt>SOG</dt><dd>${typeof sog === 'number' ? sog.toFixed(2) + ' kn' : '—'}</dd></div>
      <div class="row"><dt>STW</dt><dd>${typeof stw === 'number' ? stw.toFixed(2) + ' kn' : '—'}</dd></div>
      <div class="row"><dt>Wind</dt><dd>${typeof windSpd === 'number' ? windSpd.toFixed(2) + ' kn' : '—'} @ ${windDirTxt}</dd></div>
      <div class="row"><dt>Activity</dt><dd>${getPointActivity(point)}</dd></div>
    </dl>`;
  panel.style.display = '';
  panel.innerHTML = `
    <div class="floating-header"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="floating-title">Point Details</span><button class="close-details" aria-label="Close">×</button></div>
    <div class="details-body">${summary}</div>`;
  wireDetailsControls(panel);
}

/**
 * Function: updateSelectedPoint
 * Description: Refresh the selected point marker, wind overlay, and details pane based on the chosen voyage point.
 * Parameters:
 *   sel (object): Selected voyage point containing coordinates and entry data.
 *   neighbors (object): Adjacent voyage points used to infer vessel course information.
 * Returns: void.
 */
export function updateSelectedPoint(sel, neighbors = {}) {
  if (!sel || typeof sel.lat !== 'number' || typeof sel.lon !== 'number' || !mapInstance) return;
  const lat = sel.lat;
  const lon = sel.lon;
  const entry = sel.entry || sel;
  const storedHeading = extractHeadingDegrees(entry);
  const bearing = (typeof storedHeading === 'number')
    ? storedHeading
    : courseFromNeighbors(neighbors.prev, sel, neighbors.next);
  if (!selectedPointMarker) {
    selectedPointMarker = L.marker([lat, lon], { icon: makeBoatIcon(bearing), zIndexOffset: 1000 }).addTo(mapInstance);
  } else {
    selectedPointMarker.setLatLng([lat, lon]);
    selectedPointMarker.setIcon(makeBoatIcon(bearing));
  }
  clearSelectedWindGraphics();
  const windSpd = entry?.wind?.speed;
  let windDir = entry?.wind?.direction;
  if (typeof windSpd === 'number' && typeof windDir === 'number') {
    windDir = (windDir + 180) % 360;
    const angle = windDir.toFixed(1);
    const size = arrowSizeFromSpeed(windSpd);
    const center = size / 2;
    const tipY = size * 0.10;
    const headBaseY = tipY + size * 0.125;
    const halfHead = size * 0.075;
    const shaftTopY = tipY + size * 0.075;
    const strokeW = Math.max(2, Math.round(size / 40));
    const html = `
      <div class="wind-arrow" style="width:${size}px;height:${size}px;transform: rotate(${angle}deg);">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <line x1="${center}" y1="${center}" x2="${center}" y2="${shaftTopY}" stroke="#111827" stroke-width="${strokeW}" />
          <polygon points="${center},${tipY} ${center - halfHead},${headBaseY} ${center + halfHead},${headBaseY}" fill="#111827" />
        </svg>
        <div class="wind-speed-label" style="position:absolute;top:0;left:50%;transform:translate(-50%,-4px);">${windSpd.toFixed(1)} kn</div>
      </div>`;
    selectedWindGroup = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [center, center] }),
      interactive: false
    }).addTo(mapInstance);
  }
  renderPointDetails(sel);
}

/**
 * Function: setDetailsHint
 * Description: Display a hint message within the point details panel and ensure controls are wired.
 * Parameters:
 *   msg (string): Message to present to the user inside the panel.
 * Returns: void.
 */
export function setDetailsHint(msg) {
  const panel = document.getElementById('pointDetails');
  if (!panel) return;
  panel.style.display = '';
  panel.innerHTML = `
    <div class="floating-header"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="floating-title">Point Details</span><button class="close-details" aria-label="Close">×</button></div>
    <div class="details-body"><em>${msg}</em></div>`;
  wireDetailsControls(panel);
}

/**
 * Function: restoreBasePolylineStyles
 * Description: Reset all stored voyage polylines to their default styling.
 * Parameters: None.
 * Returns: void.
 */
export function restoreBasePolylineStyles() {
  polylines.forEach(pl => {
    try { pl.setStyle({ color: 'blue', weight: 2 }); } catch (_) {}
  });
}

/**
 * Function: resetVoyageSelection
 * Description: Clear any active voyage selection and restore the map to show all voyages.
 * Parameters: None.
 * Returns: void.
 */
export function resetVoyageSelection() {
  setSelectedTableRow(null);
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();
  clearWindIntensityLayer();
  removeActivePolylines();
  clearMaxSpeedMarker();
  if (selectedPointMarker && mapInstance) {
    try { mapInstance.removeLayer(selectedPointMarker); } catch (_) {}
  }
  selectedPointMarker = null;
  currentVoyagePoints = [];
  restoreBasePolylineStyles();
  if (mapInstance && allVoyagesBounds && typeof allVoyagesBounds.isValid === 'function' && allVoyagesBounds.isValid()) {
    mapInstance.fitBounds(allVoyagesBounds);
  }
  setWindOverlayToggleAvailability(false);
  if (historyUpdatesEnabled && window.history && typeof window.history.replaceState === 'function') {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    window.history.replaceState({}, '', `${basePathname}${search}${hash}`);
  }
  setDetailsHint('Select a voyage, then click the highlighted track to inspect points.');
}

/**
 * Function: onPolylineClick
 * Description: Select the voyage point nearest to the clicked location along a highlighted polyline.
 * Parameters:
 *   event (LeafletMouseEvent): Event emitted by Leaflet when a polyline is clicked or tapped.
 *   points (object[]): Voyage points associated with the active polyline.
 * Returns: void.
 */
function onPolylineClick(event, points) {
  if (!points || points.length === 0) return;
  const clickLL = event.latlng;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let idx = 0; idx < points.length; idx += 1) {
    const point = points[idx];
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
    const pll = L.latLng(point.lat, point.lon);
    const d = clickLL.distanceTo(pll);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  }
  const sel = points[bestIdx];
  updateSelectedPoint(sel, { prev: points[bestIdx - 1], next: points[bestIdx + 1] });
}

/**
 * Function: selectVoyage
 * Description: Activate a voyage selection, updating UI state, map overlays, and browser history.
 * Parameters:
 *   voyage (object): Voyage record containing geometry and metrics.
 *   row (HTMLTableRowElement): Table row element representing the voyage in the list.
 *   options (object): Optional behaviour flags such as map fitting and row scrolling.
 * Returns: void.
 */
export function selectVoyage(voyage, row, options = {}) {
  const { fit = true, scrollIntoView = false, suppressHistory = false } = options;
  ensureMobileLayoutReadiness();
  ensureMobileMapView();
  setSelectedTableRow(row);
  if (scrollIntoView && row && typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  restoreBasePolylineStyles();
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();

  removeActivePolylines();
  let voyagePoints = getVoyagePoints(voyage);
  if (!Array.isArray(voyagePoints) || voyagePoints.length === 0) voyagePoints = [];
  let highlightLines = voyagePoints.length >= 2 ? createActivityHighlightPolylines(voyagePoints) : [];
  if (!highlightLines.length) {
    if (voyage._segments && voyage._segments.length > 0) {
      voyage._segments.forEach(seg => {
        seg.polyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_HIGHLIGHT_WEIGHT });
        highlightLines.push(seg.polyline);
      });
    } else if (voyage._fallbackPolyline) {
      voyage._fallbackPolyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_HIGHLIGHT_WEIGHT });
      highlightLines = [voyage._fallbackPolyline];
    }
  }
  setActivePolylines(highlightLines);
  if (fit && activePolylines.length > 0) {
    let bounds = activePolylines[0].getBounds();
    for (let i = 1; i < activePolylines.length; i += 1) bounds = bounds.extend(activePolylines[i].getBounds());
    fitMapToBounds(bounds, { deferForMobile: true });
  }

  clearMaxSpeedMarker();

  if (selectedPointMarker && mapInstance) {
    mapInstance.removeLayer(selectedPointMarker);
    selectedPointMarker = null;
  }

  currentVoyagePoints = voyagePoints;
  wirePolylineSelectionHandlers(activePolylines, voyagePoints);

  renderActivePointMarkers(voyagePoints);

  refreshWindOverlay(voyagePoints);
  setWindOverlayToggleAvailability(true);

  const previousSuppress = suppressHistoryUpdate;
  if (suppressHistory) suppressHistoryUpdate = true;
  try {
    if (!suppressHistoryUpdate && historyUpdatesEnabled && typeof voyage._tripIndex === 'number') {
      updateHistoryForTrip(voyage._tripIndex, { replace: false });
    }
  } finally {
    suppressHistoryUpdate = previousSuppress;
  }

  setDetailsHint('Click on the highlighted track to inspect a point.');
}

/**
 * Function: setAllVoyagesBounds
 * Description: Store the aggregate bounds for all voyages for later reuse.
 * Parameters:
 *   bounds (L.LatLngBounds|null): Bounds covering all voyages or null.
 * Returns: void.
 */
export function setAllVoyagesBounds(bounds) {
  if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
    allVoyagesBounds = bounds;
  } else {
    allVoyagesBounds = null;
  }
}

/**
 * Function: getAllVoyagesBounds
 * Description: Retrieve the aggregate bounds for all voyages tracked by the map.
 * Parameters: None.
 * Returns: L.LatLngBounds|null - Stored bounds or null when unavailable.
 */
export function getAllVoyagesBounds() {
  return allVoyagesBounds;
}

/**
 * Function: initializeMap
 * Description: Reset any existing map instance and create a new Leaflet map with base layers and handlers.
 * Parameters:
 *   onBackgroundClick (Function): Handler invoked when the map background is clicked.
 * Returns: L.Map|null - Map instance when created successfully.
 */
export function initializeMap(onBackgroundClick) {
  if (mapInstance) {
    mapInstance.off();
    mapInstance.remove();
  }
  polylines = [];
  maxMarker = null;
  activePolylines = [];
  activeLineClickers = [];
  selectedPointMarker = null;
  activePointMarkersGroup = null;
  selectedWindGroup = null;
  windIntensityLayer = null;
  currentVoyagePoints = [];
  mapInstance = L.map('map').setView([0, 0], 2);
  createBaseLayer().addTo(mapInstance);
  registerMapResizeCallback(() => {
    if (mapInstance) {
      mapInstance.invalidateSize();
    }
  });
  if (typeof onBackgroundClick === 'function') {
    mapInstance.on('click', onBackgroundClick);
    mapInstance.on('tap', onBackgroundClick);
  }
  return mapInstance;
}

/**
 * Function: getMapInstance
 * Description: Provide the current Leaflet map instance when available.
 * Parameters: None.
 * Returns: L.Map|null - Active map instance or null when uninitialised.
 */
export function getMapInstance() {
  return mapInstance;
}

/**
 * Function: getCurrentVoyagePoints
 * Description: Retrieve the cached points for the active voyage when needed by external consumers.
 * Parameters: None.
 * Returns: object[] - Array of cached points for the active voyage.
 */
export function getCurrentVoyagePoints() {
  return currentVoyagePoints;
}

function findNearestVoyageSelection(latLng) {
  const voyages = getVoyageData();
  const rows = getVoyageRows();
  if (!latLng || !Array.isArray(voyages) || voyages.length === 0) return null;
  let best = null;
  for (let i = 0; i < voyages.length; i += 1) {
    const voyage = voyages[i];
    const row = rows[i];
    if (!voyage || !row) continue;
    const points = getVoyagePoints(voyage);
    if (!Array.isArray(points) || points.length === 0) continue;
    for (let idx = 0; idx < points.length; idx += 1) {
      const point = points[idx];
      if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
      const dist = latLng.distanceTo(L.latLng(point.lat, point.lon));
      if (Number.isNaN(dist)) continue;
      if (!best || dist < best.distance) {
        best = { voyage, row, points, index: idx, point, distance: dist };
      }
    }
  }
  return best;
}

export function handleMapBackgroundClick(event) {
  const latLng = event?.latlng;
  if (!latLng) return;
  const nearest = findNearestVoyageSelection(latLng);
  if (!nearest || !nearest.row) return;
  if (nearest.distance > MAP_CLICK_SELECT_THRESHOLD_METERS) return;
  const alreadySelected = nearest.row.classList.contains('selected-row');
  selectVoyage(nearest.voyage, nearest.row, {
    fit: !alreadySelected,
    scrollIntoView: !alreadySelected
  });
  const prev = nearest.points[nearest.index - 1];
  const next = nearest.points[nearest.index + 1];
  if (nearest.point) {
    updateSelectedPoint(nearest.point, { prev, next });
  }
}

/**
 * Function: wireDetailsControls
 * Description: Attach control handlers to the details panel for closing and dragging affordances.
 * Parameters:
 *   panel (HTMLElement): Details panel element.
 * Returns: void.
 */
function wireDetailsControls(panel) {
  if (!panel) return;
  const closeBtn = panel.querySelector('.close-details');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }
}

/**
 * Function: getMapClickThreshold
 * Description: Expose the selection distance threshold for external calculations.
 * Parameters: None.
 * Returns: number - Threshold in meters.
 */
export function getMapClickThreshold() {
  return MAP_CLICK_SELECT_THRESHOLD_METERS;
}
