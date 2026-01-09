/**
 * Module Responsibilities:
 * - Handle the manual voyage entry panel UI, calculations, and API submissions.
 * - Maintain an autocomplete list of saved manual locations for faster data entry.
 *
 * Exported API:
 * - initManualVoyagePanel
 *
 * @typedef {import('./types.js').ManualLocation} ManualLocation
 * @typedef {import('./types.js').Voyage} Voyage
 */

import { calculateDistanceNm, formatDurationMs, MANUAL_AVG_SPEED_KN } from './data.js';
import { setMapClickCapture, clearMapClickCapture } from './map.js';

const PLACEHOLDER_VALUE = '—';

/**
 * Function: normalizeLocationName
 * Description: Normalize a location name for case-insensitive lookup keys.
 * Parameters:
 *   name (string): Location name to normalize.
 * Returns: string - Normalized lookup key.
 */
function normalizeLocationName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase();
}

/**
 * Function: parseDateInput
 * Description: Parse a datetime-local input value into a Date object.
 * Parameters:
 *   value (string): Raw input value to parse.
 * Returns: Date|null - Parsed Date instance or null when invalid.
 */
function parseDateInput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * Function: formatDatetimeLocal
 * Description: Format a Date object into the datetime-local input format.
 * Parameters:
 *   date (Date): Date object to format.
 * Returns: string - Formatted datetime-local string.
 */
function formatDatetimeLocal(date) {
  const pad = value => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Function: normalizeDatetimeInputValue
 * Description: Normalize datetime-local inputs to avoid validation pattern errors.
 * Parameters:
 *   input (HTMLInputElement): Datetime input to normalize.
 * Returns: void.
 */
function normalizeDatetimeInputValue(input) {
  if (!input || typeof input.value !== 'string') return;
  const raw = input.value.trim();
  if (!raw) {
    input.setCustomValidity('');
    return;
  }
  let parsed = parseDateInput(raw);
  if (!parsed && raw.includes(' ')) {
    parsed = parseDateInput(raw.replace(' ', 'T'));
  }
  if (!parsed) {
    input.setCustomValidity('Enter a valid date and time.');
    return;
  }
  input.value = formatDatetimeLocal(parsed);
  input.setCustomValidity('');
}

/**
 * Function: parseNumberInput
 * Description: Parse a numeric input value into a finite number.
 * Parameters:
 *   value (string): Raw input value to parse.
 * Returns: number|null - Parsed number or null when invalid.
 */
function parseNumberInput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

/**
 * Function: readLocationFields
 * Description: Read a named location from the supplied input elements.
 * Parameters:
 *   nameInput (HTMLInputElement): Input containing the location name.
 *   latInput (HTMLInputElement): Input containing the latitude.
 *   lonInput (HTMLInputElement): Input containing the longitude.
 * Returns: object|null - Normalized location or null when incomplete.
 */
function readLocationFields(nameInput, latInput, lonInput) {
  const name = nameInput && typeof nameInput.value === 'string' ? nameInput.value.trim() : '';
  const lat = parseNumberInput(latInput ? latInput.value : '');
  const lon = parseNumberInput(lonInput ? lonInput.value : '');
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name, lat, lon };
}

/**
 * Function: validateTimeOrder
 * Description: Enforce end-time validation rules on the manual voyage form.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function validateTimeOrder(state) {
  if (!state.startTimeInput || !state.endTimeInput) return;
  const startDate = parseDateInput(state.startTimeInput.value);
  const endDate = parseDateInput(state.endTimeInput.value);
  if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
    state.endTimeInput.setCustomValidity('End time must be after the start time.');
  } else {
    state.endTimeInput.setCustomValidity('');
  }
}

/**
 * Function: updateManualMetrics
 * Description: Recalculate and display distance and duration based on current input values.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function updateManualMetrics(state) {
  if (!state) return;
  normalizeDatetimeInputValue(state.startTimeInput);
  normalizeDatetimeInputValue(state.endTimeInput);
  syncEndTimeWithStart(state);
  validateTimeOrder(state);
  const startLocation = readLocationFields(state.startNameInput, state.startLatInput, state.startLonInput);
  const endLocation = readLocationFields(state.endNameInput, state.endLatInput, state.endLonInput);
  const distanceValue = state.distanceValue;
  const durationValue = state.durationValue;
  const distanceNm = (startLocation && endLocation)
    ? calculateDistanceNm(startLocation.lat, startLocation.lon, endLocation.lat, endLocation.lon)
    : null;
  if (distanceValue) {
    distanceValue.textContent = Number.isFinite(distanceNm) ? `${distanceNm.toFixed(1)} NM` : PLACEHOLDER_VALUE;
  }
  if (durationValue) {
    const durationMs = Number.isFinite(distanceNm) && distanceNm > 0 && MANUAL_AVG_SPEED_KN > 0
      ? (distanceNm / MANUAL_AVG_SPEED_KN) * 60 * 60 * 1000
      : null;
    durationValue.textContent = Number.isFinite(durationMs) && durationMs > 0
      ? formatDurationMs(durationMs)
      : PLACEHOLDER_VALUE;
  }
}

/**
 * Function: syncEndTimeWithStart
 * Description: Reset the end datetime to the start when missing or earlier.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function syncEndTimeWithStart(state) {
  if (!state || !state.startTimeInput || !state.endTimeInput) return;
  const startDate = parseDateInput(state.startTimeInput.value);
  if (!startDate) return;
  const endDate = parseDateInput(state.endTimeInput.value);
  if (!endDate || endDate.getTime() < startDate.getTime()) {
    state.endTimeInput.value = formatDatetimeLocal(startDate);
  }
}

/**
 * Function: captureTablePanelLayout
 * Description: Cache the current container sizing before expanding for the manual panel.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function captureTablePanelLayout(state) {
  if (!state || state.panelLayoutRestore) return;
  const container = document.querySelector('.container');
  if (!container) return;
  state.panelLayoutRestore = {
    height: container.style.height,
    topHeight: container.style.getPropertyValue('--top-height')
  };
}

/**
 * Function: restoreTablePanelLayout
 * Description: Restore the container sizing captured before the manual panel opened.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function restoreTablePanelLayout(state) {
  if (!state || !state.panelLayoutRestore) return;
  const container = document.querySelector('.container');
  if (!container) return;
  const { height, topHeight } = state.panelLayoutRestore;
  container.style.height = height || '';
  if (topHeight) {
    container.style.setProperty('--top-height', topHeight);
  } else {
    container.style.removeProperty('--top-height');
  }
  state.panelLayoutRestore = null;
}

/**
 * Function: expandTablePanelForManual
 * Description: Extend the table panel to fully display the manual voyage form.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function expandTablePanelForManual(state) {
  if (!state || !state.panel || state.panel.hidden) return;
  const container = document.querySelector('.container');
  const topSection = document.querySelector('.top-section');
  const tableWrapper = document.querySelector('.table-wrapper');
  if (!container || !topSection || !tableWrapper) return;
  if (container.classList.contains('mobile-layout')) return;
  captureTablePanelLayout(state);

  const panelRect = state.panel.getBoundingClientRect();
  if (!panelRect || panelRect.height <= 0) return;
  const panelStyles = getComputedStyle(state.panel);
  const marginTop = parseFloat(panelStyles.marginTop || '0');
  const marginBottom = parseFloat(panelStyles.marginBottom || '0');
  const panelBlockHeight = panelRect.height + marginTop + marginBottom;

  const headerBar = document.querySelector('.header-bar');
  const headerHeight = headerBar ? headerBar.getBoundingClientRect().height : 0;
  const wrapperHeight = tableWrapper.getBoundingClientRect().height;
  const requiredWrapperHeight = Math.max(wrapperHeight, panelBlockHeight);
  const requiredTopHeight = Math.ceil(headerHeight + requiredWrapperHeight);
  const currentTopHeight = topSection.getBoundingClientRect().height;
  if (requiredTopHeight <= currentTopHeight) return;

  const containerRect = container.getBoundingClientRect();
  const delta = requiredTopHeight - currentTopHeight;
  container.style.height = `${Math.ceil(containerRect.height + delta)}px`;
  container.style.setProperty('--top-height', `${requiredTopHeight}px`);
}

/**
 * Function: setPanelVisibility
 * Description: Toggle the manual voyage panel visibility and update the toggle button label.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   isVisible (boolean): True to show the panel, false to hide it.
 * Returns: void.
 */
function setPanelVisibility(state, isVisible) {
  if (!state || !state.panel) return;
  state.panel.hidden = !isVisible;
  if (state.panelToggleBtn) {
    state.panelToggleBtn.textContent = isVisible ? 'Hide manual voyage' : 'Add manual voyage';
  }
  if (isVisible) {
    expandTablePanelForManual(state);
  } else {
    restoreTablePanelLayout(state);
  }
  if (!isVisible) {
    clearMapClickCapture();
    setPickMode(state, null);
  }
}

/**
 * Function: setEditMode
 * Description: Switch the panel between add and edit states.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   voyage (object|null): Manual voyage data for edit mode.
 * Returns: void.
 */
function setEditMode(state, voyage) {
  if (!state) return;
  const isEdit = Boolean(voyage && voyage.manualId);
  state.editId = isEdit ? voyage.manualId : null;
  if (state.panelTitle) {
    state.panelTitle.textContent = isEdit ? 'Edit manual voyage' : 'Manual voyage';
  }
  if (state.panelSubtitle) {
    state.panelSubtitle.textContent = isEdit
      ? 'Update the voyage details and save your changes.'
      : 'Add voyages that do not exist in the logbook parser output.';
  }
  if (state.addButton) {
    state.addButton.textContent = isEdit ? 'Save manual voyage' : 'Add manual voyage';
  }
  if (state.deleteButton) {
    state.deleteButton.hidden = !isEdit;
  }
}

/**
 * Function: populateFormFromVoyage
 * Description: Populate the form fields from a manual voyage entry.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   voyage (object): Manual voyage data to load into the form.
 * Returns: void.
 */
function populateFormFromVoyage(state, voyage) {
  if (!state || !voyage) return;
  if (state.startTimeInput && voyage.startTime) {
    state.startTimeInput.value = formatDatetimeLocal(new Date(voyage.startTime));
  }
  if (state.endTimeInput && voyage.endTime) {
    state.endTimeInput.value = formatDatetimeLocal(new Date(voyage.endTime));
  }
  if (state.startNameInput) {
    state.startNameInput.value = voyage.startLocation?.name || '';
  }
  if (state.endNameInput) {
    state.endNameInput.value = voyage.endLocation?.name || '';
  }
  if (state.startLatInput && Number.isFinite(voyage.startLocation?.lat)) {
    state.startLatInput.value = Number(voyage.startLocation.lat).toFixed(6);
  }
  if (state.startLonInput && Number.isFinite(voyage.startLocation?.lon)) {
    state.startLonInput.value = Number(voyage.startLocation.lon).toFixed(6);
  }
  if (state.endLatInput && Number.isFinite(voyage.endLocation?.lat)) {
    state.endLatInput.value = Number(voyage.endLocation.lat).toFixed(6);
  }
  if (state.endLonInput && Number.isFinite(voyage.endLocation?.lon)) {
    state.endLonInput.value = Number(voyage.endLocation.lon).toFixed(6);
  }
  updateManualMetrics(state);
}

/**
 * Function: setPickButtonState
 * Description: Update the pick button styles and hint visibility based on selection state.
 * Parameters:
 *   button (HTMLButtonElement|null): Button element to update.
 *   hint (HTMLElement|null): Hint element to toggle.
 *   isActive (boolean): True when pick mode is active for the button.
 * Returns: void.
 */
function setPickButtonState(button, hint, isActive) {
  if (button) {
    button.classList.toggle('is-active', isActive);
    const defaultLabel = button.dataset.defaultLabel || button.textContent;
    button.dataset.defaultLabel = defaultLabel;
    button.textContent = isActive ? 'Click map to set' : defaultLabel;
  }
  if (hint) {
    hint.hidden = !isActive;
  }
}

/**
 * Function: setPickMode
 * Description: Enable or disable map picking mode for a start or end location.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   target (string|null): Target identifier ('start', 'end', or null to clear).
 * Returns: void.
 */
function setPickMode(state, target) {
  if (!state) return;
  const startActive = target === 'start';
  const endActive = target === 'end';
  state.activePickTarget = target;
  setPickButtonState(state.startPickBtn, state.startPickHint, startActive);
  setPickButtonState(state.endPickBtn, state.endPickHint, endActive);
  if (!target) {
    clearMapClickCapture();
  }
}

/**
 * Function: handleMapPick
 * Description: Handle map clicks to populate manual coordinate fields.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   target (string): Target identifier ('start' or 'end').
 *   event (object): Leaflet click event containing latlng.
 * Returns: boolean - True when handled to prevent default map selection.
 */
function handleMapPick(state, target, event) {
  if (!state || !event || !event.latlng) return false;
  const { lat, lng } = event.latlng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const latValue = lat.toFixed(6);
  const lonValue = lng.toFixed(6);
  if (target === 'start') {
    if (state.startLatInput) state.startLatInput.value = latValue;
    if (state.startLonInput) state.startLonInput.value = lonValue;
    if (state.startNameInput) state.startNameInput.focus();
  } else if (target === 'end') {
    if (state.endLatInput) state.endLatInput.value = latValue;
    if (state.endLonInput) state.endLonInput.value = lonValue;
    if (state.endNameInput) state.endNameInput.focus();
  }
  updateManualMetrics(state);
  setPickMode(state, null);
  return true;
}

/**
 * Function: applyLocationLookup
 * Description: Apply stored location coordinates when a known name is selected.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   nameInput (HTMLInputElement): Location name input element.
 *   latInput (HTMLInputElement): Latitude input element to update.
 *   lonInput (HTMLInputElement): Longitude input element to update.
 * Returns: void.
 */
function applyLocationLookup(state, nameInput, latInput, lonInput) {
  if (!state || !nameInput || !latInput || !lonInput) return;
  const key = normalizeLocationName(nameInput.value);
  if (!key) return;
  const match = state.locationLookup.get(key);
  if (!match) return;
  latInput.value = Number(match.lat).toFixed(6);
  lonInput.value = Number(match.lon).toFixed(6);
  updateManualMetrics(state);
}

/**
 * Function: buildManualPayload
 * Description: Construct a manual voyage payload from current form values.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: object|null - Payload for API submission or null when incomplete.
 */
function buildManualPayload(state) {
  const startDate = parseDateInput(state.startTimeInput.value);
  const endDate = parseDateInput(state.endTimeInput.value);
  const startLocation = readLocationFields(state.startNameInput, state.startLatInput, state.startLonInput);
  const endLocation = readLocationFields(state.endNameInput, state.endLatInput, state.endLonInput);
  if (!startDate || !endDate || !startLocation || !endLocation) return null;
  if (endDate.getTime() <= startDate.getTime()) return null;
  return {
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    startLocation,
    endLocation
  };
}

/**
 * Function: setBusyState
 * Description: Toggle form controls to reflect an in-flight submission.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   isBusy (boolean): True when submission is in progress.
 * Returns: void.
 */
function setBusyState(state, isBusy) {
  if (!state || !state.addButton) return;
  state.addButton.disabled = isBusy;
  state.addButton.textContent = isBusy ? 'Saving...' : 'Add manual voyage';
}

/**
 * Function: saveManualVoyage
 * Description: Persist a manual voyage payload to the server.
 * Parameters:
 *   payload (object): Manual voyage payload to save.
 *   apiBasePath (string): Base API path for the request.
 * Returns: Promise<object> - Saved manual voyage record.
 */
async function saveManualVoyage(payload, apiBasePath) {
  const base = typeof apiBasePath === 'string' ? apiBasePath.replace(/\/$/, '') : '';
  const url = base ? `${base}/manual-voyages` : 'manual-voyages';
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let message = `Manual voyage save failed with status ${response.status}`;
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
  return response.json();
}

/**
 * Function: updateManualVoyage
 * Description: Persist manual voyage edits to the server.
 * Parameters:
 *   manualId (string): Manual voyage identifier to update.
 *   payload (object): Manual voyage payload to save.
 *   apiBasePath (string): Base API path for the request.
 * Returns: Promise<object> - Updated manual voyage record.
 */
async function updateManualVoyage(manualId, payload, apiBasePath) {
  const base = typeof apiBasePath === 'string' ? apiBasePath.replace(/\/$/, '') : '';
  const url = base ? `${base}/manual-voyages/${encodeURIComponent(manualId)}` : `manual-voyages/${encodeURIComponent(manualId)}`;
  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let message = `Manual voyage update failed with status ${response.status}`;
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
  return response.json();
}

/**
 * Function: deleteManualVoyage
 * Description: Delete a manual voyage on the server.
 * Parameters:
 *   manualId (string): Manual voyage identifier to delete.
 *   apiBasePath (string): Base API path for the request.
 * Returns: Promise<void> - Resolves when deletion completes.
 */
async function deleteManualVoyage(manualId, apiBasePath) {
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
 * Function: initManualVoyagePanel
 * Description: Wire the manual voyage form for calculations, autofill, and save actions.
 * Parameters:
 *   options (object): Configuration options including API path and callbacks.
 * Returns: object - API providing updateLocationOptions helper.
 */
export function initManualVoyagePanel(options = {}) {
  const panel = document.getElementById('manualVoyagePanel');
  const form = document.getElementById('manualVoyageForm');
  const locationList = document.getElementById('manualLocationList');
  const panelToggleBtn = document.getElementById('manualToggleBtn');
  const panelCloseBtn = document.getElementById('manualCloseBtn');
  if (!panel || !form || !locationList) {
    return { updateLocationOptions: () => {} };
  }

  const state = {
    panel,
    panelToggleBtn,
    panelCloseBtn,
    apiBasePath: options.apiBasePath || '',
    onSaved: typeof options.onSaved === 'function' ? options.onSaved : null,
    locationLookup: new Map(),
    startTimeInput: document.getElementById('manualStartTime'),
    endTimeInput: document.getElementById('manualEndTime'),
    startNameInput: document.getElementById('manualStartName'),
    startLatInput: document.getElementById('manualStartLat'),
    startLonInput: document.getElementById('manualStartLon'),
    endNameInput: document.getElementById('manualEndName'),
    endLatInput: document.getElementById('manualEndLat'),
    endLonInput: document.getElementById('manualEndLon'),
    startPickBtn: document.getElementById('manualStartPickBtn'),
    endPickBtn: document.getElementById('manualEndPickBtn'),
    startPickHint: document.getElementById('manualStartPickHint'),
    endPickHint: document.getElementById('manualEndPickHint'),
    distanceValue: document.getElementById('manualDistance'),
    durationValue: document.getElementById('manualDuration'),
    addButton: document.getElementById('manualAddBtn'),
    deleteButton: document.getElementById('manualDeleteBtn'),
    activePickTarget: null,
    panelLayoutRestore: null
  };

  const inputFields = [
    state.startTimeInput,
    state.endTimeInput,
    state.startLatInput,
    state.startLonInput,
    state.endLatInput,
    state.endLonInput
  ].filter(Boolean);

  inputFields.forEach(field => {
    field.addEventListener('input', () => updateManualMetrics(state));
    field.addEventListener('change', () => updateManualMetrics(state));
  });

  if (state.startTimeInput) {
    state.startTimeInput.addEventListener('blur', () => normalizeDatetimeInputValue(state.startTimeInput));
  }
  if (state.endTimeInput) {
    state.endTimeInput.addEventListener('blur', () => normalizeDatetimeInputValue(state.endTimeInput));
  }

  if (state.startNameInput) {
    state.startNameInput.addEventListener('change', () => {
      applyLocationLookup(state, state.startNameInput, state.startLatInput, state.startLonInput);
    });
  }
  if (state.endNameInput) {
    state.endNameInput.addEventListener('change', () => {
      applyLocationLookup(state, state.endNameInput, state.endLatInput, state.endLonInput);
    });
  }

  form.addEventListener('reset', () => {
    window.requestAnimationFrame(() => updateManualMetrics(state));
    setPickMode(state, null);
  });

  if (panelToggleBtn) {
    panelToggleBtn.addEventListener('click', () => {
      const shouldShow = state.panel.hidden;
      if (shouldShow) {
        form.reset();
        setEditMode(state, null);
      }
      setPanelVisibility(state, shouldShow);
      if (shouldShow && typeof state.panel.scrollIntoView === 'function') {
        state.panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  }

  if (panelCloseBtn) {
    panelCloseBtn.addEventListener('click', () => {
      setPanelVisibility(state, false);
    });
  }

  if (state.deleteButton) {
    state.deleteButton.addEventListener('click', async () => {
      if (!state.editId) return;
      const confirmed = window.confirm('Delete this manual voyage?');
      if (!confirmed) return;
      setBusyState(state, true);
      try {
        if (typeof options.onDelete === 'function') {
          await options.onDelete(state.editId);
        } else {
          await deleteManualVoyage(state.editId, state.apiBasePath);
        }
        form.reset();
        setEditMode(state, null);
        setPanelVisibility(state, false);
        if (state.onSaved) {
          await state.onSaved();
        }
      } catch (err) {
        console.error('[voyage-webapp] Manual voyage delete failed', err);
        const message = err && err.message ? err.message : 'Failed to delete manual voyage. Please try again.';
        alert(message);
      } finally {
        setBusyState(state, false);
      }
    });
  }

  const container = document.querySelector('.container');
  if (container && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (container.classList.contains('mobile-layout')) {
        setPanelVisibility(state, false);
      }
    });
    observer.observe(container, { attributes: true, attributeFilter: ['class'] });
  }

  if (state.startPickBtn) {
    state.startPickBtn.addEventListener('click', () => {
      if (state.activePickTarget === 'start') {
        setPickMode(state, null);
        return;
      }
      setPanelVisibility(state, true);
      setPickMode(state, 'start');
      setMapClickCapture((event) => handleMapPick(state, 'start', event));
    });
  }

  if (state.endPickBtn) {
    state.endPickBtn.addEventListener('click', () => {
      if (state.activePickTarget === 'end') {
        setPickMode(state, null);
        return;
      }
      setPanelVisibility(state, true);
      setPickMode(state, 'end');
      setMapClickCapture((event) => handleMapPick(state, 'end', event));
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    normalizeDatetimeInputValue(state.startTimeInput);
    normalizeDatetimeInputValue(state.endTimeInput);
    updateManualMetrics(state);
    if (!form.reportValidity()) return;
    const payload = buildManualPayload(state);
    if (!payload) {
      alert('Please complete all fields with valid values.');
      return;
    }
    setBusyState(state, true);
    try {
      if (state.editId) {
        await updateManualVoyage(state.editId, payload, state.apiBasePath);
      } else {
        await saveManualVoyage(payload, state.apiBasePath);
      }
      form.reset();
      updateManualMetrics(state);
      setEditMode(state, null);
      setPanelVisibility(state, false);
      if (state.onSaved) {
        await state.onSaved();
      }
    } catch (err) {
      console.error('[voyage-webapp] Manual voyage save failed', err);
      const message = err && err.message ? err.message : 'Failed to save manual voyage. Please try again.';
      alert(message);
    } finally {
      setBusyState(state, false);
    }
  });

  /**
   * Function: updateLocationOptions
   * Description: Refresh the datalist options with stored location names.
   * Parameters:
   *   locations (ManualLocation[]): Array of known manual locations.
   * Returns: void.
   */
  function updateLocationOptions(locations = []) {
    state.locationLookup.clear();
    locationList.innerHTML = '';
    if (!Array.isArray(locations)) return;
    locations.forEach((location) => {
      if (!location || typeof location !== 'object') return;
      const key = normalizeLocationName(location.name);
      if (!key || state.locationLookup.has(key)) return;
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return;
      state.locationLookup.set(key, location);
      const option = document.createElement('option');
      option.value = location.name;
      locationList.appendChild(option);
    });
  }

  updateManualMetrics(state);
  setPanelVisibility(state, !panel.hidden);
  setEditMode(state, null);

  return {
    updateLocationOptions,
    /**
     * Function: openForEdit
     * Description: Open the manual voyage panel populated for editing.
     * Parameters:
     *   voyage (object): Manual voyage data to load into the form.
     * Returns: void.
     */
    openForEdit(voyage) {
      if (!voyage || !voyage.manualId) return;
      setPanelVisibility(state, true);
      setEditMode(state, voyage);
      populateFormFromVoyage(state, voyage);
      if (typeof state.panel.scrollIntoView === 'function') {
        state.panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
  };
}
