const { spawn } = require('child_process');
const fs  = require('fs');
const path = require('path');

const generatePolar = require('./parse_polar');

const MAX_LOG_SNIPPET = 400;

/**
 * Function: logSnippet
 * Description: Emit a truncated log message using the supplied logger when content is present.
 * Parameters:
 *   label (string): Prefix describing the log context.
 *   content (string): Message body that may be truncated for readability.
 *   logger (Function): Logging function that handles the formatted output.
 * Returns: void.
 */
function logSnippet(label, content, logger) {
  if (!content) return;
  const payload = content.length > MAX_LOG_SNIPPET
    ? `${content.slice(0, MAX_LOG_SNIPPET)}… (truncated ${content.length - MAX_LOG_SNIPPET} chars)`
    : content;
  logger(`${label}${payload}`);
}

/**
 * Function: runLogbookParser
 * Description: Spawn the logbook parser script and capture its stdout/stderr output.
 * Parameters:
 *   scriptPath (string): Absolute path to the parser script file.
 *   logDir (string): Directory containing Signal K logbook YAML files.
 * Returns: Promise<object> - Resolves with stdout and stderr buffers when the parser succeeds.
 */
function runLogbookParser(scriptPath, logDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, logDir], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`parse_logbook.js exited with code ${code} and signal ${signal || 'null'}`);
        err.code = code;
        err.signal = signal;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

// adjust this path if your logs live elsewhere
const LOG_DIR = path.join(process.env.HOME, '.signalk', 'plugin-config-data', 'signalk-logbook');
const OUTPUT_JSON = path.join(__dirname, 'public', 'voyages.json');
const OUTPUT_POLAR = path.join(__dirname, 'public', 'Polar.json');
const MANUAL_JSON = path.join(__dirname, 'public', 'manual-voyages.json');
const MANUAL_PAYLOAD_MAX_BYTES = 100 * 1024;

/**
 * Function: ensureManualVoyageDir
 * Description: Ensure the manual voyage storage directory exists on disk.
 * Parameters: None.
 * Returns: Promise<void> - Resolves after the directory is created or already exists.
 */
async function ensureManualVoyageDir() {
  await fs.promises.mkdir(path.join(__dirname, 'public'), { recursive: true });
}

/**
 * Function: parseIsoDatetime
 * Description: Validate and normalize a datetime string into ISO format.
 * Parameters:
 *   value (string): Raw datetime value to parse.
 * Returns: string|null - ISO timestamp string or null when invalid.
 */
function parseIsoDatetime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/**
 * Function: normalizeManualLocation
 * Description: Validate a manual location payload and normalize its fields.
 * Parameters:
 *   raw (object): Incoming location descriptor.
 * Returns: object|null - Normalized location or null when invalid.
 */
function normalizeManualLocation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!name) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { name, lat, lon };
}

/**
 * Function: normalizeManualStop
 * Description: Validate a manual stop payload and normalize its fields.
 * Parameters:
 *   raw (object): Incoming stop descriptor.
 * Returns: object|null - Normalized stop or null when invalid.
 */
function normalizeManualStop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const timeValue = raw.time || raw.datetime;
  const time = parseIsoDatetime(timeValue);
  if (!name || !time) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { name, lat, lon, time };
}

/**
 * Function: normalizeManualStops
 * Description: Validate an ordered list of manual stops.
 * Parameters:
 *   rawStops (object[]): Raw stops payload.
 * Returns: object - Normalized stops payload or an error descriptor.
 */
function normalizeManualStops(rawStops) {
  if (!Array.isArray(rawStops) || rawStops.length < 2) {
    return { error: 'Manual voyages require at least two locations.' };
  }
  const locations = rawStops.map(normalizeManualStop);
  if (locations.some(location => !location)) {
    return { error: 'Missing or invalid voyage fields.' };
  }
  let previousMs = null;
  for (const location of locations) {
    const ms = new Date(location.time).getTime();
    if (!Number.isFinite(ms)) {
      return { error: 'Missing or invalid voyage fields.' };
    }
    if (previousMs !== null && ms <= previousMs) {
      return { error: 'Stop times must be in ascending order.' };
    }
    previousMs = ms;
  }
  return { locations };
}

/**
 * Function: normalizeManualVoyagePayload
 * Description: Validate manual voyage submission payloads before persistence.
 * Parameters:
 *   payload (object): Parsed JSON payload from the request body.
 * Returns: object - Normalized payload or an error descriptor.
 */
function normalizeManualVoyagePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { error: 'Invalid payload.' };
  }
  if (Array.isArray(payload.locations)) {
    const normalizedStops = normalizeManualStops(payload.locations);
    if (normalizedStops.error) {
      return { error: normalizedStops.error };
    }
    const returnTrip = Boolean(payload.returnTrip);
    const locations = normalizedStops.locations;
    const start = locations[0];
    const end = locations[locations.length - 1];
    return {
      locations,
      startTime: start.time,
      endTime: end.time,
      startLocation: { name: start.name, lat: start.lat, lon: start.lon },
      endLocation: { name: end.name, lat: end.lat, lon: end.lon },
      returnTrip
    };
  }
  const startTime = parseIsoDatetime(payload.startTime);
  const endTime = parseIsoDatetime(payload.endTime);
  const startLocation = normalizeManualLocation(payload.startLocation);
  const endLocation = normalizeManualLocation(payload.endLocation);
  if (!startTime || !endTime || !startLocation || !endLocation) {
    return { error: 'Missing or invalid voyage fields.' };
  }
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { error: 'End time must be after the start time.' };
  }
  return { startTime, endTime, startLocation, endLocation };
}

/**
 * Function: buildManualVoyageId
 * Description: Create a unique identifier for a manual voyage entry.
 * Parameters: None.
 * Returns: string - Unique manual voyage id.
 */
function buildManualVoyageId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `manual-${Date.now()}-${rand}`;
}

/**
 * Function: readManualVoyages
 * Description: Load the stored manual voyages from disk, returning an empty payload when missing.
 * Parameters: None.
 * Returns: Promise<object> - Manual voyage payload with a `voyages` array.
 */
async function readManualVoyages() {
  try {
    const contents = await fs.promises.readFile(MANUAL_JSON, 'utf8');
    const parsed = JSON.parse(contents);
    if (parsed && Array.isArray(parsed.voyages)) {
      return parsed;
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { voyages: [] };
    }
    throw err;
  }
  return { voyages: [] };
}

/**
 * Function: writeManualVoyages
 * Description: Persist the manual voyages payload to disk.
 * Parameters:
 *   payload (object): Manual voyage payload to save.
 * Returns: Promise<void> - Resolves when the file is written.
 */
async function writeManualVoyages(payload) {
  await ensureManualVoyageDir();
  await fs.promises.writeFile(MANUAL_JSON, JSON.stringify(payload, null, 2));
}

/**
 * Function: readJsonBody
 * Description: Read and parse a JSON request body with a size cap.
 * Parameters:
 *   req (object): Express request object to consume.
 * Returns: Promise<object|null> - Parsed JSON payload or null when empty.
 */
function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MANUAL_PAYLOAD_MAX_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Function: module.exports
 * Description: Create the Signal K plugin instance that exposes HTTP routes and generation hooks.
 * Parameters:
 *   app (object): Signal K application context providing logging and routing helpers.
 * Returns: object - Plugin definition consumed by the host server.
 */
module.exports = function(app) {
  const plugin = {};
  plugin.id = 'voyage-webapp';
  plugin.name = 'Voyage Webapp';

  /**
   * Function: plugin.start
   * Description: Lifecycle hook invoked when the plugin starts; no initialization required currently.
   * Parameters: None.
   * Returns: void.
   */
  plugin.start = () => {
    // nothing to initialise
  };
  /**
   * Function: plugin.stop
   * Description: Lifecycle hook invoked when the plugin stops; no teardown actions required currently.
   * Parameters: None.
   * Returns: void.
   */
  plugin.stop = () => {
    // nothing to clean up
  };

  /**
   * Function: plugin.registerWithRouter
   * Description: Attach HTTP routes that trigger voyage and polar generation when requested.
   * Parameters:
   *   router (object): Express-style router used to register HTTP route handlers.
   * Returns: void.
   */
  plugin.registerWithRouter = router => {
    router.get('/manual-voyages', async (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/manual-voyages';
      app.debug(`[voyage-webapp] GET ${targetUrl} -> loading manual voyages`);
      try {
        const payload = await readManualVoyages();
        res.json(payload);
      } catch (err) {
        app.error(`[voyage-webapp] Failed to read manual voyages: ${err.message}`);
        res.status(500).send({ message: 'Failed to read manual voyages' });
      }
    });

    router.post('/manual-voyages', async (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/manual-voyages';
      app.debug(`[voyage-webapp] POST ${targetUrl} -> saving manual voyage`);
      try {
        const payload = await readJsonBody(req);
        const normalized = normalizeManualVoyagePayload(payload);
        if (normalized.error) {
          res.status(400).send({ message: normalized.error });
          return;
        }
        const existing = await readManualVoyages();
        const voyages = Array.isArray(existing.voyages) ? existing.voyages.slice() : [];
        const newVoyage = {
          id: buildManualVoyageId(),
          createdAt: new Date().toISOString(),
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          startLocation: normalized.startLocation,
          endLocation: normalized.endLocation,
          locations: Array.isArray(normalized.locations) ? normalized.locations : undefined,
          returnTrip: Boolean(normalized.returnTrip)
        };
        voyages.push(newVoyage);
        await writeManualVoyages({ voyages });
        res.status(201).json(newVoyage);
      } catch (err) {
        const status = err.message === 'Payload too large' ? 413 : 400;
        const message = err.message === 'Payload too large' ? 'Payload too large' : 'Invalid JSON payload';
        app.error(`[voyage-webapp] Failed to save manual voyage: ${err.message}`);
        res.status(status).send({ message });
      }
    });

    router.put('/manual-voyages/:id', async (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/manual-voyages/:id';
      const { id } = req.params || {};
      app.debug(`[voyage-webapp] PUT ${targetUrl} -> updating manual voyage ${id || ''}`);
      if (!id) {
        res.status(400).send({ message: 'Missing voyage id' });
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const normalized = normalizeManualVoyagePayload(payload);
        if (normalized.error) {
          res.status(400).send({ message: normalized.error });
          return;
        }
        const existing = await readManualVoyages();
        const voyages = Array.isArray(existing.voyages) ? existing.voyages.slice() : [];
        const index = voyages.findIndex(voyage => voyage && voyage.id === id);
        if (index === -1) {
          res.status(404).send({ message: 'Voyage not found' });
          return;
        }
        const updated = {
          ...voyages[index],
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          startLocation: normalized.startLocation,
          endLocation: normalized.endLocation,
          locations: Array.isArray(normalized.locations) ? normalized.locations : voyages[index].locations,
          returnTrip: typeof normalized.returnTrip === 'boolean' ? normalized.returnTrip : voyages[index].returnTrip,
          updatedAt: new Date().toISOString()
        };
        voyages[index] = updated;
        await writeManualVoyages({ voyages });
        res.json(updated);
      } catch (err) {
        const status = err.message === 'Payload too large' ? 413 : 400;
        const message = err.message === 'Payload too large' ? 'Payload too large' : 'Invalid JSON payload';
        app.error(`[voyage-webapp] Failed to update manual voyage: ${err.message}`);
        res.status(status).send({ message });
      }
    });

    router.delete('/manual-voyages/:id', async (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/manual-voyages/:id';
      const { id } = req.params || {};
      app.debug(`[voyage-webapp] DELETE ${targetUrl} -> deleting manual voyage ${id || ''}`);
      if (!id) {
        res.status(400).send({ message: 'Missing voyage id' });
        return;
      }
      try {
        const existing = await readManualVoyages();
        const voyages = Array.isArray(existing.voyages) ? existing.voyages : [];
        const next = voyages.filter(voyage => voyage && voyage.id !== id);
        if (next.length === voyages.length) {
          res.status(404).send({ message: 'Voyage not found' });
          return;
        }
        await writeManualVoyages({ voyages: next });
        res.json({ status: 'ok' });
      } catch (err) {
        app.error(`[voyage-webapp] Failed to delete manual voyage: ${err.message}`);
        res.status(500).send({ message: 'Failed to delete manual voyage' });
      }
    });

    // GET /generate – run the parser and save voyages.json
    router.get('/generate', (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/generate';
      app.debug(`[voyage-webapp] GET ${targetUrl} -> running parser with log dir ${LOG_DIR}`);
      const scriptPath = path.join(__dirname, 'parse_logbook.js');
      runLogbookParser(scriptPath, LOG_DIR)
        .then(({ stdout, stderr }) => {
          logSnippet('[voyage-webapp] parser stderr: ', stderr, msg => app.debug(msg));
          logSnippet('[voyage-webapp] parser stdout: ', stdout, msg => app.debug(msg));
          try {
            const voyagesData = JSON.parse(stdout);
            const voyagesJson = JSON.stringify(voyagesData, null, 2);
            const polarData = generatePolar(voyagesData);
            const polarJson = JSON.stringify(polarData, null, 2);

            fs.writeFileSync(OUTPUT_JSON, voyagesJson);
            fs.writeFileSync(OUTPUT_POLAR, polarJson);
            app.debug('[voyage-webapp] Successfully wrote voyages.json and Polar.json');
            res.json({ status: 'ok' });
          } catch (writeErr) {
            app.error(`[voyage-webapp] Failed to process voyages output: ${writeErr.message}`);
            logSnippet('[voyage-webapp] raw stdout: ', stdout, msg => app.error(msg));
            res.status(500).send({message: 'Error processing parser output'});
          }
        })
        .catch(err => {
          app.error(`[voyage-webapp] parse_logbook.js failed (code=${err.code ?? 'n/a'} signal=${err.signal ?? 'n/a'}): ${err.message}`);
          logSnippet('[voyage-webapp] parser stderr: ', err.stderr, msg => app.error(msg));
          logSnippet('[voyage-webapp] parser stdout: ', err.stdout, msg => app.error(msg));
          res.status(500).send({message: 'Error running parser'});
        });
    });

    // GET /generate/polar – regenerate polar data using the existing voyages.json
    router.get('/generate/polar', (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/generate/polar';
      app.debug(`[voyage-webapp] GET ${targetUrl} -> regenerating polar from existing voyages.json`);
      fs.readFile(OUTPUT_JSON, 'utf8', (readErr, contents) => {
        if (readErr) {
          app.error(`[voyage-webapp] Failed to read voyages.json: ${readErr.message}`);
          res.status(500).send({message: 'Could not read voyages data'});
          return;
        }

        try {
          const voyagesData = JSON.parse(contents);
          const polarData = generatePolar(voyagesData);
          const polarJson = JSON.stringify(polarData, null, 2);
          fs.writeFile(OUTPUT_POLAR, polarJson, writeErr => {
            if (writeErr) {
              app.error(`[voyage-webapp] Failed to write Polar.json: ${writeErr.message}`);
              res.status(500).send({message: 'Could not write polar data'});
              return;
            }
            app.debug('[voyage-webapp] Successfully rewrote Polar.json from existing voyages.json');
            res.json({ status: 'ok' });
          });
        } catch (parseErr) {
          app.error(`[voyage-webapp] Failed to generate polar data: ${parseErr.message}`);
          res.status(500).send({message: 'Could not process voyages data'});
        }
      });
    });
  };

  // add an empty configuration schema
  plugin.schema = {
    type: 'object',
    properties: {},
    additionalProperties: false
  };

  return plugin;
};
