// Logbook app logic
// Depends on Leaflet (global L). Expects DOM with #map, #voyTable, #pointDetails.

// Compass utility
/**
 * Function: degToCompass
 * Description: Convert a heading in degrees to a cardinal or intercardinal compass label.
 * Parameters:
 *   deg (number): Heading in degrees from 0 through 359.
 * Returns: string - Compass label representing the supplied heading.
 */
function degToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// Global state
let map, polylines = [], maxMarker;
let activePolylines = [];
let activeLineClickers = [];
let selectedPointMarker = null;
let activePointMarkersGroup = null;
let selectedWindGroup = null;
let windIntensityLayer = null;
let currentVoyagePoints = [];
let voyageRows = [];
let voyageData = [];
let suppressHistoryUpdate = false;
let allVoyagesBounds = null;

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
const MIN_TOP_SECTION_HEIGHT = 230;
const MIN_MAP_SECTION_HEIGHT = 400;
const GRID_ROW_GAP_PX = 12;
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessageEl = loadingOverlay ? loadingOverlay.querySelector('.loading-message') : null;
const windOverlayToggleInput = document.getElementById('windOverlayToggle');
const windOverlayToggleWrapper = windOverlayToggleInput ? windOverlayToggleInput.closest('.toggle-switch') : null;

const MOBILE_BREAKPOINT_PX = 700;
const containerEl = document.querySelector('.container');
const mobileTabBar = document.getElementById('mobileTabBar');
const mobileTabButtons = {
  table: document.getElementById('mobileTabTable'),
  map: document.getElementById('mobileTabMap')
};
const tablePanel = document.getElementById('tablePanel');
const mapPanel = document.getElementById('mapPanel');

let pendingMobileResizeFrame = null;
let hasInitializedMobileView = false;

let windOverlayEnabled = false;

/**
 * Function: isMobileViewport
 * Description: Determine whether the viewport width is below the mobile breakpoint.
 * Parameters: None.
 * Returns: boolean - True when the viewport should use the mobile layout.
 */
function isMobileViewport() {
  const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0;
  return width > 0 && width < MOBILE_BREAKPOINT_PX;
}

/**
 * Function: isMobileLayoutActive
 * Description: Determine whether the responsive mobile layout is currently applied.
 * Parameters: None.
 * Returns: boolean - True when the container is in mobile layout mode.
 */
function isMobileLayoutActive() {
  return Boolean(containerEl && containerEl.classList.contains('mobile-layout'));
}

/**
 * Function: getActiveMobileView
 * Description: Read the currently selected mobile view from the container dataset.
 * Parameters: None.
 * Returns: string - Either 'table' or 'map'.
 */
function getActiveMobileView() {
  if (!containerEl) return 'table';
  return containerEl.dataset.mobileView === 'map' ? 'map' : 'table';
}

/**
 * Function: ensureMobileMapView
 * Description: Activate the map tab when the mobile layout is active and scroll to the top when switching.
 * Parameters: None.
 * Returns: void.
 */
function ensureMobileMapView() {
  if (!isMobileLayoutActive()) return;
  const previousView = getActiveMobileView();
  setActiveMobileView('map');
  if (previousView === 'map') return;
  if (typeof window === 'undefined') return;
  const scrollToTop = () => {
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(scrollToTop);
  } else {
    scrollToTop();
  }
}

/**
 * Function: ensureMobileLayoutReadiness
 * Description: Apply the mobile layout when the viewport qualifies and it has not yet been activated.
 * Parameters: None.
 * Returns: void.
 */
function ensureMobileLayoutReadiness() {
  if (!isMobileViewport()) return;
  if (isMobileLayoutActive()) return;
  applyMobileLayout();
}

/**
 * Function: fitMapToBounds
 * Description: Fit the Leaflet map to the supplied bounds, optionally deferring until the mobile layout stabilises.
 * Parameters:
 *   bounds (L.LatLngBounds): Geographic bounds representing the region to display.
 *   options (object): Optional flags controlling scheduling behaviour.
 * Returns: void.
 */
function fitMapToBounds(bounds, options = {}) {
  if (!map || !bounds || typeof bounds.isValid !== 'function' || !bounds.isValid()) return;
  const { deferForMobile = false } = options;
  const performFit = () => {
    if (map && bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
      map.fitBounds(bounds);
    }
  };
  if (deferForMobile && isMobileLayoutActive()) {
    requestAnimationFrame(() => {
      if (map) map.invalidateSize();
      requestAnimationFrame(performFit);
    });
    return;
  }
  performFit();
}

/**
 * Function: setActiveMobileView
 * Description: Activate the requested mobile panel, update tab styling, and manage visibility.
 * Parameters:
 *   view (string): Target view identifier, accepts 'table' or 'map'.
 * Returns: void.
 */
function setActiveMobileView(view) {
  if (!containerEl) return;
  const normalized = view === 'map' ? 'map' : 'table';
  containerEl.dataset.mobileView = normalized;
  const inMobileLayout = containerEl.classList.contains('mobile-layout');

  const tableButton = mobileTabButtons.table;
  const mapButton = mobileTabButtons.map;
  if (tableButton) {
    const isActive = normalized === 'table' && inMobileLayout;
    tableButton.classList.toggle('is-active', isActive);
    tableButton.setAttribute('aria-selected', String(isActive));
    tableButton.setAttribute('tabindex', inMobileLayout ? (normalized === 'table' ? '0' : '-1') : '0');
  }
  if (mapButton) {
    const isActive = normalized === 'map' && inMobileLayout;
    mapButton.classList.toggle('is-active', isActive);
    mapButton.setAttribute('aria-selected', String(isActive));
    mapButton.setAttribute('tabindex', inMobileLayout ? (normalized === 'map' ? '0' : '-1') : '0');
  }

  if (tablePanel) {
    tablePanel.hidden = inMobileLayout ? normalized !== 'table' : false;
  }
  if (mapPanel) {
    mapPanel.hidden = inMobileLayout ? normalized !== 'map' : false;
  }

  if (normalized === 'map' && typeof map !== 'undefined' && map) {
    requestAnimationFrame(() => {
      if (map) map.invalidateSize();
    });
  }
}

/**
 * Function: applyMobileLayout
 * Description: Toggle the responsive layout class and associated UI affordances based on viewport width.
 * Parameters: None.
 * Returns: void.
 */
function applyMobileLayout() {
  if (!containerEl) return;
  const shouldUseMobile = isMobileViewport();
  if (shouldUseMobile) {
    containerEl.classList.add('mobile-layout');
    if (mobileTabBar) {
      mobileTabBar.hidden = false;
      mobileTabBar.setAttribute('aria-hidden', 'false');
    }
    containerEl.style.removeProperty('--top-height');
    containerEl.style.height = '';
    setActiveMobileView(getActiveMobileView());
  } else {
    containerEl.classList.remove('mobile-layout');
    if (mobileTabBar) {
      mobileTabBar.hidden = true;
      mobileTabBar.setAttribute('aria-hidden', 'true');
    }
    if (mobileTabButtons.table) {
      mobileTabButtons.table.classList.remove('is-active');
      mobileTabButtons.table.setAttribute('aria-selected', 'false');
      mobileTabButtons.table.setAttribute('tabindex', '0');
    }
    if (mobileTabButtons.map) {
      mobileTabButtons.map.classList.remove('is-active');
      mobileTabButtons.map.setAttribute('aria-selected', 'false');
      mobileTabButtons.map.setAttribute('tabindex', '0');
    }
    if (tablePanel) tablePanel.hidden = false;
    if (mapPanel) mapPanel.hidden = false;
    if (typeof map !== 'undefined' && map) {
      requestAnimationFrame(() => {
        if (map) map.invalidateSize();
      });
    }
  }
}

/**
 * Function: handleMobileTabKeyNavigation
 * Description: Support left and right arrow key navigation between mobile tabs.
 * Parameters:
 *   event (KeyboardEvent): Key event triggered within the mobile tab bar.
 * Returns: void.
 */
function handleMobileTabKeyNavigation(event) {
  if (!containerEl || !containerEl.classList.contains('mobile-layout')) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const currentView = getActiveMobileView();
  let nextView = currentView;
  if (event.key === 'ArrowLeft') {
    nextView = currentView === 'map' ? 'table' : 'map';
  } else if (event.key === 'ArrowRight') {
    nextView = currentView === 'table' ? 'map' : 'table';
  }
  if (nextView === currentView) return;
  event.preventDefault();
  setActiveMobileView(nextView);
  const nextButton = mobileTabButtons[nextView];
  if (nextButton) nextButton.focus();
}

/**
 * Function: initMobileLayoutControls
 * Description: Wire up mobile tab interactions and monitor viewport changes.
 * Parameters: None.
 * Returns: void.
 */
function initMobileLayoutControls() {
  if (!containerEl) return;
  if (mobileTabButtons.table) {
    mobileTabButtons.table.addEventListener('click', () => setActiveMobileView('table'));
  }
  if (mobileTabButtons.map) {
    mobileTabButtons.map.addEventListener('click', () => setActiveMobileView('map'));
  }
  if (mobileTabBar) {
    mobileTabBar.addEventListener('keydown', handleMobileTabKeyNavigation);
  }
  window.addEventListener('resize', () => {
    if (pendingMobileResizeFrame) {
      cancelAnimationFrame(pendingMobileResizeFrame);
    }
    pendingMobileResizeFrame = requestAnimationFrame(() => {
      pendingMobileResizeFrame = null;
      applyMobileLayout();
    });
  });
  applyMobileLayout();
}

initMobileLayoutControls();

/**
 * Function: showLoading
 * Description: Display the global loading overlay with an optional status message.
 * Parameters:
 *   message (string): Message shown to the user while loading; defaults to a generic label.
 * Returns: void.
 */
function showLoading(message) {
  if (!loadingOverlay) return;
  if (loadingMessageEl) {
    loadingMessageEl.textContent = message || 'Working...';
  }
  loadingOverlay.classList.add('is-active');
  document.body.classList.add('is-loading');
}

/**
 * Function: hideLoading
 * Description: Hide the global loading overlay and reset its message copy.
 * Parameters: None.
 * Returns: void.
 */
function hideLoading() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.remove('is-active');
  document.body.classList.remove('is-loading');
  if (loadingMessageEl) {
    loadingMessageEl.textContent = 'Working...';
  }
}

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
 * Function: extractWindSpeed
 * Description: Resolve the wind speed in knots for a voyage point if available.
 * Parameters:
 *   point (object): Voyage point with optional wind metadata.
 * Returns: number|null - Wind speed in knots or null when missing.
 */
function extractWindSpeed(point) {
  if (!point || typeof point !== 'object') return null;
  if (typeof point.windSpeed === 'number') return point.windSpeed;
  const windObj = point.entry?.wind;
  if (windObj && typeof windObj.speed === 'number') return windObj.speed;
  return null;
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
  for (let i = 0; i < WIND_SPEED_COLOR_STOPS.length; i++) {
    const stop = WIND_SPEED_COLOR_STOPS[i];
    selected = stop.color;
    if (speed <= stop.limit) break;
  }
  return selected;
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
function clearWindIntensityLayer() {
  if (windIntensityLayer) {
    map.removeLayer(windIntensityLayer);
    windIntensityLayer = null;
  }
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
function setWindOverlayToggleAvailability(available) {
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
function refreshWindOverlay(points = currentVoyagePoints) {
  clearWindIntensityLayer();
  if (!windOverlayEnabled) return;
  if (!Array.isArray(points) || points.length === 0) return;
  const layer = buildWindIntensityOverlay(points);
  if (!layer) return;
  windIntensityLayer = layer;
  windIntensityLayer.addTo(map);
}

/**
 * Function: setWindOverlayEnabled
 * Description: Toggle the wind overlay visibility and update related UI state.
 * Parameters:
 *   enabled (boolean): When true the overlay renders for the active voyage.
 * Returns: void.
 */
function setWindOverlayEnabled(enabled) {
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

// Allow a bit of tolerance when selecting voyages by clicking the map background
const MAP_CLICK_SELECT_THRESHOLD_METERS = 1500;

const SAILING_HIGHLIGHT_COLOR = '#ef4444'; // vivid red
const NON_SAIL_HIGHLIGHT_COLOR = '#facc15'; // warm yellow
const DEFAULT_HIGHLIGHT_WEIGHT = 4;
const DEFAULT_HIGHLIGHT_OPACITY = 0.95;

const basePathname = (() => {
  let path = window.location.pathname || '/';
  if (/\/index\.html?$/i.test(path)) path = path.replace(/\/index\.html?$/i, '/');
  if (/\/[0-9]+\/?$/.test(path)) path = path.replace(/\/[0-9]+\/?$/, '/');
  path = path.replace(/\/+$/, '/');
  if (!path.endsWith('/')) path += '/';
  return path;
})();

// Resolve the API base path for this plugin
// The API base path is "/plugins/voyage-webapp" when the app is run from signalk (the app path is "/voyage-webapp")
// Otherwise, the API base path is the empty string ("/") when the app is run standalone  server.js (the app path is "/")
const apiBasePath = (() => {
  const pathname = window.location.pathname || '';
  const pluginPrefix = '/plugins/voyage-webapp';
  if (pathname.includes('voyage-webapp')) {
    return pluginPrefix;
  }
  return '';
})();

const historyUpdatesEnabled = apiBasePath === '';

console.log(`[voyage-webapp] apiBasePath resolved to "${apiBasePath || '/'}" for pathname "${window.location.pathname}"`);

/**
 * Function: getTripIdFromPath
 * Description: Extract the trip identifier from the current URL path when present.
 * Parameters: None.
 * Returns: number|null - Trip identifier or null when no valid identifier exists in the path.
 */
function getTripIdFromPath() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  const last = segments[segments.length - 1];
  if (!/^[0-9]+$/.test(last)) return null;
  const tripId = Number.parseInt(last, 10);
  return Number.isNaN(tripId) ? null : tripId;
}

/**
 * Function: getPointActivity
 * Description: Determine the activity type for a voyage point, falling back to sailing.
 * Parameters:
 *   point (object): Voyage point potentially containing activity metadata.
 * Returns: string - Activity label such as 'sailing', 'motoring', or 'anchored'.
 */
function getPointActivity(point) {
  const activity = point?.activity ?? point?.entry?.activity;
  if (activity === 'sailing' || activity === 'motoring' || activity === 'anchored') return activity;
  return 'sailing';
}

/**
 * Function: shouldSkipConnection
 * Description: Decide if two sequential points should not be connected when drawing or analysing a track.
 * Parameters:
 *   start (object): Point containing metadata for the segment start.
 *   end (object): Point containing metadata for the segment end.
 * Returns: boolean - True when the connection should be skipped due to stop markers.
 */
function shouldSkipConnection(start, end) {
  if (!start || !end) return false;
  if (start && typeof start === 'object') {
    if (start.skipConnectionToNext) return true;
    if (start.entry && start.entry.skipConnectionToNext) return true;
  }
  if (end && typeof end === 'object') {
    if (end.skipConnectionFromPrev) return true;
    if (end.entry && end.entry.skipConnectionFromPrev) return true;
  }
  return false;
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

  for (let i = 0; i < points.length - 1; i++) {
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
function createActivityHighlightPolylines(points, options = {}) {
  if (!map || !Array.isArray(points) || points.length < 2) return [];
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
    }).addTo(map);
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
function removeActivePolylines() {
  if (!Array.isArray(activePolylines) || !map) { activePolylines = []; return; }
  activePolylines.forEach(pl => {
    if (pl && pl._activityHighlight) {
      try { map.removeLayer(pl); } catch (_) {}
    }
  });
  activePolylines = [];
}

/**
 * Function: updateHistoryForTrip
 * Description: Update the browser history state to reflect the selected voyage identifier.
 * Parameters:
 *   tripId (number): Voyage identifier to encode into the history state.
 *   options (object): Optional flags including replace to control history mutation.
 * Returns: void.
 */
function updateHistoryForTrip(tripId, options = {}) {
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
 * Function: syncVoyageSelectionWithPath
 * Description: Select the voyage corresponding to the current URL path if possible.
 * Parameters:
 *   options (object): Optional flags controlling history updates during selection.
 * Returns: boolean - True when a voyage selection was applied from the path.
 */
function syncVoyageSelectionWithPath(options = {}) {
  const { updateHistory = false } = options;
  const tripId = getTripIdFromPath();
  if (!Number.isInteger(tripId)) return false;
  const idx = tripId - 1;
  const voyage = voyageData[idx];
  const row = voyageRows[idx];
  if (!voyage || !row) return false;
  suppressHistoryUpdate = true;
  try {
    selectVoyage(voyage, row, { fit: true, scrollIntoView: true });
  } finally {
    suppressHistoryUpdate = false;
  }
  if (updateHistory && historyUpdatesEnabled) {
    updateHistoryForTrip(tripId, { replace: true });
  }
  return true;
}

window.addEventListener('popstate', () => {
  syncVoyageSelectionWithPath({ updateHistory: false });
});

// Data helpers
/**
 * Function: getVoyagePoints
 * Description: Retrieve the best available array of points for a voyage regardless of source field.
 * Parameters:
 *   v (object): Voyage summary that may store points under multiple property names.
 * Returns: object[] - Array of point objects prepared for mapping.
 */
function getVoyagePoints(v) {
  if (Array.isArray(v.points) && v.points.length) return v.points;
  if (Array.isArray(v.entries) && v.entries.length) return v.entries;
  if (Array.isArray(v.coords) && v.coords.length) return v.coords.map(([lon, lat]) => ({ lon, lat }));
  return [];
}

/**
 * Function: computeVoyageTotals
 * Description: Aggregate voyage distance and activity durations across the full voyage list.
 * Parameters:
 *   voyages (object[]): Voyage summaries containing point data and statistics.
 * Returns: object - Accumulated totals for distance (NM) and activity durations (milliseconds).
 */
function computeVoyageTotals(voyages) {
  if (!Array.isArray(voyages) || voyages.length === 0) {
    return { totalDistanceNm: 0, totalActiveMs: 0, totalSailingMs: 0 };
  }

  let totalDistanceNm = 0;
  let totalActiveMs = 0;
  let totalSailingMs = 0;
  const activeActivities = new Set(['sailing', 'motoring', 'anchored']);

  const readActivity = (point) => {
    const activity = point?.activity ?? point?.entry?.activity;
    if (typeof activity !== 'string') return '';
    return activity.toLowerCase();
  };

  voyages.forEach((voyage) => {
    if (typeof voyage?.nm === 'number' && Number.isFinite(voyage.nm)) {
      totalDistanceNm += voyage.nm;
    }
    const points = getVoyagePoints(voyage);
    if (!Array.isArray(points) || points.length < 2) return;
    for (let idx = 1; idx < points.length; idx++) {
      const prev = points[idx - 1];
      const curr = points[idx];
      if (shouldSkipConnection(prev, curr)) continue;
      const prevDt = prev?.entry?.datetime || prev?.datetime;
      const currDt = curr?.entry?.datetime || curr?.datetime;
      if (!prevDt || !currDt) continue;
      const prevDate = new Date(prevDt);
      const currDate = new Date(currDt);
      const prevMs = prevDate.getTime();
      const currMs = currDate.getTime();
      if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) continue;
      const gap = currMs - prevMs;
      if (!(gap > 0)) continue;
      const prevAct = readActivity(prev);
      const currAct = readActivity(curr);
      if (activeActivities.has(prevAct) && activeActivities.has(currAct)) {
        totalActiveMs += gap;
        if (prevAct === 'sailing' && currAct === 'sailing') {
          totalSailingMs += gap;
        }
      }
    }
  });

  return { totalDistanceNm, totalActiveMs, totalSailingMs };
}

/**
 * Function: formatDurationMs
 * Description: Convert a duration in milliseconds to a human-readable days, hours, and minutes string.
 * Parameters:
 *   durationMs (number): Duration expressed in milliseconds.
 * Returns: string - Formatted "Xd Yh Zm" duration string.
 */
function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0d 0h 0m';
  const totalMinutes = Math.round(durationMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const remainingMinutes = totalMinutes - (days * 24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
}

/**
 * Function: renderTotalsRow
 * Description: Append a totals row summarising voyage metrics to the voyages table body.
 * Parameters:
 *   tbody (HTMLElement): Table body element that will receive the new totals row.
 *   totals (object): Aggregated voyage totals including distance and activity durations.
 * Returns: void.
 */
function renderTotalsRow(tbody, totals) {
  if (!tbody || !totals) return;
  const totalDistanceNm = Number.isFinite(totals.totalDistanceNm) ? totals.totalDistanceNm : 0;
  const totalActiveMs = Number.isFinite(totals.totalActiveMs) ? totals.totalActiveMs : 0;
  const totalSailingMs = Number.isFinite(totals.totalSailingMs) ? totals.totalSailingMs : 0;
  const sailingPct = totalActiveMs > 0 ? ((totalSailingMs / totalActiveMs) * 100) : 0;
  const row = tbody.insertRow();
  row.classList.add('totals-row');
  row.innerHTML = `
    <td colspan="2" class="idx-cell totals-label">&nbspTotals</td>
    <td colspan="2" class="totals-active">Active Time: ${formatDurationMs(totalActiveMs)}</td>
    <td colspan="2" class="totals-distance">${totalDistanceNm.toFixed(1)} NM</td>
    <td colspan="4" class="totals-sailing">Sailing Time: ${formatDurationMs(totalSailingMs)} (${sailingPct.toFixed(1)}%)</td>
    `;
  row.addEventListener('click', () => {
    resetVoyageSelection();
  });
}

/**
 * Function: clearMaxSpeedMarker
 * Description: Remove the maximum speed marker and popup from the map when present.
 * Parameters: None.
 * Returns: void.
 */
function clearMaxSpeedMarker() {
  if (map && maxMarker) {
    try { map.removeLayer(maxMarker); } catch (_) {}
  }
  maxMarker = null;
}

/**
 * Function: drawMaxSpeedMarkerFromCoord
 * Description: Render the maximum speed marker and popup at the supplied coordinate.
 * Parameters:
 *   coord (number[]): Longitude and latitude pair representing the maximum speed location.
 *   speed (number): Speed over ground in knots to present in the popup.
 * Returns: void.
 */
function drawMaxSpeedMarkerFromCoord(coord, speed) {
  clearMaxSpeedMarker();
  if (!Array.isArray(coord) || coord.length !== 2) return;
  const [lon, lat] = coord;
  maxMarker = L.circleMarker([lat, lon], { color: 'orange', radius: 6 }).addTo(map);
  // Disable autoPan so opening this popup does not move the map
  maxMarker.bindPopup(`Max SoG: ${Number(speed).toFixed(1)} kn`, { autoPan: false, autoClose: false, closeOnClick: false }).openPopup();
  const onMaxSelect = (e) => {
    const clickLL = e.latlng || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0]
      ? map.mouseEventToLatLng(e.originalEvent.touches[0])
      : null);
    if (!clickLL || !Array.isArray(currentVoyagePoints) || currentVoyagePoints.length === 0) return;
    let bestIdx = 0; let bestDist = Infinity;
    for (let i = 0; i < currentVoyagePoints.length; i++) {
      const p = currentVoyagePoints[i];
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const pll = L.latLng(p.lat, p.lon);
      const d = clickLL.distanceTo(pll);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const sel = currentVoyagePoints[bestIdx];
    updateSelectedPoint(sel, { prev: currentVoyagePoints[bestIdx-1], next: currentVoyagePoints[bestIdx+1] });
  };
  maxMarker.on('click', onMaxSelect);
  maxMarker.on('tap', onMaxSelect);
}

// Select a voyage from table or map and set up interactions
/**
 * Function: selectVoyage
 * Description: Activate a voyage selection, updating UI state, map overlays, and browser history.
 * Parameters:
 *   v (object): Voyage record containing geometry and metrics.
 *   row (HTMLTableRowElement): Table row element representing the voyage in the list.
 *   opts (object): Optional behaviour flags such as map fitting and row scrolling.
 * Returns: void.
 */
function selectVoyage(v, row, opts = {}) {
  const { fit = true, scrollIntoView = false } = opts;
  ensureMobileLayoutReadiness();
  ensureMobileMapView();
  // highlight table row
  setSelectedTableRow(row);
  if (scrollIntoView && row && typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  // reset all polylines to default and re-enable voyage selection on blue lines
  polylines.forEach(pl => {
    pl.setStyle({ color: 'blue', weight: 2 });
    if (pl._voySelect) { try { pl.off('click', pl._voySelect); } catch(_) {} pl.on('click', pl._voySelect); }
  });
  // remove previous click handlers and overlays
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();

  // highlight selected voyage
  removeActivePolylines();
  let voyagePoints = getVoyagePoints(v);
  if (!Array.isArray(voyagePoints) || voyagePoints.length === 0) voyagePoints = [];
  let highlightLines = voyagePoints.length >= 2 ? createActivityHighlightPolylines(voyagePoints) : [];
  if (!highlightLines.length) {
    if (v._segments && v._segments.length > 0) {
      v._segments.forEach(seg => {
        seg.polyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_HIGHLIGHT_WEIGHT });
        highlightLines.push(seg.polyline);
      });
    } else if (v._fallbackPolyline) {
      v._fallbackPolyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_HIGHLIGHT_WEIGHT });
      highlightLines = [v._fallbackPolyline];
    }
  }
  activePolylines = highlightLines;
  if (fit && activePolylines.length > 0) {
    let bounds = activePolylines[0].getBounds();
    for (let i = 1; i < activePolylines.length; i++) bounds = bounds.extend(activePolylines[i].getBounds());
    fitMapToBounds(bounds, { deferForMobile: true });
  }

  // update max speed marker
  clearMaxSpeedMarker();

  // clear previous point selection
  if (selectedPointMarker) { map.removeLayer(selectedPointMarker); selectedPointMarker = null; }

  // attach click handler to highlighted track to select nearest point
  currentVoyagePoints = voyagePoints;
  activePolylines.forEach(pl => {
    if (pl._voySelect) { try { pl.off('click', pl._voySelect); } catch(_) {} }
    const onLineClick = (e) => onPolylineClick(e, voyagePoints);
    pl.on('click', onLineClick);
    pl.on('tap', onLineClick);
    activeLineClickers.push({ pl, onLineClick });
  });

  // add tiny markers for all points on highlighted track
  if (Array.isArray(voyagePoints) && voyagePoints.length) {
    activePointMarkersGroup = L.layerGroup();
    voyagePoints.forEach((p, idx) => {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
      const icon = createPointMarkerIcon(p);
      const m = L.marker([p.lat, p.lon], { icon });
      m.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        updateSelectedPoint(p, { prev: voyagePoints[idx-1], next: voyagePoints[idx+1] });
      });
      m.addTo(activePointMarkersGroup);
    });
    activePointMarkersGroup.addTo(map);
  }

  refreshWindOverlay(voyagePoints);
  setWindOverlayToggleAvailability(true);

  if (!suppressHistoryUpdate && historyUpdatesEnabled && typeof v._tripIndex === 'number') {
    updateHistoryForTrip(v._tripIndex, { replace: false });
  }

  setDetailsHint('Click on the highlighted track to inspect a point.');
}

/**
 * Function: findNearestVoyageSelection
 * Description: Locate the voyage point closest to the provided map coordinate.
 * Parameters:
 *   latLng (L.LatLng): Leaflet latitude/longitude representing the user's selection.
 * Returns: object|null - Metadata about the closest voyage point or null when none is suitable.
 */
function findNearestVoyageSelection(latLng) {
  if (!latLng || !Array.isArray(voyageData) || voyageData.length === 0) return null;
  let best = null;
  for (let i = 0; i < voyageData.length; i++) {
    const voyage = voyageData[i];
    const points = getVoyagePoints(voyage);
    if (!Array.isArray(points) || points.length === 0) continue;
    for (let idx = 0; idx < points.length; idx++) {
      const p = points[idx];
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const dist = latLng.distanceTo(L.latLng(p.lat, p.lon));
      if (Number.isNaN(dist)) continue;
      if (!best || dist < best.distance) {
        best = { voyage, row: voyageRows[i], points, index: idx, point: p, distance: dist };
      }
    }
  }
  return best;
}

/**
 * Function: onMapBackgroundClick
 * Description: Handle clicks on the map background to select nearby voyages or points.
 * Parameters:
 *   ev (LeafletMouseEvent): Leaflet event describing the click or tap location.
 * Returns: void.
 */
function onMapBackgroundClick(ev) {
  const latLng = ev?.latlng;
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
  if (nearest.point) updateSelectedPoint(nearest.point, { prev, next });
}

// UI helpers
/**
 * Function: setSelectedTableRow
 * Description: Apply selection styling to a voyage table row while clearing previous selections.
 * Parameters:
 *   row (HTMLTableRowElement|null): Table row to mark as selected.
 * Returns: void.
 */
function setSelectedTableRow(row) {
  document.querySelectorAll('#voyTable tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  if (row) row.classList.add('selected-row');
}

/**
 * Function: resetVoyageSelection
 * Description: Clear any active voyage selection and restore the map to show all voyages.
 * Parameters: None.
 * Returns: void.
 */
function resetVoyageSelection() {
  setSelectedTableRow(null);
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();
  clearWindIntensityLayer();
  removeActivePolylines();
  clearMaxSpeedMarker();
  if (selectedPointMarker && map) {
    try { map.removeLayer(selectedPointMarker); } catch (_) {}
  }
  selectedPointMarker = null;
  currentVoyagePoints = [];
  polylines.forEach(pl => {
    try { pl.setStyle({ color: 'blue', weight: 2 }); } catch (_) {}
  });
  if (map && allVoyagesBounds && typeof allVoyagesBounds.isValid === 'function' && allVoyagesBounds.isValid()) {
    map.fitBounds(allVoyagesBounds);
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
 * Function: clearActivePointMarkers
 * Description: Remove the active point markers layer from the map if present.
 * Parameters: None.
 * Returns: void.
 */
function clearActivePointMarkers() {
  if (activePointMarkersGroup) { map.removeLayer(activePointMarkersGroup); activePointMarkersGroup = null; }
}

/**
 * Function: clearSelectedWindGraphics
 * Description: Remove the wind overlay associated with the selected point.
 * Parameters: None.
 * Returns: void.
 */
function clearSelectedWindGraphics() {
  if (selectedWindGroup) { map.removeLayer(selectedWindGroup); selectedWindGroup = null; }
}

/**
 * Function: nearestHour
 * Description: Round a timestamp to the nearest hour and return the adjusted Date and label.
 * Parameters:
 *   dateStr (string): ISO datetime string to round.
 * Returns: object|string - Object with rounded Date and label or an em dash when invalid.
 */
function nearestHour(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d)) return '—';
  d.setMinutes(d.getMinutes() + 30);
  d.setMinutes(0,0,0);
  let h = d.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return { d, label: `${h}${ampm}` };
}

/**
 * Function: dateHourLabel
 * Description: Format a timestamp into a combined date and nearest-hour label.
 * Parameters:
 *   dateStr (string): ISO datetime string to format.
 * Returns: string - Formatted label or em dash when invalid.
 */
function dateHourLabel(dateStr) {
  const res = nearestHour(dateStr);
  if (res === '—') return res;
  const { d, label } = res;
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
function weekdayShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * Function: arrowSizeFromSpeed
 * Description: Determine a wind arrow icon size scaled by wind speed for readability.
 * Parameters:
 *   kn (number): Wind speed in knots.
 * Returns: number - Size in pixels for the arrow visual.
 */
function arrowSizeFromSpeed(kn) {
  const small = 60;   // ~= 5 kn
  const mid   = 180;  // ~= 25 kn
  const large = 240;  // > 25 kn (emphasized)
  if (!(typeof kn === 'number') || Number.isNaN(kn)) return small;
  if (kn <= 5) return small;
  if (kn >= 25) return large;
  const t = (kn - 5) / 20; // 0..1 across 5..25
  return Math.round(small + t * (mid - small));
}

// Boat + heading helpers
/**
 * Function: makeBoatIcon
 * Description: Create a Leaflet div icon representing the selected vessel at a specific bearing.
 * Parameters:
 *   bearingDeg (number): Heading in degrees for icon rotation.
 * Returns: L.DivIcon - Configured boat icon instance.
 */
function makeBoatIcon(bearingDeg) {
  const w = 18, h = 36; // long triangle
  const html = `
    <div class="boat-icon" style="width:${w}px;height:${h}px;transform: rotate(${bearingDeg.toFixed(1)}deg);">
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <polygon points="${w/2},2 2,${h-2} ${w-2},${h-2}" fill="var(--accent-color, #ef4444)" stroke="#ffffff" stroke-width="1.5" />
      </svg>
    </div>`;
  return L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: [w/2, h/2] });
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
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = (toDeg(θ) + 360) % 360; // 0..360, 0=N
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
 * Function: extractHeadingDegrees
 * Description: Extract a heading measurement from an entry when available.
 * Parameters:
 *   entry (object): Voyage entry containing heading-related properties.
 * Returns: number|undefined - Heading in degrees or undefined when not present.
 */
function extractHeadingDegrees(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const v = entry.heading;
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
  return ((v % 360) + 360) % 360;
}

/**
 * Function: updateSelectedPoint
 * Description: Refresh the selected point marker, wind overlay, and details pane based on the chosen voyage point.
 * Parameters:
 *   sel (object): Selected voyage point containing coordinates and entry data.
 *   neighbors (object): Adjacent voyage points used to infer vessel course information.
 * Returns: void.
 */
function updateSelectedPoint(sel, neighbors = {}) {
  if (!sel || typeof sel.lat !== 'number' || typeof sel.lon !== 'number') return;
  const lat = sel.lat, lon = sel.lon;
  const entry = sel.entry || sel;
  const storedHeading = extractHeadingDegrees(entry);
  const bearing = (typeof storedHeading === 'number')
    ? storedHeading
    : courseFromNeighbors(neighbors.prev, sel, neighbors.next);
  if (!selectedPointMarker) {
    selectedPointMarker = L.marker([lat, lon], { icon: makeBoatIcon(bearing), zIndexOffset: 1000 }).addTo(map);
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
    const c = size / 2;
    const tipY = size * 0.10;
    const headBaseY = tipY + size * 0.125;
    const halfHead = size * 0.075;
    const shaftTopY = tipY + size * 0.075;
    const strokeW = Math.max(2, Math.round(size / 40));
    const html = `
      <div class="wind-arrow" style="width:${size}px;height:${size}px;transform: rotate(${angle}deg);">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <line x1="${c}" y1="${c}" x2="${c}" y2="${shaftTopY}" stroke="#111827" stroke-width="${strokeW}" />
          <polygon points="${c},${tipY} ${c - halfHead},${headBaseY} ${c + halfHead},${headBaseY}" fill="#111827" />
        </svg>
        <div class="wind-speed-label" style="position:absolute;top:0;left:50%;transform:translate(-50%,-4px);">${windSpd.toFixed(1)} kn</div>
      </div>`;
    selectedWindGroup = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html, iconSize: [size,size], iconAnchor: [c,c] }),
      interactive: false
    }).addTo(map);
  }
  renderPointDetails(sel);
}

// Core init and rendering
/**
 * Function: load
 * Description: Fetch voyages data, rebuild map overlays, and refresh the voyage table UI.
 * Parameters:
 *   options (object): Optional flags controlling progress display.
 *     showProgress (boolean): When true and no overlay is active, display loading status.
 *     message (string): Custom loading message displayed while fetching voyage data.
 * Returns: Promise<void> - Resolves when the interface has been refreshed.
 */
async function load(options = {}) {
  const showProgress = options.showProgress !== undefined ? Boolean(options.showProgress) : true;
  const overlayActive = Boolean(loadingOverlay && loadingOverlay.classList.contains('is-active'));
  const shouldManageOverlay = showProgress && !overlayActive;
  const loadingMessage = typeof options.message === 'string' && options.message.trim() !== ''
    ? options.message
    : 'Loading voyages...';
  if (shouldManageOverlay) {
    showLoading(loadingMessage);
  }
  try {
    const res  = await fetch('voyages.json');
    const data = await res.json();

    if (map) { map.off(); map.remove(); }
    polylines = [];
    maxMarker = null;
    windIntensityLayer = null;
    allVoyagesBounds = null;

    map = L.map('map').setView([0, 0], 2);
    createBaseLayer().addTo(map);
    map.on('click', onMapBackgroundClick);
    map.on('tap', onMapBackgroundClick);

    const tbody = document.querySelector('#voyTable tbody');
    tbody.innerHTML = '';
    voyageRows = [];
    voyageData = [];

    // Track overall bounds to fit all voyages when nothing is selected
    let allBounds = null;
    const totals = computeVoyageTotals(data.voyages);

    data.voyages.forEach((v, i) => {
      v._tripIndex = i + 1;
      const avgWindDir = (v.avgWindHeading !== undefined && v.avgWindHeading !== null) ? degToCompass(v.avgWindHeading) : '';
      const row = tbody.insertRow();
      row.dataset.tripIndex = String(i + 1);
      voyageRows.push(row);
      voyageData.push(v);

      const segments = computeDaySegments(v);
      v._segments = segments;
      const isMultiDay = segments.length > 1;
      const expander = isMultiDay ? `<button class="expander-btn" aria-label="Toggle days">[+]</button>` : '';

      row.innerHTML =
        `<td class="exp-cell">${expander}</td><td class="idx-cell">${i+1}</td><td>${dateHourLabel(v.startTime)}</td>
          <td class="end-col">${dateHourLabel(v.endTime)}</td>
          <td>${v.nm.toFixed(1)}</td>
          <td class="max-speed-cell" tabindex="0">${v.maxSpeed.toFixed(1)}<span class="unit-kn"> kn</span></td>
          <td class="avg-speed-col">${v.avgSpeed.toFixed(1)} kn</td>
          <td class="max-wind-cell">${v.maxWind.toFixed(1)}<span class="unit-kn"> kn</span></td>
          <td class="avg-wind-col">${v.avgWindSpeed.toFixed(1)} kn</td>
          <td>${avgWindDir}</td>`;

      const maxSpeedCell = row.querySelector('.max-speed-cell');
      if (maxSpeedCell) {
        const activateMaxSpeedCell = () => {
          const wasSelected = row.classList.contains('selected-row');
          const previousSuppress = suppressHistoryUpdate;
          if (wasSelected) suppressHistoryUpdate = true;
          try {
            selectVoyage(v, row, { fit: wasSelected ? false : true });
          } finally {
            suppressHistoryUpdate = previousSuppress;
          }
          drawMaxSpeedMarkerFromCoord(v.maxSpeedCoord, v.maxSpeed);
        };
        maxSpeedCell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateMaxSpeedCell();
        });
        maxSpeedCell.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            activateMaxSpeedCell();
          }
        });
      }

      let voyageBounds = null;
      if (segments.length > 0) {
        segments.forEach(seg => {
          const latLngs = seg.points.map(p => [p.lat, p.lon]);
          const pl = L.polyline(latLngs, { color: 'blue', weight: 2 }).addTo(map);
          seg.polyline = pl;
          polylines.push(pl);
          const b = pl.getBounds();
          voyageBounds = voyageBounds ? voyageBounds.extend(b) : b;
          const voySelect = (ev) => { L.DomEvent.stopPropagation(ev); selectVoyage(v, row, { fit: false, scrollIntoView: true }); };
          pl.on('click', voySelect);
          pl._voySelect = voySelect;
        });
      } else {
        const latLngs = v.coords.map(([lon, lat]) => [lat, lon]);
        const line = L.polyline(latLngs, { color: 'blue', weight: 2 }).addTo(map);
        polylines.push(line);
        v._fallbackPolyline = line;
        voyageBounds = line.getBounds();
        const voySelect = (ev) => { L.DomEvent.stopPropagation(ev); selectVoyage(v, row, { fit: false, scrollIntoView: true }); };
        line.on('click', voySelect);
        line._voySelect = voySelect;
      }
      // Accumulate global bounds
      if (voyageBounds) allBounds = allBounds ? allBounds.extend(voyageBounds) : voyageBounds;

      row.addEventListener('click', (ev) => {
        // Ignore clicks on the expander button; those toggle day rows only
        if (ev.target && ev.target.classList && ev.target.classList.contains('expander-btn')) return;
        selectVoyage(v, row, { fit: true });
      });

      if (isMultiDay) {
        const dayRows = [];
        let insertIndex = row.sectionRowIndex + 1;
        segments.forEach((seg, idx) => {
          const dr = tbody.insertRow(insertIndex);
          dr.classList.add('day-row', 'hidden');
            const avgWindDirDay = (seg.avgWindHeading !== undefined && seg.avgWindHeading !== null) ? degToCompass(seg.avgWindHeading) : '';
            const dayLbl = weekdayShort(seg.startTime);
            dr.innerHTML = `
            <td class="exp-cell"></td>
            <td class="idx-cell">${dayLbl}</td>
            <td>${dateHourLabel(seg.startTime)}</td>
            <td class="end-col">${dateHourLabel(seg.endTime)}</td>
            <td>${seg.nm.toFixed(1)}</td>
            <td class="max-speed-cell" tabindex="0">${seg.maxSpeed.toFixed(1)}<span class="unit-kn"> kn</span></td>
            <td class="avg-speed-col">${seg.avgSpeed.toFixed(1)} kn</td>
            <td class="max-wind-cell">${seg.maxWind.toFixed(1)}<span class="unit-kn"> kn</span></td>
            <td class="avg-wind-col">${seg.avgWindSpeed.toFixed(1)} kn</td>
            <td>${avgWindDirDay}</td>
            `;

          const handleDayRowClick = () => {
            ensureMobileLayoutReadiness();
            ensureMobileMapView();
            clearMaxSpeedMarker();
            polylines.forEach(pl => pl.setStyle({ color: 'blue', weight: 2 }));
            detachActiveClickers();
            clearActivePointMarkers();
            clearSelectedWindGraphics();
            removeActivePolylines();
            const dayPoints = Array.isArray(seg.points) ? seg.points : [];
            let dayHighlights = dayPoints.length >= 2 ? createActivityHighlightPolylines(dayPoints, { weight: 5 }) : [];
            if (!dayHighlights.length && seg.polyline) {
              seg.polyline.setStyle({ color: SAILING_HIGHLIGHT_COLOR, weight: DEFAULT_HIGHLIGHT_WEIGHT });
              dayHighlights = [seg.polyline];
            }
            activePolylines = dayHighlights;
            if (activePolylines.length > 0) {
              let bounds = activePolylines[0].getBounds();
              for (let i = 1; i < activePolylines.length; i++) bounds = bounds.extend(activePolylines[i].getBounds());
              fitMapToBounds(bounds, { deferForMobile: true });
            }
            if (selectedPointMarker) { map.removeLayer(selectedPointMarker); selectedPointMarker = null; }
            if (activePolylines.length && seg.points && seg.points.length) {
              const onLineClick = (e) => onPolylineClick(e, seg.points);
              activePolylines.forEach(pl => {
                if (pl._voySelect) { try { pl.off('click', pl._voySelect); } catch (_) {} }
                pl.on('click', onLineClick);
                pl.on('tap', onLineClick);
                activeLineClickers.push({ pl, onLineClick });
              });
              activePointMarkersGroup = L.layerGroup();
              seg.points.forEach((p, idx) => {
                if (typeof p.lat === 'number' && typeof p.lon === 'number') {
                  const icon = createPointMarkerIcon(p);
                  const m = L.marker([p.lat, p.lon], { icon });
                  m.on('click', (ev) => {
                    L.DomEvent.stopPropagation(ev);
                    updateSelectedPoint(p, { prev: seg.points[idx-1], next: seg.points[idx+1] });
                  });
                  m.addTo(activePointMarkersGroup);
                }
              });
              activePointMarkersGroup.addTo(map);
            }
            currentVoyagePoints = seg.points || [];
            refreshWindOverlay(dayPoints);
            setWindOverlayToggleAvailability(true);
            setDetailsHint('Click on the highlighted track to inspect a point.');
          };
          dr.addEventListener('click', handleDayRowClick);

          const dayMaxSpeedCell = dr.querySelector('.max-speed-cell');
          if (dayMaxSpeedCell) {
            const activateDayMaxSpeedCell = () => {
              handleDayRowClick();
              drawMaxSpeedMarkerFromCoord(seg.maxSpeedCoord, seg.maxSpeed);
            };
            dayMaxSpeedCell.addEventListener('click', (ev) => {
              ev.stopPropagation();
              activateDayMaxSpeedCell();
            });
            dayMaxSpeedCell.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                ev.stopPropagation();
                activateDayMaxSpeedCell();
              }
            });
          }

          dayRows.push(dr);
          insertIndex += 1;
        });

        const btn = row.querySelector('.expander-btn');
        if (btn) {
          let expanded = false;
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            expanded = !expanded;
            btn.textContent = expanded ? '[-]' : '[+]';
            dayRows.forEach(r => r.classList.toggle('hidden', !expanded));
            if (expanded && dayRows.length) {
              const wrapper = row.closest('.table-wrapper');
              if (wrapper) {
                // Scroll just enough so the day rows are visible
                requestAnimationFrame(() => {
                  const first = dayRows[0];
                  const last = dayRows[dayRows.length - 1];
                  const wr = wrapper.getBoundingClientRect();
                  const fr = first.getBoundingClientRect();
                  const lr = last.getBoundingClientRect();
                  const pad = 8;
                  if (fr.top < wr.top) {
                    wrapper.scrollTop += (fr.top - wr.top) - pad;
                  } else if (lr.bottom > wr.bottom) {
                    wrapper.scrollTop += (lr.bottom - wr.bottom) + pad;
                  }
                });
              }
            }
          });
        }
      }
    });

    renderTotalsRow(tbody, totals);

    if (allBounds && typeof allBounds.isValid === 'function' && allBounds.isValid()) {
      allVoyagesBounds = allBounds;
    } else {
      allVoyagesBounds = null;
    }

    const selectedFromPath = syncVoyageSelectionWithPath({ updateHistory: historyUpdatesEnabled });

    // On initial load/refresh with no selection, fit all voyages
    if (!selectedFromPath && allVoyagesBounds) fitMapToBounds(allVoyagesBounds, { deferForMobile: true });

    // Scroll table to bottom on initial load
    const tableWrapper = document.querySelector('.table-wrapper');
    if (tableWrapper) {
      if (!selectedFromPath) {
        tableWrapper.scrollTop = tableWrapper.scrollHeight;
      }
    }

    const initializingMobileView = !hasInitializedMobileView;
    applyMobileLayout();
    if (initializingMobileView) {
      hasInitializedMobileView = true;
      setActiveMobileView('map');
    }
  } finally {
    if (shouldManageOverlay) {
      hideLoading();
    }
  }
}
// Details panel helpers
/**
 * Function: setDetailsHint
 * Description: Display a hint message within the point details panel and ensure controls are wired.
 * Parameters:
 *   msg (string): Message to present to the user inside the panel.
 * Returns: void.
 */
function setDetailsHint(msg) {
  const panel = document.getElementById('pointDetails');
  panel.style.display = '';
  panel.innerHTML = `
    <div class="floating-header"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="floating-title">Point Details</span><button class="close-details" aria-label="Close">×</button></div>
    <div class="details-body"><em>${msg}</em></div>`;
  wireDetailsControls(panel);
}
/**
 * Function: degToCompassLocal
 * Description: Convert degrees to a localised compass heading used within the details panel.
 * Parameters:
 *   deg (number): Heading in degrees.
 * Returns: string - Compass label representing the supplied heading.
 */
function degToCompassLocal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
/**
 * Function: toDMS
 * Description: Format a latitude or longitude value as degrees, minutes, and seconds.
 * Parameters:
 *   value (number): Coordinate component in decimal degrees.
 *   isLat (boolean): True when formatting a latitude value, false for longitude.
 * Returns: string - Formatted DMS representation or an em dash when invalid.
 */
function toDMS(value, isLat) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = Math.round((minFloat - min) * 60);
  if (sec === 60) { sec = 0; min += 1; }
  if (min === 60) { min = 0; deg += 1; }
  const dir = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return `${deg}°${mm}′${ss}″${dir}`;
}
/**
 * Function: formatPosition
 * Description: Produce a formatted position string that combines latitude and longitude values.
 * Parameters:
 *   lat (number): Latitude in decimal degrees.
 *   lon (number): Longitude in decimal degrees.
 * Returns: string - Combined DMS formatted position.
 */
function formatPosition(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return '—';
  return `${toDMS(lat, true)} ${toDMS(lon, false)}`;
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
    </dl>
  `;
  const raw = `<pre style="white-space: pre-wrap;">${escapeHtml(JSON.stringify(entry, null, 2))}</pre>`;
  panel.style.display = '';
  panel.innerHTML = `
    <div class="floating-header"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="floating-title">Point Details</span><button class="close-details" aria-label="Close">×</button></div>
    <div class="details-body">${summary}<details><summary>Raw data</summary>${raw}</details></div>`;
  wireDetailsControls(panel);
}
/**
 * Function: wireDetailsControls
 * Description: Attach drag and close handlers to the point details floating panel.
 * Parameters:
 *   panel (HTMLElement|null): Panel element containing the point details UI.
 * Returns: void.
 */
function wireDetailsControls(panel) {
  if (!panel) return;
  const closeBtn = panel.querySelector('.close-details');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display = 'none'; });
    closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    closeBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
  }
  const header = panel.querySelector('.floating-header');
  const handleEl = panel.querySelector('.drag-handle') || header;
  const container = document.querySelector('.map-row');
  if (!header || !container) return;
  let startX = 0, startY = 0; let startLeft = 0, startTop = 0;
  const onMouseMove = (e) => doMove(e.clientX, e.clientY);
  const onMouseUp = () => endDrag();
  const onTouchMove = (e) => { if (!e.touches || e.touches.length === 0) return; doMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); };
  const onTouchEnd = () => endDrag();
  const beginDrag = (clientX, clientY) => {
    startX = clientX; startY = clientY;
    const rect = panel.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    startLeft = rect.left - contRect.left;
    startTop = rect.top - contRect.top;
    panel.style.right = 'auto';
    panel.style.left = `${startLeft}px`;
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { once: true });
  };
  const doMove = (clientX, clientY) => {
    const contRect = container.getBoundingClientRect();
    let newLeft = startLeft + (clientX - startX);
    let newTop = startTop + (clientY - startY);
    const maxLeft = contRect.width - panel.offsetWidth - 4;
    const maxTop = contRect.height - panel.offsetHeight - 4;
    if (newLeft < 4) newLeft = 4; if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop < 4) newTop = 4; if (newTop > maxTop) newTop = maxTop;
    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
  };
  const endDrag = () => {
    document.body.classList.remove('resizing');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('touchmove', onTouchMove);
  };
  handleEl.addEventListener('mousedown', (e) => { beginDrag(e.clientX, e.clientY); e.preventDefault(); e.stopPropagation(); });
  handleEl.addEventListener('touchstart', (e) => { if (!e.touches || e.touches.length === 0) return; beginDrag(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); e.stopPropagation(); }, { passive: false });
}
/**
 * Function: escapeHtml
 * Description: Escape HTML-sensitive characters to safely display raw JSON content.
 * Parameters:
 *   str (string): String value to escape.
 * Returns: string - Escaped string safe for HTML insertion.
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Interaction helpers
/**
 * Function: detachActiveClickers
 * Description: Remove click handlers previously attached to active voyage polylines.
 * Parameters: None.
 * Returns: void.
 */
function detachActiveClickers() {
  if (Array.isArray(activeLineClickers)) {
    activeLineClickers.forEach(({ pl, onLineClick }) => { try { pl.off('click', onLineClick); } catch (_) {} });
  }
  activeLineClickers = [];
}
/**
 * Function: onPolylineClick
 * Description: Select the voyage point nearest to the clicked location along a highlighted polyline.
 * Parameters:
 *   e (LeafletMouseEvent): Event emitted by Leaflet when a polyline is clicked or tapped.
 *   points (object[]): Voyage points associated with the active polyline.
 * Returns: void.
 */
function onPolylineClick(e, points) {
  if (!points || points.length === 0) return;
  const clickLL = e.latlng;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let idx = 0; idx < points.length; idx++) {
    const p = points[idx];
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const pll = L.latLng(p.lat, p.lon);
    const d = clickLL.distanceTo(pll);
    if (d < bestDist) { bestDist = d; bestIdx = idx; }
  }
  const sel = points[bestIdx];
  updateSelectedPoint(sel, { prev: points[bestIdx-1], next: points[bestIdx+1] });
}

// Segmentation + math
/**
 * Function: computeDaySegments
 * Description: Break a voyage into daily segments with per-day statistics while respecting stop gaps.
 * Parameters:
 *   v (object): Voyage summary containing point data.
 * Returns: object[] - Ordered segment summaries for each day of the voyage.
 */
function computeDaySegments(v) {
  const pts = Array.isArray(v.points) && v.points.length ? v.points : null;
  if (!pts) return [];
  const byDay = new Map();
  for (const p of pts) {
    const dtStr = p.entry?.datetime || p.datetime;
    if (!dtStr) continue;
    const d = new Date(dtStr);
    if (Number.isNaN(d)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p);
  }
  const keys = Array.from(byDay.keys()).sort();
  const segments = [];
  for (const key of keys) {
    const points = byDay.get(key);
    points.sort((a,b) => new Date(a.entry?.datetime || a.datetime) - new Date(b.entry?.datetime || b.datetime));
    const startTime = points[0]?.entry?.datetime || points[0]?.datetime;
    const endTime = points[points.length-1]?.entry?.datetime || points[points.length-1]?.datetime;
    let nm = 0; let maxSpeed = 0; let maxSpeedCoord = null; let speedSum = 0, speedCount = 0;
    let maxWind = 0; let windSpeedSum = 0, windSpeedCount = 0; const windHeadings = [];
    let totalDurationMs = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const prev = points[i-1];
        const curr = points[i];
        const prevValid = typeof prev?.lat === 'number' && typeof prev?.lon === 'number';
        const currValid = typeof curr?.lat === 'number' && typeof curr?.lon === 'number';
        if (prevValid && currValid && !shouldSkipConnection(prev, curr)) {
          const a = L.latLng(prev.lat, prev.lon);
          const b = L.latLng(curr.lat, curr.lon);
          nm += a.distanceTo(b) / 1852; // meters -> NM
        }
        const prevDt = prev?.entry?.datetime || prev?.datetime;
        const currDt = curr?.entry?.datetime || curr?.datetime;
        if (prevDt && currDt) {
          const prevDate = new Date(prevDt);
          const currDate = new Date(currDt);
          const prevMs = prevDate.getTime();
          const currMs = currDate.getTime();
          if (!Number.isNaN(prevMs) && !Number.isNaN(currMs)) {
            const gap = currMs - prevMs;
            if (Number.isFinite(gap) && gap > 0) {
              totalDurationMs += gap;
            }
          }
        }
      }
      const entry = points[i].entry || points[i];
      const s = entry?.speed?.sog ?? entry?.speed?.stw;
      if (typeof s === 'number') { if (s > maxSpeed) { maxSpeed = s; maxSpeedCoord = [points[i].lon, points[i].lat]; } speedSum += s; speedCount++; }
      const w = entry?.wind?.speed; if (typeof w === 'number') { if (w > maxWind) maxWind = w; windSpeedSum += w; windSpeedCount++; }
      const wd = entry?.wind?.direction; if (typeof wd === 'number') windHeadings.push(wd);
    }
    const totalHours = totalDurationMs > 0 ? (totalDurationMs / (1000 * 60 * 60)) : 0;
    const avgSpeed = totalHours > 0 ? (nm / totalHours) : (speedCount ? (speedSum / speedCount) : 0);
    const avgWindSpeed = windSpeedCount ? (windSpeedSum / windSpeedCount) : 0;
    const avgWindHeading = windHeadings.length ? circularMean(windHeadings) : null;
    segments.push({ dateKey: key, startTime, endTime, nm: parseFloat(nm.toFixed(1)), maxSpeed, avgSpeed, maxWind, avgWindSpeed, avgWindHeading, points, maxSpeedCoord, polyline: null });
  }
  return segments;
}

/**
 * Function: circularMean
 * Description: Compute the average direction of a set of angles in degrees.
 * Parameters:
 *   degrees (number[]): Collection of angles in degrees.
 * Returns: number - Mean direction normalized to [0, 360).
 */
function circularMean(degrees) {
  let sumSin = 0, sumCos = 0;
  for (const d of degrees) { const rad = d * Math.PI / 180; sumSin += Math.sin(rad); sumCos += Math.cos(rad); }
  const avgRad = Math.atan2(sumSin / degrees.length, sumCos / degrees.length);
  let deg = avgRad * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

// Boot
load().then(() => setDetailsHint('Select a voyage, then click the highlighted track to inspect points.')).catch(console.error);

const regenBtn = document.getElementById('regenBtn');
if (regenBtn) {
  regenBtn.addEventListener('click', async () => {
    showLoading('Generating voyages...');
    try {
      console.log(`[voyage-webapp] Triggering voyage regeneration via ${apiBasePath || ''}/generate`);
      const response = await fetch(`${apiBasePath}/generate`, { method: 'GET', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Voyage generation request failed with status ${response.status}`);
      }
      await load();
    } catch (err) {
      console.error('[voyage-webapp] Voyage regeneration failed', err);
      alert('Failed to regenerate voyages. See console for details.');
    } finally {
      hideLoading();
    }
  });
}

const regenPolarBtn = document.getElementById('regenPolarBtn');
if (regenPolarBtn) {
  regenPolarBtn.addEventListener('click', async () => {
    showLoading('Generating polar...');
    try {
      console.log(`[voyage-webapp] Triggering polar regeneration via ${apiBasePath || ''}/generate/polar`);
      const response = await fetch(`${apiBasePath}/generate/polar`, { method: 'GET', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Polar generation request failed with status ${response.status}`);
      }
    } catch (err) {
      console.error('[voyage-webapp] Polar regeneration failed', err);
      alert('Failed to regenerate polar data. See console for details.');
    } finally {
      hideLoading();
    }
  });
}

// Splitter initialization (vertical between map and details, horizontal above map)
/**
 * Function: initSplitters
 * Description: Configure draggable splitters that resize the layout in desktop and touch contexts.
 * Parameters: None.
 * Returns: void.
 */
(function initSplitters() {
  const container = document.querySelector('.container');
  const top = document.querySelector('.top-section');
  const hDivider = document.getElementById('hDivider');
  if (!container || !top || !hDivider) return;

  // Horizontal drag to resize top-section height
  let hDragging = false, hStartY = 0, hStartHeight = 0;
  hDivider.addEventListener('mousedown', (e) => {
    hDragging = true;
    hStartY = e.clientY;
    hStartHeight = top.getBoundingClientRect().height;
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  const onHMove = (clientY) => {
    const dy = clientY - hStartY;
    const containerH = container.getBoundingClientRect().height;
    let newH = hStartHeight + dy;
    const minH = MIN_TOP_SECTION_HEIGHT;
    const dividerHeight = hDivider.getBoundingClientRect().height || 0;
    const maxAvailable = containerH - MIN_MAP_SECTION_HEIGHT - dividerHeight - GRID_ROW_GAP_PX; // keep map visible and respect grid gap
    const maxH = Math.max(minH, maxAvailable);
    if (newH < minH) newH = minH;
    if (newH > maxH) newH = maxH;
    container.style.setProperty('--top-height', `${newH}px`);
    if (typeof map !== 'undefined' && map) map.invalidateSize();
  };
  window.addEventListener('mousemove', (e) => {
    if (!hDragging) return;
    onHMove(e.clientY);
  });
  window.addEventListener('mouseup', () => {
    if (hDragging) {
      hDragging = false;
      document.body.classList.remove('resizing');
      if (typeof map !== 'undefined' && map) map.invalidateSize();
    }
  });

  // Touch support for horizontal divider
  hDivider.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length === 0) return;
    hDragging = true;
    hStartY = e.touches[0].clientY;
    hStartHeight = top.getBoundingClientRect().height;
    document.body.classList.add('resizing');
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!hDragging) return;
    if (!e.touches || e.touches.length === 0) return;
    onHMove(e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', () => {
    if (hDragging) {
      hDragging = false;
      document.body.classList.remove('resizing');
      if (typeof map !== 'undefined' && map) map.invalidateSize();
    }
  });
})();

// Maximize/restore table height
(function initMaxButton() {
  const btn = document.getElementById('toggleMaxBtn');
  const container = document.querySelector('.container');
  const top = document.querySelector('.top-section');
  const wrapper = document.querySelector('.table-wrapper');
  const headerBar = document.querySelector('.header-bar');
  const hDivider = document.getElementById('hDivider');
  if (!btn || !container) return;
  let maximized = false;
  const update = () => {
    if (maximized) {
      // Compute required height to show all rows without inner scroll
      const thead = document.querySelector('#voyTable thead');
      const tbody = document.querySelector('#voyTable tbody');
      const wrapCS = wrapper ? getComputedStyle(wrapper) : null;
      const borders = wrapCS ? (parseFloat(wrapCS.borderTopWidth||'0') + parseFloat(wrapCS.borderBottomWidth||'0')) : 0;
      const paddings = wrapCS ? (parseFloat(wrapCS.paddingTop||'0') + parseFloat(wrapCS.paddingBottom||'0')) : 0;
      const headerH = headerBar ? headerBar.getBoundingClientRect().height : 0;
      const headH = thead ? thead.getBoundingClientRect().height : 0;
      const bodyH = tbody ? tbody.scrollHeight : 0;
      const requiredTop = Math.max(MIN_TOP_SECTION_HEIGHT, Math.ceil(headerH + headH + bodyH + borders + paddings + 2));
      const containerRect = container.getBoundingClientRect();
      const currentTop = top.getBoundingClientRect().height;
      const delta = Math.max(0, requiredTop - currentTop);
      // Increase overall container height so map height stays the same
      container.style.height = `${Math.ceil(containerRect.height + delta)}px`;
      container.style.setProperty('--top-height', `${requiredTop}px`);
      btn.textContent = 'Restore';
      btn.setAttribute('aria-pressed', 'true');
    } else {
      container.style.height = ''; // back to CSS defaults
      container.style.removeProperty('--top-height');
      btn.textContent = 'Maximize';
      btn.setAttribute('aria-pressed', 'false');
    }
    if (typeof map !== 'undefined' && map) map.invalidateSize();
  };
  btn.addEventListener('click', () => {
    maximized = !maximized;
    update();
  });
  update();
})();
