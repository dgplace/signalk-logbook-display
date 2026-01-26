# Change Log

## 2026-01-26

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
