/**
 * Module Responsibilities:
 * - Facade module re-exporting map functionality from subdirectory modules.
 * - Provides backward-compatible API for consumers.
 *
 * @typedef {import('./types.js').Voyage} Voyage
 * @typedef {import('./types.js').VoyagePoint} VoyagePoint
 */

// Re-export from core module
export {
  initializeMap,
  getMapInstance,
  fitMapToBounds,
  setAllVoyagesBounds,
  getAllVoyagesBounds,
  apiBasePath,
  historyUpdatesEnabled,
  getPreferredColorMode,
  applyBaseLayerForMode,
  setMapClickCapture,
  clearMapClickCapture,
  getMapClickCaptureHandler,
  getBasePathname
} from './map/core.js';

// Re-export from layers module
export {
  addVoyageToMap,
  removeActivePolylines,
  setActivePolylines,
  getPolylines,
  getActivePolylines,
  resetPolylines,
  renderActivePointMarkers,
  clearActivePointMarkers,
  refreshWindOverlay,
  setWindOverlayEnabled,
  setWindOverlayToggleAvailability,
  clearWindIntensityLayer,
  clearSelectedWindGraphics,
  drawManualVoyagePreview,
  clearManualVoyagePreview,
  drawMaxSpeedMarkerFromCoord,
  clearMaxSpeedMarker,
  highlightLocation,
  clearHighlightedLocationMarker,
  restoreBasePolylineStyles,
  setCurrentVoyagePoints,
  getCurrentVoyagePoints,
  setManualRouteEditState,
  getManualRouteEditActive,
  bearingBetween,
  renderSelectedWindGraphics,
  updateManualVoyagePreviewLatLngs,
  ensureManualRouteEditHitPolyline,
  attachManualRouteInsertHandler,
  detachManualRouteInsertHandler,
  getManualRouteEditHitPolyline,
  getManualVoyagePreviewPolyline,
  setManualRouteEditClicker,
  getManualRouteEditClicker,
  getWindIntensityLayer,
  getActivePointMarkersGroup,
  getSelectedWindGroup,
  getMaxMarker,
  resetLayerState
} from './map/layers.js';

// Re-export from interaction module
export {
  selectVoyage,
  resetVoyageSelection,
  updateSelectedPoint,
  handleMapBackgroundClick,
  wirePolylineSelectionHandlers,
  updateHistoryForTrip,
  setDetailsHint,
  detachActiveClickers,
  setManualRouteEditing,
  syncManualRouteEditor,
  focusSegment,
  getMapClickThreshold,
  getSelectedPointMarker,
  resetInteractionState
} from './map/interaction.js';
