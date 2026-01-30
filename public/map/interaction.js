/**
 * Module Responsibilities:
 * - Handle voyage selection and point interactions.
 * - Manage click handlers for polylines and map background.
 * - Coordinate manual route editing state.
 *
 * Exported API:
 * - selectVoyage, resetVoyageSelection, updateSelectedPoint
 * - handleMapBackgroundClick, wirePolylineSelectionHandlers
 * - updateHistoryForTrip, setDetailsHint
 * - detachActiveClickers
 * - setManualRouteEditing, syncManualRouteEditor
 */

import { getMapInstance, fitMapToBounds, getAllVoyagesBounds, historyUpdatesEnabled, getBasePathname } from './core.js';
import {
  removeActivePolylines,
  setActivePolylines,
  clearActivePointMarkers,
  clearSelectedWindGraphics,
  clearWindIntensityLayer,
  clearHighlightedLocationMarker,
  clearManualVoyagePreview,
  clearMaxSpeedMarker,
  restoreBasePolylineStyles,
  setCurrentVoyagePoints,
  getCurrentVoyagePoints,
  refreshWindOverlay,
  setWindOverlayToggleAvailability,
  renderActivePointMarkers,
  drawManualVoyagePreview,
  drawManualRouteArrows,
  ensureManualRouteEditHitPolyline,
  attachManualRouteInsertHandler,
  detachManualRouteInsertHandler,
  setManualRouteEditState,
  getManualRouteEditActive,
  getPolylines,
  getActivePolylines,
  bearingBetween,
  drawMaxSpeedMarkerFromCoord,
  drawMaxWindMarkerFromCoord,
  renderSelectedWindGraphics,
  getActivePointMarkersGroup,
  getSelectedWindGroup,
  getMaxMarker,
  getWindIntensityLayer,
  highlightLocation,
  updateManualVoyagePreviewLatLngs,
  getManualVoyagePreviewPolyline,
  getManualRouteEditHitPolyline
} from './layers.js';
import { emit, on, EVENTS } from '../events.js';
import { getVoyageData, getVoyageRows } from '../table.js';
import { getVoyagePoints, getPointActivity, buildPointKey, updateLocalOverride } from '../data.js';
import { apiBasePath } from './core.js';
import {
  ensureMobileLayoutReadiness,
  ensureMobileMapView
} from '../view.js';
import {
  degToCompassLocal,
  extractHeadingDegrees,
  formatPosition
} from '../util.js';
import {
  createActivityHighlightPolylines,
  createBoatIcon,
  DEFAULT_ACTIVITY_WEIGHT,
  SAILING_HIGHLIGHT_COLOR
} from '../overlays.js';

// Interaction state
let activeLineClickers = [];
let selectedPointMarker = null;
let suppressHistoryUpdate = false;

// Manual route editing state
let manualRouteEditLayer = null;
let manualRouteEditMarkers = [];
let manualRouteEditPoints = [];
let manualRouteEditTurnIndex = null;
let manualRouteEditCloseLoop = true;
let manualRouteEditLegIndex = null;
let manualRouteHiddenLayers = null;
let manualRouteDimmedLayers = null;
let skipNextManualPreview = false;
let manualPreviewRoutePoints = null;
let manualPreviewCloseLoop = false;

// Constants
const MAP_CLICK_SELECT_THRESHOLD_METERS = 1500;
const ROUTE_EDIT_DIM_COLOR = '#94a3b8';
const ROUTE_EDIT_DIM_OPACITY = 0.4;

/**
 * Function: getMapClickThreshold
 * Description: Expose the selection distance threshold for external calculations.
 * Parameters: None.
 * Returns: number - Threshold in meters.
 */
export function getMapClickThreshold() {
  return MAP_CLICK_SELECT_THRESHOLD_METERS;
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
  const basePathname = getBasePathname();
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
 * Function: wireDetailsControls
 * Description: Attach control handlers to the details panel for closing and dragging affordances.
 * Parameters:
 *   panel (HTMLElement): Details panel element.
 * Returns: void.
 */
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

// Store reference to currently displayed point for activity change handler
let currentDetailsPoint = null;

/**
 * Function: getOriginalPointActivity
 * Description: Get the original activity value from a point, ignoring any overrides.
 * Parameters:
 *   point (object): Voyage point to inspect.
 * Returns: string - Original activity label or 'sailing' as default.
 */
function getOriginalPointActivity(point) {
  const activity = point?.activity ?? point?.entry?.activity;
  if (activity === 'sailing' || activity === 'motoring' || activity === 'anchored') return activity;
  return 'sailing';
}

/**
 * Function: saveActivityOverride
 * Description: Save an activity override to the server and update local state.
 * Parameters:
 *   point (object): Voyage point being modified.
 *   newActivity (string): New activity value to save.
 * Returns: Promise<boolean> - True when the save succeeded.
 */
async function saveActivityOverride(point, newActivity) {
  const key = buildPointKey(point);
  if (!key) {
    console.error('[voyage-webapp] Cannot save activity override: invalid point key');
    return false;
  }
  const originalActivity = getOriginalPointActivity(point);
  const base = typeof apiBasePath === 'string' ? apiBasePath.replace(/\/$/, '') : '';
  const url = base ? `${base}/activity-overrides` : 'activity-overrides';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ key, activity: newActivity, originalActivity })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }
    updateLocalOverride(key, newActivity, originalActivity);
    return true;
  } catch (err) {
    console.error('[voyage-webapp] Failed to save activity override:', err);
    return false;
  }
}

/**
 * Function: wireActivitySelectHandler
 * Description: Attach change listener to the activity dropdown in the point details panel.
 * Parameters:
 *   point (object): Voyage point associated with the dropdown.
 * Returns: void.
 */
function wireActivitySelectHandler(point) {
  const select = document.getElementById('pointActivitySelect');
  if (!select) return;
  select.addEventListener('change', async (event) => {
    const newActivity = event.target.value;
    if (!newActivity) return;
    select.disabled = true;
    const success = await saveActivityOverride(point, newActivity);
    select.disabled = false;
    if (success) {
      emit(EVENTS.ACTIVITY_OVERRIDE_CHANGED, { point, activity: newActivity });
    } else {
      // Revert to current value on failure
      select.value = getPointActivity(point);
    }
  });
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
  currentDetailsPoint = point;
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
  const currentActivity = getPointActivity(point);
  const pointKey = buildPointKey(point);
  const activityDropdown = pointKey
    ? `<select id="pointActivitySelect" data-point-key="${escapeHtml(pointKey)}">
        <option value="anchored"${currentActivity === 'anchored' ? ' selected' : ''}>Anchored</option>
        <option value="motoring"${currentActivity === 'motoring' ? ' selected' : ''}>Motoring</option>
        <option value="sailing"${currentActivity === 'sailing' ? ' selected' : ''}>Sailing</option>
      </select>`
    : escapeHtml(currentActivity);
  const summary = `
    <dl class="point-details">
      <div class="row"><dt>Time</dt><dd>${when}</dd></div>
      ${locationRow}
      <div class="row"><dt>Position</dt><dd>${posStr}</dd></div>
      <div class="row"><dt>SOG</dt><dd>${typeof sog === 'number' ? sog.toFixed(2) + ' kn' : '—'}</dd></div>
      <div class="row"><dt>STW</dt><dd>${typeof stw === 'number' ? stw.toFixed(2) + ' kn' : '—'}</dd></div>
      <div class="row"><dt>Wind</dt><dd>${typeof windSpd === 'number' ? windSpd.toFixed(2) + ' kn' : '—'} @ ${windDirTxt}</dd></div>
      <div class="row"><dt>Activity</dt><dd>${activityDropdown}</dd></div>
    </dl>`;
  panel.style.display = '';
  body.innerHTML = summary;
  wireDetailsControls(panel);
  wireActivitySelectHandler(point);
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
  const mapInstance = getMapInstance();
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
  const windDir = entry?.wind?.direction;
  if (typeof windSpd === 'number' && typeof windDir === 'number') {
    renderSelectedWindGraphics(lat, lon, windSpd, windDir);
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
 * Function: resetVoyageSelection
 * Description: Clear any active voyage selection and restore the map to show all voyages.
 * Parameters: None.
 * Returns: void.
 */
export function resetVoyageSelection() {
  const mapInstance = getMapInstance();
  const allVoyagesBounds = getAllVoyagesBounds();
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
  setCurrentVoyagePoints([]);
  // Clear any lingering route edit state
  manualRouteDimmedLayers = null;
  manualRouteHiddenLayers = null;
  restoreBasePolylineStyles();
  if (mapInstance && allVoyagesBounds && typeof allVoyagesBounds.isValid === 'function' && allVoyagesBounds.isValid()) {
    mapInstance.fitBounds(allVoyagesBounds);
  }
  setWindOverlayToggleAvailability(false);
  if (historyUpdatesEnabled && window.history && typeof window.history.replaceState === 'function') {
    const basePathname = getBasePathname();
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    window.history.replaceState({}, '', `${basePathname}${search}${hash}`);
  }
  setDetailsHint('Select a voyage, then click track to inspect.');
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
  if (getManualRouteEditActive()) return;
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
  const mapInstance = getMapInstance();
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
  // Close the loop for return trips (day trips) so all segments are highlighted
  const isReturnTrip = Boolean(voyage?.returnTrip);
  let highlightLines = (mapInstance && voyagePoints.length >= 2)
    ? createActivityHighlightPolylines(mapInstance, voyagePoints, { closeLoop: isReturnTrip })
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
  const activePolylines = getActivePolylines();
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

  setCurrentVoyagePoints(voyagePoints);
  wirePolylineSelectionHandlers(activePolylines, voyagePoints);

  renderActivePointMarkers(voyagePoints, (point, idx, points) => {
    updateSelectedPoint(point, { prev: points[idx - 1], next: points[idx + 1] });
  });

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

  setDetailsHint('Click track to inspect a point.');
}

/**
 * Function: focusSegment
 * Description: Highlight a voyage leg segment, wiring point interactions and map fitting.
 * Parameters:
 *   segment (object): Segment descriptor containing points and optional polyline reference.
 *   options (object): Optional overrides for highlight styling.
 * Returns: void.
 */
export function focusSegment(segment, options = {}) {
  const mapInstance = getMapInstance();
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
  // Close the loop for return trip segments (day trips) so all segments are highlighted
  const closeLoop = Boolean(segment?.closeLoop);
  let segmentHighlights = (mapInstance && segmentPoints.length >= 2)
    ? createActivityHighlightPolylines(mapInstance, segmentPoints, { weight: highlightWeight, closeLoop })
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
  renderActivePointMarkers(segmentPoints, (point, idx, points) => {
    updateSelectedPoint(point, { prev: points[idx - 1], next: points[idx + 1] });
  });
  refreshWindOverlay(segmentPoints);
  setWindOverlayToggleAvailability(true);
  setDetailsHint('Click track to inspect a point.');
}

/**
 * Function: findNearestVoyageSelection
 * Description: Find the nearest voyage point to a given location.
 * Parameters:
 *   latLng (object): Leaflet LatLng object.
 * Returns: object|null - Selection info or null if none found.
 */
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

/**
 * Function: handleMapBackgroundClick
 * Description: Handle clicks on the map background to select nearby voyages.
 * Parameters:
 *   event (object): Leaflet click event.
 * Returns: void.
 */
export function handleMapBackgroundClick(event) {
  if (getManualRouteEditActive()) return;
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

// Manual route editing functions

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
 * Function: isSameCoordinate
 * Description: Compare two latitude/longitude pairs with a small tolerance.
 * Parameters:
 *   a (object): First coordinate with lat/lon values.
 *   b (object): Second coordinate with lat/lon values.
 *   epsilon (number): Optional tolerance for coordinate comparisons.
 * Returns: boolean - True when the coordinates are effectively the same.
 */
function isSameCoordinate(a, b, epsilon = 1e-6) {
  if (!a || !b) return false;
  const latA = Number(a.lat);
  const lonA = Number(a.lon);
  const latB = Number(b.lat);
  const lonB = Number(b.lon);
  if (!Number.isFinite(latA) || !Number.isFinite(lonA) || !Number.isFinite(latB) || !Number.isFinite(lonB)) return false;
  return Math.abs(latA - latB) <= epsilon && Math.abs(lonA - lonB) <= epsilon;
}

/**
 * Function: stitchLegRoutePoints
 * Description: Stitch together per-leg route points from manual locations.
 * Parameters:
 *   locations (object[]): Manual location list with lat/lon and optional routePoints.
 * Returns: object[]|null - Continuous route points or null when invalid.
 */
function stitchLegRoutePoints(locations) {
  if (!Array.isArray(locations) || locations.length < 2) return null;
  const result = [];
  for (let i = 0; i < locations.length - 1; i += 1) {
    const current = locations[i];
    const next = locations[i + 1];
    if (!current || !next) continue;
    const currentLat = Number(current.lat);
    const currentLon = Number(current.lon);
    const nextLat = Number(next.lat);
    const nextLon = Number(next.lon);
    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLon) ||
        !Number.isFinite(nextLat) || !Number.isFinite(nextLon)) continue;
    let legPoints = null;
    if (Array.isArray(current.routePoints) && current.routePoints.length >= 2) {
      const normalized = normalizeRoutePoints(current.routePoints);
      if (normalized) {
        normalized[0] = { lat: currentLat, lon: currentLon };
        normalized[normalized.length - 1] = { lat: nextLat, lon: nextLon };
        legPoints = normalized;
      }
    }
    if (!legPoints) {
      legPoints = [
        { lat: currentLat, lon: currentLon },
        { lat: nextLat, lon: nextLon }
      ];
    }
    if (result.length) {
      const lastPoint = result[result.length - 1];
      const firstPoint = legPoints[0];
      if (isSameCoordinate(lastPoint, firstPoint)) {
        result.push(...legPoints.slice(1));
        continue;
      }
    }
    result.push(...legPoints);
  }
  return result.length >= 2 ? result : null;
}

/**
 * Function: createManualRouteMarkerIcon
 * Description: Build a Leaflet div icon for manual route point markers.
 * Parameters:
 *   kind (string): Marker kind ("start", "turn", "end", or "via").
 * Returns: object - Leaflet divIcon instance.
 */
function createManualRouteMarkerIcon(kind) {
  let label = '';
  if (kind === 'start') label = 'S';
  else if (kind === 'turn') label = 'T';
  else if (kind === 'end') label = 'E';
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
  const mapInstance = getMapInstance();
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
  const mapInstance = getMapInstance();
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
  const polylines = getPolylines();
  const activePolylines = getActivePolylines();
  (polylines || []).forEach(dimLayer);
  (activePolylines || []).forEach(dimLayer);
  hideLayer(getActivePointMarkersGroup());
  hideLayer(selectedPointMarker);
  hideLayer(getMaxMarker());
  hideLayer(getSelectedWindGroup());
  hideLayer(getWindIntensityLayer());
  manualRouteHiddenLayers = Array.from(hidden);
  manualRouteDimmedLayers = dimmed;
}

/**
 * Function: restoreVoyageLayersAfterRouteEdit
 * Description: Restore voyage layers hidden during manual loop editing.
 * Parameters:
 *   options (object): Optional flags controlling restoration behavior.
 * Returns: void.
 */
function restoreVoyageLayersAfterRouteEdit(options = {}) {
  const { restorePolylineStyles = false } = options;
  const mapInstance = getMapInstance();
  if (!mapInstance) return;
  if (manualRouteDimmedLayers && restorePolylineStyles) {
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
 * Function: updateManualRoutePreviewFromEditor
 * Description: Refresh the preview polyline and arrows while editing the route.
 * Parameters: None.
 * Returns: void.
 */
function updateManualRoutePreviewFromEditor() {
  if (!getManualRouteEditActive() || !Array.isArray(manualRouteEditPoints) || manualRouteEditPoints.length < 2) return;
  if (!getManualVoyagePreviewPolyline()) {
    drawManualVoyagePreview(manualRouteEditPoints, { closeLoop: manualRouteEditCloseLoop, showDirection: true });
    return;
  }
  const latLngs = buildRouteLatLngs(manualRouteEditPoints, manualRouteEditCloseLoop);
  updateManualVoyagePreviewLatLngs(latLngs);
  ensureManualRouteEditHitPolyline(latLngs);
  drawManualRouteArrows(manualRouteEditPoints, manualRouteEditCloseLoop);
}

/**
 * Function: emitManualRouteUpdated
 * Description: Emit route updates from map edits back to the manual form.
 * Parameters: None.
 * Returns: void.
 */
function emitManualRouteUpdated() {
  if (!getManualRouteEditActive()) return;
  emit(EVENTS.MANUAL_ROUTE_UPDATED, {
    points: manualRouteEditPoints.map(point => ({ lat: point.lat, lon: point.lon })),
    turnIndex: manualRouteEditTurnIndex,
    legIndex: manualRouteEditLegIndex,
    closeLoop: manualRouteEditCloseLoop
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
 * Description: Find the best insertion index for a new point along the route.
 * Parameters:
 *   latLng (object): Leaflet latlng for the insertion location.
 *   points (object[]): Normalized route points.
 * Returns: number|null - Insert index or null when unavailable.
 */
function findRouteInsertIndex(latLng, points) {
  const mapInstance = getMapInstance();
  if (!mapInstance || !Array.isArray(points) || points.length < 2) return null;
  const screenPoint = mapInstance.latLngToLayerPoint(latLng);
  let bestIndex = null;
  let bestDistance = Infinity;
  // For closed loops, include segment from last to first; for open, only consecutive segments
  const totalSegments = manualRouteEditCloseLoop ? points.length : points.length - 1;
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
  if (!getManualRouteEditActive() || !Array.isArray(manualRouteEditPoints)) return;
  const insertIndex = findRouteInsertIndex(latLng, manualRouteEditPoints);
  if (insertIndex === null) return;
  manualRouteEditPoints.splice(insertIndex, 0, { lat: latLng.lat, lon: latLng.lng });
  if (manualRouteEditCloseLoop && insertIndex <= manualRouteEditTurnIndex) {
    manualRouteEditTurnIndex += 1;
    manualRouteEditTurnIndex = clampRouteTurnIndex(manualRouteEditTurnIndex, manualRouteEditPoints.length);
  }
  updateManualRoutePreviewFromEditor();
  renderManualRouteEditMarkers();
  emitManualRouteUpdated();
}

/**
 * Function: renderManualRouteEditMarkers
 * Description: Render draggable markers for each manual route point.
 * Parameters: None.
 * Returns: void.
 */
function renderManualRouteEditMarkers() {
  const mapInstance = getMapInstance();
  clearManualRouteEditLayer();
  if (!mapInstance || !getManualRouteEditActive() || !Array.isArray(manualRouteEditPoints)) return;
  manualRouteEditLayer = L.layerGroup();
  const lastIndex = manualRouteEditPoints.length - 1;
  manualRouteEditMarkers = manualRouteEditPoints.map((point, index) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;

    // Determine marker kind based on mode (closed loop vs open segment)
    let kind = 'via';
    if (index === 0) {
      kind = 'start';
    } else if (manualRouteEditCloseLoop && index === manualRouteEditTurnIndex) {
      kind = 'turn';
    } else if (!manualRouteEditCloseLoop && index === lastIndex) {
      kind = 'end';
    }

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
      // Protect start and end points
      if (index === 0) return;
      if (manualRouteEditCloseLoop && index === manualRouteEditTurnIndex) return;
      if (!manualRouteEditCloseLoop && index === lastIndex) return;

      manualRouteEditPoints.splice(index, 1);
      if (manualRouteEditCloseLoop && index < manualRouteEditTurnIndex) {
        manualRouteEditTurnIndex -= 1;
      }
      if (manualRouteEditCloseLoop) {
        manualRouteEditTurnIndex = clampRouteTurnIndex(manualRouteEditTurnIndex, manualRouteEditPoints.length);
      }
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
 *   turnIndex (number): Index of the turnaround point (for closed loops).
 *   options (object): Optional settings including closeLoop and legIndex.
 * Returns: void.
 */
export function setManualRouteEditing(active, points, turnIndex, options = {}) {
  if (!active) {
    setManualRouteEditState(false);
    manualRouteEditPoints = [];
    manualRouteEditTurnIndex = null;
    manualRouteEditCloseLoop = true;
    manualRouteEditLegIndex = null;
    clearManualRouteEditLayer();
    detachManualRouteInsertHandler();
    clearManualVoyagePreview();
    const mapInstance = getMapInstance();
    const hitPolyline = getManualRouteEditHitPolyline();
    if (hitPolyline && mapInstance) {
      mapInstance.removeLayer(hitPolyline);
    }
    // Remove active highlight polylines as they show the old data
    removeActivePolylines();
    // Don't restore dimmed layers - just clear the state
    // The preview will show the current route
    manualRouteDimmedLayers = null;
    manualRouteHiddenLayers = null;
    return;
  }
  const normalized = normalizeRoutePoints(points);
  if (!normalized || normalized.length < 2) {
    setManualRouteEditState(false);
    clearManualRouteEditLayer();
    restoreVoyageLayersAfterRouteEdit();
    return;
  }
  setManualRouteEditState(true);
  manualRouteEditPoints = normalized;
  manualRouteEditCloseLoop = options.closeLoop !== false;
  manualRouteEditLegIndex = Number.isInteger(options.legIndex) ? options.legIndex : null;
  manualRouteEditTurnIndex = manualRouteEditCloseLoop ? clampRouteTurnIndex(turnIndex, normalized.length) : null;
  hideVoyageLayersForRouteEdit();
  drawManualVoyagePreview(manualRouteEditPoints, { closeLoop: manualRouteEditCloseLoop, showDirection: true });
  attachManualRouteInsertHandler(insertRoutePoint);
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
export function syncManualRouteEditor(points, turnIndex) {
  if (!getManualRouteEditActive()) return;
  const normalized = normalizeRoutePoints(points);
  if (!normalized || normalized.length < 2) return;
  manualRouteEditPoints = normalized;
  manualRouteEditTurnIndex = clampRouteTurnIndex(turnIndex, normalized.length);
  renderManualRouteEditMarkers();
}

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

// Event handlers

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
    const currentVoyagePoints = getCurrentVoyagePoints();
    const onMaxSelect = (e) => {
      if (getManualRouteEditActive()) return;
      const clickLL = e.latlng || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0]
        ? getMapInstance().mouseEventToLatLng(e.originalEvent.touches[0])
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
    drawMaxSpeedMarkerFromCoord(payload.coord, payload.speed, onMaxSelect);
  }
}

/**
 * Function: findMaxWindPoint
 * Description: Locate the point with the highest recorded wind speed.
 * Parameters:
 *   points (object[]): Ordered voyage points containing wind metadata.
 * Returns: object|null - Object with coord and windSpeed or null when unavailable.
 */
function findMaxWindPoint(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let maxWind = -Infinity;
  let coord = null;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const windSpeed = point?.windSpeed ?? point?.wind?.speed ?? point?.entry?.wind?.speed;
    if (!Number.isFinite(windSpeed)) continue;
    if (windSpeed <= maxWind) continue;
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) continue;
    maxWind = windSpeed;
    coord = [point.lon, point.lat];
  }
  if (!Number.isFinite(maxWind) || !coord) return null;
  return { coord, windSpeed: maxWind };
}

/**
 * Function: handleVoyageMaxWindRequested
 * Description: Respond to a voyage max-wind request by selecting the voyage and placing the marker.
 * Parameters:
 *   payload (object): Descriptor including voyage, row, coordinate pair, and wind speed value.
 * Returns: void.
 */
function handleVoyageMaxWindRequested(payload = {}) {
  performVoyageSelection(payload);
  const currentVoyagePoints = getCurrentVoyagePoints();
  const maxWind = findMaxWindPoint(currentVoyagePoints);
  if (!maxWind) return;
  const onMaxSelect = (e) => {
    if (getManualRouteEditActive()) return;
    const clickLL = e.latlng || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0]
      ? getMapInstance().mouseEventToLatLng(e.originalEvent.touches[0])
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
  drawMaxWindMarkerFromCoord(maxWind.coord, maxWind.windSpeed, onMaxSelect);
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
    const currentVoyagePoints = getCurrentVoyagePoints();
    const onMaxSelect = (e) => {
      if (getManualRouteEditActive()) return;
      const clickLL = e.latlng;
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
    drawMaxSpeedMarkerFromCoord(payload.coord, payload.speed, onMaxSelect);
  }
}

/**
 * Function: handleSegmentMaxWindRequested
 * Description: Focus a segment and display its maximum wind marker when requested.
 * Parameters:
 *   payload (object): Descriptor containing voyage, segment, coordinate, and wind speed details.
 * Returns: void.
 */
function handleSegmentMaxWindRequested(payload = {}) {
  handleSegmentSelectRequested(payload);
  const currentVoyagePoints = getCurrentVoyagePoints();
  const maxWind = findMaxWindPoint(currentVoyagePoints);
  if (!maxWind) return;
  const onMaxSelect = (e) => {
    if (getManualRouteEditActive()) return;
    const clickLL = e.latlng;
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
  drawMaxWindMarkerFromCoord(maxWind.coord, maxWind.windSpeed, onMaxSelect);
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
  // Skip if we just created highlight polylines from route editing
  if (skipNextManualPreview) {
    skipNextManualPreview = false;
    return;
  }
  const locations = payload?.locations;
  const returnTrip = Boolean(payload?.returnTrip);
  const routePoints = payload?.routePoints;
  const routeTurnIndex = Number.isInteger(payload?.routeTurnIndex) ? payload.routeTurnIndex : null;
  const hasLocations = Array.isArray(locations) && locations.length >= 2;
  const hasRoutePoints = Array.isArray(routePoints) && routePoints.length >= 2;
  manualPreviewRoutePoints = null;
  manualPreviewCloseLoop = Boolean(returnTrip);
  if (!hasLocations && !hasRoutePoints) {
    clearManualVoyagePreview();
    return;
  }
  if (returnTrip) {
    if (hasRoutePoints) {
      manualPreviewRoutePoints = normalizeRoutePoints(routePoints);
      drawManualVoyagePreview(routePoints, { closeLoop: true, showDirection: true });
    } else if (hasLocations) {
      manualPreviewRoutePoints = normalizeRoutePoints(locations);
      drawManualVoyagePreview(locations, { closeLoop: true, showDirection: true });
    }
  } else if (hasLocations) {
    manualPreviewRoutePoints = stitchLegRoutePoints(locations) || normalizeRoutePoints(locations);
    manualPreviewCloseLoop = false;
    if (getManualRouteEditActive()) {
      return;
    }
    drawManualVoyagePreview(locations, { closeLoop: false, showDirection: false });
  }
  if (getManualRouteEditActive()) {
    if (hasRoutePoints) {
      syncManualRouteEditor(routePoints, routeTurnIndex);
    }
    // Reattach the insert handler since drawManualVoyagePreview detaches it
    attachManualRouteInsertHandler(insertRoutePoint);
  }
}

/**
 * Function: createManualRouteHighlightPolylines
 * Description: Create red highlight polylines from manual route points.
 * Parameters:
 *   points (object[]): Route points with lat/lon values.
 *   options (object): Optional flags for rendering.
 * Returns: object[] - Array of Leaflet polylines.
 */
function createManualRouteHighlightPolylines(points, options = {}) {
  const mapInstance = getMapInstance();
  if (!mapInstance || !Array.isArray(points) || points.length < 2) return [];

  const { closeLoop = false } = options;
  const latLngs = points.map(p => [p.lat, p.lon]).filter(ll =>
    Number.isFinite(ll[0]) && Number.isFinite(ll[1])
  );

  if (latLngs.length < 2) return [];

  if (closeLoop) {
    const first = latLngs[0];
    const last = latLngs[latLngs.length - 1];
    if (first && last && (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6)) {
      latLngs.push(first);
    }
  }

  const polyline = L.polyline(latLngs, {
    color: SAILING_HIGHLIGHT_COLOR,
    weight: DEFAULT_ACTIVITY_WEIGHT,
    opacity: 1,
    interactive: false
  }).addTo(mapInstance);

  return [polyline];
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
  const closeLoop = payload?.closeLoop !== false;
  if (!active) {
    // Get the updated route points and mode before clearing edit state
    const updatedPoints = manualRouteEditPoints.slice();
    const wasCloseLoop = manualRouteEditCloseLoop;

    setManualRouteEditing(false, null, null);

    // Create red highlight polylines from the updated route
    if (updatedPoints.length >= 2) {
      const shouldHighlightFullVoyage = !wasCloseLoop && Array.isArray(manualPreviewRoutePoints);
      const highlightPoints = shouldHighlightFullVoyage ? manualPreviewRoutePoints : updatedPoints;
      const highlightCloseLoop = shouldHighlightFullVoyage ? manualPreviewCloseLoop : wasCloseLoop;
      if (Array.isArray(highlightPoints) && highlightPoints.length >= 2) {
        const highlights = createManualRouteHighlightPolylines(highlightPoints, { closeLoop: highlightCloseLoop });
        setActivePolylines(highlights);
        skipNextManualPreview = true;
      }
    }
    return;
  }
  setManualRouteEditing(true, payload?.points, payload?.turnIndex, {
    closeLoop,
    legIndex: payload?.legIndex
  });
}

/**
 * Function: handleActivityOverrideChanged
 * Description: Refresh highlight polylines when an activity override changes.
 * Parameters:
 *   payload (object): Event payload containing point and new activity.
 * Returns: void.
 */
function handleActivityOverrideChanged(payload = {}) {
  const mapInstance = getMapInstance();
  if (!mapInstance) return;
  const currentPoints = getCurrentVoyagePoints();
  if (!Array.isArray(currentPoints) || currentPoints.length < 2) return;

  // Remove existing active polylines
  removeActivePolylines();
  detachActiveClickers();

  // Recreate with updated activity colors
  const highlightLines = createActivityHighlightPolylines(mapInstance, currentPoints, { closeLoop: false });
  setActivePolylines(highlightLines);

  // Re-wire polyline selection handlers
  const activePolylines = getActivePolylines();
  wirePolylineSelectionHandlers(activePolylines, currentPoints);
}

// Register event handlers
on(EVENTS.VOYAGE_SELECT_REQUESTED, handleVoyageSelectRequested);
on(EVENTS.VOYAGE_MAX_SPEED_REQUESTED, handleVoyageMaxSpeedRequested);
on(EVENTS.VOYAGE_MAX_WIND_REQUESTED, handleVoyageMaxWindRequested);
on(EVENTS.SEGMENT_SELECT_REQUESTED, handleSegmentSelectRequested);
on(EVENTS.SEGMENT_MAX_SPEED_REQUESTED, handleSegmentMaxSpeedRequested);
on(EVENTS.SEGMENT_MAX_WIND_REQUESTED, handleSegmentMaxWindRequested);
on(EVENTS.SELECTION_RESET_REQUESTED, handleSelectionResetRequested);
on(EVENTS.MANUAL_LOCATION_SELECTED, handleManualLocationSelected);
on(EVENTS.MANUAL_VOYAGE_PREVIEW, handleManualVoyagePreview);
on(EVENTS.MANUAL_ROUTE_EDIT_REQUESTED, handleManualRouteEditRequested);
on(EVENTS.ACTIVITY_OVERRIDE_CHANGED, handleActivityOverrideChanged);

/**
 * Function: getSelectedPointMarker
 * Description: Get the selected point marker reference.
 * Parameters: None.
 * Returns: object|null - The selected point marker.
 */
export function getSelectedPointMarker() {
  return selectedPointMarker;
}

/**
 * Function: resetInteractionState
 * Description: Reset all interaction-related state. Called when reinitializing.
 * Parameters: None.
 * Returns: void.
 */
export function resetInteractionState() {
  activeLineClickers = [];
  selectedPointMarker = null;
  suppressHistoryUpdate = false;
  manualRouteEditLayer = null;
  manualRouteEditMarkers = [];
  manualRouteEditPoints = [];
  manualRouteEditTurnIndex = null;
  manualRouteEditCloseLoop = true;
  manualRouteEditLegIndex = null;
  manualRouteHiddenLayers = null;
  manualRouteDimmedLayers = null;
  skipNextManualPreview = false;
  manualPreviewRoutePoints = null;
  manualPreviewCloseLoop = false;
  currentDetailsPoint = null;
}
