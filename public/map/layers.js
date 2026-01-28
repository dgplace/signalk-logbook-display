/**
 * Module Responsibilities:
 * - Manage voyage polyline rendering on the map.
 * - Handle wind overlay and point marker layers.
 * - Provide manual voyage preview and route editing visuals.
 *
 * Exported API:
 * - addVoyageToMap, removeActivePolylines, setActivePolylines
 * - renderActivePointMarkers, clearActivePointMarkers
 * - refreshWindOverlay, setWindOverlayEnabled, setWindOverlayToggleAvailability
 * - clearWindIntensityLayer, clearSelectedWindGraphics
 * - drawManualVoyagePreview, clearManualVoyagePreview
 * - drawMaxSpeedMarkerFromCoord, clearMaxSpeedMarker
 * - highlightLocation, clearHighlightedLocationMarker
 * - restoreBasePolylineStyles, setCurrentVoyagePoints, getCurrentVoyagePoints
 * - getPolylines, getActivePolylines
 */

import { getMapInstance } from './core.js';
import { emit, EVENTS } from '../events.js';
import {
  calculateWindArrowSize,
  createActivityHighlightPolylines,
  createPointMarkerIcon,
  createWindIntensityLayer,
  DEFAULT_ACTIVITY_WEIGHT,
  SAILING_HIGHLIGHT_COLOR
} from '../overlays.js';

// Layer state
let polylines = [];
let activePolylines = [];
let maxMarker = null;
let activePointMarkersGroup = null;
let selectedWindGroup = null;
let windIntensityLayer = null;
let highlightedLocationMarker = null;
let manualVoyagePreviewPolyline = null;
let manualVoyagePreviewArrows = [];
let manualRouteEditHitPolyline = null;
let currentVoyagePoints = [];
let windOverlayEnabled = false;

// Constants
const MANUAL_VOYAGE_COLOR = '#94a3b8';
const ROUTE_EDIT_ACTIVE_COLOR = '#1a9748';
const ROUTE_EDIT_DIM_COLOR = MANUAL_VOYAGE_COLOR;
const ROUTE_EDIT_DIM_OPACITY = 0.4;

// References for external state (set by interaction.js)
let manualRouteEditActive = false;
let manualRouteEditClicker = null;

// DOM references
const windOverlayToggleInput = document.getElementById('windOverlayToggle');
const windOverlayToggleWrapper = windOverlayToggleInput ? windOverlayToggleInput.closest('.toggle-switch') : null;

/**
 * Function: setManualRouteEditState
 * Description: Update the manual route edit state from interaction module.
 * Parameters:
 *   active (boolean): Whether manual route editing is active.
 * Returns: void.
 */
export function setManualRouteEditState(active) {
  manualRouteEditActive = Boolean(active);
}

/**
 * Function: getManualRouteEditActive
 * Description: Get the current manual route edit state.
 * Parameters: None.
 * Returns: boolean - Whether manual route editing is active.
 */
export function getManualRouteEditActive() {
  return manualRouteEditActive;
}

/**
 * Function: setManualRouteEditClicker
 * Description: Set the manual route edit clicker handler reference.
 * Parameters:
 *   clicker (Function|null): The click handler function.
 * Returns: void.
 */
export function setManualRouteEditClicker(clicker) {
  manualRouteEditClicker = clicker;
}

/**
 * Function: getManualRouteEditClicker
 * Description: Get the manual route edit clicker handler reference.
 * Parameters: None.
 * Returns: Function|null - The click handler function.
 */
export function getManualRouteEditClicker() {
  return manualRouteEditClicker;
}

/**
 * Function: getPolylines
 * Description: Get the array of all voyage polylines.
 * Parameters: None.
 * Returns: object[] - Array of polyline layers.
 */
export function getPolylines() {
  return polylines;
}

/**
 * Function: resetPolylines
 * Description: Reset the polylines array.
 * Parameters: None.
 * Returns: void.
 */
export function resetPolylines() {
  polylines = [];
}

/**
 * Function: getActivePolylines
 * Description: Get the array of active highlight polylines.
 * Parameters: None.
 * Returns: object[] - Array of active polyline layers.
 */
export function getActivePolylines() {
  return activePolylines;
}

/**
 * Function: removeActivePolylines
 * Description: Remove all active highlight polylines from the map and reset the tracking array.
 * Parameters: None.
 * Returns: void.
 */
export function removeActivePolylines() {
  const mapInstance = getMapInstance();
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
 * Function: clearWindIntensityLayer
 * Description: Remove the wind intensity overlay from the map when present.
 * Parameters: None.
 * Returns: void.
 */
export function clearWindIntensityLayer() {
  const mapInstance = getMapInstance();
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
  const mapInstance = getMapInstance();
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

// Wire up wind overlay toggle event
if (windOverlayToggleInput) {
  windOverlayToggleInput.addEventListener('change', (event) => {
    setWindOverlayEnabled(event.target.checked);
  });
  setWindOverlayToggleAvailability(false);
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
  const mapInstance = getMapInstance();
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
  const mapInstance = getMapInstance();
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
 * Function: getCurrentVoyagePoints
 * Description: Retrieve the cached points for the active voyage when needed by external consumers.
 * Parameters: None.
 * Returns: object[] - Array of cached points for the active voyage.
 */
export function getCurrentVoyagePoints() {
  return currentVoyagePoints;
}

/**
 * Function: drawMaxSpeedMarkerFromCoord
 * Description: Render the maximum speed marker and popup at the supplied coordinate.
 * Parameters:
 *   coord (number[]): Longitude and latitude pair representing the maximum speed location.
 *   speed (number): Speed over ground in knots to present in the popup.
 *   onMaxSelect (Function): Handler for clicking the max speed marker.
 * Returns: void.
 */
export function drawMaxSpeedMarkerFromCoord(coord, speed, onMaxSelect) {
  const mapInstance = getMapInstance();
  clearMaxSpeedMarker();
  if (!Array.isArray(coord) || coord.length !== 2 || !mapInstance) return;
  const [lon, lat] = coord;
  maxMarker = L.circleMarker([lat, lon], { color: 'orange', radius: 6 }).addTo(mapInstance);
  maxMarker.bindPopup(`Max SoG: ${Number(speed).toFixed(1)} kn`, { autoPan: false, autoClose: false, closeOnClick: false }).openPopup();
  if (typeof onMaxSelect === 'function') {
    maxMarker.on('click', onMaxSelect);
    maxMarker.on('tap', onMaxSelect);
  }
}

/**
 * Function: clearActivePointMarkers
 * Description: Remove the active point markers layer from the map if present.
 * Parameters: None.
 * Returns: void.
 */
export function clearActivePointMarkers() {
  const mapInstance = getMapInstance();
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
  const mapInstance = getMapInstance();
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
  const mapInstance = getMapInstance();
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
  const mapInstance = getMapInstance();
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
 * Function: bearingBetween
 * Description: Calculate the initial bearing from the first coordinate to the second.
 * Parameters:
 *   lat1 (number): Latitude of the starting coordinate.
 *   lon1 (number): Longitude of the starting coordinate.
 *   lat2 (number): Latitude of the destination coordinate.
 *   lon2 (number): Longitude of the destination coordinate.
 * Returns: number|null - Bearing in degrees or null when insufficient data is provided.
 */
export function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const phiOne = toRad(lat1);
  const phiTwo = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phiTwo);
  const x = Math.cos(phiOne) * Math.sin(phiTwo) - Math.sin(phiOne) * Math.cos(phiTwo) * Math.cos(deltaLambda);
  let theta = Math.atan2(y, x);
  theta = (toDeg(theta) + 360) % 360;
  return theta;
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
  const mapInstance = getMapInstance();
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
 * Function: detachManualRouteInsertHandler
 * Description: Remove the route insert click handler from preview layers.
 * Parameters: None.
 * Returns: void.
 */
export function detachManualRouteInsertHandler() {
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
 * Function: clearManualVoyagePreview
 * Description: Remove the manual voyage preview polyline from the map.
 * Parameters: None.
 * Returns: void.
 */
export function clearManualVoyagePreview() {
  const mapInstance = getMapInstance();
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
 * Function: ensureManualRouteEditHitPolyline
 * Description: Maintain an invisible, wide polyline to capture route insert clicks.
 * Parameters:
 *   latLngs (array): Lat/lon pairs for the route line.
 * Returns: void.
 */
export function ensureManualRouteEditHitPolyline(latLngs) {
  const mapInstance = getMapInstance();
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
 * Function: getManualRouteEditHitPolyline
 * Description: Get the manual route edit hit polyline reference.
 * Parameters: None.
 * Returns: object|null - The hit polyline layer.
 */
export function getManualRouteEditHitPolyline() {
  return manualRouteEditHitPolyline;
}

/**
 * Function: getManualVoyagePreviewPolyline
 * Description: Get the manual voyage preview polyline reference.
 * Parameters: None.
 * Returns: object|null - The preview polyline layer.
 */
export function getManualVoyagePreviewPolyline() {
  return manualVoyagePreviewPolyline;
}

/**
 * Function: attachManualRouteInsertHandler
 * Description: Attach a click handler to insert route points along the preview line.
 * Parameters:
 *   insertHandler (Function): Handler to call when inserting a point.
 * Returns: void.
 */
export function attachManualRouteInsertHandler(insertHandler) {
  if (!manualRouteEditActive || !manualVoyagePreviewPolyline) return;
  detachManualRouteInsertHandler();
  manualRouteEditClicker = (event) => {
    if (!event?.latlng) return;
    L.DomEvent.stopPropagation(event);
    if (typeof insertHandler === 'function') {
      insertHandler(event.latlng);
    }
  };
  const target = manualRouteEditHitPolyline || manualVoyagePreviewPolyline;
  target.on('click', manualRouteEditClicker);
  target.on('tap', manualRouteEditClicker);
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
  const mapInstance = getMapInstance();
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
  }
}

/**
 * Function: updateManualVoyagePreviewLatLngs
 * Description: Update the manual voyage preview polyline coordinates.
 * Parameters:
 *   latLngs (array): New lat/lon pairs for the preview line.
 * Returns: void.
 */
export function updateManualVoyagePreviewLatLngs(latLngs) {
  if (manualVoyagePreviewPolyline) {
    manualVoyagePreviewPolyline.setLatLngs(latLngs);
  }
}

/**
 * Function: renderActivePointMarkers
 * Description: Display clickable point markers for the supplied voyage point collection.
 * Parameters:
 *   points (object[]): Voyage points to visualise on the map.
 *   onPointClick (Function): Handler for clicking a point marker.
 * Returns: void.
 */
export function renderActivePointMarkers(points, onPointClick) {
  const mapInstance = getMapInstance();
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
      if (typeof onPointClick === 'function') {
        onPointClick(point, idx, points);
      }
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
  const mapInstance = getMapInstance();
  if (selectedWindGroup && mapInstance) {
    mapInstance.removeLayer(selectedWindGroup);
  }
  selectedWindGroup = null;
}

/**
 * Function: renderSelectedWindGraphics
 * Description: Render wind arrow graphics for a selected point.
 * Parameters:
 *   lat (number): Latitude of the point.
 *   lon (number): Longitude of the point.
 *   windSpd (number): Wind speed in knots.
 *   windDir (number): Wind direction in degrees.
 * Returns: void.
 */
export function renderSelectedWindGraphics(lat, lon, windSpd, windDir) {
  const mapInstance = getMapInstance();
  clearSelectedWindGraphics();
  if (!mapInstance || typeof windSpd !== 'number' || typeof windDir !== 'number') return;

  const adjustedDir = (windDir + 180) % 360;
  const angle = adjustedDir.toFixed(1);
  const size = calculateWindArrowSize(windSpd);
  const center = size / 2;
  const tipY = 6;
  const headLength = 10;
  const halfHead = 6;
  const headBaseY = tipY + headLength;
  const shaftTopY = tipY + Math.round(headLength * 0.6);
  const strokeW = 2;

  // Get CSS variable value
  const getCssVariableValue = (name) => {
    if (typeof window === 'undefined' || !window.getComputedStyle) return '';
    const root = document.documentElement;
    if (!root) return '';
    const styles = window.getComputedStyle(root);
    return (styles.getPropertyValue(name) || '').trim();
  };

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
 * Function: getWindIntensityLayer
 * Description: Get the current wind intensity layer.
 * Parameters: None.
 * Returns: object|null - The wind intensity layer.
 */
export function getWindIntensityLayer() {
  return windIntensityLayer;
}

/**
 * Function: getActivePointMarkersGroup
 * Description: Get the active point markers group.
 * Parameters: None.
 * Returns: object|null - The active point markers layer group.
 */
export function getActivePointMarkersGroup() {
  return activePointMarkersGroup;
}

/**
 * Function: getSelectedWindGroup
 * Description: Get the selected wind graphics group.
 * Parameters: None.
 * Returns: object|null - The selected wind graphics layer.
 */
export function getSelectedWindGroup() {
  return selectedWindGroup;
}

/**
 * Function: getMaxMarker
 * Description: Get the max speed marker.
 * Parameters: None.
 * Returns: object|null - The max speed marker.
 */
export function getMaxMarker() {
  return maxMarker;
}

/**
 * Function: resetLayerState
 * Description: Reset all layer-related state. Called when reinitializing.
 * Parameters: None.
 * Returns: void.
 */
export function resetLayerState() {
  polylines = [];
  activePolylines = [];
  maxMarker = null;
  activePointMarkersGroup = null;
  selectedWindGroup = null;
  windIntensityLayer = null;
  highlightedLocationMarker = null;
  manualVoyagePreviewPolyline = null;
  manualVoyagePreviewArrows = [];
  manualRouteEditHitPolyline = null;
  currentVoyagePoints = [];
  manualRouteEditActive = false;
  manualRouteEditClicker = null;
}
