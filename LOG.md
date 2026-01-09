# Project Architecture and File Guide

## Application Overview
- Signal K plugin that exposes a web interface for exploring logbook voyages and generating polar data.
- Node.js back-end components parse raw YAML log entries into structured JSON consumed by the front-end, splitting voyages on inactivity gaps over 48 hours, discarding voyages under 1 nm, pruning repeated anchored fixes within 100 meters of the leg-end anchor, segmenting legs on anchored gaps (>= 1 hour) while filtering out legs under 1 nm, and filtering GPS outliers beyond a 100 nm jump threshold.
- Manual voyage entries are stored separately on the server, merged into the front-end view, and can be added or edited from a desktop-only entry panel that stays hidden until toggled open, with a tabbed multi-stop editor (including Add stop for intermediate legs), a single-leg return-trip toggle that stays a single table leg, remembered locations, map click picking for coordinates, panel-based deletion, table-panel expansion to keep the full form visible, stop times auto-filled from the prior stop plus leg duration at 5 kn (with the final stop time derived automatically and read-only), manual duration derived from total distance at 5 kn, manual map tracks rendered in gray, and manual table rows suppressing max speed and wind metrics.
- Front-end single-page app (SPA) renders voyage tracks on Leaflet maps, provides rich voyage analytics, includes responsive layout controls with a tab-view toggle that mirrors the active layout and can override auto switching, and shows leg total-time hours (h) in cell values plus single-leg voyage totals while summing Active Time from leg durations and averaging multi-leg voyage speeds from leg averages.
- Utility scripts support data preparation, polar analysis, and batch log maintenance outside the runtime path.

## Data Flow Summary
1. YAML logbook entries are stored under `~/.signalk/plugin-config-data/signalk-logbook/`.
2. Manual voyage entries are stored in `public/manual-voyages.json` (including ordered `locations` arrays for multi-leg trips) and served via `/manual-voyages` endpoints for the UI to merge on load, with manual durations derived from distance at 5 kn in the UI.
3. `parse_logbook.js` processes the YAML files into `public/voyages.json`, splitting voyages after inactivity gaps greater than 48 hours, discarding voyages under 1 nm, pruning repeated anchored fixes within 100 meters of the leg-end anchor, and marking anchored gaps (>= 1 hour) for leg segmentation, filtering position jumps greater than 100 nm from the last known fix, enriching points with activity metadata, and ignoring speed/wind readings that lack positional data.
4. `parse_polar.js` transforms the voyage output into polar performance points saved in `public/Polar.json`.
5. The `plugin.js` router or standalone `server.js` endpoint triggers regeneration on demand and persists manual voyages.
6. `public/app.js` fetches the JSON resources, merges generated and manual voyages chronologically, derives leg segments from anchored activity or skip-connection markers (allowing manual legs under 1 nm), computes leg durations to drive total-time/average-speed display and totals-row Active Time, renders voyages on the map, and exposes UI interactions.

## Core Files
- `plugin.js`: Signal K plugin entry point. Registers HTTP endpoints, spawns the logbook parser, writes voyage and polar JSON, and integrates with the host router.
- `server.js`: Lightweight development server for the `public/` directory. Mirrors the plugin endpoints to regenerate voyage and polar data locally while serving manual voyage CRUD endpoints.
- `parse_logbook.js`: Node.js CLI tool that ingests daily YAML logs, splits voyages on 48-hour inactivity gaps, discards voyages under 1 nm, prunes repeated anchored fixes within 100 meters of the leg-end anchor, marks anchored stop gaps for leg segmentation, filters GPS outliers, classifies activity, computes voyage statistics, and emits structured voyage data.
- `parse_polar.js`: Helper module that derives polar performance points from voyage data, normalising headings and wind metrics.
- `public/app.js`: Front-end orchestrator that wires data fetching, module initialisation, and high-level user interactions.
- `public/map.js`: Leaflet controller that builds voyage overlays (including gray manual tracks), handles map/background interactions, and coordinates selection state with other modules.
- `public/view.js`: Responsive layout utility that manages mobile/desktop toggles, tab/desktop overrides that sync with auto layout changes, tab behaviour, and layout-driven map resizing.
- `public/table.js`: Table controller responsible for rendering voyage/leg rows (including total-time hours with unit suffixes on desktop), suppressing max speed and wind columns for manual voyages, maintaining row state, and raising callbacks for row events.
- `public/manual.js`: Desktop-only manual voyage entry panel logic including tabbed multi-stop editing, return-trip toggles for single-leg entries, calculations, autocomplete, persistence calls, stop-time auto-fill from leg durations (deriving the final stop time), manual-duration estimates at 5 kn, and table-panel resizing to keep the manual form fully visible.
- `public/data.js`: Data helpers focused on voyage datasets, totals aggregation (including Active Time from leg durations), leg segmentation, per-leg duration/average-speed calculations based on anchored activity/skip-connection gaps while discarding legs under 1 nm, manual stop normalization for multi-leg entries, and manual-duration assumptions at 5 kn.
- `public/util.js`: Shared presentation helpers including heading/DMS formatting and datetime labelling.
- `public/index.html`: Base HTML shell loading the SPA, styles, and UI scaffolding.
- `public/styles.css`: Styling for the logbook UI, including map layout, table presentation, and responsive behaviour.
- `public/voyages.json`: Generated voyage dataset consumed by the SPA (overwritten via parser runs).
- `public/manual-voyages.json`: Stored manual voyage entries containing named locations, timestamps, and optional multi-leg stop arrays.
- `public/Polar.json`: Generated polar dataset used by the polar plotting tooling.

## Supporting Scripts
- `scripts/generate_polar.py`: Matplotlib-based utility that plots polar diagrams from `public/Polar.json`, supporting saving or interactive display.
- `scripts/merge_course_changes.py`: Cleans and merges course change log entries, with optional maxima position fixes.
- `scripts/merge_course_changes_dir.py`: Batch wrapper around `merge_course_changes.py` for directory-wide processing.
- `scripts/fetch-voyages.sh`: Convenience shell script for retrieving voyage data (if configured by the user).
- `scripts/deploy-to-signalk.sh`: Deploys `public/` assets (excluding `voyages.json`) and root-level helper scripts into a local Signal K install.
- `scripts/build-plugin.sh`: Bundles plugin assets for distribution.

## Additional Assets
- `polar.txt`: Sample polar data reference file used during analysis.
- `polar_diagram.png`: Example polar diagram output generated by the plotting script.
- `README.md`: High-level project instructions and setup guidance.
- `AGENTS.md`: Automation and agent guidelines for repository maintenance.
- `LOG.md`: (This document) Describes architecture, data flow, and file responsibilities for quick onboarding.

## Operational Notes
- Plugin endpoints: `GET /plugins/voyage-webapp/generate` regenerates voyages and polar data; `/generate/polar` recomputes polar data only; `/manual-voyages` supports manual voyage GET/POST/DELETE.
- Development server runs at `http://localhost:3645/` via `node server.js` and mirrors plugin regeneration endpoints.
- The development server also strips a `/logbook` prefix (or `VOYAGE_BASE_PATH`/`X-Forwarded-Prefix`) so JSON assets and manual-voyage endpoints work when the UI is hosted under a subpath.
- Manual voyage entries are stored in `public/manual-voyages.json` and surfaced through a desktop-only entry panel beneath the voyage table.
- Manual voyage entry is toggled by the Add manual voyage button, supports tabbed start/stop/end entries with map clicks to populate coordinates, includes a Return to start toggle for single-leg trips that still renders as one leg in the table, auto-fills stop times from the previous stop plus leg duration (deriving a read-only final stop time), manual durations assume 5 kn average speed, and manual rows expose an Edit button for in-place updates via the panel.
- Manual voyage map tracks render in gray and hide max speed, max wind, avg wind, and wind direction cells in the table.
- Opening the manual voyage panel expands the table panel to fit the full form; closing restores the prior table panel height.
- Front-end relies on Leaflet globals; ensure assets are served from `public/` for proper styling and script load.
- Parser scripts expect valid ISO datetimes in YAML and handle anchored/motoring classification via text cues and speed heuristics.
- Parser drops positions that jump more than 100 nm from the last accepted fix to avoid plotting GPS/AIS outliers.
- Parser max-speed and max-wind statistics ignore entries that do not include a valid GPS position to prevent sensor spikes from inflating voyage summaries.
- The header includes a tab-view toggle that mirrors the active layout and can force the tab or desktop layout even when the viewport would choose the opposite.
- Desktop tables add a Total Time column for leg rows and single-leg voyages with hours shown in cell values, leaving multi-leg voyage totals blank while averaging voyage speed across leg averages.
- Totals row Active Time is computed by summing leg durations; Sailing Time still derives from point activity samples.
- Voyages split on inactivity gaps over 48 hours, with voyages under 1 nm discarded and repeated anchored fixes within 100 meters of the leg-end anchor pruned, while legs split on anchored gaps (>= 1 hour) flagged via anchored activity or skip-connection markers so legs can span multiple days and multiple legs can occur within a single day, with leg segments under 1 nm removed from the UI.

## Change Log
- Auto-reset the manual voyage end time to the start when missing or earlier than the start time.
- Use gray map polylines for manual voyages, derive manual duration from distance at 5 kn, and hide manual max speed/wind columns in the table.
- Expand the table panel when the manual voyage form opens so the full panel stays visible, then restore sizing when it closes.
- Store manual voyage entries in `public/manual-voyages.json` alongside other UI JSON assets.
- Fix manual voyage panel script syntax error so the UI loads in browsers.
- Resolve data fetch base paths and server prefix stripping so voyages load correctly when the UI is served from a subpath.
- Added desktop-only manual voyage entry with separate server storage, toggleable panel, map click coordinate picking, location autocomplete, table integration, edit controls, and panel-based deletion.
- Align totals-row Active Time with the sum of leg durations.
- Move Total Time hour units into the cell values so the Duration header stays unit-free.
- Added a desktop-only Total Time column for legs and single-leg voyages, computing leg speeds from distance/time and averaging multi-leg voyage speeds from leg averages.
- Prune repeated anchored fixes within 100 meters of the leg-end anchor before computing voyage metrics.
- Filter out voyages that travel less than 1 nm during parsing.
- Split voyages on inactivity gaps over 36 hours and define legs by anchored gaps (>= 1 hour) instead of day boundaries.
- Added a 100 nm GPS outlier filter to `parse_logbook.js`, skipping positions that jump too far from the last accepted fix.
- Updated deployment helper (now `scripts/deploy-to-signalk.sh`) to copy root-level `.js` files into the Signal K module directory alongside the public asset sync.
- Adopted the CARTO Voyager basemap and rethemed the front-end with a light palette for balanced contrast across the app.
- Added a wind overlay toggle for enabling map wind arrows.
- Added a tab-view toggle in the header so the mobile tab layout can be forced on demand.
- Synced the tab-view toggle with automatic layout changes and let unticking force the desktop layout.
- Moved the wind overlay toggle into the point details panel on the map.
- Swapped the wind overlay from circles to opaque arrows sized and colored by wind speed.
- Renamed the header toggle label from Portrait View to Tab View.
- Matched the wind overlay arrow style and size to the selected-point arrow while keeping color driven by wind speed.
- Suppressed wind overlay arrows when wind speed is zero.
- Kept wind arrow stroke and head size constant while scaling arrow length by wind speed.
- Thinned wind overlay arrows to at least 1 nm spacing between rendered points.
- Resized point markers to roughly 1.1× the route weight and tuned wind overlay sizing for consistent visibility.
- Enforced a 700px minimum page width to preserve layout integrity on narrow viewports.
- Set a 150px minimum height on the voyage table wrapper to maintain legibility when space is constrained.
- Let the main layout exceed the viewport when necessary so the page scrolls instead of shrinking the map, keeping the map row at least 400px tall and ensuring the table row never compresses below 230px even when the window is short.
- Replaced the previous 700px minimum width requirement with a mobile breakpoint that swaps the grid for accessible tabs, letting phone users toggle between the voyage table and the map.
- Default the mobile layout to the Map tab on load and automatically switch back to the map whenever a voyage or leg segment is selected from the table.
- Ensure the mobile layout is applied before selections so reloading with an active voyage keeps the highlighted track visible and refits the map immediately.
- Hide the table maximize control when the responsive mobile layout is active and reduce the voyage table font size slightly for consistency across viewports.
- Scroll the page to the top whenever the mobile layout switches back to the Map tab after a voyage or leg selection so the map remains in view.
- In the mobile layout hide the voyage table's Avg Speed and Avg Wind columns to keep the table readable on small screens.
- Suppress the `kn` units for Max Speed and Max Wind cells when the mobile layout is active to reduce visual clutter on phones.
- Hide the End column and the totals summary row from the mobile voyage table to keep the layout focused on primary metrics.
- Add strong conditional caching to `server.js`, emitting ETags and `Last-Modified` headers (including Safari-specific `; length=` suffix parsing and unquoted validator matches on conditional headers) so reloading the web app avoids retransferring unchanged `voyages.json`.
- Update the SPA fetch logic to request `voyages.json` with `cache: 'no-cache'`, ensuring browsers send conditional requests even on manual reloads.
- Split the SPA into modular files (`public/app.js`, `public/map.js`, `public/view.js`, `public/table.js`, `public/util.js`, `public/data.js`) so map controls, layout behaviour, table state, shared utilities, and data utilities are isolated for clearer maintenance and reuse.
- Centralised formatting and heading helpers inside `public/util.js`, keeping map and table modules focused on orchestration.
- Dedicated `public/table.js` now owns voyage table state, DOM rendering, row selection, and accessor helpers to keep table concerns separate from map rendering.
- Moved the map background selection logic into `public/map.js` so the map controller owns its event handlers.
- Normalised voyage, segment, max-speed, and reset workflows through a shared pub/sub bus (`public/events.js`), letting map, table, and history listeners coordinate via event emission instead of bespoke callbacks.
- Extracted overlay and icon builders into `public/overlays.js`, leaving `public/map.js` focused on Leaflet lifecycle, history updates, and event wiring while reusing the overlay helpers across voyage and segment selections.
- Documented cross-module voyage structures in `public/types.js` and added module-level API summaries to aid future maintenance.
- Added prefers-color-scheme driven theming with CSS custom properties, automatically swapping the UI palette while keeping the Leaflet base tiles on CARTO Voyager in both modes so dark theme users still get a readable map.
- Lowered dark-mode Voyager tile brightness further and increased contrast more so the basemap stays legible without overpowering the darker UI.
- Guard voyage max-speed and max-wind calculations by excluding log entries without coordinates so instrument glitches (e.g., 46 kt SOG with no position) cannot distort voyage summaries.
- Group voyages by UTC day boundaries to avoid splitting a single journey across multiple voyages when entries occur near local midnight in different timezones.
- Revert voyage grouping to a strict 24-hour gap so voyages separated by more than a day (e.g., July 1 vs. July 4) are treated as distinct trips.
- Use anchored activity/skip-connection markers when building leg segments so the table no longer splits legs on midnight boundaries.
- Raise the voyage separation gap to 48 hours and filter out leg segments under 1 nm.
- Added tabbed multi-leg manual voyage entry so intermediate stops create additional legs and are persisted in `locations`.
- Hide inactive manual stop panels so only the selected tab's fields are visible.
- Auto-fill manual stop times from leg durations and derive end times automatically.
- Make manual end stop time read-only and compute manual leg end times in the table display.
- Add a return-trip toggle for single-leg manual voyages that doubles the distance/time.
- Keep return-trip manual voyages as a single table leg while still doubling distance/time.
