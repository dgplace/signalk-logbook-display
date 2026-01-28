/**
 * Module Responsibilities:
 * - Manage Leaflet map lifecycle, base layers, and initialization.
 * - Handle theme switching and responsive resizing.
 * - Provide core map state and accessors.
 *
 * Exported API:
 * - initializeMap, getMapInstance, fitMapToBounds
 * - setAllVoyagesBounds, getAllVoyagesBounds
 * - apiBasePath, historyUpdatesEnabled
 * - getPreferredColorMode, applyBaseLayerForMode
 * - setMapClickCapture, clearMapClickCapture
 * - getMapClickCaptureHandler
 */

import { registerMapResizeCallback, isMobileLayoutActive } from '../view.js';

// Map state
let mapInstance = null;
let baseTileLayer = null;
let openSeaMapLayer = null;
let openSeaMapEnabled = false;
let themeListenerRegistered = false;
let allVoyagesBounds = null;
let mapClickCaptureHandler = null;

// Constants
const BASE_TILESET_URL_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const BASE_TILESET_URL_DARK = BASE_TILESET_URL_LIGHT;
const BASE_TILESET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const OPENSEAMAP_TILESET_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
const OPENSEAMAP_ATTRIBUTION = '&copy; <a href="https://www.openseamap.org">OpenSeaMap</a> contributors';

const prefersColorSchemeQuery = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

// API base path and history configuration
export const apiBasePath = (() => {
  const pathname = window.location.pathname || '';
  const pluginPrefix = '/plugins/voyage-webapp';
  if (pathname.includes('voyage-webapp')) {
    return pluginPrefix;
  }
  return '';
})();

export const historyUpdatesEnabled = apiBasePath === '';

const basePathname = (() => {
  let path = window.location.pathname || '/';
  if (/\/index\.html?$/i.test(path)) path = path.replace(/\/index\.html?$/i, '/');
  if (/\/[0-9]+\/?$/.test(path)) path = path.replace(/\/[0-9]+\/?$/, '/');
  path = path.replace(/\/+$/, '/');
  if (!path.endsWith('/')) path += '/';
  return path;
})();

/**
 * Function: getBasePathname
 * Description: Get the base pathname for URL construction.
 * Parameters: None.
 * Returns: string - Base pathname for the application.
 */
export function getBasePathname() {
  return basePathname;
}

/**
 * Function: getPreferredColorMode
 * Description: Determine the preferred color scheme based on OS/browser settings.
 * Parameters: None.
 * Returns: string - 'dark' when the user prefers a dark theme, otherwise 'light'.
 */
export function getPreferredColorMode() {
  if (prefersColorSchemeQuery && typeof prefersColorSchemeQuery.matches === 'boolean') {
    return prefersColorSchemeQuery.matches ? 'dark' : 'light';
  }
  return 'light';
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

// DOM references for OpenSeaMap toggle
const openSeaMapToggleInput = document.getElementById('openSeaMapToggle');
const openSeaMapToggleWrapper = openSeaMapToggleInput ? openSeaMapToggleInput.closest('.toggle-switch') : null;

/**
 * Function: createOpenSeaMapLayer
 * Description: Instantiate the Leaflet tile layer for OpenSeaMap nautical overlay.
 * Parameters: None.
 * Returns: L.TileLayer - Tile layer for OpenSeaMap seamark overlay.
 */
function createOpenSeaMapLayer() {
  return L.tileLayer(OPENSEAMAP_TILESET_URL, {
    maxZoom: 18,
    attribution: OPENSEAMAP_ATTRIBUTION,
    opacity: 1
  });
}

/**
 * Function: updateOpenSeaMapToggleUI
 * Description: Sync the OpenSeaMap toggle button state with the current setting.
 * Parameters: None.
 * Returns: void.
 */
function updateOpenSeaMapToggleUI() {
  if (!openSeaMapToggleInput) return;
  openSeaMapToggleInput.checked = openSeaMapEnabled;
  if (openSeaMapToggleWrapper) {
    openSeaMapToggleWrapper.classList.toggle('is-active', openSeaMapEnabled);
  }
}

/**
 * Function: setOpenSeaMapEnabled
 * Description: Toggle the OpenSeaMap overlay visibility.
 * Parameters:
 *   enabled (boolean): When true the overlay is shown on the map.
 * Returns: void.
 */
export function setOpenSeaMapEnabled(enabled) {
  openSeaMapEnabled = Boolean(enabled);
  updateOpenSeaMapToggleUI();
  if (!mapInstance) return;

  if (openSeaMapEnabled) {
    if (!openSeaMapLayer) {
      openSeaMapLayer = createOpenSeaMapLayer();
    }
    if (!mapInstance.hasLayer(openSeaMapLayer)) {
      openSeaMapLayer.addTo(mapInstance);
    }
  } else {
    if (openSeaMapLayer && mapInstance.hasLayer(openSeaMapLayer)) {
      mapInstance.removeLayer(openSeaMapLayer);
    }
  }
}

/**
 * Function: getOpenSeaMapEnabled
 * Description: Get the current OpenSeaMap overlay state.
 * Parameters: None.
 * Returns: boolean - Whether OpenSeaMap overlay is enabled.
 */
export function getOpenSeaMapEnabled() {
  return openSeaMapEnabled;
}

// Wire up OpenSeaMap toggle event
if (openSeaMapToggleInput) {
  openSeaMapToggleInput.addEventListener('change', (event) => {
    setOpenSeaMapEnabled(event.target.checked);
  });
}

/**
 * Function: applyBaseLayerForMode
 * Description: Ensure the map uses a base layer that matches the supplied color mode.
 * Parameters:
 *   mode (string): Target color mode, defaults to light when unrecognised.
 * Returns: void.
 */
export function applyBaseLayerForMode(mode) {
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
 * Function: getMapClickCaptureHandler
 * Description: Get the current map click capture handler.
 * Parameters: None.
 * Returns: Function|null - The current capture handler.
 */
export function getMapClickCaptureHandler() {
  return mapClickCaptureHandler;
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
 *   handleMapBackgroundClick (Function): Handler for default map background click behavior.
 * Returns: L.Map|null - Map instance when created successfully.
 */
export function initializeMap(onBackgroundClick, handleMapBackgroundClick) {
  if (mapInstance) {
    mapInstance.off();
    mapInstance.remove();
  }
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
    if (!handled && typeof handleMapBackgroundClick === 'function') {
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
 * Function: resetMapState
 * Description: Reset all map-related state. Called when reinitializing.
 * Parameters: None.
 * Returns: void.
 */
export function resetMapState() {
  mapInstance = null;
  baseTileLayer = null;
  openSeaMapLayer = null;
  openSeaMapEnabled = false;
  allVoyagesBounds = null;
  mapClickCaptureHandler = null;
}
