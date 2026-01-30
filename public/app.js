/**
 * Module Responsibilities:
 * - Bootstraps the voyage webapp by loading voyage data and rendering the table and map overlays.
 * - Coordinates event bus interactions so URL navigation, selections, and regeneration stay in sync.
 * - Initialises responsive layout controls for mobile/desktop experiences.
 *
 * Exported API:
 * - (none) This module performs side effects during evaluation.
 *
 * @typedef {import('./types.js').Voyage} Voyage
 * @typedef {import('./types.js').VoyageTotals} VoyageTotals
 */

import {
  addVoyageToMap,
  apiBasePath,
  fitMapToBounds,
  getAllVoyagesBounds,
  historyUpdatesEnabled,
  initializeMap,
  setAllVoyagesBounds,
  setDetailsHint,
  updateHistoryForTrip
} from './map.js';
import {
  initMobileLayoutControls,
  initSplitters,
  initMaximizeControl,
  syncInitialMobileView
} from './view.js';
import {
  getVoyageByIndex,
  getVoyageRowByIndex,
  renderVoyageTable
} from './table.js';
import {
  computeDaySegments,
  computeVoyageTotals,
  buildManualVoyageFromRecord,
  buildManualSegmentsFromStops,
  buildManualReturnSegmentFromStops,
  fetchVoyagesData,
  fetchManualVoyagesData,
  formatDurationMs,
  applyVoyageTimeMetrics,
  MANUAL_AVG_SPEED_KN
} from './data.js';
import { emit, on, EVENTS } from './events.js';
import { initManualVoyagePanel } from './manual.js';

// DOM references
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessageEl = loadingOverlay ? loadingOverlay.querySelector('.loading-message') : null;
const summaryToggleBtn = document.getElementById('summaryToggleBtn');
const summaryPanel = document.getElementById('summaryPanel');
const summaryDistanceEl = document.getElementById('summaryDistance');
const summaryActiveEl = document.getElementById('summaryActive');
const summarySeaTimeEl = document.getElementById('summarySeaTime');
const summarySailingEl = document.getElementById('summarySailing');
const tableWrapperEl = document.querySelector('.table-wrapper');
const summaryLabels = {
  show: 'Show summary',
  hide: 'Show table'
};

console.log(`[voyage-webapp] apiBasePath resolved to "${apiBasePath || '/'}" for pathname "${window.location.pathname}"`);

initMobileLayoutControls();
initSplitters();
initMaximizeControl();

let isSummaryViewActive = false;

const manualPanelApi = initManualVoyagePanel({
  apiBasePath,
  onSaved: async () => {
    await load();
  },
  onDelete: async (manualId) => {
    await deleteManualVoyage(manualId);
  }
});

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
 * Function: updateSummaryPanel
 * Description: Update the summary panel with aggregated voyage totals.
 * Parameters:
 *   totals (VoyageTotals): Aggregated voyage totals for all voyages.
 *   seaTimeMs (number): Sum of voyage durations from start to end timestamps.
 * Returns: void.
 */
function updateSummaryPanel(totals, seaTimeMs) {
  if (!totals) return;
  const totalDistanceNm = Number.isFinite(totals.totalDistanceNm) ? totals.totalDistanceNm : 0;
  const totalActiveMs = Number.isFinite(totals.totalActiveMs) ? totals.totalActiveMs : 0;
  const totalSailingMs = Number.isFinite(totals.totalSailingMs) ? totals.totalSailingMs : 0;
  const totalSeaTimeMs = Number.isFinite(seaTimeMs) ? seaTimeMs : 0;
  const sailingPct = totalActiveMs > 0 ? ((totalSailingMs / totalActiveMs) * 100) : 0;

  if (summaryDistanceEl) {
    summaryDistanceEl.textContent = `${totalDistanceNm.toFixed(1)} NM`;
  }
  if (summaryActiveEl) {
    summaryActiveEl.textContent = formatDurationMs(totalActiveMs);
  }
  if (summarySeaTimeEl) {
    summarySeaTimeEl.textContent = formatDurationMs(totalSeaTimeMs);
  }
  if (summarySailingEl) {
    summarySailingEl.textContent = `${formatDurationMs(totalSailingMs)} (${sailingPct.toFixed(1)}%)`;
  }
}

/**
 * Function: setSummaryViewEnabled
 * Description: Toggle the summary panel visibility while hiding or showing the voyage table.
 * Parameters:
 *   enabled (boolean): True when the summary panel should replace the voyage table.
 * Returns: void.
 */
function setSummaryViewEnabled(enabled) {
  isSummaryViewActive = Boolean(enabled);
  if (summaryPanel) {
    summaryPanel.hidden = !isSummaryViewActive;
  }
  if (tableWrapperEl) {
    tableWrapperEl.hidden = isSummaryViewActive;
  }
  if (summaryToggleBtn) {
    summaryToggleBtn.classList.toggle('is-active', isSummaryViewActive);
    summaryToggleBtn.setAttribute('aria-pressed', String(isSummaryViewActive));
    summaryToggleBtn.textContent = isSummaryViewActive ? summaryLabels.hide : summaryLabels.show;
    summaryToggleBtn.setAttribute('aria-label', summaryToggleBtn.textContent);
  }
}

if (summaryToggleBtn) {
  summaryToggleBtn.addEventListener('click', () => {
    setSummaryViewEnabled(!isSummaryViewActive);
  });
}

setSummaryViewEnabled(false);

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
 * Function: getSortTimeValue
 * Description: Resolve a numeric timestamp used to sort voyages chronologically.
 * Parameters:
 *   voyage (object): Voyage descriptor containing a start time.
 * Returns: number - Millisecond timestamp or Infinity when invalid.
 */
function getSortTimeValue(voyage) {
  if (!voyage || !voyage.startTime) return Number.POSITIVE_INFINITY;
  const dt = new Date(voyage.startTime);
  const ts = dt.getTime();
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
}

/**
 * Function: mergeVoyageCollections
 * Description: Merge auto-generated and manual voyage data into a sorted list.
 * Parameters:
 *   voyages (object[]): Generated voyages from the logbook parser.
 *   manualVoyages (object[]): Manual voyage entries.
 * Returns: object[] - Combined voyage list ordered by start time.
 */
function mergeVoyageCollections(voyages, manualVoyages) {
  const combined = []
    .concat(Array.isArray(voyages) ? voyages : [])
    .concat(Array.isArray(manualVoyages) ? manualVoyages : []);
  return combined.sort((a, b) => getSortTimeValue(a) - getSortTimeValue(b));
}

/**
 * Function: collectManualLocations
 * Description: Extract unique manual locations for autocomplete suggestions.
 * Parameters:
 *   records (object[]): Manual voyage records from storage.
 * Returns: object[] - Unique manual locations with names and coordinates.
 */
function collectManualLocations(records) {
  const locations = new Map();
  if (!Array.isArray(records)) return [];
  records.forEach((record) => {
    const manualLocations = Array.isArray(record?.locations) ? record.locations : [];
    const legacyLocations = [record?.startLocation, record?.endLocation];
    const combined = manualLocations.length ? manualLocations : legacyLocations;
    combined.forEach((location) => {
      if (!location || typeof location !== 'object') return;
      const name = typeof location.name === 'string' ? location.name.trim() : '';
      const lat = Number(location.lat);
      const lon = Number(location.lon);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const key = name.toLowerCase();
      if (!locations.has(key)) {
        locations.set(key, { name, lat, lon });
      }
    });
  });
  return Array.from(locations.values());
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
  emit(EVENTS.VOYAGE_SELECT_REQUESTED, {
    voyage,
    row,
    source: 'history',
    options: { fit: true, scrollIntoView: true, suppressHistory: true }
  });
  if (updateHistory && historyUpdatesEnabled) {
    updateHistoryForTrip(tripId, { replace: true });
  }
  return true;
}

window.addEventListener('popstate', () => {
  syncVoyageSelectionWithPath({ updateHistory: false });
});

/**
 * Function: load
 * Description: Fetch voyages data, rebuild map overlays, and refresh the voyage table UI.
 * Parameters: None.
 * Returns: Promise<void> - Resolves when the interface has been refreshed.
 */
async function load() {
  const [data, manualData] = await Promise.all([
    fetchVoyagesData(),
    fetchManualVoyagesData(apiBasePath)
  ]);

  initializeMap();
  const tbody = document.querySelector('#voyTable tbody');
  if (!tbody) return;
  const manualRecords = Array.isArray(manualData?.voyages) ? manualData.voyages : [];
  const manualVoyages = manualRecords
    .map(record => buildManualVoyageFromRecord(record))
    .filter(Boolean);
  const combinedVoyages = mergeVoyageCollections(data.voyages, manualVoyages);
  if (manualPanelApi && typeof manualPanelApi.updateLocationOptions === 'function') {
    manualPanelApi.updateLocationOptions(collectManualLocations(manualRecords));
  }
  const voyages = combinedVoyages.map((voyage, index) => {
    voyage._tripIndex = index + 1;
    if (voyage.manual && voyage.returnTrip && Array.isArray(voyage.manualLocations)) {
      const returnSegment = buildManualReturnSegmentFromStops(voyage.manualLocations, {
        routePoints: voyage.manualRoutePoints,
        routeTurnIndex: voyage.manualRouteTurnIndex,
        startName: voyage.manualLocations[0]?.name || voyage.startLocation?.name || '',
        turnName: voyage.manualLocations[1]?.name || voyage.endLocation?.name || ''
      });
      voyage._segments = returnSegment ? [returnSegment] : [];
    } else if (voyage.manual && Array.isArray(voyage.manualLocations) && voyage.manualLocations.length > 1) {
      voyage._segments = buildManualSegmentsFromStops(voyage.manualLocations);
    } else {
      const minLegDistanceNm = voyage.manual ? 0 : undefined;
      voyage._segments = computeDaySegments(voyage, { minLegDistanceNm });
    }
    applyVoyageTimeMetrics(voyage);
    if (voyage.manual) {
      const distanceNm = Number.isFinite(voyage.nm) ? voyage.nm : 0;
      const manualHours = MANUAL_AVG_SPEED_KN > 0 ? (distanceNm / MANUAL_AVG_SPEED_KN) : 0;
      const manualSpeed = distanceNm > 0 ? MANUAL_AVG_SPEED_KN : 0;
      voyage.totalHours = manualHours;
      voyage.avgSpeed = manualSpeed;
      voyage.maxSpeed = 0;
      voyage.maxWind = 0;
      voyage.avgWindSpeed = 0;
      voyage.avgWindHeading = null;
      voyage.maxSpeedCoord = null;
      const segments = Array.isArray(voyage._segments) ? voyage._segments : [];
      if (segments.length > 0) {
        segments.forEach((segment) => {
          const segmentDistance = Number.isFinite(segment?.nm) ? segment.nm : 0;
          const segmentHours = MANUAL_AVG_SPEED_KN > 0 ? (segmentDistance / MANUAL_AVG_SPEED_KN) : 0;
          segment.totalHours = segmentHours;
          segment.avgSpeed = segmentDistance > 0 ? MANUAL_AVG_SPEED_KN : 0;
          segment.maxSpeed = 0;
          segment.maxSpeedCoord = null;
          segment.maxWind = 0;
          segment.avgWindSpeed = 0;
          segment.avgWindHeading = null;
        });
      }
    }
    return voyage;
  });

  renderVoyageTable(tbody, voyages);

  const totals = computeVoyageTotals(voyages);
  const seaTimeMs = voyages.reduce((sum, voyage) => {
    const start = voyage?.startTime ? new Date(voyage.startTime).getTime() : Number.NaN;
    const end = voyage?.endTime ? new Date(voyage.endTime).getTime() : Number.NaN;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return sum;
    }
    return sum + (end - start);
  }, 0);
  updateSummaryPanel(totals, seaTimeMs);

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

load().then(() => setDetailsHint('Select a voyage, then click track to inspect.')).catch(console.error);

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

/**
 * Function: deleteManualVoyage
 * Description: Issue a delete request for a manual voyage by id.
 * Parameters:
 *   manualId (string): Identifier of the manual voyage to delete.
 * Returns: Promise<void> - Resolves when the delete completes.
 */
async function deleteManualVoyage(manualId) {
  const base = typeof apiBasePath === 'string' ? apiBasePath.replace(/\/$/, '') : '';
  const url = base ? `${base}/manual-voyages/${encodeURIComponent(manualId)}` : `manual-voyages/${encodeURIComponent(manualId)}`;
  const response = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!response.ok) {
    let message = `Manual voyage delete failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data && typeof data.message === 'string' && data.message.trim()) {
        message = data.message.trim();
      }
    } catch (err) {
      try {
        const text = await response.text();
        if (text && text.trim()) {
          message = text.trim();
        }
      } catch (_) {
        // keep default message
      }
    }
    throw new Error(message);
  }
}

/**
 * Function: handleManualVoyageEditRequested
 * Description: Open the manual voyage panel in edit mode for a manual voyage.
 * Parameters:
 *   payload (object): Event payload containing the voyage metadata.
 * Returns: void.
 */
function handleManualVoyageEditRequested(payload = {}) {
  const voyage = payload?.voyage;
  if (!voyage || !voyage.manualId) return;

  // Auto-focus the voyage on the map when editing starts
  emit(EVENTS.VOYAGE_SELECT_REQUESTED, {
    voyage,
    row: payload?.row || null,
    fit: true
  });

  if (manualPanelApi && typeof manualPanelApi.openForEdit === 'function') {
    manualPanelApi.openForEdit(voyage);
  }
}

on(EVENTS.MANUAL_VOYAGE_EDIT_REQUESTED, handleManualVoyageEditRequested);
