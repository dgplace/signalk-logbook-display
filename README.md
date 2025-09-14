# Voyage Webapp (Signal K Plugin)

A Signal K plugin/webapp that provides a voyage summary and map viewer.

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

## Local Deploy for Testing

To test changes to the static assets without reinstalling the plugin, deploy the contents of `public/` directly to your Signal K data directory.

- Default destination: `~/.signalk/node_modules/voyage-webapp/public/`
- Excludes: `voyages.json` (keeps your local data intact)

Usage:

```bash
scripts/deploy-public.sh                                      # deploy to ~/.signalk/node_modules/voyage-webapp/public/
scripts/deploy-public.sh /custom/target/path                  # custom destination
```

Notes:
- If `rsync` is available, the script uses it and excludes `voyages.json`.
- Without `rsync`, it falls back to copying files and preserves existing `voyages.json`.

## Utilities

The Python helpers are under `scripts/` now:

- `scripts/merge_course_changes.py`: Merge successive course-change log entries in a YAML file.
- `scripts/merge_course_changes_dir.py`: Run the merge over all `.yml` files in a directory.

Examples:

```bash
python scripts/merge_course_changes.py input.yml output.yml --fix-maxima-pos
python scripts/merge_course_changes_dir.py logs/ --inplace --fix-maxima-pos
```
