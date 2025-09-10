// Logbook app logic
// Depends on Leaflet (global L). Expects DOM with #map, #voyTable, #pointDetails.

// Compass utility
function degToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// Global state
let map, polylines = [], maxMarker;
let activePolylines = [];
let activeLineClickers = [];
let selectedPointMarker = null;
let squareIcon = L.divIcon({ className: 'square-marker', iconSize: [10,10] });
let tinySquareIcon = L.divIcon({ className: 'tiny-square-marker', iconSize: [6,6] });
let activePointMarkersGroup = null;
let selectedWindGroup = null;
let currentVoyagePoints = [];

// Data helpers
function getVoyagePoints(v) {
  if (Array.isArray(v.points) && v.points.length) return v.points;
  if (Array.isArray(v.entries) && v.entries.length) return v.entries;
  if (Array.isArray(v.coords) && v.coords.length) return v.coords.map(([lon, lat]) => ({ lon, lat }));
  return [];
}

function drawMaxSpeedMarkerFromCoord(coord, speed) {
  if (maxMarker) { map.removeLayer(maxMarker); maxMarker = null; }
  if (coord && coord.length === 2) {
    const [lon, lat] = coord;
    maxMarker = L.circleMarker([lat, lon], { color: 'orange', radius: 6 }).addTo(map);
    maxMarker.bindPopup(`Max SoG: ${Number(speed).toFixed(1)} kn`).openPopup();
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
}

// Select a voyage from table or map and set up interactions
function selectVoyage(v, row, opts = {}) {
  const { fit = true } = opts;
  // highlight table row
  setSelectedTableRow(row);
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
  activePolylines = [];
  if (v._segments && v._segments.length > 0) {
    v._segments.forEach(seg => {
      seg.polyline.setStyle({ color: 'red', weight: 4 });
      activePolylines.push(seg.polyline);
    });
    if (fit && v._segments[0].polyline) {
      let b = v._segments[0].polyline.getBounds();
      for (let k = 1; k < v._segments.length; k++) b = b.extend(v._segments[k].polyline.getBounds());
      map.fitBounds(b);
    }
  } else if (v._fallbackPolyline) {
    v._fallbackPolyline.setStyle({ color: 'red', weight: 4 });
    activePolylines = [v._fallbackPolyline];
    if (fit) map.fitBounds(v._fallbackPolyline.getBounds());
  }

  // update max speed marker
  drawMaxSpeedMarkerFromCoord(v.maxSpeedCoord, v.maxSpeed);

  // clear previous point selection
  if (selectedPointMarker) { map.removeLayer(selectedPointMarker); selectedPointMarker = null; }
  detachActiveClickers();

  // attach click handler to red path to select nearest point
  const voyagePoints = getVoyagePoints(v);
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
      const m = L.marker([p.lat, p.lon], { icon: tinySquareIcon });
      m.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        updateSelectedPoint(p, { prev: voyagePoints[idx-1], next: voyagePoints[idx+1] });
      });
      m.addTo(activePointMarkersGroup);
    });
    activePointMarkersGroup.addTo(map);
  }

  setDetailsHint('Click on the red path to inspect a point.');
}

// UI helpers
function setSelectedTableRow(row) {
  document.querySelectorAll('#voyTable tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  if (row) row.classList.add('selected-row');
}

function clearActivePointMarkers() {
  if (activePointMarkersGroup) { map.removeLayer(activePointMarkersGroup); activePointMarkersGroup = null; }
}

function clearSelectedWindGraphics() {
  if (selectedWindGroup) { map.removeLayer(selectedWindGroup); selectedWindGroup = null; }
}

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

function dateHourLabel(dateStr) {
  const res = nearestHour(dateStr);
  if (res === '—') return res;
  const { d, label } = res;
  const dateTxt = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${dateTxt} ${label}`;
}

function weekdayShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

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

function extractHeadingDegrees(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const v = entry.heading;
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
  return ((v % 360) + 360) % 360;
}

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
async function load() {
  const res  = await fetch('voyages.json');
  const data = await res.json();

  if (map) { map.off(); map.remove(); }
  polylines = [];
  maxMarker = null;

  map = L.map('map').setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  const tbody = document.querySelector('#voyTable tbody');
  tbody.innerHTML = '';

  data.voyages.forEach((v, i) => {
    const avgWindDir = (v.avgWindHeading !== undefined && v.avgWindHeading !== null) ? degToCompass(v.avgWindHeading) : '';
    const row = tbody.insertRow();

    const segments = computeDaySegments(v);
    v._segments = segments;
    const isMultiDay = segments.length > 1;
    const expander = isMultiDay ? `<button class="expander-btn" aria-label="Toggle days">[+]</button>` : '';

    row.innerHTML =
      `<td class="exp-cell">${expander}</td><td class="idx-cell">${i+1}</td><td>${dateHourLabel(v.startTime)}</td>
        <td>${dateHourLabel(v.endTime)}</td>
        <td>${v.nm.toFixed(1)}</td>
        <td>${v.maxSpeed.toFixed(1)} kn</td>
        <td>${v.avgSpeed.toFixed(1)} kn</td>
        <td>${v.maxWind.toFixed(1)} kn</td>
        <td>${v.avgWindSpeed.toFixed(1)} kn</td>
        <td>${avgWindDir}</td>`;

    let voyageBounds = null;
    if (segments.length > 0) {
      segments.forEach(seg => {
        const latLngs = seg.points.map(p => [p.lat, p.lon]);
        const pl = L.polyline(latLngs, { color: 'blue', weight: 2 }).addTo(map);
        seg.polyline = pl;
        polylines.push(pl);
        const b = pl.getBounds();
        voyageBounds = voyageBounds ? voyageBounds.extend(b) : b;
        const voySelect = (ev) => { L.DomEvent.stopPropagation(ev); selectVoyage(v, row, { fit: false }); };
        pl.on('click', voySelect);
        pl._voySelect = voySelect;
      });
    } else {
      const latLngs = v.coords.map(([lon, lat]) => [lat, lon]);
      const line = L.polyline(latLngs, { color: 'blue', weight: 2 }).addTo(map);
      polylines.push(line);
      v._fallbackPolyline = line;
      voyageBounds = line.getBounds();
      const voySelect = (ev) => { L.DomEvent.stopPropagation(ev); selectVoyage(v, row, { fit: false }); };
      line.on('click', voySelect);
      line._voySelect = voySelect;
    }
    if (i === 0 && voyageBounds) map.fitBounds(voyageBounds);

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
          <td>${dateHourLabel(seg.endTime)}</td>
          <td>${seg.nm.toFixed(1)}</td>
          <td>${seg.maxSpeed.toFixed(1)} kn</td>
          <td>${seg.avgSpeed.toFixed(1)} kn</td>
          <td>${seg.maxWind.toFixed(1)} kn</td>
          <td>${seg.avgWindSpeed.toFixed(1)} kn</td>
          <td>${avgWindDirDay}</td>
          `;

        dr.addEventListener('click', () => {
          polylines.forEach(pl => pl.setStyle({ color: 'blue', weight: 2 }));
          detachActiveClickers();
          clearActivePointMarkers();
          clearSelectedWindGraphics();
          activePolylines = [];
          if (seg.polyline) {
            seg.polyline.setStyle({ color: 'red', weight: 4 });
            activePolylines = [seg.polyline];
            map.fitBounds(seg.polyline.getBounds());
          }
          drawMaxSpeedMarkerFromCoord(seg.maxSpeedCoord, seg.maxSpeed);
          if (selectedPointMarker) { map.removeLayer(selectedPointMarker); selectedPointMarker = null; }
          if (seg.points && seg.points.length) {
            const onLineClick = (e) => onPolylineClick(e, seg.points);
            seg.polyline.on('click', onLineClick);
            seg.polyline.on('tap', onLineClick);
            activeLineClickers.push({ pl: seg.polyline, onLineClick });
            activePointMarkersGroup = L.layerGroup();
            seg.points.forEach((p, idx) => {
              if (typeof p.lat === 'number' && typeof p.lon === 'number') {
                const m = L.marker([p.lat, p.lon], { icon: tinySquareIcon });
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
          setDetailsHint('Click on the red path to inspect a point.');
        });

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
        });
      }
    }
  });

  // Scroll table to bottom on initial load
  const tableWrapper = document.querySelector('.table-wrapper');
  if (tableWrapper) {
    tableWrapper.scrollTop = tableWrapper.scrollHeight;
  }
}

// Details panel helpers
function setDetailsHint(msg) {
  const panel = document.getElementById('pointDetails');
  panel.style.display = '';
  panel.innerHTML = `
    <div class="floating-header"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="floating-title">Point Details</span><button class="close-details" aria-label="Close">×</button></div>
    <div class="details-body"><em>${msg}</em></div>`;
  wireDetailsControls(panel);
}
function degToCompassLocal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
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
function formatPosition(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return '—';
  return `${toDMS(lat, true)} ${toDMS(lon, false)}`;
}
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
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Interaction helpers
function detachActiveClickers() {
  if (Array.isArray(activeLineClickers)) {
    activeLineClickers.forEach(({ pl, onLineClick }) => { try { pl.off('click', onLineClick); } catch (_) {} });
  }
  activeLineClickers = [];
}
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
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const a = L.latLng(points[i-1].lat, points[i-1].lon);
        const b = L.latLng(points[i].lat, points[i].lon);
        nm += a.distanceTo(b) / 1852; // meters -> NM
      }
      const entry = points[i].entry || points[i];
      const s = entry?.speed?.sog ?? entry?.speed?.stw;
      if (typeof s === 'number') { if (s > maxSpeed) { maxSpeed = s; maxSpeedCoord = [points[i].lon, points[i].lat]; } speedSum += s; speedCount++; }
      const w = entry?.wind?.speed; if (typeof w === 'number') { if (w > maxWind) maxWind = w; windSpeedSum += w; windSpeedCount++; }
      const wd = entry?.wind?.direction; if (typeof wd === 'number') windHeadings.push(wd);
    }
    const avgSpeed = speedCount ? (speedSum / speedCount) : 0;
    const avgWindSpeed = windSpeedCount ? (windSpeedSum / windSpeedCount) : 0;
    const avgWindHeading = windHeadings.length ? circularMean(windHeadings) : null;
    segments.push({ dateKey: key, startTime, endTime, nm: parseFloat(nm.toFixed(1)), maxSpeed, avgSpeed, maxWind, avgWindSpeed, avgWindHeading, points, maxSpeedCoord, polyline: null });
  }
  return segments;
}

function circularMean(degrees) {
  let sumSin = 0, sumCos = 0;
  for (const d of degrees) { const rad = d * Math.PI / 180; sumSin += Math.sin(rad); sumCos += Math.cos(rad); }
  const avgRad = Math.atan2(sumSin / degrees.length, sumCos / degrees.length);
  let deg = avgRad * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

// Boot
load().then(() => setDetailsHint('Select a voyage, then click the red path to inspect points.')).catch(console.error);
document.getElementById('regenBtn').addEventListener('click', async () => {
  await fetch('/plugins/voyage-webapp/generate', { method: 'GET', credentials: 'include' });
  await load();
});

// Splitter initialization (vertical between map and details, horizontal above map)
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
    const minH = 120; // minimum top-section height
    const maxH = containerH - 140; // keep room for map
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
      const requiredTop = Math.ceil(headerH + headH + bodyH + borders + paddings + 2);
      const containerRect = container.getBoundingClientRect();
      const currentTop = top.getBoundingClientRect().height;
      const delta = Math.max(0, requiredTop - currentTop);
      // Increase overall container height so map height stays the same
      container.style.height = `${Math.ceil(containerRect.height + delta)}px`;
      container.style.setProperty('--top-height', `${requiredTop}px`);
      btn.textContent = 'Restore';
      btn.setAttribute('aria-pressed', 'true');
    } else {
      container.style.height = ''; // back to CSS (95vh)
      container.style.setProperty('--top-height', '25%');
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
