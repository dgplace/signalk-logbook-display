# Change Log

## 2026-02-02

- Restore executable permissions on `scripts/push-voyages.sh`

## 2026-01-31

- Add activity override feature for voyage point inspection:
  - Replace static activity text in point details panel with a dropdown selector
  - Store activity overrides in `public/activity-overrides.json` separate from voyage data
  - Use composite key `${datetime}|${lon}|${lat}` to match points across regenerations
  - Add GET/POST/DELETE endpoints for `/activity-overrides` in `server.js` and `plugin.js`
  - Add `setActivityOverrides`, `getActivityOverride`, `buildPointKey`, `updateLocalOverride`, `fetchActivityOverrides` functions in `data.js`
  - Modify `getPointActivity()` to check overrides first, ensuring all calculations use override values
  - Add `ACTIVITY_OVERRIDE_CHANGED` event to refresh map polylines after activity change
  - Load activity overrides in parallel with voyage data on app init
  - Style dropdown for consistent appearance in point details panel

## 2026-01-30

- Replace the Maximize pill button with a macOS-style green control in the voyage table header row
- Add a macOS-style yellow collapse control to show only a single voyage row
- Keep the collapsed voyage table scrollable so other rows can be browsed
- Add a summary pill toggle next to Add voyage to swap the table for a global totals panel
- Move Active Time, total distance, and Sailing Time totals out of the voyage table into the summary panel
- Fix summary panel visibility toggle and update the button label to show the current action
- Reduce the default voyage table height by one row while keeping the minimum height unchanged
- Add Sea Time to the summary panel using voyage start/end timestamps
- Rename Active time to Travel time and add Night time totals based on dawn/dusk at voyage coordinates
- Show summary metrics in a fixed 3-column grid capped at two rows
- Refine Night time to count sailing/motoring gaps only and add a test that reports per-voyage night totals
- Exclude manual voyages from Night time totals to match generated-voyage travel at night
- Show total distance in NM with km in parentheses in the summary panel
- Reset the table/map splitter to its default position when opening the summary panel
- Remove the Tab View header toggle from the UI
- Add clickable Max Wind values in the table to focus the max wind point on the map
- Add average and maximum speed to the summary panel (excluding manual voyages) while keeping it within two rows
- Split average and max speed into separate summary cards and switch to four columns per row
- Add sailing and motoring average speeds to the summary average speed card
- Move sailing and motoring averages into their own cards and drop the max speed summary card

## 2026-01-29

- Add per-leg route editing for multi-stop voyages:
  - Enable custom route paths for individual legs of overnight/multi-stop voyages
  - Support open segment editing (A→B) in addition to closed day-trip loops
  - Store `routePoints` array within each location object for per-leg persistence
  - Add "end" marker type (red) for open segment editing
  - Stitch per-leg routes into continuous voyage preview on the map
  - Calculate distances using custom routes when available
  - Update backend validation to accept nested `routePoints` in location objects
  - Update `public/types.js` with `routePoints` field in `ManualVoyageStop` typedef
  - Update `public/map/layers.js` with `stitchLegRoutes()` function
  - Update `public/map/interaction.js` for open segment support
  - Update `public/manual.js` for per-leg route editing UI

- Refactor manual voyage panel into a movable overlay map control:
  - Move panel markup from table section to map panel in `public/index.html`
  - Style panel as a `.details-panel` overlay with absolute positioning and z-index layering
  - Implement `makeDraggable` utility in `public/view.js` and apply it to the panel header
  - Add drag handle (⋮⋮) to the manual voyage panel header
  - Hide latitude/longitude input fields to compact the UI (values populated via map pick/autocomplete)
  - Remove table panel expansion logic as the overlay no longer affects document flow
  - Update `public/manual.js` to manage overlay visibility and initialization
  - Hide Point Details panel when Manual Voyage panel is open to reduce clutter, restoring it when closed
- Keep the nautical (OpenSeaMap) overlay active after saving a manual voyage by reapplying it on map reloads
- Move the manual voyage toggle into the header beside Regenerate voyages and rename it to "Add voyage"
- Fix manual voyage date/time input overflow so it stays within the panel width
- Constrain manual date/time fields to shrink inside the overlay layout
- Add iPad-friendly inline sizing so date/time inputs stay within the manual panel
- Cap the manual voyage date/time input width for a more compact layout
- Tighten the manual voyage date/time width cap and rename the panel title to "Voyage"
- Apply a fixed-width time field wrapper so the manual date/time input can be smaller
- Override manual time field sizing with higher-specificity rules so the fixed width applies
- Widen the manual voyage date/time field by 20px after confirming the narrow layout
- Expand the manual voyage date/time field by another 40px for readability
- Remove the manual trip type legend and shorten the overnight label to "Overnights"
- Omit the 0d prefix when formatting durations shorter than a day
- Hide the manual voyage location section title to simplify the form
- Remove the manual group title markup from the manual voyage template
- Remove unused manual group title references after dropping the label
- Replace the manual stop remove button with a red × icon in the panel corner
- Ensure the red remove icon is hidden for Start and To stops
- Restyle manual trip type radios as pill buttons to match the app controls
- Revert to radio-style trip type controls with custom circles and focus styling
- Dim the manual route hint text whenever route editing is disabled
- Rename manual location tab labels from Anchorage to Stop for intermediate legs

## 2026-01-28

- Fix manual voyage leg route editing:
  - Preserve per-leg `routePoints` on manual-voyage save requests in the plugin API
  - Target per-leg route edits from the previous stop to the current one and disable editing on Start
- Fix manual route edit persistence and map editing UX:
  - Load per-leg `routePoints` from stored manual voyages and use them for voyage distance/segments
  - Reattach the map insert handler during route edits so multiple points can be added without toggling
  - Add regression test coverage for per-leg route persistence in overnight manual voyages
  - Render saved multi-leg manual voyages using per-leg route points when highlighting or selecting trips
  - Keep route edit arrows/insert clicks active during multi-leg edits and highlight the full voyage when exiting edit mode

- Refactor `public/manual.js` and `public/map.js` into maintainable modules:
  - Extract pure calculation functions into `public/manual-logic.js`:
    - `normalizeLocationName`, `parseDateInput`, `isSameCoordinate`
    - `normalizeRoutePoints`, `calculateRouteDistanceNm`, `calculateOutboundDistanceNm`
    - `stitchRoutePoints`, `splitRoutePoints` for multi-leg support
  - Create `public/manual-state.js` with `ManualVoyageState` class for testable state management
  - Decompose `public/map.js` into directory-based modules:
    - `public/map/core.js`: Map lifecycle, base layers, theme switching
    - `public/map/layers.js`: Voyage rendering, wind overlays, markers
    - `public/map/interaction.js`: Selection, click handlers, route editing
    - `public/map.js`: Facade re-exporting all public APIs
- Add test infrastructure using Node.js built-in `node:test` module:
  - `test/manual-logic.test.mjs`: Tests for pure calculation functions
  - `test/manual-state.test.mjs`: Tests for ManualVoyageState class
  - Run tests with `node --test test/*.test.mjs`
- Update `public/manual.js` to import from `manual-logic.js`
- Fix day-trip loop editing UX issues:
  - Show updated route as red highlight polyline when exiting map edit mode
  - Allow adding multiple points during map editing (reattach insert handler after route updates)
  - Close the loop when highlighting return trip voyages so all segments show in red

## 2026-01-26

- Improve manual voyage creation and editing UX:
  - Auto-focus and fit voyage on map when clicking Edit button
  - Highlight active stop with pulsing orange marker during both creation and editing
  - Draw preview track in real-time as stops are added/edited (dashed gray line)
  - Update highlight and track instantly when switching stops or editing coordinates
  - Show stop name in tooltip above highlighted marker
  - Clear highlight and preview when closing panel or exiting edit mode
- Add `MANUAL_LOCATION_SELECTED` event to coordinate stop highlighting
- Add `MANUAL_VOYAGE_PREVIEW` event to coordinate preview track drawing
- Add map functions: `highlightLocation()`, `clearHighlightedLocationMarker()`, `drawManualVoyagePreview()`, `clearManualVoyagePreview()`
- Add `emitManualVoyagePreview()` helper in manual.js to broadcast location updates
- Refactor day trip UI for manual voyages:
  - Move "Day trip (return to start)" checkbox to top of form (next to tab buttons)
  - Remove per-location "Return to start" toggle
  - Rename "End" location to "To"
  - Rename "Add stop" button to "Add Anchorage"
  - Rename intermediate stops from "Stop N" to "Anchorage N"
  - Disable "Add Anchorage" button when day trip is checked with tooltip guidance
- Replace day trip checkbox with a trip type radio group and only allow day trips when there are no anchorages
- Lay out trip type radios inline and alert when day trip is selected while anchorages are present
- Rename manual stop removal control to "Remove anchorage"
- Add day-trip loop editing on the map:
  - Show an Edit loop on map toggle with reset option in the manual voyage form
  - Allow inserting, dragging, and removing loop points with directional arrows
  - Persist optional `routePoints` and `routeTurnIndex` for day trips and use them for distance/time calculations
- Improve day-trip loop editing usability:
  - Dim other voyage layers and disable selection while editing a loop
  - Widen the click target for inserting loop control points
- Render the editable day-trip loop in green while map editing is active
- Add mandatory documentation update requirement to AGENTS.md
- Simplify voyage sync scripts (`scripts/fetch-voyages.sh` and `scripts/push-voyages.sh`)
- Remove `scripts/update-voyages.sh` and add `scripts/push-voyages.sh` to copy assets into a local Signal K install
- Update manual voyage metadata timestamp in `public/manual-voyages.json`

## 2026-01-09

- Load manual voyage data from the static `public/manual-voyages.json` asset with an API fallback to mirror `voyages.json` handling
- Fix totals Active Time to align with summed voyage total hours and cap Sailing Time to Active Time
- Add multi-leg manual voyages with tabbed stop editor
- Add return-trip toggle for single-leg manual voyages that doubles distance/time but keeps a single table leg
- Improve manual voyage display and timing:
  - Auto-fill stop times from leg durations at 5 kn
  - Make final stop time read-only and automatically derived
  - Compute manual leg end times in table display
- Add manual voyage entry support and persistence:
  - Store manual entries in `public/manual-voyages.json`
  - Desktop-only entry panel with map click coordinate picking
  - Location name autocomplete and remembered locations
  - Edit controls and panel-based deletion
  - Gray map tracks for manual voyages
  - Suppress max speed/wind columns in manual voyage table rows
  - Expand table panel when manual form opens to keep it fully visible
- Align duration units:
  - Move Total Time hour units into cell values (h suffix)
  - Keep Duration header unit-free
- Add voyage leg duration and total time:
  - Desktop tables show Total Time column for legs and voyages
  - Multi-leg voyage totals sum leg durations
  - Multi-leg voyage speeds average across leg averages
  - Totals row Active Time sums voyage total hours/leg durations

## 2026-01-08

- Enhance UI with tab-view toggle and wind overlay controls:
  - Add tab-view toggle in header that mirrors active layout
  - Can force tab or desktop layout regardless of viewport size
  - Move wind overlay toggle into point details panel
  - Improve wind overlay arrow rendering with speed-based color and sizing
  - Thin wind arrows to 1 nm spacing minimum
  - Suppress wind arrows when speed is zero
- Improve layout responsiveness:
  - Add mobile breakpoint with accessible tabs (replaces 700px minimum width)
  - Default mobile layout to Map tab
  - Auto-switch to map when voyage/leg selected
  - Hide table maximize control in mobile layout
  - Hide Avg Speed, Avg Wind, End columns and totals row on mobile
  - Suppress `kn` units for Max Speed and Max Wind on mobile
  - Set minimum heights: 400px map row, 230px table row
  - Let layout exceed viewport and scroll instead of compressing
- Prune repeated anchored fixes within 100 meters of leg-end anchor before computing voyage metrics
- Raise voyage separation gap to 48 hours
- Filter out leg segments under 1 nm
- Split voyages by legs using anchored activity/skip-connection markers instead of day boundaries
- Split voyages on anchored stop gaps (>= 1 hour)

## 2025-12-21

- Add 100 nm GPS outlier filter to `parse_logbook.js`, skipping positions that jump too far from the last accepted fix
- Guard voyage max-speed and max-wind calculations by excluding log entries without coordinates

## Earlier Changes

- Add strong conditional caching to `server.js`:
  - Emit ETags and `Last-Modified` headers
  - Handle Safari `; length=` suffixes and unquoted validators
  - Use `must-revalidate` directive
- Update SPA fetch logic to request `voyages.json` with `cache: 'no-cache'`
- Split SPA into modular files:
  - `public/app.js`: Front-end orchestrator
  - `public/map.js`: Leaflet controller
  - `public/view.js`: Responsive layout utility
  - `public/table.js`: Table controller
  - `public/util.js`: Shared presentation helpers
  - `public/data.js`: Data utilities
  - `public/events.js`: Shared pub/sub bus
  - `public/overlays.js`: Overlay and icon builders
  - `public/types.js`: TypeScript-style JSDoc typedefs
- Add prefers-color-scheme driven theming with CSS custom properties
- Update deployment helper (now `scripts/deploy-to-signalk.sh`) to copy root-level `.js` files
- Adopt CARTO Voyager basemap and light color palette
- Add wind overlay toggle for map wind arrows

---

**Note**: This log tracks chronological changes to the project. For architecture and technical design, see [ARCHITECTURE.md](ARCHITECTURE.md). For usage and features, see [README.md](README.md).
