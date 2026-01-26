# Project Architecture

## Application Overview

- Signal K plugin that exposes a web interface for exploring logbook voyages and generating polar data.
- Node.js back-end components parse raw YAML log entries into structured JSON consumed by the front-end, splitting voyages on inactivity gaps over 48 hours, discarding voyages under 1 nm, pruning repeated anchored fixes within 100 meters of the leg-end anchor, segmenting legs on anchored gaps (>= 1 hour) while filtering out legs under 1 nm, and filtering GPS outliers beyond a 100 nm jump threshold.
- Manual voyage entries are stored in `public/manual-voyages.json`, loaded by the UI as a static JSON asset (with an API fallback), merged into the front-end view, and can be added or edited from a desktop-only entry panel that stays hidden until toggled open, with a tabbed multi-stop editor (including Add stop for intermediate legs), a single-leg return-trip toggle that stays a single table leg, remembered locations, map click picking for coordinates, panel-based deletion, table-panel expansion to keep the full form visible, stop times auto-filled from the prior stop plus leg duration at 5 kn (with the final stop time derived automatically and read-only), manual duration derived from total distance at 5 kn, manual map tracks rendered in gray, and manual table rows suppressing max speed and wind metrics.
- Front-end single-page app (SPA) renders voyage tracks on Leaflet maps, provides rich voyage analytics, includes responsive layout controls with a tab-view toggle that mirrors the active layout and can override auto switching, and shows leg total-time hours (h) in cell values plus voyage totals (including summed multi-leg durations) while summing Active Time from voyage total hours/leg durations and averaging multi-leg voyage speeds from leg averages.
- Utility scripts support data preparation, polar analysis, and batch log maintenance outside the runtime path.

## Data Flow Summary

1. YAML logbook entries are stored under `~/.signalk/plugin-config-data/signalk-logbook/`.
2. Manual voyage entries are stored in `public/manual-voyages.json` (including ordered `locations` arrays for multi-leg trips) and loaded as a static JSON asset alongside `voyages.json`, with the `/manual-voyages` API used for create/update/delete operations.
3. `parse_logbook.js` processes the YAML files into `public/voyages.json`, splitting voyages after inactivity gaps greater than 48 hours, discarding voyages under 1 nm, pruning repeated anchored fixes within 100 meters of the leg-end anchor, and marking anchored gaps (>= 1 hour) for leg segmentation, filtering position jumps greater than 100 nm from the last known fix, enriching points with activity metadata, and ignoring speed/wind readings that lack positional data.
4. `parse_polar.js` transforms the voyage output into polar performance points saved in `public/Polar.json`.
5. The `plugin.js` router or standalone `server.js` endpoint triggers regeneration on demand and persists manual voyages.
6. `public/app.js` fetches the JSON resources, merges generated and manual voyages chronologically, derives leg segments from anchored activity or skip-connection markers (allowing manual legs under 1 nm), computes leg durations to drive total-time/average-speed display (including summed multi-leg totals) and totals-row Active Time, renders voyages on the map, and exposes UI interactions.

## Core Files

### Back-End

- **plugin.js**: Signal K plugin entry point. Registers HTTP endpoints, spawns the logbook parser, writes voyage and polar JSON, and integrates with the host router.
- **server.js**: Lightweight development server for the `public/` directory. Mirrors the plugin endpoints to regenerate voyage and polar data locally while serving manual voyage CRUD endpoints.
- **parse_logbook.js**: Node.js CLI tool that ingests daily YAML logs, splits voyages on 48-hour inactivity gaps, discards voyages under 1 nm, prunes repeated anchored fixes within 100 meters of the leg-end anchor, marks anchored stop gaps for leg segmentation, filters GPS outliers, classifies activity, computes voyage statistics, and emits structured voyage data.
- **parse_polar.js**: Helper module that derives polar performance points from voyage data, normalising headings and wind metrics.

### Front-End

- **public/app.js**: Front-end orchestrator that wires data fetching, module initialisation, and high-level user interactions.
- **public/map.js**: Leaflet controller that builds voyage overlays (including gray manual tracks), handles map/background interactions, coordinates selection state with other modules, and provides real-time manual voyage feedback via `highlightLocation()`, `clearHighlightedLocationMarker()`, `drawManualVoyagePreview()`, and `clearManualVoyagePreview()`.
- **public/view.js**: Responsive layout utility that manages mobile/desktop toggles, tab/desktop overrides that sync with auto layout changes, tab behaviour, and layout-driven map resizing.
- **public/table.js**: Table controller responsible for rendering voyage/leg rows (including total-time hours with unit suffixes and summed multi-leg voyage durations on desktop), suppressing max speed and wind columns for manual voyages, maintaining row state, and raising callbacks for row events.
- **public/manual.js**: Desktop-only manual voyage entry panel logic including tabbed multi-stop editing, return-trip toggles for single-leg entries, calculations, autocomplete, persistence calls, stop-time auto-fill from leg durations (deriving the final stop time), manual-duration estimates at 5 kn, table-panel resizing to keep the manual form fully visible, real-time location highlighting via `MANUAL_LOCATION_SELECTED` events, and real-time preview track drawing via `MANUAL_VOYAGE_PREVIEW` events during both creation and editing.
- **public/data.js**: Data helpers focused on voyage datasets, totals aggregation (including Active Time from voyage total hours/leg durations), leg segmentation, per-leg duration/average-speed calculations based on anchored activity/skip-connection gaps while discarding legs under 1 nm, manual stop normalization for multi-leg entries, and manual-duration assumptions at 5 kn.
- **public/util.js**: Shared presentation helpers including heading/DMS formatting and datetime labelling.
- **public/events.js**: Shared pub/sub bus for coordinating cross-module interactions (voyage selection, segment selection, max-speed display, manual location highlighting, manual voyage preview, reset workflows).
- **public/overlays.js**: Overlay and icon builders for Leaflet map layers.
- **public/types.js**: TypeScript-style JSDoc typedefs documenting cross-module voyage structures.
- **public/index.html**: Base HTML shell loading the SPA, styles, and UI scaffolding.
- **public/styles.css**: Styling for the logbook UI, including map layout, table presentation, and responsive behaviour.

### Data Files

- **public/voyages.json**: Generated voyage dataset consumed by the SPA (overwritten via parser runs).
- **public/manual-voyages.json**: Stored manual voyage entries containing named locations, timestamps, and optional multi-leg stop arrays, served as a static asset for UI loads.
- **public/Polar.json**: Generated polar dataset used by the polar plotting tooling.

## Supporting Scripts

- **scripts/generate_polar.py**: Matplotlib-based utility that plots polar diagrams from `public/Polar.json`, supporting saving or interactive display.
- **scripts/merge_course_changes.py**: Cleans and merges course change log entries, with optional maxima position fixes.
- **scripts/merge_course_changes_dir.py**: Batch wrapper around `merge_course_changes.py` for directory-wide processing.
- **scripts/fetch-voyages.sh**: Copies voyages, polar, and manual voyage JSON assets from a local Signal K install into the repo `public/` directory.
- **scripts/push-voyages.sh**: Copies voyages, polar, and manual voyage JSON assets from the repo `public/` directory into a local Signal K install.
- **scripts/deploy-to-signalk.sh**: Deploys `public/` assets (excluding `voyages.json`) and root-level helper scripts into a local Signal K install.
- **scripts/build-plugin.sh**: Bundles plugin assets for distribution.

## Additional Assets

- **polar.txt**: Sample polar data reference file used during analysis.
- **polar_diagram.png**: Example polar diagram output generated by the plotting script.

## Operational Notes

### API Endpoints

- Plugin endpoints: `GET /plugins/voyage-webapp/generate` regenerates voyages and polar data; `/generate/polar` recomputes polar data only; `/manual-voyages` supports manual voyage create/update/delete with GET kept for API access.
- Development server runs at `http://localhost:3645/` via `node server.js` and mirrors plugin regeneration endpoints.
- The development server also strips a `/logbook` prefix (or `VOYAGE_BASE_PATH`/`X-Forwarded-Prefix`) so JSON assets and manual-voyage endpoints work when the UI is hosted under a subpath.

### Manual Voyage Features

- Manual voyage entries are stored in `public/manual-voyages.json`, loaded alongside other JSON assets, and surfaced through a desktop-only entry panel beneath the voyage table.
- Manual voyage entry is toggled by the Add manual voyage button, supports tabbed Start/To entries with "Add Anchorage" to insert intermediate stops (labeled "Anchorage N"), map clicks to populate coordinates, includes a top-level "Day trip (return to start)" checkbox for round trips that doubles distance/time and prevents adding anchorages, auto-fills stop times from the previous stop plus leg duration (deriving a read-only final stop time), manual durations assume 5 kn average speed, and manual rows expose an Edit button for in-place updates via the panel.
- During both creation and editing, the manual voyage panel provides real-time map feedback: clicking Edit automatically selects and focuses the voyage on the map, the currently active stop is highlighted with a pulsing orange marker (including stop name in tooltip), and a dashed gray preview track connects all valid stops.
- The highlighted location marker and preview track update instantly when switching between stop tabs, editing coordinates, adding stops, or removing stops, and both clear automatically when closing the panel or exiting edit mode.
- Event coordination: `MANUAL_LOCATION_SELECTED` event triggers `highlightLocation()` for stop markers, `MANUAL_VOYAGE_PREVIEW` event triggers `drawManualVoyagePreview()` for the preview track, both emitted from manual.js to map.js with location payloads, enabling cross-module coordination without tight coupling.
- Manual voyage map tracks render in gray and hide max speed, max wind, avg wind, and wind direction cells in the table.
- Opening the manual voyage panel expands the table panel to fit the full form; closing restores the prior table panel height.

### Front-End Behavior

- Front-end relies on Leaflet globals; ensure assets are served from `public/` for proper styling and script load.
- The header includes a tab-view toggle that mirrors the active layout and can force the tab or desktop layout even when the viewport would choose the opposite.
- Desktop tables add a Total Time column for leg rows and voyages with hours shown in cell values, summing multi-leg voyage durations while averaging voyage speed across leg averages.
- Totals row Active Time is computed by summing voyage total hours (leg durations for parsed voyages and distance-based hours for manual entries); Sailing Time still derives from point activity samples and is capped to Active Time.

### Parser Behavior

- Parser scripts expect valid ISO datetimes in YAML and handle anchored/motoring classification via text cues and speed heuristics.
- Parser drops positions that jump more than 100 nm from the last accepted fix to avoid plotting GPS/AIS outliers.
- Parser max-speed and max-wind statistics ignore entries that do not include a valid GPS position to prevent sensor spikes from inflating voyage summaries.
- Voyages split on inactivity gaps over 48 hours, with voyages under 1 nm discarded and repeated anchored fixes within 100 meters of the leg-end anchor pruned, while legs split on anchored gaps (>= 1 hour) flagged via anchored activity or skip-connection markers so legs can span multiple days and multiple legs can occur within a single day, with leg segments under 1 nm removed from the UI.

## Design Decisions

### Voyage and Leg Segmentation

- **Voyage boundaries**: Split on 48-hour inactivity gaps to group related sailing within reasonable time windows
- **Leg boundaries**: Split on anchored gaps >= 1 hour, allowing legs to span multiple days and multiple legs within a single day
- **Distance threshold**: Discard voyages < 1 nm and leg segments < 1 nm to avoid noise from minor movements
- **Anchor pruning**: Keep only the earliest anchored fix within 100m of the leg-end anchor to avoid cluttering the map

### GPS Outlier Filtering

- **Jump threshold**: Skip position fixes that jump > 100 nm from the last accepted fix
- **Coordinate validation**: Ignore speed/wind readings without valid GPS positions to prevent sensor glitches from distorting statistics

### Responsive Design

- **Mobile breakpoint**: 700px width triggers tab-based layout
- **Layout constraints**: Minimum 400px map height, 230px table height, 150px table wrapper minimum
- **Tab behavior**: Default to Map tab on mobile, auto-switch to map on voyage/leg selection
- **Column hiding**: Hide End, Total Time, Avg Speed, Avg Wind columns on mobile for readability

### Manual Voyage Design

- **Storage**: Static JSON file (`public/manual-voyages.json`) loaded alongside generated voyages
- **Speed assumption**: 5 kn average for duration calculations
- **Visual distinction**: Gray map tracks, suppressed max speed/wind columns
- **Multi-leg support**: Tabbed stop editor with auto-filled times and read-only end time
- **Return trips**: Single-leg toggle that doubles distance/time but keeps one table row

### Caching Strategy

- **Server-side**: ETag and Last-Modified headers with must-revalidate directive
- **Client-side**: `cache: 'no-cache'` fetch option to force revalidation on manual reload
- **Safari compatibility**: Handle `; length=` suffix in ETag parsing and unquoted validators in conditional headers

### Module Architecture

- **Event-driven coordination**: Pub/sub bus (`events.js`) decouples map, table, and view modules
- **Separation of concerns**: Data utilities, overlays, formatting, and types in dedicated modules
- **ES modules**: Modern import/export syntax throughout front-end code
