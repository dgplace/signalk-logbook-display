# Voyage Webapp (Signal K Plugin)

A Signal K plugin/webapp that provides a voyage summary and map viewer.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Launch the standalone dev server:

   ```bash
   node server.js
   ```

   Open `http://localhost:3645/` in your browser. Use the **Generate Voyages** or **Generate Polar** buttons to refresh the JSON outputs after updating log files.

3. To ingest log files manually, run the parser directly:

   ```bash
   node parse_logbook.js ~/.signalk/plugin-config-data/signalk-logbook > public/voyages.json
   ```

   Then regenerate the polar dataset:

   ```bash
   node -e "const generatePolar = require('./parse_polar'); const fs = require('fs'); const voyages = JSON.parse(fs.readFileSync('public/voyages.json', 'utf8')); fs.writeFileSync('public/Polar.json', JSON.stringify(generatePolar(voyages), null, 2));"
   ```

For architectural details and file responsibilities, see `LOG.md`.

## Map Theme

The voyage viewer renders voyages on CARTO basemaps and now follows your OS/browser color scheme automatically (including Safari). Both light and dark modes use the Voyager tiles for consistent legibility, while the UI itself switches palettes to match the system theme. A slider-style “Wind overlay” control in the point details panel starts off (and stays disabled until a voyage/leg is selected) so you can enable the wind arrows only when you need them. Ensure the browser can reach the CARTO basemap endpoint (`https://{s}.basemaps.cartocdn.com/`) when running the app.

## Mobile Layout

When the viewport drops below 700 px wide the app automatically switches to a tabbed interface tailored for phones. Use the **Voyages** and **Map** tabs above the content to flip between the table and the Leaflet view; the point details drawer moves beneath the map so it remains readable on smaller screens. The mobile layout now opens on the Map tab by default, recentres the view when the page loads with a trip URL, and jumps back to the map whenever you select a voyage or leg from the table so the highlighted track is visible straight away. On phones the voyage table hides the End, Total Time, Avg Speed, and Avg Wind columns so the remaining metrics stay legible without horizontal scrolling, and the totals summary row is suppressed to keep the table compact. On wider layouts the table adds a Total Time column for each leg and for voyages that only contain one leg with hours shown in the cell values; multi-leg voyages leave total time blank and compute average speed as the mean of the leg averages. A **Tab View** toggle in the header mirrors the active layout; when enabled it forces the mobile tabs even on wider screens, and when disabled it can force the desktop layout on narrow screens. Wider displays continue to use the side-by-side grid without any extra interaction.

## Build and Package

- Prerequisites: Node.js and npm available in your PATH.
- Output: An npm tarball named `voyage-webapp-<version>.tgz` in the repo root.

Steps:

1. Update `package.json` if needed (name, version, description).
2. Run the build/pack script:
   
   ```bash
   scripts/build-plugin.sh
   ```

This uses `npm pack`, which respects `.npmignore`/`.gitignore` to determine the files included.

## Install Into Signal K Server

You can install the generated tarball in one of the following ways:

- Signal K Admin UI:
  - Open the Admin UI, go to Appstore/Plugins.
  - Choose “Install from local file” (or equivalent) and select the generated `voyage-webapp-<version>.tgz`.

- Command line (inside your Signal K server directory):
  
  ```bash
  npm install ./voyage-webapp-<version>.tgz
  ```

Restart the Signal K server after installation if necessary.

## Notes

- The repository `.gitignore` excludes `__pycache__/` and `voyage-webapp-*.tgz` artifacts.
- To release a new tarball, bump the `version` in `package.json` and rerun the build script.
- The voyage parser skips speed and wind samples that do not include a valid GPS position so sensor spikes without coordinates cannot inflate voyage statistics.
- The voyage parser ignores GPS fixes that jump more than 100 nm from the last accepted position to avoid plotting AIS outliers.
- The voyage parser prunes repeated anchored fixes within 100 meters of the leg-end anchor so only the earliest anchored point is kept.
- Voyages are grouped by inactivity gaps over 48 hours and voyages under 1 nm are discarded, while legs split on anchored gaps (>= 1 hour) flagged by activity/skip-connection markers so legs can span multiple days and multiple legs can occur within a single day; leg segments under 1 nm are omitted from the UI.
- The development server (`server.js`) returns `ETag` and `Last-Modified` headers (handling Safari’s `; length=` suffixes and unquoted validators on conditional headers) with `must-revalidate` caching so browsers reuse existing `voyages.json` unless it changes.
- The front-end fetches `voyages.json` with `cache: 'no-cache'` so browsers revalidate rather than bypassing the cache during reloads.
- Front-end JavaScript now uses ES modules: `public/app.js` orchestrates data loading and event wiring, `public/events.js` provides the shared pub/sub bus, `public/map.js` manages Leaflet lifecycle plus history updates, `public/overlays.js` builds map overlays and icons, `public/view.js` owns responsive layout and tab controls, `public/table.js` renders voyage rows while emitting events, `public/util.js` centralises formatting helpers, `public/data.js` exposes voyage data utilities, and `public/types.js` documents shared voyage typedefs for tooling.
- Publishing to npm is not covered here; this script only creates a local package tarball.

## Local Deploy for Testing

To test changes without reinstalling the plugin, deploy the `public/` assets and root-level helper scripts straight into your Signal K install.

- Default destination root: `~/.signalk/node_modules/voyage-webapp/`
- Public assets land under `public/` while skipping `voyages.json`
- Root-level `*.js` files copy beside `plugin.js` for quick iteration

Usage:

```bash
scripts/deploy-to-signalk.sh                                   # deploy to ~/.signalk/node_modules/voyage-webapp/
scripts/deploy-to-signalk.sh /custom/target/path               # custom destination root
```

Notes:
- If `rsync` is available, the script syncs `public/` and excludes `voyages.json`.
- Without `rsync`, it falls back to copying files while preserving existing `voyages.json`.
- Root-level scripts copy via `cp -p`; rerun after editing back-end helpers.

## Utilities

The Python helpers are under `scripts/` now:

- `scripts/merge_course_changes.py`: Merge successive course-change log entries in a YAML file.
- `scripts/merge_course_changes_dir.py`: Run the merge over all `.yml` files in a directory.

Examples:

```bash
python scripts/merge_course_changes.py input.yml output.yml --fix-maxima-pos
python scripts/merge_course_changes_dir.py logs/ --inplace --fix-maxima-pos
```

- `scripts/generate_polar.py`: Plot the computed polar diagram using Matplotlib and optionally save the figure.

```bash
python scripts/generate_polar.py --polar-file public/Polar.json --output polar_diagram.png
```
