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

For architectural details and file responsibilities, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Map Theme

The voyage viewer renders voyages on CARTO basemaps and now follows your OS/browser color scheme automatically (including Safari). Both light and dark modes use the Voyager tiles for consistent legibility, while the UI itself switches palettes to match the system theme. A slider-style “Wind overlay” control in the point details panel starts off (and stays disabled until a voyage/leg is selected) so you can enable the wind arrows only when you need them. Ensure the browser can reach the CARTO basemap endpoint (`https://{s}.basemaps.cartocdn.com/`) when running the app.

## Mobile Layout

When the viewport drops below 700 px wide the app automatically switches to a tabbed interface tailored for phones. Use the **Voyages** and **Map** tabs above the content to flip between the table and the Leaflet view; the point details drawer moves beneath the map so it remains readable on smaller screens. The mobile layout now opens on the Map tab by default, recentres the view when the page loads with a trip URL, and jumps back to the map whenever you select a voyage or leg from the table so the highlighted track is visible straight away. On phones the voyage table hides the End, Total Time, Avg Speed, and Avg Wind columns so the remaining metrics stay legible without horizontal scrolling. Use the **Show summary** pill next to **Add voyage** to replace the table with a global totals panel (Travel time, Sea Time, Night time based on sailing/motoring during civil-night hours from generated voyages only, total distance shown in NM with km in parentheses, Sailing Time, plus average/max speed across generated voyages); the button flips to **Show table** to restore the list and resets the split divider to its default position for readability. On wider layouts the table adds a Total Time column for each leg and for voyages, showing multi-leg totals as the sum of each leg while computing average speed as the mean of the leg averages. Clicking Max Speed or Max Wind in the table highlights the voyage and focuses the corresponding point on the map. Wider displays continue to use the side-by-side grid without any extra interaction. The table controls now appear as macOS-style window dots in the top-left of the voyage table header row: yellow collapses the table to a single-row viewport while keeping it scrollable, and green maximizes it.

## Manual Voyages

Manual voyages can be added from the desktop layout (non tab view) by clicking **Add voyage** next to **Regenerate voyages** in the header to reveal the movable entry panel overlaying the map. The panel is compact, hiding raw coordinates (populated via **Pick on map** or autocomplete) to save space, and the date/time field stays a fixed narrow width on wider screens. Enter the start date/time plus named locations; use the **Add Anchorage** control to insert intermediate locations (labeled "Stop N"), which become additional legs in the voyage, and use the red × in the top-right of a stop panel to remove intermediate stops (Start and To cannot be removed). Stop start times are auto-filled from the previous stop plus the leg duration at 5 kn, and the final stop time is derived automatically (read-only, not required); durations under a day omit the leading 0d. For trip type, select **Day trip (return to start)** for a round trip that treats the "To" location as the turnaround point, doubles the distance/time, and still renders as a single leg in the table; you can optionally enable **Edit loop on map** to insert, drag, or remove loop points while direction arrows show the out-and-back path (use **Reset loop** to return to the direct route). While editing the loop, the editable path turns green, other voyages stay visible but are dimmed and unselectable to prevent accidental selection, and the loop line has a wider click target for inserting points. Select **Overnight + stops** to allow intermediate anchorages; the day trip option is only available when there are just Start and To, and the UI warns if you try to select it while anchorages are present. For multi-stop overnight voyages, you can also customize the route for individual legs: select a stop (except the Start stop), and the **Edit route** toggle enables you to insert, drag, or remove waypoints for the leg from the previous stop to the current one, with start (green "S") and end (red "E") markers at each endpoint; use **Reset route** to return to a straight line, and the helper hint fades when route editing is unavailable. Custom leg routes are stitched together into a continuous preview track on the map, persist when the voyage is saved and reopened, and render on the saved trip display; when you exit route editing the full voyage highlights in red. The UI calculates total distance across all legs (using custom routes when available) and an estimated duration based on a 5 kn average speed, stores the record separately, and merges it into the table chronologically. Manual voyages render in gray on the map and suppress Max Speed, Max Wind, Avg Wind, and Wind Dir values in the table. The location name list is remembered so future entries can re-use saved coordinates. Manual voyages persist in `public/manual-voyages.json`, loaded as a static JSON asset alongside `voyages.json`, and can be edited via the Edit button in the rightmost column; the panel includes a Delete manual voyage button while editing. During both creation and editing, the map displays a real-time preview: the voyage is automatically focused on the map, the currently active stop is highlighted with a pulsing orange marker, and a dashed gray preview track connects all valid stops, updating instantly as you switch between stops or edit coordinates. When the manual panel opens, the Point Details panel is hidden to clear the map view, and it reappears when you close the manual panel. The manual entry panel and edit/delete controls are hidden in the mobile tab layout.

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
- Publishing to npm is not covered here; this script only creates a local package tarball.
- For technical details on voyage/leg segmentation, GPS filtering, caching strategy, and module architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

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

For a quick local refresh from an installed Signal K plugin, copy the generated JSON assets into this repo:

```bash
scripts/fetch-voyages.sh                                   # copy from ~/.signalk/node_modules/voyage-webapp/public
scripts/fetch-voyages.sh /custom/signalk/path/public       # custom Signal K public directory
```

Push local JSON assets back into a Signal K install:

```bash
scripts/push-voyages.sh                                    # copy into ~/.signalk/node_modules/voyage-webapp/public
scripts/push-voyages.sh /custom/signalk/path/public        # custom Signal K public directory
```
