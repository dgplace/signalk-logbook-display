import {
  addVoyageToMap,
  apiBasePath,
  clearActivePointMarkers,
  clearMaxSpeedMarker,
  clearSelectedWindGraphics,
  clearWindIntensityLayer,
  createActivityHighlightPolylines,
  detachActiveClickers,
  drawMaxSpeedMarkerFromCoord,
  fitMapToBounds,
  getAllVoyagesBounds,
  handleMapBackgroundClick,
  historyUpdatesEnabled,
  initializeMap,
  refreshWindOverlay,
  removeActivePolylines,
  renderActivePointMarkers,
  resetVoyageSelection,
  restoreBasePolylineStyles,
  selectVoyage,
  setAllVoyagesBounds,
  setActivePolylines,
  setCurrentVoyagePoints,
  setDetailsHint,
  setWindOverlayToggleAvailability,
  updateHistoryForTrip,
  updateSelectedPoint,
  wirePolylineSelectionHandlers
} from './map.js';
import {
  ensureMobileLayoutReadiness,
  ensureMobileMapView,
  initMobileLayoutControls,
  initSplitters,
  initMaximizeControl,
  syncInitialMobileView
} from './view.js';
import {
  getVoyageByIndex,
  getVoyageRowByIndex,
  renderTotalsRow,
  renderVoyageTable
} from './table.js';
import {
  computeDaySegments,
  computeVoyageTotals,
  fetchVoyagesData,
  formatDurationMs
} from './data.js';

// DOM references
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessageEl = loadingOverlay ? loadingOverlay.querySelector('.loading-message') : null;

console.log(`[voyage-webapp] apiBasePath resolved to "${apiBasePath || '/'}" for pathname "${window.location.pathname}"`);

initMobileLayoutControls();
initSplitters();
initMaximizeControl();

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
  const voyage = getVoyageByIndex(idx);
  const row = getVoyageRowByIndex(idx);
  if (!voyage || !row) return false;
  selectVoyage(voyage, row, { fit: true, scrollIntoView: true, suppressHistory: true });
  if (updateHistory && historyUpdatesEnabled) {
    updateHistoryForTrip(tripId, { replace: true });
  }
  return true;
}

window.addEventListener('popstate', () => {
  syncVoyageSelectionWithPath({ updateHistory: false });
});

function focusSegment(segment) {
  ensureMobileLayoutReadiness();
  ensureMobileMapView();
  clearMaxSpeedMarker();
  restoreBasePolylineStyles();
  detachActiveClickers();
  clearActivePointMarkers();
  clearSelectedWindGraphics();
  removeActivePolylines();
  const dayPoints = Array.isArray(segment?.points) ? segment.points : [];
  let dayHighlights = dayPoints.length >= 2 ? createActivityHighlightPolylines(dayPoints, { weight: 5 }) : [];
  if (!dayHighlights.length && segment?.polyline) {
    segment.polyline.setStyle({ color: '#ef4444', weight: 4 });
    dayHighlights = [segment.polyline];
  }
  setActivePolylines(dayHighlights);
  if (dayHighlights.length > 0) {
    wirePolylineSelectionHandlers(dayHighlights, dayPoints);
    let bounds = dayHighlights[0].getBounds();
    for (let i = 1; i < dayHighlights.length; i += 1) {
      bounds = bounds.extend(dayHighlights[i].getBounds());
    }
    fitMapToBounds(bounds, { deferForMobile: true });
  }
  clearWindIntensityLayer();
  setCurrentVoyagePoints(dayPoints);
  renderActivePointMarkers(dayPoints);
  refreshWindOverlay(dayPoints);
  setWindOverlayToggleAvailability(true);
  setDetailsHint('Click on the highlighted track to inspect a point.');
}

/**
 * Function: load
 * Description: Fetch voyages data, rebuild map overlays, and refresh the voyage table UI.
 * Parameters: None.
 * Returns: Promise<void> - Resolves when the interface has been refreshed.
 */
async function load() {
  const data = await fetchVoyagesData();

  initializeMap(handleMapBackgroundClick);
  const tbody = document.querySelector('#voyTable tbody');
  if (!tbody) return;
  const voyages = data.voyages.map((voyage, index) => {
    voyage._tripIndex = index + 1;
    voyage._segments = computeDaySegments(voyage);
    return voyage;
  });

  const tableHandlers = {
    onVoyageSelect: (voyage, row, { wasSelected }) => {
      selectVoyage(voyage, row, { fit: true, suppressHistory: false });
    },
    onVoyageMaxSpeed: (voyage, row, { wasSelected }) => {
      selectVoyage(voyage, row, { fit: !wasSelected, suppressHistory: wasSelected });
      drawMaxSpeedMarkerFromCoord(voyage.maxSpeedCoord, voyage.maxSpeed);
    },
    onDaySelect: (voyage, segment) => {
      focusSegment(segment);
    },
    onDayMaxSpeed: (voyage, segment) => {
      focusSegment(segment);
      drawMaxSpeedMarkerFromCoord(segment.maxSpeedCoord, segment.maxSpeed);
    }
  };

  renderVoyageTable(tbody, voyages, tableHandlers);

  const totals = computeVoyageTotals(data.voyages);
  renderTotalsRow(tbody, totals, formatDurationMs, resetVoyageSelection);

  let allBounds = null;
  voyages.forEach((voyage, index) => {
    const row = getVoyageRowByIndex(index);
    const voyageBounds = addVoyageToMap(voyage, row);
    if (voyageBounds) {
      allBounds = allBounds ? allBounds.extend(voyageBounds) : voyageBounds;
    }
  });

  setAllVoyagesBounds(allBounds);
  const selectedFromPath = syncVoyageSelectionWithPath({ updateHistory: historyUpdatesEnabled });
  const storedBounds = getAllVoyagesBounds();
  if (!selectedFromPath && storedBounds) {
    fitMapToBounds(storedBounds, { deferForMobile: true });
  }

  const tableWrapper = document.querySelector('.table-wrapper');
  if (tableWrapper && !selectedFromPath) {
    tableWrapper.scrollTop = tableWrapper.scrollHeight;
  }

  syncInitialMobileView();
}

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
