/**
 * Module Responsibilities:
 * - Manage the Leaflet map lifecycle, including base layers, overlay construction, and responsive resizing.
 * - Synchronise voyage selection state with the event bus, browser history, and table interactions.
 * - Provide helper APIs for point highlighting, wind overlays, and max-speed markers used across the app.
 *
 * Exported API:
 * - Constants: `apiBasePath`, `historyUpdatesEnabled`.
 * - Map lifecycle: `initializeMap`, `fitMapToBounds`, `getMapInstance`, `getMapClickThreshold`,
 *   `setAllVoyagesBounds`, `getAllVoyagesBounds`.
 * - Selection state: `selectVoyage`, `resetVoyageSelection`, `updateSelectedPoint`,
 *   `handleMapBackgroundClick`, `updateHistoryForTrip`, `setDetailsHint`.
 * - Overlay management: `addVoyageToMap`, `removeActivePolylines`, `setActivePolylines`,
 *   `wirePolylineSelectionHandlers`, `refreshWindOverlay`, `setWindOverlayEnabled`,
 *   `setWindOverlayToggleAvailability`, `clearWindIntensityLayer`, `clearActivePointMarkers`,
 *   `renderActivePointMarkers`, `clearSelectedWindGraphics`, `restoreBasePolylineStyles`,
 *   `clearMaxSpeedMarker`, `setCurrentVoyagePoints`, `detachActiveClickers`, `setMapClickCapture`,
 *   `clearMapClickCapture`.
 * - Highlight helpers: `drawMaxSpeedMarkerFromCoord`.
 *
 * @typedef {import('./types.js').Voyage} Voyage
 * @typedef {import('./types.js').VoyageSegment} VoyageSegment
 * @typedef {import('./types.js').VoyagePoint} VoyagePoint
 * @typedef {import('./types.js').VoyageSelectionPayload} VoyageSelectionPayload
 * @typedef {import('./types.js').SegmentSelectionPayload} SegmentSelectionPayload
 * @typedef {import('./types.js').MaxSpeedPayload} MaxSpeedPayload
 */

import {
  getPointActivity,
  getVoyagePoints
} from './data.js';
import {
  ensureMobileLayoutReadiness,
  ensureMobileMapView,
  isMobileLayoutActive,
  registerMapResizeCallback
} from './view.js';
import { getVoyageData, getVoyageRows } from './table.js';
import {
  degToCompassLocal,
  extractHeadingDegrees,
  formatPosition
} from './util.js';
import { emit, on, EVENTS } from './events.js';
import {
  calculateWindArrowSize,
  createActivityHighlightPolylines,
  createBoatIcon,
  createPointMarkerIcon,
  createWindIntensityLayer,
  DEFAULT_ACTIVITY_WEIGHT,
  NON_SAIL_HIGHLIGHT_COLOR,
  SAILING_HIGHLIGHT_COLOR
} from './overlays.js';

// Map state and configuration
const MANUAL_VOYAGE_COLOR = '#94a3b8';
const ROUTE_EDIT_ACTIVE_COLOR = '#1a9748';
const ROUTE_EDIT_DIM_COLOR = MANUAL_VOYAGE_COLOR;
const ROUTE_EDIT_DIM_OPACITY = 0.4;

let mapInstance = null;
let polylines = [];
let maxMarker = null;
let activePolylines = [];
let activeLineClickers = [];
let selectedPointMarker = null;
let activePointMarkersGroup = null;
let selectedWindGroup = null;
let windIntensityLayer = null;
let highlightedLocationMarker = null;
let manualVoyagePreviewPolyline = null;
let manualVoyagePreviewArrows = [];
let manualRouteEditActive = false;
let manualRouteEditLayer = null;
let manualRouteEditMarkers = [];
let manualRouteEditPoints = [];
let manualRouteEditTurnIndex = null;
let manualRouteEditClicker = null;
let manualRouteEditHitPolyline = null;
let manualRouteHiddenLayers = null;
let manualRouteDimmedLayers = null;
let currentVoyagePoints = [];
let allVoyagesBounds = null;
let suppressHistoryUpdate = false;
let windOverlayEnabled = false;
let baseTileLayer = null;
let themeListenerRegistered = false;
let mapClickCaptureHandler = null;

const BASE_TILESET_URL_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const BASE_TILESET_URL_DARK = BASE_TILESET_URL_LIGHT;
const BASE_TILESET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const prefersColorSchemeQuery = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

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

/**
 * Function: getPreferredColorMode
 * Description: Determine the preferred color scheme based on OS/browser settings.
 * Parameters: None.
 * Returns: string - 'dark' when the user prefers a dark theme, otherwise 'light'.
 */
function getPreferredColorMode() {
  if (prefersColorSchemeQuery && typeof prefersColorSchemeQuery.matches === 'boolean') {
    return prefersColorSchemeQuery.matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Function: getCssVariableValue
 * Description: Resolve the computed value of a CSS custom property on the root element.
 * Parameters:
 *   name (string): CSS variable name including the leading double hyphen.
 * Returns: string - Trimmed value for the variable or an empty string when unavailable.
 */
function getCssVariableValue(name) {
  if (typeof window === 'undefined' || !window.getComputedStyle) return '';
  const root = document.documentElement;
  if (!root) return '';
  const styles = window.getComputedStyle(root);
  return (styles.getPropertyValue(name) || '').trim();
}

/**
 * Function: escapeHtml
 * Description: Escape special characters before injecting text into HTML strings.
 * Parameters:
 *   value (string): Raw string value to escape.
 * Returns: string - Escaped string safe for HTML insertion.
 */
function escapeHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Function: createBaseLayer
 * Description: Instantiate the Leaflet tile layer using the appropriate basemap for the theme.
 * Parameters:
 *   mode (string): Target color mode, accepts 'light' or 'dark'.
 * Returns: L.TileLayer - Tile layer configured with balanced-toned cartography.
 */
function createBaseLayer(mode = 'light') {
  const useDark = mode === 'dark';
  const url = useDark ? BASE_TILESET_URL_DARK : BASE_TILESET_URL_LIGHT;
  const layer = L.tileLayer(url, {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: BASE_TILESET_ATTRIBUTION
  });
  layer._colorMode = useDark ? 'dark' : 'light';
  return layer;
}

/**
 * Function: applyBaseLayerForMode
 * Description: Ensure the map uses a base layer that matches the supplied color mode.
 * Parameters:
 *   mode (string): Target color mode, defaults to light when unrecognised.
 * Returns: void.
 */
function applyBaseLayerForMode(mode) {
  if (!mapInstance) return;
  const targetMode = mode === 'dark' ? 'dark' : 'light';
  const currentMode = baseTileLayer ? baseTileLayer._colorMode : null;
  if (currentMode === targetMode) return;
  const nextLayer = createBaseLayer(targetMode);
  if (baseTileLayer) {
    try { mapInstance.removeLayer(baseTileLayer); } catch (_) {}
  }
  nextLayer.addTo(mapInstance);
  baseTileLayer = nextLayer;
}

/**
 * Function: registerThemeChangeHandler
 * Description: Listen for OS theme changes so the base map updates automatically.
 * Parameters: None.
 * Returns: void.
 */
function registerThemeChangeHandler() {
  if (themeListenerRegistered || !prefersColorSchemeQuery) return;
  const handler = (event) => {
    applyBaseLayerForMode(event.matches ? 'dark' : 'light');
  };
  if (typeof prefersColorSchemeQuery.addEventListener === 'function') {
    prefersColorSchemeQuery.addEventListener('change', handler);
  } else if (typeof prefersColorSchemeQuery.addListener === 'function') {
    prefersColorSchemeQuery.addListener(handler);
  }
  themeListenerRegistered = true;
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
 * Function: setMapClickCapture
 * Description: Register a handler to intercept map background clicks.
 * Parameters:
 *   handler (Function|null): Handler invoked with the Leaflet event; return true to swallow default handling.
 * Returns: void.
 */
export function setMapClickCapture(handler) {
  mapClickCaptureHandler = typeof handler === 'function' ? handler : null;
}

/**
 * Function: clearMapClickCapture
 * Description: Clear the active map click capture handler.
 * Parameters: None.
 * Returns: void.
 */
export function clearMapClickCapture() {
  mapClickCaptureHandler = null;
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
  const layer = createWindIntensityLayer(points);
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
  const baseColor = voyage.manual ? MANUAL_VOYAGE_COLOR : 'blue';
  const segments = Array.isArray(voyage._segments) ? voyage._segments : [];
  if (segments.length > 0) {
    segments.forEach((seg) => {
      const latLngs = seg.points.map(p => [p.lat, p.lon]);
      if (seg.closeLoop && latLngs.length > 1) {
        const first = latLngs[0];
        const last = latLngs[latLngs.length - 1];
        if (first && last && (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6)) {
          latLngs.push(first);
        }
      }
      const polyline = L.polyline(latLngs, { color: baseColor, weight: 2 }).addTo(mapInstance);
      polyline._baseColor = baseColor;
      seg.polyline = polyline;
      polylines.push(polyline);
      const bounds = polyline.getBounds();
      voyageBounds = voyageBounds ? voyageBounds.extend(bounds) : bounds;
      const voySelect = (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (manualRouteEditActive) return;
        emit(EVENTS.VOYAGE_SELECT_REQUESTED, {
          voyage,
          row,
          source: 'polyline',
          options: { fit: false, scrollIntoView: true }
        });
      };
      polyline.on('click', voySelect);
      polyline.on('tap', voySelect);
      polyline._voySelect = voySelect;
    });
  } else if (Array.isArray(voyage.coords) && voyage.coords.length) {
    const latLngs = voyage.coords.map(([lon, lat]) => [lat, lon]);
    const line = L.polyline(latLngs, { color: baseColor, weight: 2 }).addTo(mapInstance);
    line._baseColor = baseColor;
    polylines.push(line);
    voyage._fallbackPolyline = line;
    voyageBounds = line.getBounds();
    const voySelect = (ev) => {
      L.DomEvent.stopPropagation(ev);
      if (manualRouteEditActive) return;
      emit(EVENTS.VOYAGE_SELECT_REQUESTED, {
        voyage,
        row,
        source: 'polyline',
        options: { fit: false, scrollIntoView: true }
      });
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
    if (manualRouteEditActive) return;
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
 * Function: clearHighlightedLocationMarker
 * Description: Remove the highlighted location marker from the map.
 * Parameters: None.
 * Returns: void.
 */
export function clearHighlightedLocationMarker() {
  if (highlightedLocationMarker && mapInstance) {
    mapInstance.removeLayer(highlightedLocationMarker);
  }
  highlightedLocationMarker = null;
}

/**
 * Function: highlightLocation
 * Description: Highlight a specific location on the map with a large marker.
 * Parameters:
 *   lat (number): Latitude of the location.
 *   lon (number): Longitude of the location.
 *   name (string): Optional name of the location for display.
 * Returns: void.
 */
export function highlightLocation(lat, lon, name = '') {
  clearHighlightedLocationMarker();
  if (!mapInstance || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const markerIcon = L.divIcon({
    className: 'highlighted-location-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: '<span class="highlighted-location-marker"></span>'
  });

  highlightedLocationMarker = L.marker([lat, lon], { icon: markerIcon });

  if (name) {
    highlightedLocationMarker.bindTooltip(name, {
      permanent: true,
      direction: 'top',
      offset: [0, -12],
      className: 'highlighted-location-tooltip'
    });
  }

  highlightedLocationMarker.addTo(mapInstance);
}

/**
 * Function: normalizeRoutePoints
 * Description: Normalize a list of route points into lat/lon objects.
 * Parameters:
 *   points (object[]): Raw route points.
 * Returns: object[]|null - Normalized points or null when invalid.
 */
function normalizeRoutePoints(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const normalized = points.map((point) => {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }).filter(Boolean);
  if (normalized.length < 2) return null;
  return normalized;
}

/**
 * Function: buildRouteLatLngs
 * Description: Build Leaflet lat/lon pairs for route rendering, closing the loop when requested.
 * Parameters:
 *   points (object[]): Normalized route points with lat/lon values.
 *   closeLoop (boolean): When true, append the start point to close the loop.
 * Returns: Array - Array of `[lat, lon]` pairs for Leaflet polylines.
 */
function buildRouteLatLngs(points, closeLoop) {
  const latLngs = points.map(point => [point.lat, point.lon]);
  if (closeLoop && latLngs.length > 1) {
    const first = latLngs[0];
    const last = latLngs[latLngs.length - 1];
    if (first && last && (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6)) {
      latLngs.push(first);
    }
  }
  return latLngs;
}

/**
 * Function: clearManualVoyagePreviewArrows
 * Description: Remove direction arrow markers for manual voyage previews.
 * Parameters: None.
 * Returns: void.
 */
function clearManualVoyagePreviewArrows() {
  if (!Array.isArray(manualVoyagePreviewArrows) || manualVoyagePreviewArrows.length === 0) {
    manualVoyagePreviewArrows = [];
    return;
  }
  manualVoyagePreviewArrows.forEach((marker) => {
    if (marker && mapInstance) {
      try { mapInstance.removeLayer(marker); } catch (_) {}
    }
  });
  manualVoyagePreviewArrows = [];
}

/**
 * Function: createRouteArrowIcon
 * Description: Create a Leaflet div icon for route direction arrows.
 * Parameters:
 *   rotation (number): Rotation angle in degrees.
 * Returns: object - Leaflet divIcon instance.
 */
function createRouteArrowIcon(rotation) {
  const angle = Number.isFinite(rotation) ? rotation : 0;
  return L.divIcon({
    className: 'manual-route-arrow-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span class="manual-route-arrow" style="--rotation: ${angle}deg;"></span>`
  });
}

/**
 * Function: drawManualRouteArrows
 * Description: Render direction arrows along the manual route preview.
 * Parameters:
 *   points (object[]): Normalized route points with lat/lon values.
 *   closeLoop (boolean): When true, include the closing segment back to start.
 * Returns: void.
 */
function drawManualRouteArrows(points, closeLoop) {
  clearManualVoyagePreviewArrows();
  if (!mapInstance || !Array.isArray(points) || points.length < 2) return;
  const totalSegments = closeLoop ? points.length : points.length - 1;
  const maxArrows = 12;
  const step = Math.max(1, Math.ceil(totalSegments / maxArrows));
  for (let i = 0; i < totalSegments; i += step) {
    const start = points[i];
    const end = (i === points.length - 1) ? points[0] : points[i + 1];
    if (!start || !end) continue;
    const midLat = (start.lat + end.lat) / 2;
    const midLon = (start.lon + end.lon) / 2;
    const rotation = bearingBetween(start.lat, start.lon, end.lat, end.lon);
    const marker = L.marker([midLat, midLon], {
      icon: createRouteArrowIcon(rotation),
      interactive: false
    });
    marker.addTo(mapInstance);
    manualVoyagePreviewArrows.push(marker);
  }
}

/**
 * Function: clearManualVoyagePreview
 * Description: Remove the manual voyage preview polyline from the map.
 * Parameters: None.
 * Returns: void.
 */
export function clearManualVoyagePreview() {
  detachManualRouteInsertHandler();
  if (manualVoyagePreviewPolyline && mapInstance) {
    mapInstance.removeLayer(manualVoyagePreviewPolyline);
  }
  manualVoyagePreviewPolyline = null;
  if (manualRouteEditHitPolyline && mapInstance) {
    mapInstance.removeLayer(manualRouteEditHitPolyline);
  }
  manualRouteEditHitPolyline = null;
  clearManualVoyagePreviewArrows();
}

/**
 * Function: drawManualVoyagePreview
 * Description: Draw a preview polyline for manual voyage creation with valid locations.
 * Parameters:
 *   locations (array): Array of location objects with lat, lon properties.
 *   options (object): Optional flags controlling loop closure and direction arrows.
 * Returns: void.
 */
export function drawManualVoyagePreview(locations, options = {}) {
  clearManualVoyagePreview();
  if (!mapInstance || !Array.isArray(locations) || locations.length < 2) return;

  const normalized = normalizeRoutePoints(locations);
  if (!normalized || normalized.length < 2) return;
  const closeLoop = Boolean(options.closeLoop);
  const latLngs = buildRouteLatLngs(normalized, closeLoop);

  if (latLngs.length < 2) return;

  const previewColor = manualRouteEditActive ? ROUTE_EDIT_ACTIVE_COLOR : MANUAL_VOYAGE_COLOR;
  manualVoyagePreviewPolyline = L.polyline(latLngs, {
    color: previewColor,
    weight: 3,
    opacity: 0.7,
    dashArray: '5, 10',
    lineCap: 'round',
    lineJoin: 'round'
  });

  manualVoyagePreviewPolyline.addTo(mapInstance);

  if (options.showDirection) {
    drawManualRouteArrows(normalized, closeLoop);
  }
  if (manualRouteEditActive) {
    ensureManualRouteEditHitPolyline(latLngs);
    attachManualRouteInsertHandler();
  }
}

/**
 * Function: clampRouteTurnIndex
 * Description: Clamp the turnaround index to the valid range for the route points.
 * Parameters:
 *   turnIndex (number): Proposed turnaround index.
 *   length (number): Total number of route points.
 * Returns: number - Clamped turnaround index.
 */
function clampRouteTurnIndex(turnIndex, length) {
  if (!Number.isInteger(turnIndex)) return Math.max(1, length - 1);
  return Math.max(1, Math.min(turnIndex, length - 1));
}

/**
 * Function: createManualRouteMarkerIcon
 * Description: Build a Leaflet div icon for manual route point markers.
 * Parameters:
 *   kind (string): Marker kind ("start", "turn", or "via").
 * Returns: object - Leaflet divIcon instance.
 */
function createManualRouteMarkerIcon(kind) {
  const label = kind === 'start' ? 'S' : (kind === 'turn' ? 'T' : '');
  return L.divIcon({
    className: `manual-route-marker manual-route-marker-${kind}`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span class="manual-route-marker-dot">${label}</span>`
  });
}

/**
 * Function: clearManualRouteEditLayer
 * Description: Remove manual route editor markers from the map.
 * Parameters: None.
 * Returns: void.
 */
function clearManualRouteEditLayer() {
  if (manualRouteEditLayer && mapInstance) {
    mapInstance.removeLayer(manualRouteEditLayer);
  }
  manualRouteEditLayer = null;
  manualRouteEditMarkers = [];
}

/**
 * Function: capturePolylineStyleSnapshot
 * Description: Capture the current style needed to restore a dimmed polyline.
 * Parameters:
 *   polyline (object): Leaflet polyline layer.
 * Returns: object|null - Style snapshot or null when unavailable.
 */
function capturePolylineStyleSnapshot(polyline) {
  if (!polyline || !polyline.options) return null;
  return {
    color: polyline.options.color,
    weight: polyline.options.weight,
    opacity: polyline.options.opacity,
    dashArray: polyline.options.dashArray,
    lineCap: polyline.options.lineCap,
    lineJoin: polyline.options.lineJoin,
    interactive: typeof polyline.options.interactive === 'boolean' ? polyline.options.interactive : true
  };
}

/**
 * Function: hideVoyageLayersForRouteEdit
 * Description: Dim and disable voyage layers while editing a manual loop.
 * Parameters: None.
 * Returns: void.
 */
function hideVoyageLayersForRouteEdit() {
  if (!mapInstance || manualRouteHiddenLayers || manualRouteDimmedLayers) return;
  const hidden = new Set();
  const hideLayer = (layer) => {
    if (!layer || !mapInstance || !mapInstance.hasLayer(layer)) return;
    mapInstance.removeLayer(layer);
    hidden.add(layer);
  };
  const dimmed = new Map();
  const dimLayer = (layer) => {
    if (!layer || !mapInstance || !mapInstance.hasLayer(layer)) return;
    if (dimmed.has(layer)) return;
    if (typeof layer.setStyle !== 'function') return;
    const snapshot = capturePolylineStyleSnapshot(layer);
    if (!snapshot) return;
    dimmed.set(layer, snapshot);
    try {
      layer.setStyle({
        color: ROUTE_EDIT_DIM_COLOR,
        opacity: ROUTE_EDIT_DIM_OPACITY,
        interactive: false
      });
    } catch (_) {}
  };
  (polylines || []).forEach(dimLayer);
  (activePolylines || []).forEach(dimLayer);
  hideLayer(activePointMarkersGroup);
  hideLayer(selectedPointMarker);
  hideLayer(maxMarker);
  hideLayer(selectedWindGroup);
  hideLayer(windIntensityLayer);
  manualRouteHiddenLayers = Array.from(hidden);
  manualRouteDimmedLayers = dimmed;
}

/**
 * Function: restoreVoyageLayersAfterRouteEdit
 * Description: Restore voyage layers hidden during manual loop editing.
 * Parameters: None.
 * Returns: void.
 */
function restoreVoyageLayersAfterRouteEdit() {
  if (!mapInstance) return;
  if (manualRouteDimmedLayers) {
    manualRouteDimmedLayers.forEach((style, layer) => {
      try {
        layer.setStyle({
          color: style.color,
          weight: style.weight,
          opacity: style.opacity,
          dashArray: style.dashArray,
          lineCap: style.lineCap,
          lineJoin: style.lineJoin,
          interactive: style.interactive
        });
      } catch (_) {}
    });
    manualRouteDimmedLayers = null;
  }
  if (manualRouteHiddenLayers) {
    manualRouteHiddenLayers.forEach((layer) => {
      try { mapInstance.addLayer(layer); } catch (_) {}
    });
    manualRouteHiddenLayers = null;
  }
}

/**
 * Function: updateManualRoutePreviewFromEditor
 * Description: Refresh the preview polyline and arrows while editing the route.
 * Parameters: None.
 * Returns: void.
 */
function updateManualRoutePreviewFromEditor() {
  if (!manualRouteEditActive || !Array.isArray(manualRouteEditPoints) || manualRouteEditPoints.length < 2) return;
  if (!manualVoyagePreviewPolyline) {
    drawManualVoyagePreview(manualRouteEditPoints, { closeLoop: true, showDirection: true });
    return;
  }
  const latLngs = buildRouteLatLngs(manualRouteEditPoints, true);
  manualVoyagePreviewPolyline.setLatLngs(latLngs);
  ensureManualRouteEditHitPolyline(latLngs);
  drawManualRouteArrows(manualRouteEditPoints, true);
}

/**
 * Function: emitManualRouteUpdated
 * Description: Emit route updates from map edits back to the manual form.
 * Parameters: None.
 * Returns: void.
 */
function emitManualRouteUpdated() {
  if (!manualRouteEditActive) return;
  emit(EVENTS.MANUAL_ROUTE_UPDATED, {
    points: manualRouteEditPoints.map(point => ({ lat: point.lat, lon: point.lon })),
    turnIndex: manualRouteEditTurnIndex
  });
}

/**
 * Function: distanceToSegment
 * Description: Calculate the distance from a point to a line segment in screen space.
 * Parameters:
 *   point (object): Screen point with x/y values.
 *   start (object): Segment start point with x/y values.
 *   end (object): Segment end point with x/y values.
 * Returns: number - Distance in pixels.
 */
function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = start.x + clamped * dx;
  const projY = start.y + clamped * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Function: findRouteInsertIndex
 * Description: Find the best insertion index for a new point along the loop.
 * Parameters:
 *   latLng (object): Leaflet latlng for the insertion location.
 *   points (object[]): Normalized route points.
 * Returns: number|null - Insert index or null when unavailable.
 */
function findRouteInsertIndex(latLng, points) {
  if (!mapInstance || !Array.isArray(points) || points.length < 2) return null;
  const screenPoint = mapInstance.latLngToLayerPoint(latLng);
  let bestIndex = null;
  let bestDistance = Infinity;
  const totalSegments = points.length;
  for (let i = 0; i < totalSegments; i += 1) {
    const start = points[i];
    const end = (i === points.length - 1) ? points[0] : points[i + 1];
    if (!start || !end) continue;
    const startPt = mapInstance.latLngToLayerPoint([start.lat, start.lon]);
    const endPt = mapInstance.latLngToLayerPoint([end.lat, end.lon]);
    const dist = distanceToSegment(screenPoint, startPt, endPt);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = (i === points.length - 1) ? points.length : i + 1;
    }
  }
  return bestIndex;
}

/**
 * Function: insertRoutePoint
 * Description: Insert a new route point at the supplied location.
 * Parameters:
 *   latLng (object): Leaflet latlng for the insertion location.
 * Returns: void.
 */
function insertRoutePoint(latLng) {
  if (!manualRouteEditActive || !Array.isArray(manualRouteEditPoints)) return;
  const insertIndex = findRouteInsertIndex(latLng, manualRouteEditPoints);
  if (insertIndex === null) return;
  manualRouteEditPoints.splice(insertIndex, 0, { lat: latLng.lat, lon: latLng.lng });
  if (insertIndex <= manualRouteEditTurnIndex) {
    manualRouteEditTurnIndex += 1;
  }
  manualRouteEditTurnIndex = clampRouteTurnIndex(manualRouteEditTurnIndex, manualRouteEditPoints.length);
  updateManualRoutePreviewFromEditor();
  renderManualRouteEditMarkers();
  emitManualRouteUpdated();
}

/**
 * Function: ensureManualRouteEditHitPolyline
 * Description: Maintain an invisible, wide polyline to capture route insert clicks.
 * Parameters:
 *   latLngs (array): Lat/lon pairs for the route line.
 * Returns: void.
 */
function ensureManualRouteEditHitPolyline(latLngs) {
  if (!mapInstance) return;
  const hitStyle = {
    color: '#000000',
    opacity: 0,
    weight: 16,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: true
  };
  if (!manualRouteEditHitPolyline) {
    manualRouteEditHitPolyline = L.polyline(latLngs, hitStyle);
  } else {
    manualRouteEditHitPolyline.setLatLngs(latLngs);
    manualRouteEditHitPolyline.setStyle(hitStyle);
  }
  if (!mapInstance.hasLayer(manualRouteEditHitPolyline)) {
    manualRouteEditHitPolyline.addTo(mapInstance);
  }
}

/**
 * Function: detachManualRouteInsertHandler
 * Description: Remove the route insert click handler from preview layers.
 * Parameters: None.
 * Returns: void.
 */
function detachManualRouteInsertHandler() {
  if (!manualRouteEditClicker) return;
  const targets = [manualRouteEditHitPolyline, manualVoyagePreviewPolyline];
  targets.forEach((layer) => {
    if (!layer) return;
    try { layer.off('click', manualRouteEditClicker); } catch (_) {}
    try { layer.off('tap', manualRouteEditClicker); } catch (_) {}
  });
  manualRouteEditClicker = null;
}

/**
 * Function: attachManualRouteInsertHandler
 * Description: Attach a click handler to insert route points along the preview line.
 * Parameters: None.
 * Returns: void.
 */
function attachManualRouteInsertHandler() {
  if (!manualRouteEditActive || !manualVoyagePreviewPolyline) return;
  detachManualRouteInsertHandler();
  manualRouteEditClicker = (event) => {
    if (!event?.latlng) return;
    L.DomEvent.stopPropagation(event);
    insertRoutePoint(event.latlng);
  };
  const target = manualRouteEditHitPolyline || manualVoyagePreviewPolyline;
  target.on('click', manualRouteEditClicker);
  target.on('tap', manualRouteEditClicker);
}

/**
 * Function: renderManualRouteEditMarkers
 * Description: Render draggable markers for each manual route point.
 * Parameters: None.
 * Returns: void.
 */
function renderManualRouteEditMarkers() {
  clearManualRouteEditLayer();
  if (!mapInstance || !manualRouteEditActive || !Array.isArray(manualRouteEditPoints)) return;
  manualRouteEditLayer = L.layerGroup();
  manualRouteEditMarkers = manualRouteEditPoints.map((point, index) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
    const kind = index === 0 ? 'start' : (index === manualRouteEditTurnIndex ? 'turn' : 'via');
    const marker = L.marker([point.lat, point.lon], {
      icon: createManualRouteMarkerIcon(kind),
      draggable: true
    });
    marker.on('drag', (event) => {
      const latlng = event?.target?.getLatLng();
      if (!latlng) return;
      manualRouteEditPoints[index] = { lat: latlng.lat, lon: latlng.lng };
      updateManualRoutePreviewFromEditor();
    });
    marker.on('dragend', () => {
      emitManualRouteUpdated();
    });
    marker.on('dblclick', (event) => {
      L.DomEvent.stopPropagation(event);
      if (manualRouteEditPoints.length <= 2) return;
      if (index === 0 || index === manualRouteEditTurnIndex) return;
      manualRouteEditPoints.splice(index, 1);
      if (index < manualRouteEditTurnIndex) {
        manualRouteEditTurnIndex -= 1;
      }
      manualRouteEditTurnIndex = clampRouteTurnIndex(manualRouteEditTurnIndex, manualRouteEditPoints.length);
      updateManualRoutePreviewFromEditor();
      renderManualRouteEditMarkers();
      emitManualRouteUpdated();
    });
    marker.addTo(manualRouteEditLayer);
    return marker;
  }).filter(Boolean);
  manualRouteEditLayer.addTo(mapInstance);
}

/**
 * Function: setManualRouteEditing
 * Description: Enable or disable manual route editing on the map.
 * Parameters:
 *   active (boolean): True when editing mode should be enabled.
 *   points (object[]): Route points to edit.
 *   turnIndex (number): Index of the turnaround point.
 * Returns: void.
 */
function setManualRouteEditing(active, points, turnIndex) {
  if (!active) {
    manualRouteEditActive = false;
    manualRouteEditPoints = [];
    manualRouteEditTurnIndex = null;
    clearManualRouteEditLayer();
    detachManualRouteInsertHandler();
    if (manualRouteEditHitPolyline && mapInstance) {
      mapInstance.removeLayer(manualRouteEditHitPolyline);
    }
    manualRouteEditHitPolyline = null;
    restoreVoyageLayersAfterRouteEdit();
    return;
  }
  const normalized = normalizeRoutePoints(points);
  if (!normalized || normalized.length < 2) {
    manualRouteEditActive = false;
    clearManualRouteEditLayer();
    restoreVoyageLayersAfterRouteEdit();
    return;
  }
  manualRouteEditActive = true;
  manualRouteEditPoints = normalized;
  manualRouteEditTurnIndex = clampRouteTurnIndex(turnIndex, normalized.length);
  hideVoyageLayersForRouteEdit();
  drawManualVoyagePreview(manualRouteEditPoints, { closeLoop: true, showDirection: true });
  renderManualRouteEditMarkers();
}

/**
 * Function: syncManualRouteEditor
 * Description: Sync route editor markers with updated route points.
 * Parameters:
 *   points (object[]): Route points to render.
 *   turnIndex (number): Index of the turnaround point.
 * Returns: void.
 */
function syncManualRouteEditor(points, turnIndex) {
  if (!manualRouteEditActive) return;
  const normalized = normalizeRoutePoints(points);
  if (!normalized || normalized.length < 2) return;
  manualRouteEditPoints = normalized;
  manualRouteEditTurnIndex = clampRouteTurnIndex(turnIndex, normalized.length);
  renderManualRouteEditMarkers();
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
      if (manualRouteEditActive) return;
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
 * Function: getDetailsPanelElements
 * Description: Resolve the point details panel and body container for content updates.
 * Parameters: None.
 * Returns: object|null - Object containing the panel and body elements or null if unavailable.
 */
function getDetailsPanelElements() {
  const panel = document.getElementById('pointDetails');
  if (!panel) return null;
  let body = panel.querySelector('.details-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'details-body';
    panel.appendChild(body);
  }
  return { panel, body };
}

/**
 * Function: renderPointDetails
 * Description: Populate the point details panel with data from the selected voyage point.
 * Parameters:
 *   point (object): Voyage point containing entry metadata and coordinates.
 * Returns: void.
 */
function renderPointDetails(point) {
  const elements = getDetailsPanelElements();
  if (!elements) return;
  const { panel, body } = elements;
  const entry = point.entry || point;
  const when = entry.datetime ? new Date(entry.datetime).toLocaleString() : '—';
  const sog = entry?.speed?.sog;
  const stw = entry?.speed?.stw;
  const windSpd = entry?.wind?.speed;
  const windDir = entry?.wind?.direction;
  const windDirTxt = typeof windDir === 'number' ? `${windDir.toFixed(0)}° (${degToCompassLocal(windDir)})` : '—';
  const posStr = formatPosition(point.lat, point.lon);
  const locationName = point.manualLocationName || entry.manualLocationName;
  const locationRow = locationName
    ? `<div class="row"><dt>Location</dt><dd>${escapeHtml(String(locationName))}</dd></div>`
    : '';
  const summary = `
    <dl class="point-details">
      <div class="row"><dt>Time</dt><dd>${when}</dd></div>
      ${locationRow}
      <div class="row"><dt>Position</dt><dd>${posStr}</dd></div>
      <div class="row"><dt>SOG</dt><dd>${typeof sog === 'number' ? sog.toFixed(2) + ' kn' : '—'}</dd></div>
      <div class="row"><dt>STW</dt><dd>${typeof stw === 'number' ? stw.toFixed(2) + ' kn' : '—'}</dd></div>
      <div class="row"><dt>Wind</dt><dd>${typeof windSpd === 'number' ? windSpd.toFixed(2) + ' kn' : '—'} @ ${windDirTxt}</dd></div>
      <div class="row"><dt>Activity</dt><dd>${getPointActivity(point)}</dd></div>
    </dl>`;
  panel.style.display = '';
  body.innerHTML = summary;
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
    selectedPointMarker = L.marker([lat, lon], { icon: createBoatIcon(bearing), zIndexOffset: 1000 }).addTo(mapInstance);
  } else {
    selectedPointMarker.setLatLng([lat, lon]);
    selectedPointMarker.setIcon(createBoatIcon(bearing));
  }
  clearSelectedWindGraphics();
  const windSpd = entry?.wind?.speed;
  let windDir = entry?.wind?.direction;
  if (typeof windSpd === 'number' && typeof windDir === 'number') {
    windDir = (windDir + 180) % 360;
    const angle = windDir.toFixed(1);
    const size = calculateWindArrowSize(windSpd);
    const center = size / 2;
    const tipY = 6;
    const headLength = 10;
    const halfHead = 6;
    const headBaseY = tipY + headLength;
    const shaftTopY = tipY + Math.round(headLength * 0.6);
    const strokeW = 2;
    const windStroke = getCssVariableValue('--wind-arrow-color') || '#111827';
    const html = `
      <div class="wind-arrow" style="width:${size}px;height:${size}px;transform: rotate(${angle}deg);">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <line x1="${center}" y1="${center}" x2="${center}" y2="${shaftTopY}" stroke="${windStroke}" stroke-width="${strokeW}" />
          <polygon points="${center},${tipY} ${center - halfHead},${headBaseY} ${center + halfHead},${headBaseY}" fill="${windStroke}" />
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
  const elements = getDetailsPanelElements();
  if (!elements) return;
  const { panel, body } = elements;
  panel.style.display = '';
  body.innerHTML = `<em>${msg}</em>`;
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
    const color = pl && pl._baseColor ? pl._baseColor : 'blue';
    try { pl.setStyle({ color, weight: 2 }); } catch (_) {}
  });
}

/**
 * Function: resetVoyageSelection
 * Description: Clear any active voyage selection and restore the map to show all voyages.
 * Parameters: None.
 * Returns: void.
 */
export function resetVoyageSelection() {
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();
  clearWindIntensityLayer();
  clearHighlightedLocationMarker();
  clearManualVoyagePreview();
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
  emit(EVENTS.SELECTION_RESET_COMPLETE, {});
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
  if (manualRouteEditActive) return;
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
  let highlightLines = (mapInstance && voyagePoints.length >= 2)
    ? createActivityHighlightPolylines(mapInstance, voyagePoints)
    : [];
  if (!highlightLines.length) {
    if (voyage._segments && voyage._segments.length > 0) {
      voyage._segments.forEach(seg => {
        seg.polyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_ACTIVITY_WEIGHT });
        highlightLines.push(seg.polyline);
      });
    } else if (voyage._fallbackPolyline) {
      voyage._fallbackPolyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_ACTIVITY_WEIGHT });
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
 * Function: focusSegment
 * Description: Highlight a voyage leg segment, wiring point interactions and map fitting.
 * Parameters:
 *   segment (object): Segment descriptor containing points and optional polyline reference.
 *   options (object): Optional overrides for highlight styling.
 * Returns: void.
 */
function focusSegment(segment, options = {}) {
  if (!segment) return;
  ensureMobileLayoutReadiness();
  ensureMobileMapView();
  clearMaxSpeedMarker();
  restoreBasePolylineStyles();
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();
  removeActivePolylines();

  const segmentPoints = Array.isArray(segment?.points) ? segment.points : [];
  const highlightWeight = typeof options.weight === 'number' ? options.weight : 5;
  let segmentHighlights = (mapInstance && segmentPoints.length >= 2)
    ? createActivityHighlightPolylines(mapInstance, segmentPoints, { weight: highlightWeight })
    : [];
  if (!segmentHighlights.length && segment?.polyline) {
    segment.polyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_ACTIVITY_WEIGHT });
    segmentHighlights = [segment.polyline];
  }
  setActivePolylines(segmentHighlights);
  if (segmentHighlights.length > 0) {
    wirePolylineSelectionHandlers(segmentHighlights, segmentPoints);
    let bounds = segmentHighlights[0].getBounds();
    for (let i = 1; i < segmentHighlights.length; i += 1) {
      bounds = bounds.extend(segmentHighlights[i].getBounds());
    }
    fitMapToBounds(bounds, { deferForMobile: true });
  }

  clearWindIntensityLayer();
  setCurrentVoyagePoints(segmentPoints);
  renderActivePointMarkers(segmentPoints);
  refreshWindOverlay(segmentPoints);
  setWindOverlayToggleAvailability(true);
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
 * Description: Reset any existing map instance and create a new Leaflet map with base layers and event wiring.
 * Parameters:
 *   onBackgroundClick (Function): Optional additional handler invoked when the map background is clicked.
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
  manualVoyagePreviewPolyline = null;
  manualVoyagePreviewArrows = [];
  manualRouteEditActive = false;
  manualRouteEditLayer = null;
  manualRouteEditMarkers = [];
  manualRouteEditPoints = [];
  manualRouteEditTurnIndex = null;
  manualRouteEditClicker = null;
  manualRouteEditHitPolyline = null;
  manualRouteHiddenLayers = null;
  manualRouteDimmedLayers = null;
  currentVoyagePoints = [];
  baseTileLayer = null;
  mapInstance = L.map('map').setView([0, 0], 2);
  applyBaseLayerForMode(getPreferredColorMode());
  registerThemeChangeHandler();
  registerMapResizeCallback(() => {
    if (mapInstance) {
      mapInstance.invalidateSize();
    }
  });
  const backgroundHandler = (event) => {
    const handled = mapClickCaptureHandler ? mapClickCaptureHandler(event) : false;
    if (!handled) {
      handleMapBackgroundClick(event);
    }
    if (typeof onBackgroundClick === 'function') {
      onBackgroundClick(event);
    }
  };
  mapInstance.on('click', backgroundHandler);
  mapInstance.on('tap', backgroundHandler);
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
  if (manualRouteEditActive) return;
  const latLng = event?.latlng;
  if (!latLng) return;
  const nearest = findNearestVoyageSelection(latLng);
  if (!nearest || !nearest.row) return;
  if (nearest.distance > MAP_CLICK_SELECT_THRESHOLD_METERS) return;
  const alreadySelected = nearest.row.classList.contains('selected-row');
  const prev = nearest.points[nearest.index - 1];
  const next = nearest.points[nearest.index + 1];
  emit(EVENTS.VOYAGE_SELECT_REQUESTED, {
    voyage: nearest.voyage,
    row: nearest.row,
    source: 'map-background',
    options: {
      fit: !alreadySelected,
      scrollIntoView: !alreadySelected,
      suppressHistory: false
    },
    focusPoint: {
      point: nearest.point,
      prev,
      next
    }
  });
}

/**
 * Function: wireDetailsControls
 * Description: Attach control handlers to the details panel for closing and dragging affordances.
 * Parameters:
 *   panel (HTMLElement): Details panel element.
 * Returns: void.
 */
/**
 * Function: performVoyageSelection
 * Description: Execute a voyage selection request and notify listeners of the resulting state.
 * Parameters:
 *   payload (object): Selection descriptor including voyage, row, options, and optional focus point.
 * Returns: object|null - Normalised selection context or null when selection could not be completed.
 */
function performVoyageSelection(payload = {}) {
  const voyage = payload?.voyage;
  if (!voyage) return null;
  let row = payload?.row || null;
  if (!row && typeof voyage._tripIndex === 'number') {
    const rows = getVoyageRows();
    row = rows[voyage._tripIndex - 1] || null;
  }
  if (!row) return null;
  const options = {
    fit: true,
    scrollIntoView: false,
    suppressHistory: false,
    ...(payload.options || {})
  };
  selectVoyage(voyage, row, options);
  const focusPoint = payload.focusPoint;
  if (focusPoint && focusPoint.point) {
    updateSelectedPoint(focusPoint.point, {
      prev: focusPoint.prev,
      next: focusPoint.next
    });
  }
  emit(EVENTS.VOYAGE_SELECTED, {
    voyage,
    row,
    options,
    source: payload.source || 'unknown',
    metadata: payload.metadata || null
  });
  return { voyage, row, options };
}

/**
 * Function: handleVoyageSelectRequested
 * Description: Respond to a voyage selection request broadcast on the event bus.
 * Parameters:
 *   payload (object): Selection descriptor containing voyage, row, and options.
 * Returns: void.
 */
function handleVoyageSelectRequested(payload = {}) {
  performVoyageSelection(payload);
}

/**
 * Function: handleVoyageMaxSpeedRequested
 * Description: Respond to a voyage max-speed request by selecting the voyage and placing the marker.
 * Parameters:
 *   payload (object): Descriptor including voyage, row, coordinate pair, and speed value.
 * Returns: void.
 */
function handleVoyageMaxSpeedRequested(payload = {}) {
  performVoyageSelection(payload);
  if (Array.isArray(payload.coord) && payload.coord.length === 2) {
    drawMaxSpeedMarkerFromCoord(payload.coord, payload.speed);
  }
}

/**
 * Function: handleSegmentSelectRequested
 * Description: Handle a segment focus request by selecting the voyage and highlighting the segment.
 * Parameters:
 *   payload (object): Descriptor with voyage, row, and segment metadata.
 * Returns: void.
 */
function handleSegmentSelectRequested(payload = {}) {
  performVoyageSelection(payload);
  if (payload.segment) {
    focusSegment(payload.segment, payload.segmentOptions);
  }
}

/**
 * Function: handleSegmentMaxSpeedRequested
 * Description: Focus a segment and display its maximum speed marker when requested.
 * Parameters:
 *   payload (object): Descriptor containing voyage, segment, coordinate, and speed details.
 * Returns: void.
 */
function handleSegmentMaxSpeedRequested(payload = {}) {
  handleSegmentSelectRequested(payload);
  if (Array.isArray(payload.coord) && payload.coord.length === 2) {
    drawMaxSpeedMarkerFromCoord(payload.coord, payload.speed);
  }
}

/**
 * Function: handleSelectionResetRequested
 * Description: Reset the voyage selection in response to a global reset event.
 * Parameters: None.
 * Returns: void.
 */
function handleSelectionResetRequested() {
  resetVoyageSelection();
}

/**
 * Function: handleManualLocationSelected
 * Description: Highlight a manual voyage location on the map when selected in the edit form.
 * Parameters:
 *   payload (object): Event payload containing location data.
 * Returns: void.
 */
function handleManualLocationSelected(payload = {}) {
  const location = payload?.location;
  if (!location) {
    clearHighlightedLocationMarker();
    return;
  }
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    clearHighlightedLocationMarker();
    return;
  }
  highlightLocation(lat, lon, location.name || '');
}

/**
 * Function: handleManualVoyagePreview
 * Description: Draw or clear preview polyline for manual voyage being created/edited.
 * Parameters:
 *   payload (object): Event payload containing locations array.
 * Returns: void.
 */
function handleManualVoyagePreview(payload = {}) {
  const locations = payload?.locations;
  const returnTrip = Boolean(payload?.returnTrip);
  const routePoints = payload?.routePoints;
  const routeTurnIndex = Number.isInteger(payload?.routeTurnIndex) ? payload.routeTurnIndex : null;
  const hasLocations = Array.isArray(locations) && locations.length >= 2;
  const hasRoutePoints = Array.isArray(routePoints) && routePoints.length >= 2;
  if (!hasLocations && !hasRoutePoints) {
    clearManualVoyagePreview();
    return;
  }
  if (returnTrip) {
    if (hasRoutePoints) {
      drawManualVoyagePreview(routePoints, { closeLoop: true, showDirection: true });
    } else if (hasLocations) {
      drawManualVoyagePreview(locations, { closeLoop: true, showDirection: true });
    }
  } else if (hasLocations) {
    drawManualVoyagePreview(locations, { closeLoop: false, showDirection: false });
  }
  if (manualRouteEditActive && hasRoutePoints) {
    syncManualRouteEditor(routePoints, routeTurnIndex);
  }
}

/**
 * Function: handleManualRouteEditRequested
 * Description: Toggle manual route editing in response to UI requests.
 * Parameters:
 *   payload (object): Event payload containing active state and route metadata.
 * Returns: void.
 */
function handleManualRouteEditRequested(payload = {}) {
  const active = Boolean(payload?.active);
  if (!active) {
    setManualRouteEditing(false, null, null);
    return;
  }
  setManualRouteEditing(true, payload?.points, payload?.turnIndex);
}

on(EVENTS.VOYAGE_SELECT_REQUESTED, handleVoyageSelectRequested);
on(EVENTS.VOYAGE_MAX_SPEED_REQUESTED, handleVoyageMaxSpeedRequested);
on(EVENTS.SEGMENT_SELECT_REQUESTED, handleSegmentSelectRequested);
on(EVENTS.SEGMENT_MAX_SPEED_REQUESTED, handleSegmentMaxSpeedRequested);
on(EVENTS.SELECTION_RESET_REQUESTED, handleSelectionResetRequested);
on(EVENTS.MANUAL_LOCATION_SELECTED, handleManualLocationSelected);
on(EVENTS.MANUAL_VOYAGE_PREVIEW, handleManualVoyagePreview);
on(EVENTS.MANUAL_ROUTE_EDIT_REQUESTED, handleManualRouteEditRequested);

function wireDetailsControls(panel) {
  if (!panel) return;
  if (panel.dataset.controlsWired === 'true') return;
  const closeBtn = panel.querySelector('.close-details');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }
  panel.dataset.controlsWired = 'true';
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
