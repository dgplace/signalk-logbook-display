/**
 * Module Responsibilities:
 * - Handle the manual voyage entry panel UI, calculations, and API submissions.
 * - Maintain an autocomplete list of saved manual locations for faster data entry.
 *
 * Exported API:
 * - initManualVoyagePanel
 *
 * @typedef {import('./types.js').ManualLocation} ManualLocation
 * @typedef {import('./types.js').ManualVoyageStop} ManualVoyageStop
 * @typedef {import('./types.js').Voyage} Voyage
 */

import { calculateDistanceNm, formatDurationMs, MANUAL_AVG_SPEED_KN } from './data.js';
import { setMapClickCapture, clearMapClickCapture } from './map.js';

const PLACEHOLDER_VALUE = '—';
const MIN_MANUAL_LOCATIONS = 2;

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
 * Function: coerceDateValue
 * Description: Convert a datetime payload into a Date object when possible.
 * Parameters:
 *   value (string|Date): Value to convert.
 * Returns: Date|null - Parsed Date instance or null when invalid.
 */
function coerceDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  return parseDateInput(String(value));
}

/**
 * Function: buildLocationLabel
 * Description: Build a tab label for the location entry based on position.
 * Parameters:
 *   index (number): Zero-based index of the location.
 *   total (number): Total number of locations.
 * Returns: string - Label for the location tab.
 */
function buildLocationLabel(index, total) {
  if (index === 0) return 'Start';
  if (index === total - 1) return 'End';
  return `Stop ${index}`;
}

/**
 * Function: setActiveLocation
 * Description: Switch the active location tab and panel by index.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   index (number): Zero-based index to activate.
 * Returns: void.
 */
function setActiveLocation(state, index) {
  if (!state || !Array.isArray(state.locations)) return;
  const total = state.locations.length;
  const nextIndex = Number.isInteger(index) ? Math.max(0, Math.min(index, total - 1)) : 0;
  state.activeLocationIndex = nextIndex;
  state.locations.forEach((entry, entryIndex) => {
    const isActive = entryIndex === nextIndex;
    if (entry.tab) {
      entry.tab.classList.toggle('is-active', isActive);
      entry.tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      entry.tab.setAttribute('tabindex', isActive ? '0' : '-1');
    }
    if (entry.panel) {
      entry.panel.hidden = !isActive;
    }
  });
}

/**
 * Function: refreshLocationLabels
 * Description: Update location tab labels and remove button visibility.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function refreshLocationLabels(state) {
  if (!state || !Array.isArray(state.locations)) return;
  const total = state.locations.length;
  state.locations.forEach((entry, index) => {
    const label = buildLocationLabel(index, total);
    if (entry.tab) entry.tab.textContent = label;
    if (entry.title) entry.title.textContent = label;
    if (entry.removeBtn) {
      entry.removeBtn.hidden = index === 0 || index === total - 1;
    }
    if (entry.timeInput) {
      entry.timeInput.required = index < total - 1;
      const isEndStop = index === total - 1;
      entry.timeInput.readOnly = isEndStop;
      entry.timeInput.disabled = isEndStop;
      if (isEndStop) {
        entry.timeEdited = false;
      }
    }
  });
}

/**
 * Function: createLocationEntry
 * Description: Create and append a new location tab and panel.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   data (object): Optional location data to prefill.
 *   insertIndex (number): Array index to insert at.
 * Returns: object|null - Location entry state or null when creation fails.
 */
function createLocationEntry(state, data = {}, insertIndex = null) {
  if (!state || !state.locationTemplate || !state.tabList || !state.tabPanels) return null;
  const template = state.locationTemplate;
  const fragment = template.content.cloneNode(true);
  const panel = fragment.querySelector('.manual-location-panel');
  if (!panel) return null;
  const title = panel.querySelector('.manual-group-title');
  const timeInput = panel.querySelector('.manual-time-input');
  const nameInput = panel.querySelector('.manual-name-input');
  const latInput = panel.querySelector('.manual-lat-input');
  const lonInput = panel.querySelector('.manual-lon-input');
  const pickBtn = panel.querySelector('.manual-pick-btn');
  const pickHint = panel.querySelector('.manual-pick-hint');
  const removeBtn = panel.querySelector('.manual-remove-btn');
  const entryId = `manual-location-${state.locationIdCounter += 1}`;
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'manual-tab';
  tab.id = `${entryId}-tab`;
  panel.id = `${entryId}-panel`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', tab.id);
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', panel.id);
  tab.setAttribute('aria-selected', 'false');
  tab.setAttribute('tabindex', '-1');

  const entry = {
    id: entryId,
    tab,
    panel,
    title,
    timeInput,
    nameInput,
    latInput,
    lonInput,
    pickBtn,
    pickHint,
    removeBtn,
    timeEdited: false
  };

  if (data && typeof data === 'object') {
    const dateValue = coerceDateValue(data.time);
    if (dateValue && timeInput) {
      timeInput.value = formatDatetimeLocal(dateValue);
      entry.timeEdited = Boolean(state.editId);
    }
    if (data.name && nameInput) {
      nameInput.value = data.name;
    }
    if (Number.isFinite(data.lat) && latInput) {
      latInput.value = Number(data.lat).toFixed(6);
    }
    if (Number.isFinite(data.lon) && lonInput) {
      lonInput.value = Number(data.lon).toFixed(6);
    }
  }

  const listIndex = Number.isInteger(insertIndex) ? insertIndex : state.locations.length;
  state.locations.splice(listIndex, 0, entry);

  if (listIndex >= state.tabList.children.length) {
    state.tabList.appendChild(tab);
    state.tabPanels.appendChild(panel);
  } else {
    state.tabList.insertBefore(tab, state.tabList.children[listIndex]);
    state.tabPanels.insertBefore(panel, state.tabPanels.children[listIndex]);
  }

  tab.addEventListener('click', () => {
    const idx = state.locations.indexOf(entry);
    if (idx >= 0) {
      setPickMode(state, null);
      setActiveLocation(state, idx);
    }
  });

  const updateHandler = () => updateManualMetrics(state);
  [latInput, lonInput].filter(Boolean).forEach((input) => {
    input.addEventListener('input', updateHandler);
    input.addEventListener('change', updateHandler);
  });

  if (timeInput) {
    const handleTimeChange = () => {
      entry.timeEdited = true;
      updateManualMetrics(state);
    };
    timeInput.addEventListener('input', handleTimeChange);
    timeInput.addEventListener('change', handleTimeChange);
    timeInput.addEventListener('blur', () => normalizeDatetimeInputValue(timeInput));
  }

  if (nameInput) {
    nameInput.addEventListener('change', () => {
      applyLocationLookup(state, entry);
    });
  }

  if (pickBtn) {
    pickBtn.addEventListener('click', () => {
      const idx = state.locations.indexOf(entry);
      if (idx < 0) return;
      if (state.activePickIndex === idx) {
        setPickMode(state, null);
        return;
      }
      setPanelVisibility(state, true);
      setActiveLocation(state, idx);
      setPickMode(state, idx);
      setMapClickCapture((event) => handleMapPick(state, idx, event));
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      const idx = state.locations.indexOf(entry);
      if (idx <= 0 || idx === state.locations.length - 1) return;
      state.locations.splice(idx, 1);
      entry.tab.remove();
      entry.panel.remove();
      if (state.activePickIndex === idx) {
        setPickMode(state, null);
      }
      if (state.activeLocationIndex >= state.locations.length) {
        state.activeLocationIndex = state.locations.length - 1;
      }
      refreshLocationLabels(state);
      setActiveLocation(state, state.activeLocationIndex);
      updateManualMetrics(state);
    });
  }

  return entry;
}

/**
 * Function: rebuildLocationEntries
 * Description: Reset the location tabs and panels to a new dataset.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   locations (ManualVoyageStop[]): Ordered location list.
 * Returns: void.
 */
function rebuildLocationEntries(state, locations = []) {
  if (!state || !state.tabList || !state.tabPanels) return;
  state.tabList.innerHTML = '';
  state.tabPanels.innerHTML = '';
  state.locations = [];
  state.activePickIndex = null;
  const safeLocations = Array.isArray(locations) ? locations : [];
  const initial = safeLocations.length ? safeLocations.slice() : [];
  while (initial.length < MIN_MANUAL_LOCATIONS) {
    initial.push({});
  }
  if (!coerceDateValue(initial[0]?.time)) {
    initial[0] = { ...initial[0], time: new Date() };
  }
  initial.forEach((location, index) => {
    createLocationEntry(state, location, index);
  });
  refreshLocationLabels(state);
  setActiveLocation(state, 0);
  setPickMode(state, null);
}

/**
 * Function: readLocationEntry
 * Description: Read a location entry into a normalised payload.
 * Parameters:
 *   entry (object): Location entry state.
 * Returns: object|null - Normalized location payload or null when incomplete.
 */
function readLocationEntry(entry) {
  if (!entry) return null;
  const location = readLocationFields(entry.nameInput, entry.latInput, entry.lonInput);
  const time = entry.timeInput ? parseDateInput(entry.timeInput.value) : null;
  if (!location || !time) return null;
  return {
    name: location.name,
    lat: location.lat,
    lon: location.lon,
    time
  };
}

/**
 * Function: computeLegDurationMs
 * Description: Calculate leg duration in milliseconds based on distance and average speed.
 * Parameters:
 *   prevEntry (object): Location entry for the leg start.
 *   nextEntry (object): Location entry for the leg end.
 * Returns: number|null - Duration in milliseconds or null when inputs are incomplete.
 */
function computeLegDurationMs(prevEntry, nextEntry) {
  const prevLocation = readLocationFields(prevEntry?.nameInput, prevEntry?.latInput, prevEntry?.lonInput);
  const nextLocation = readLocationFields(nextEntry?.nameInput, nextEntry?.latInput, nextEntry?.lonInput);
  if (!prevLocation || !nextLocation || MANUAL_AVG_SPEED_KN <= 0) return null;
  const distanceNm = calculateDistanceNm(prevLocation.lat, prevLocation.lon, nextLocation.lat, nextLocation.lon);
  if (!Number.isFinite(distanceNm)) return null;
  return (distanceNm / MANUAL_AVG_SPEED_KN) * 60 * 60 * 1000;
}

/**
 * Function: ensureStopTimes
 * Description: Auto-fill stop times based on previous times and leg durations.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: Date[] - Ordered list of resolved stop times.
 */
function ensureStopTimes(state) {
  if (!state || !Array.isArray(state.locations) || state.locations.length === 0) return [];
  const times = [];
  const firstEntry = state.locations[0];
  if (!firstEntry?.timeInput) return [];
  normalizeDatetimeInputValue(firstEntry.timeInput);
  let previousTime = parseDateInput(firstEntry.timeInput.value);
  if (!previousTime) return [];
  times[0] = previousTime;

  for (let i = 1; i < state.locations.length; i += 1) {
    const entry = state.locations[i];
    if (!entry?.timeInput) continue;
    normalizeDatetimeInputValue(entry.timeInput);
    const inputTime = parseDateInput(entry.timeInput.value);
    const isLast = i === state.locations.length - 1;
    const shouldAutoFill = isLast || !inputTime || !entry.timeEdited;
    let nextTime = inputTime;
    if (shouldAutoFill) {
      const durationMs = computeLegDurationMs(state.locations[i - 1], entry);
      if (Number.isFinite(durationMs)) {
        nextTime = new Date(previousTime.getTime() + durationMs);
      } else {
        nextTime = new Date(previousTime.getTime());
      }
      entry.timeInput.value = formatDatetimeLocal(nextTime);
      entry.timeEdited = false;
    }
    if (nextTime) {
      previousTime = nextTime;
      times[i] = nextTime;
    }
  }

  return times;
}

/**
 * Function: validateTimeOrder
 * Description: Enforce chronological ordering for manual stop times.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function validateTimeOrder(state, resolvedTimes = null) {
  if (!state || !Array.isArray(state.locations)) return;
  const times = Array.isArray(resolvedTimes) ? resolvedTimes : ensureStopTimes(state);
  let previousTime = null;
  state.locations.forEach((entry, index) => {
    if (!entry?.timeInput) return;
    entry.timeInput.setCustomValidity('');
    if (index === state.locations.length - 1 && !entry.timeInput.required) return;
    const nextTime = times[index] || parseDateInput(entry.timeInput.value);
    if (!nextTime) return;
    if (previousTime && nextTime.getTime() <= previousTime.getTime()) {
      entry.timeInput.setCustomValidity('Time must be after the previous stop.');
    }
    previousTime = nextTime;
  });
}

/**
 * Function: updateManualMetrics
 * Description: Recalculate and display distance and duration based on current input values.
 * Parameters:
 *   state (object): Manual voyage panel state.
 * Returns: void.
 */
function updateManualMetrics(state) {
  if (!state || !Array.isArray(state.locations)) return;
  const resolvedTimes = ensureStopTimes(state);
  validateTimeOrder(state, resolvedTimes);
  const distanceValue = state.distanceValue;
  const durationValue = state.durationValue;
  let distanceNm = null;
  const locations = state.locations.map(entry => readLocationFields(entry.nameInput, entry.latInput, entry.lonInput));
  if (locations.every(Boolean) && locations.length >= MIN_MANUAL_LOCATIONS) {
    distanceNm = locations.reduce((sum, location, index) => {
      if (index === 0) return 0;
      const prev = locations[index - 1];
      const legDistance = calculateDistanceNm(prev.lat, prev.lon, location.lat, location.lon);
      return sum + (Number.isFinite(legDistance) ? legDistance : 0);
    }, 0);
  }
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
    const label = isEdit ? 'Save manual voyage' : 'Add manual voyage';
    state.addButton.textContent = label;
    state.addButton.dataset.defaultLabel = label;
  }
  if (state.deleteButton) {
    state.deleteButton.hidden = !isEdit;
  }
}

/**
 * Function: extractVoyageLocations
 * Description: Build a location list from a manual voyage entry for editing.
 * Parameters:
 *   voyage (object): Manual voyage data to extract.
 * Returns: ManualVoyageStop[] - Ordered manual locations for the edit panel.
 */
function extractVoyageLocations(voyage) {
  if (!voyage || typeof voyage !== 'object') return [];
  const manualLocations = Array.isArray(voyage.manualLocations) ? voyage.manualLocations : [];
  if (manualLocations.length >= MIN_MANUAL_LOCATIONS) {
    return manualLocations.map((location) => ({
      name: location?.name || '',
      lat: Number.isFinite(Number(location?.lat)) ? Number(location.lat) : null,
      lon: Number.isFinite(Number(location?.lon)) ? Number(location.lon) : null,
      time: location?.time || location?.datetime || location?.startTime || ''
    }));
  }
  if (voyage.startTime && voyage.endTime) {
    return [
      {
        name: voyage.startLocation?.name || '',
        lat: Number.isFinite(Number(voyage.startLocation?.lat)) ? Number(voyage.startLocation.lat) : null,
        lon: Number.isFinite(Number(voyage.startLocation?.lon)) ? Number(voyage.startLocation.lon) : null,
        time: voyage.startTime
      },
      {
        name: voyage.endLocation?.name || '',
        lat: Number.isFinite(Number(voyage.endLocation?.lat)) ? Number(voyage.endLocation.lat) : null,
        lon: Number.isFinite(Number(voyage.endLocation?.lon)) ? Number(voyage.endLocation.lon) : null,
        time: voyage.endTime
      }
    ];
  }
  return [];
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
  const locations = extractVoyageLocations(voyage);
  rebuildLocationEntries(state, locations);
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
 * Description: Enable or disable map picking mode for a location index.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   target (number|null): Target location index or null to clear.
 * Returns: void.
 */
function setPickMode(state, target) {
  if (!state || !Array.isArray(state.locations)) return;
  const nextIndex = Number.isInteger(target) ? target : null;
  state.activePickIndex = nextIndex;
  state.locations.forEach((entry, index) => {
    const isActive = nextIndex === index;
    setPickButtonState(entry.pickBtn, entry.pickHint, isActive);
  });
  if (nextIndex === null) {
    clearMapClickCapture();
  }
}

/**
 * Function: handleMapPick
 * Description: Handle map clicks to populate manual coordinate fields.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   target (number): Location index to update.
 *   event (object): Leaflet click event containing latlng.
 * Returns: boolean - True when handled to prevent default map selection.
 */
function handleMapPick(state, target, event) {
  if (!state || !Array.isArray(state.locations) || !event || !event.latlng) return false;
  const idx = Number.isInteger(target) ? target : null;
  if (idx === null || idx < 0 || idx >= state.locations.length) return false;
  const entry = state.locations[idx];
  const { lat, lng } = event.latlng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const latValue = lat.toFixed(6);
  const lonValue = lng.toFixed(6);
  if (entry.latInput) entry.latInput.value = latValue;
  if (entry.lonInput) entry.lonInput.value = lonValue;
  if (entry.nameInput) entry.nameInput.focus();
  updateManualMetrics(state);
  setPickMode(state, null);
  return true;
}

/**
 * Function: applyLocationLookup
 * Description: Apply stored location coordinates when a known name is selected.
 * Parameters:
 *   state (object): Manual voyage panel state.
 *   entry (object): Location entry state to update.
 * Returns: void.
 */
function applyLocationLookup(state, entry) {
  if (!state || !entry || !entry.nameInput || !entry.latInput || !entry.lonInput) return;
  const key = normalizeLocationName(entry.nameInput.value);
  if (!key) return;
  const match = state.locationLookup.get(key);
  if (!match) return;
  entry.latInput.value = Number(match.lat).toFixed(6);
  entry.lonInput.value = Number(match.lon).toFixed(6);
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
  if (!state || !Array.isArray(state.locations)) return null;
  const resolvedTimes = ensureStopTimes(state);
  if (resolvedTimes.length < MIN_MANUAL_LOCATIONS) return null;
  const locations = state.locations.map((entry, index) => {
    const location = readLocationFields(entry.nameInput, entry.latInput, entry.lonInput);
    if (!location) return null;
    const time = resolvedTimes[index] || parseDateInput(entry.timeInput?.value || '');
    if (!time) return null;
    return {
      name: location.name,
      lat: location.lat,
      lon: location.lon,
      time: time.toISOString()
    };
  });
  if (locations.some(location => !location)) return null;
  for (let i = 1; i < locations.length; i += 1) {
    const prev = new Date(locations[i - 1].time);
    const next = new Date(locations[i].time);
    if (!Number.isFinite(prev.getTime()) || !Number.isFinite(next.getTime())) return null;
    if (next.getTime() <= prev.getTime()) return null;
  }
  const startLocation = readLocationFields(
    state.locations[0].nameInput,
    state.locations[0].latInput,
    state.locations[0].lonInput
  );
  const endLocation = readLocationFields(
    state.locations[state.locations.length - 1].nameInput,
    state.locations[state.locations.length - 1].latInput,
    state.locations[state.locations.length - 1].lonInput
  );
  if (!startLocation || !endLocation) return null;
  const startTime = locations[0].time;
  const endTime = locations[locations.length - 1].time;
  return {
    locations,
    startTime,
    endTime,
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
  const defaultLabel = state.addButton.dataset.defaultLabel || state.addButton.textContent || 'Add manual voyage';
  state.addButton.textContent = isBusy ? 'Saving...' : defaultLabel;
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
  const tabList = document.getElementById('manualTabList');
  const tabPanels = document.getElementById('manualTabPanels');
  const locationTemplate = document.getElementById('manualLocationTemplate');
  const addStopBtn = document.getElementById('manualAddStopBtn');
  if (!panel || !form || !locationList || !tabList || !tabPanels || !locationTemplate) {
    return { updateLocationOptions: () => {} };
  }

  const state = {
    panel,
    panelToggleBtn,
    panelCloseBtn,
    tabList,
    tabPanels,
    locationTemplate,
    addStopBtn,
    apiBasePath: options.apiBasePath || '',
    onSaved: typeof options.onSaved === 'function' ? options.onSaved : null,
    locationLookup: new Map(),
    distanceValue: document.getElementById('manualDistance'),
    durationValue: document.getElementById('manualDuration'),
    addButton: document.getElementById('manualAddBtn'),
    deleteButton: document.getElementById('manualDeleteBtn'),
    locations: [],
    activeLocationIndex: 0,
    activePickIndex: null,
    locationIdCounter: 0,
    panelLayoutRestore: null
  };

  rebuildLocationEntries(state, []);

  form.addEventListener('reset', () => {
    window.requestAnimationFrame(() => {
      rebuildLocationEntries(state, []);
      updateManualMetrics(state);
    });
    setPickMode(state, null);
  });

  if (panelToggleBtn) {
    panelToggleBtn.addEventListener('click', () => {
      const shouldShow = state.panel.hidden;
      if (shouldShow) {
        form.reset();
        setEditMode(state, null);
        rebuildLocationEntries(state, []);
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
        rebuildLocationEntries(state, []);
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

  if (addStopBtn) {
    addStopBtn.addEventListener('click', () => {
      const insertIndex = Math.max(state.locations.length - 1, 1);
      createLocationEntry(state, {}, insertIndex);
      refreshLocationLabels(state);
      setActiveLocation(state, insertIndex);
      updateManualMetrics(state);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
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
      setEditMode(state, null);
      rebuildLocationEntries(state, []);
      updateManualMetrics(state);
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
