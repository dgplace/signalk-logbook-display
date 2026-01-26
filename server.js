// Simple static file server for the `public` directory
// Usage: node server.js
// Serves on http://localhost:3645

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const generatePolar = require('./parse_polar');

const PORT = 3645;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_DIR = path.join(process.env.HOME, '.signalk', 'plugin-config-data', 'signalk-logbook');
const OUTPUT_JSON = path.join(PUBLIC_DIR, 'voyages.json');
const OUTPUT_POLAR = path.join(PUBLIC_DIR, 'Polar.json');
const MANUAL_JSON = path.join(PUBLIC_DIR, 'manual-voyages.json');
const MANUAL_PAYLOAD_MAX_BYTES = 100 * 1024;
const BASE_PATH = process.env.VOYAGE_BASE_PATH || '';

// Basic, minimal MIME type map
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Function: runLogbookParser
 * Description: Execute the logbook parser script and collect its stdout/stderr output streams.
 * Parameters:
 *   scriptPath (string): Absolute path to the Node.js parser script.
 *   logDir (string): Directory containing the Signal K logbook YAML files.
 * Returns: Promise<object> - Resolves with stdout and stderr strings when the parser exits successfully.
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

/**
 * Function: send
 * Description: Write a response with headers and body to an HTTP client, supporting stream payloads.
 * Parameters:
 *   res (http.ServerResponse): Response object used to send data back to the client.
 *   status (number): HTTP status code to return.
 *   headers (object): Header key/value pairs for the response.
 *   body (string|stream.Readable|undefined): Optional response payload or stream.
 * Returns: void.
 */
function send(res, status, headers, body) {
  res.writeHead(status, headers);
  // If body is a readable stream, pipe it; otherwise end with string/undefined
  if (body && typeof body.pipe === 'function') {
    body.pipe(res);
  } else {
    res.end(body);
  }
}

/**
 * Function: buildEtag
 * Description: Construct a deterministic ETag token using file size and modification time metadata.
 * Parameters:
 *   stats (fs.Stats): File system metadata describing the file being served.
 * Returns: string - Quoted ETag value suitable for HTTP headers.
 */
function buildEtag(stats) {
  const sizeHex = stats.size.toString(16);
  const mtimeHex = Math.floor(stats.mtimeMs).toString(16);
  return '"' + sizeHex + '-' + mtimeHex + '"';
}

/**
 * Function: normalizeBasePath
 * Description: Normalize a base path string for prefix stripping.
 * Parameters:
 *   value (string): Base path value to normalize.
 * Returns: string - Normalized base path with leading slash and no trailing slash.
 */
function normalizeBasePath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, '');
}

/**
 * Function: resolveEffectivePath
 * Description: Strip a configured base path or forwarded prefix from the request path.
 * Parameters:
 *   pathname (string): Raw decoded pathname from the request URL.
 *   req (http.IncomingMessage): Request object used to inspect forwarded headers.
 * Returns: string - Effective pathname for routing.
 */
function resolveEffectivePath(pathname, req) {
  const configured = normalizeBasePath(BASE_PATH);
  const forwarded = normalizeBasePath(req.headers['x-forwarded-prefix']);
  const candidates = [configured, forwarded].filter(Boolean);
  let effective = pathname;

  for (const prefix of candidates) {
    if (effective === prefix) {
      effective = '/';
      break;
    }
    if (effective.startsWith(`${prefix}/`)) {
      effective = effective.slice(prefix.length);
      break;
    }
  }

  if (effective === '/logbook') return '/';
  if (effective.startsWith('/logbook/')) {
    return effective.slice('/logbook'.length);
  }

  return effective;
}

/**
 * Function: ensureManualVoyageDir
 * Description: Ensure the manual voyage storage directory exists.
 * Parameters: None.
 * Returns: Promise<void> - Resolves after the directory is created or already exists.
 */
async function ensureManualVoyageDir() {
  await fs.promises.mkdir(PUBLIC_DIR, { recursive: true });
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
 * Function: normalizeManualRoutePoint
 * Description: Validate a manual route point payload and normalize its fields.
 * Parameters:
 *   raw (object): Incoming route point descriptor.
 * Returns: object|null - Normalized route point or null when invalid.
 */
function normalizeManualRoutePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Function: normalizeManualRoute
 * Description: Validate optional route points for return trips and align start/turn indices.
 * Parameters:
 *   rawPoints (object[]): Raw route points payload.
 *   rawTurnIndex (number): Optional turnaround index for the route.
 *   start (object): Start stop containing lat/lon coordinates.
 *   turn (object): Turnaround stop containing lat/lon coordinates.
 * Returns: object|null - Normalized route payload or null when invalid.
 */
function normalizeManualRoute(rawPoints, rawTurnIndex, start, turn) {
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) return null;
  const points = rawPoints.map(normalizeManualRoutePoint);
  if (points.some(point => !point) || points.length < 2) return null;
  let turnIndex = Number.isInteger(rawTurnIndex) ? rawTurnIndex : 1;
  if (turnIndex < 1 || turnIndex >= points.length) {
    turnIndex = 1;
  }
  points[0] = { lat: start.lat, lon: start.lon };
  points[turnIndex] = { lat: turn.lat, lon: turn.lon };
  const last = points[points.length - 1];
  if (points.length > 2 && last && last.lat === points[0].lat && last.lon === points[0].lon) {
    points.pop();
    if (turnIndex >= points.length) {
      turnIndex = Math.max(1, points.length - 1);
      points[turnIndex] = { lat: turn.lat, lon: turn.lon };
    }
  }
  return { points, turnIndex };
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
    const turn = locations[1] || end;
    const route = returnTrip ? normalizeManualRoute(payload.routePoints, payload.routeTurnIndex, start, turn) : null;
    return {
      locations,
      startTime: start.time,
      endTime: end.time,
      startLocation: { name: start.name, lat: start.lat, lon: start.lon },
      endLocation: { name: end.name, lat: end.lat, lon: end.lon },
      returnTrip,
      routePoints: route ? route.points : undefined,
      routeTurnIndex: route ? route.turnIndex : undefined
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
 *   req (http.IncomingMessage): Request stream to consume.
 * Returns: Promise<object|null> - Parsed JSON payload or null when empty.
 */
function readJsonBody(req) {
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
 * Function: handleManualVoyagesList
 * Description: Return the stored manual voyage list to the client.
 * Parameters:
 *   res (http.ServerResponse): Response object used to transmit data.
 * Returns: void.
 */
function handleManualVoyagesList(res) {
  readManualVoyages()
    .then(payload => {
      send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(payload));
    })
    .catch(err => {
      console.error(`[voyage-webapp] Failed to read manual voyages: ${err.message}`);
      send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Failed to read manual voyages' }));
    });
}

/**
 * Function: handleManualVoyageCreate
 * Description: Store a new manual voyage record based on the request payload.
 * Parameters:
 *   req (http.IncomingMessage): Request stream containing JSON payload.
 *   res (http.ServerResponse): Response object used to transmit data.
 * Returns: void.
 */
function handleManualVoyageCreate(req, res) {
  readJsonBody(req)
    .then((payload) => {
      const normalized = normalizeManualVoyagePayload(payload);
      if (normalized.error) {
        send(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({ message: normalized.error }));
        return null;
      }
      return readManualVoyages().then(existing => {
        const newVoyage = {
          id: buildManualVoyageId(),
          createdAt: new Date().toISOString(),
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          startLocation: normalized.startLocation,
          endLocation: normalized.endLocation,
          locations: Array.isArray(normalized.locations) ? normalized.locations : undefined,
          returnTrip: Boolean(normalized.returnTrip),
          routePoints: Array.isArray(normalized.routePoints) ? normalized.routePoints : undefined,
          routeTurnIndex: Number.isInteger(normalized.routeTurnIndex) ? normalized.routeTurnIndex : undefined
        };
        const voyages = Array.isArray(existing.voyages) ? existing.voyages.slice() : [];
        voyages.push(newVoyage);
        return writeManualVoyages({ voyages }).then(() => {
          send(res, 201, { 'Content-Type': 'application/json' }, JSON.stringify(newVoyage));
        });
      });
    })
    .catch(err => {
      const status = err.message === 'Payload too large' ? 413 : 400;
      const message = err.message === 'Payload too large' ? 'Payload too large' : 'Invalid JSON payload';
      if (status === 400) {
        console.error(`[voyage-webapp] Failed to parse manual voyage payload: ${err.message}`);
      }
      send(res, status, { 'Content-Type': 'application/json' }, JSON.stringify({ message }));
    });
}

/**
 * Function: handleManualVoyageUpdate
 * Description: Update an existing manual voyage by id.
 * Parameters:
 *   req (http.IncomingMessage): Request stream containing JSON payload.
 *   res (http.ServerResponse): Response object used to transmit data.
 *   id (string): Manual voyage identifier to update.
 * Returns: void.
 */
function handleManualVoyageUpdate(req, res, id) {
  if (!id) {
    send(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Missing voyage id' }));
    return;
  }
  readJsonBody(req)
    .then((payload) => {
      const normalized = normalizeManualVoyagePayload(payload);
      if (normalized.error) {
        send(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({ message: normalized.error }));
        return null;
      }
      return readManualVoyages().then(existing => {
        const voyages = Array.isArray(existing.voyages) ? existing.voyages.slice() : [];
        const index = voyages.findIndex(voyage => voyage && voyage.id === id);
        if (index === -1) {
          send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Voyage not found' }));
          return null;
        }
        const nextReturnTrip = typeof normalized.returnTrip === 'boolean' ? normalized.returnTrip : voyages[index].returnTrip;
        const updated = {
          ...voyages[index],
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          startLocation: normalized.startLocation,
          endLocation: normalized.endLocation,
          locations: Array.isArray(normalized.locations) ? normalized.locations : voyages[index].locations,
          returnTrip: nextReturnTrip,
          routePoints: nextReturnTrip
            ? (Array.isArray(normalized.routePoints) ? normalized.routePoints : voyages[index].routePoints)
            : undefined,
          routeTurnIndex: nextReturnTrip
            ? (Number.isInteger(normalized.routeTurnIndex) ? normalized.routeTurnIndex : voyages[index].routeTurnIndex)
            : undefined,
          updatedAt: new Date().toISOString()
        };
        voyages[index] = updated;
        return writeManualVoyages({ voyages }).then(() => {
          send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(updated));
        });
      });
    })
    .catch(err => {
      const status = err.message === 'Payload too large' ? 413 : 400;
      const message = err.message === 'Payload too large' ? 'Payload too large' : 'Invalid JSON payload';
      if (status === 400) {
        console.error(`[voyage-webapp] Failed to parse manual voyage update payload: ${err.message}`);
      }
      send(res, status, { 'Content-Type': 'application/json' }, JSON.stringify({ message }));
    });
}

/**
 * Function: handleManualVoyageDelete
 * Description: Delete a manual voyage by id.
 * Parameters:
 *   id (string): Manual voyage identifier to delete.
 *   res (http.ServerResponse): Response object used to transmit data.
 * Returns: void.
 */
function handleManualVoyageDelete(id, res) {
  if (!id) {
    send(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Missing voyage id' }));
    return;
  }
  readManualVoyages()
    .then(existing => {
      const voyages = Array.isArray(existing.voyages) ? existing.voyages : [];
      const next = voyages.filter(voyage => voyage && voyage.id !== id);
      if (next.length === voyages.length) {
        send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Voyage not found' }));
        return null;
      }
      return writeManualVoyages({ voyages: next }).then(() => {
        send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'ok' }));
      });
    })
    .catch(err => {
      console.error(`[voyage-webapp] Failed to delete manual voyage: ${err.message}`);
      send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Failed to delete manual voyage' }));
    });
}

/**
 * Function: serveFile
 * Description: Stream a static file to the HTTP client, applying appropriate MIME type and cache headers.
 * Parameters:
 *   req (http.IncomingMessage): Request object supplying conditional header values.
 *   res (http.ServerResponse): Response object used to transmit the file contents.
 *   filePath (string): Absolute path to the file that should be served.
 * Returns: void.
 */
function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = buildEtag(stats);
    const clientEtagsHeader = req.headers['if-none-match'];
    let hasWildcardEtag = false;
    const clientEtags = clientEtagsHeader
      ? clientEtagsHeader.split(',')
          .map(raw => raw.trim())
          .filter(Boolean)
          .map(raw => {
            if (raw === '*') {
              hasWildcardEtag = true;
              return null;
            }
            const token = raw.split(';')[0].trim();
            const strippedWeak = token.startsWith('W/') ? token.slice(2) : token;
            if (!strippedWeak) {
              return null;
            }
            const unquoted = strippedWeak.startsWith('"') && strippedWeak.endsWith('"') && strippedWeak.length >= 2
              ? strippedWeak.slice(1, -1)
              : strippedWeak;
            return { quoted: strippedWeak, unquoted };
          })
          .filter(Boolean)
      : [];
    const modifiedSinceHeader = req.headers['if-modified-since'];
    const normalizedModifiedSince = modifiedSinceHeader ? modifiedSinceHeader.split(';')[0].trim() : '';
    const modifiedSinceTs = normalizedModifiedSince ? Date.parse(normalizedModifiedSince) : Number.NaN;
    const fileMtimeMs = Math.floor(stats.mtimeMs / 1000) * 1000;
    const cacheHeaders = {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'ETag': etag,
      'Last-Modified': new Date(fileMtimeMs).toUTCString()
    };

    const normalizedEtag = etag.startsWith('"') && etag.endsWith('"') && etag.length >= 2 ? etag.slice(1, -1) : etag;
    const etagMatched = hasWildcardEtag || clientEtags.some(entry => entry.quoted === etag || entry.unquoted === normalizedEtag);

    const clientModifiedMs = Number.isFinite(modifiedSinceTs) ? Math.floor(modifiedSinceTs / 1000) * 1000 : Number.NaN;
    const lastModifiedMatched = Number.isFinite(clientModifiedMs) && fileMtimeMs <= clientModifiedMs;

    if (etagMatched || lastModifiedMatched) {
      return send(res, 304, cacheHeaders);
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
    });

    send(res, 200, {
      ...cacheHeaders,
      'Content-Type': type,
      'Content-Length': stats.size,
    }, stream);
  });
}

/**
 * Function: serverRequestHandler
 * Description: Handle incoming HTTP requests for static assets and parser endpoints.
 * Parameters:
 *   req (http.IncomingMessage): Request object describing the client request.
 *   res (http.ServerResponse): Response object used to send data back to the client.
 * Returns: void.
 */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const originalPath = decodeURI(parsed.pathname || '/');
  let pathname = resolveEffectivePath(originalPath, req);
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const logSuffix = originalPath === pathname ? '' : ` -> ${pathname}`;
  console.log(`[voyage-webapp] ${req.method} ${originalPath}${logSuffix}`);

  if (req.method === 'GET' && normalizedPath === '/manual-voyages') {
    handleManualVoyagesList(res);
    return;
  }

  if (req.method === 'POST' && normalizedPath === '/manual-voyages') {
    handleManualVoyageCreate(req, res);
    return;
  }

  if (req.method === 'PUT' && normalizedPath.startsWith('/manual-voyages/')) {
    const manualId = normalizedPath.split('/').pop();
    handleManualVoyageUpdate(req, res, manualId);
    return;
  }

  if (req.method === 'DELETE' && normalizedPath.startsWith('/manual-voyages/')) {
    const manualId = normalizedPath.split('/').pop();
    handleManualVoyageDelete(manualId, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/generate') {
    console.log(`[voyage-webapp] Handling /generate with log dir ${LOG_DIR}`);
    const scriptPath = path.join(__dirname, 'parse_logbook.js');
    runLogbookParser(scriptPath, LOG_DIR)
      .then(({ stdout, stderr }) => {
        if (stderr) {
          console.log(`[voyage-webapp] parser stderr: ${stderr.slice(0, 400)}${stderr.length > 400 ? '…' : ''}`);
        }
        try {
          const voyagesData = JSON.parse(stdout);
          const voyagesJson = JSON.stringify(voyagesData, null, 2);
          const polarData = generatePolar(voyagesData);
          const polarJson = JSON.stringify(polarData, null, 2);
          fs.writeFileSync(OUTPUT_JSON, voyagesJson);
          fs.writeFileSync(OUTPUT_POLAR, polarJson);
          console.log('[voyage-webapp] Successfully wrote voyages.json and Polar.json');
          return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'ok' }));
        } catch (error) {
          console.error(`[voyage-webapp] Failed to process voyages output: ${error.message}`);
          console.error(`[voyage-webapp] raw stdout (partial): ${stdout.slice(0, 400)}${stdout.length > 400 ? '…' : ''}`);
          return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Error processing parser output' }));
        }
      })
      .catch(err => {
        console.error(`[voyage-webapp] Failed to generate voyages: ${err.message}`);
        if (err.stderr) {
          console.error(`[voyage-webapp] parser stderr: ${err.stderr.slice(0, 400)}${err.stderr.length > 400 ? '…' : ''}`);
        }
        if (err.stdout) {
          console.error(`[voyage-webapp] parser stdout (partial): ${err.stdout.slice(0, 400)}${err.stdout.length > 400 ? '…' : ''}`);
        }
        return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Error running parser' }));
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/generate/polar') {
    console.log('[voyage-webapp] Handling /generate/polar');
    fs.readFile(OUTPUT_JSON, 'utf8', (readErr, contents) => {
      if (readErr) {
        console.error(`[voyage-webapp] Failed to read voyages.json: ${readErr.message}`);
        return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Could not read voyages data' }));
      }
      try {
        const voyagesData = JSON.parse(contents);
        const polarData = generatePolar(voyagesData);
        const polarJson = JSON.stringify(polarData, null, 2);
        fs.writeFile(OUTPUT_POLAR, polarJson, writeErr => {
          if (writeErr) {
            console.error(`[voyage-webapp] Failed to write Polar.json: ${writeErr.message}`);
            return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Could not write polar data' }));
          }
          console.log('[voyage-webapp] Successfully regenerated Polar.json from existing voyages.json');
          return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'ok' }));
        });
      } catch (parseErr) {
        console.error(`[voyage-webapp] Failed to generate polar data: ${parseErr.message}`);
        return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Could not process voyages data' }));
      }
    });
    return;
  }

  // Default to index.html for root or directory requests
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  // Resolve to a path under PUBLIC_DIR; prevent path traversal
  const unsafePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!unsafePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  // If path is a directory, serve its index.html
  fs.stat(unsafePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      const indexPath = path.join(unsafePath, 'index.html');
      return serveFile(req, res, indexPath);
    }
    if (!err && stats.isFile()) {
      return serveFile(req, res, unsafePath);
    }

    // For routes without file extensions (e.g. /8), fall back to SPA index
    if (!path.extname(pathname)) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      return serveFile(req, res, indexPath);
    }

    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
  });
});

server.listen(PORT, () => {
  console.log(`Serving public/ at http://localhost:${PORT}`);
});
