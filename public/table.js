/**
 * Module Responsibilities:
 * - Render the voyage summary table, including per-day expansion rows and totals.
 * - Track table row references so other modules can coordinate selections.
 * - Publish voyage and segment selection events for map consumers while reflecting active state.
 *
 * Exported API:
 * - Data accessors: `setVoyageTableData`, `getVoyageRows`, `getVoyageRowByIndex`, `getVoyageByIndex`,
 *   `getVoyageData`, `clearVoyageTableData`.
 * - Selection helpers: `setSelectedTableRow`.
 * - Rendering helpers: `renderVoyageTable`, `renderTotalsRow`.
 *
 * @typedef {import('./types.js').Voyage} Voyage
 * @typedef {import('./types.js').VoyageSegment} VoyageSegment
 * @typedef {import('./types.js').VoyageTotals} VoyageTotals
 */

import { degToCompass, dateHourLabel, weekdayShort } from './util.js';
import { emit, on, EVENTS } from './events.js';

let voyageRows = [];
let voyageData = [];

/**
 * Function: setVoyageTableData
 * Description: Store the current voyage dataset and associated table rows for later retrieval.
 * Parameters:
 *   voyages (object[]): Array of voyage descriptors rendered in the table.
 *   rows (HTMLTableRowElement[]): Matching table row elements.
 * Returns: void.
 */
export function setVoyageTableData(voyages, rows) {
  voyageData = Array.isArray(voyages) ? voyages : [];
  voyageRows = Array.isArray(rows) ? rows : [];
}

/**
 * Function: getVoyageRows
 * Description: Retrieve the stored voyage rows.
 * Parameters: None.
 * Returns: HTMLTableRowElement[] - Array of voyage rows in render order.
 */
export function getVoyageRows() {
  return voyageRows;
}

/**
 * Function: getVoyageRowByIndex
 * Description: Return the voyage row corresponding to the given zero-based index.
 * Parameters:
 *   index (number): Zero-based voyage index.
 * Returns: HTMLTableRowElement|undefined - Matching table row or undefined when absent.
 */
export function getVoyageRowByIndex(index) {
  return voyageRows[index];
}

/**
 * Function: getVoyageByIndex
 * Description: Return the voyage data item corresponding to the given zero-based index.
 * Parameters:
 *   index (number): Zero-based voyage index.
 * Returns: object|undefined - Voyage data object or undefined when absent.
 */
export function getVoyageByIndex(index) {
  return voyageData[index];
}

/**
 * Function: getVoyageData
 * Description: Retrieve the stored voyage dataset.
 * Parameters: None.
 * Returns: object[] - Array of voyage descriptors in render order.
 */
export function getVoyageData() {
  return voyageData;
}

/**
 * Function: clearVoyageTableData
 * Description: Reset cached voyage table rows and dataset.
 * Parameters: None.
 * Returns: void.
 */
export function clearVoyageTableData() {
  voyageRows = [];
  voyageData = [];
}

/**
 * Function: setSelectedTableRow
 * Description: Apply selection styling to a voyage table row while clearing previous selections.
 * Parameters:
 *   row (HTMLTableRowElement|null): Table row to mark as selected.
 * Returns: void.
 */
export function setSelectedTableRow(row) {
  document.querySelectorAll('#voyTable tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  if (row) row.classList.add('selected-row');
}

/**
 * Function: renderTotalsRow
 * Description: Append a totals row summarizing voyage metrics to the voyages table body.
 * Parameters:
 *   tbody (HTMLElement): Table body element that will receive the new totals row.
 *   totals (object): Aggregated voyage totals including distance and activity durations.
 *   formatDuration (Function): Helper that formats durations for display.
 * Returns: void.
 */
export function renderTotalsRow(tbody, totals, formatDuration) {
  if (!tbody || !totals) return;
  const totalDistanceNm = Number.isFinite(totals.totalDistanceNm) ? totals.totalDistanceNm : 0;
  const totalActiveMs = Number.isFinite(totals.totalActiveMs) ? totals.totalActiveMs : 0;
  const totalSailingMs = Number.isFinite(totals.totalSailingMs) ? totals.totalSailingMs : 0;
  const sailingPct = totalActiveMs > 0 ? ((totalSailingMs / totalActiveMs) * 100) : 0;
  const row = tbody.insertRow();
  row.classList.add('totals-row');
  const formatFn = typeof formatDuration === 'function' ? formatDuration : () => '0d 0h 0m';
  row.innerHTML = `
    <td colspan="2" class="idx-cell totals-label">&nbspTotals</td>
    <td colspan="2" class="totals-active">Active Time: ${formatFn(totalActiveMs)}</td>
    <td colspan="2" class="totals-distance">${totalDistanceNm.toFixed(1)} NM</td>
    <td colspan="4" class="totals-sailing">Sailing Time: ${formatFn(totalSailingMs)} (${sailingPct.toFixed(1)}%)</td>
    `;
  row.addEventListener('click', () => {
    emit(EVENTS.SELECTION_RESET_REQUESTED, { source: 'table-totals' });
  });
}

function createVoyageRowHTML(voyage, index, isMultiDay) {
  const avgWindDir = (voyage.avgWindHeading !== undefined && voyage.avgWindHeading !== null)
    ? degToCompass(voyage.avgWindHeading)
    : '';
  const expander = isMultiDay ? '<button class="expander-btn" aria-label="Toggle days">[+]</button>' : '';
  return `
    <td class="exp-cell">${expander}</td>
    <td class="idx-cell">${index + 1}</td>
    <td>${dateHourLabel(voyage.startTime)}</td>
    <td class="end-col">${dateHourLabel(voyage.endTime)}</td>
    <td>${voyage.nm.toFixed(1)}</td>
    <td class="max-speed-cell" tabindex="0">${voyage.maxSpeed.toFixed(1)}<span class="unit-kn"> kn</span></td>
    <td class="avg-speed-col">${voyage.avgSpeed.toFixed(1)} kn</td>
    <td class="max-wind-cell">${voyage.maxWind.toFixed(1)}<span class="unit-kn"> kn</span></td>
    <td class="avg-wind-col">${voyage.avgWindSpeed.toFixed(1)} kn</td>
    <td>${avgWindDir}</td>`;
}

function createDayRowHTML(segment) {
  const avgWindDirDay = (segment.avgWindHeading !== undefined && segment.avgWindHeading !== null)
    ? degToCompass(segment.avgWindHeading)
    : '';
  const dayLbl = weekdayShort(segment.startTime);
  return `
    <td class="exp-cell"></td>
    <td class="idx-cell">${dayLbl}</td>
    <td>${dateHourLabel(segment.startTime)}</td>
    <td class="end-col">${dateHourLabel(segment.endTime)}</td>
    <td>${segment.nm.toFixed(1)}</td>
    <td class="max-speed-cell" tabindex="0">${segment.maxSpeed.toFixed(1)}<span class="unit-kn"> kn</span></td>
    <td class="avg-speed-col">${segment.avgSpeed.toFixed(1)} kn</td>
    <td class="max-wind-cell">${segment.maxWind.toFixed(1)}<span class="unit-kn"> kn</span></td>
    <td class="avg-wind-col">${segment.avgWindSpeed.toFixed(1)} kn</td>
    <td>${avgWindDirDay}</td>`;
}

function attachVoyageRowHandlers(row, voyage) {
  row.addEventListener('click', (event) => {
    const target = event.target;
    if (target && target.classList && target.classList.contains('expander-btn')) {
      return;
    }
    const wasSelected = row.classList.contains('selected-row');
    emit(EVENTS.VOYAGE_SELECT_REQUESTED, {
      voyage,
      row,
      source: 'table-row',
      options: { fit: true, suppressHistory: false },
      metadata: { wasSelected }
    });
  });

  const maxSpeedCell = row.querySelector('.max-speed-cell');
  if (maxSpeedCell) {
    const activate = (event) => {
      event.stopPropagation();
      const wasSelected = row.classList.contains('selected-row');
      emit(EVENTS.VOYAGE_MAX_SPEED_REQUESTED, {
        voyage,
        row,
        source: 'table-row-max-speed',
        coord: voyage.maxSpeedCoord,
        speed: voyage.maxSpeed,
        options: {
          fit: !wasSelected,
          suppressHistory: wasSelected
        },
        metadata: { wasSelected }
      });
    };
    maxSpeedCell.addEventListener('click', activate);
    maxSpeedCell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(event);
      }
    });
  }
}

function attachDayRowHandlers(dayRow, voyage, segment, voyageRow) {
  dayRow.addEventListener('click', (event) => {
    event.stopPropagation();
    emit(EVENTS.SEGMENT_SELECT_REQUESTED, {
      voyage,
      row: voyageRow,
      segment,
      source: 'table-day-row',
      options: {
        fit: false,
        suppressHistory: true
      }
    });
  });

  const maxSpeedCell = dayRow.querySelector('.max-speed-cell');
  if (maxSpeedCell) {
    const activate = (event) => {
      event.stopPropagation();
      emit(EVENTS.SEGMENT_MAX_SPEED_REQUESTED, {
        voyage,
        row: voyageRow,
        segment,
        source: 'table-day-max-speed',
        coord: segment.maxSpeedCoord,
        speed: segment.maxSpeed,
        options: {
          fit: false,
          suppressHistory: true
        }
      });
    };
    maxSpeedCell.addEventListener('click', activate);
    maxSpeedCell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(event);
      }
    });
  }
}

function attachExpanderHandler(row, dayRows) {
  const btn = row.querySelector('.expander-btn');
  if (!btn) return;
  const wrapper = document.querySelector('.table-wrapper');
  let expanded = false;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    expanded = !expanded;
    btn.textContent = expanded ? '[-]' : '[+]';
    dayRows.forEach(r => r.classList.toggle('hidden', !expanded));
    if (expanded && dayRows.length && wrapper) {
      requestAnimationFrame(() => {
        const first = dayRows[0];
        const last = dayRows[dayRows.length - 1];
        if (!first || !last) return;
        const wrapperRect = wrapper.getBoundingClientRect();
        const firstRect = first.getBoundingClientRect();
        const lastRect = last.getBoundingClientRect();
        const pad = 8;
        if (firstRect.top < wrapperRect.top) {
          wrapper.scrollTop += (firstRect.top - wrapperRect.top) - pad;
        } else if (lastRect.bottom > wrapperRect.bottom) {
          wrapper.scrollTop += (lastRect.bottom - wrapperRect.bottom) + pad;
        }
      });
    }
  });
}

export function renderVoyageTable(tbody, voyages) {
  if (!tbody) return;
  tbody.innerHTML = '';
  clearVoyageTableData();
  const rows = [];

  voyages.forEach((voyage, index) => {
    const row = tbody.insertRow();
    row.dataset.tripIndex = String(index + 1);
    const segments = Array.isArray(voyage._segments) ? voyage._segments : [];
    const isMultiDay = segments.length > 1;
    row.innerHTML = createVoyageRowHTML(voyage, index, isMultiDay);
    rows.push(row);

    attachVoyageRowHandlers(row, voyage);

    const dayRows = [];
    if (segments.length > 0) {
      let insertIndex = row.sectionRowIndex + 1;
      segments.forEach((segment) => {
        const dayRow = tbody.insertRow(insertIndex);
        insertIndex += 1;
        dayRow.classList.add('day-row', 'hidden');
        dayRow.innerHTML = createDayRowHTML(segment);
        dayRows.push(dayRow);
        attachDayRowHandlers(dayRow, voyage, segment, row);
      });
    }

    if (dayRows.length > 0) {
      attachExpanderHandler(row, dayRows);
    }
  });

  setVoyageTableData(voyages, rows);
  return { rows };
}

/**
 * Function: handleVoyageSelectedEvent
 * Description: Apply table row selection styling when a voyage selection event is received.
 * Parameters:
 *   payload (object): Event payload containing voyage and row references.
 * Returns: void.
 */
function handleVoyageSelectedEvent(payload = {}) {
  const explicitRow = payload?.row;
  if (explicitRow instanceof HTMLTableRowElement) {
    setSelectedTableRow(explicitRow);
    return;
  }
  const voyage = payload?.voyage;
  if (voyage && typeof voyage._tripIndex === 'number') {
    const idx = voyage._tripIndex - 1;
    const row = getVoyageRowByIndex(idx);
    if (row) {
      setSelectedTableRow(row);
    }
  }
}

/**
 * Function: handleSelectionResetComplete
 * Description: Clear table selection styling after a reset completes.
 * Parameters: None.
 * Returns: void.
 */
function handleSelectionResetComplete() {
  setSelectedTableRow(null);
}

on(EVENTS.VOYAGE_SELECTED, handleVoyageSelectedEvent);
on(EVENTS.SELECTION_RESET_COMPLETE, handleSelectionResetComplete);
