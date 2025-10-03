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
 * Function: serveFile
 * Description: Stream a static file to the HTTP client, applying appropriate MIME type headers and cache validation.
 * Parameters:
 *   req (http.IncomingMessage): Request object used to inspect cache headers from the client.
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
    const lastModified = stats.mtime.toUTCString();
    const cacheControl = ext === '.json'
      ? 'public, max-age=60, must-revalidate'
      : 'public, max-age=86400, must-revalidate';

    const ifModifiedSince = req.headers['if-modified-since'];
    if (ifModifiedSince) {
      const modifiedSinceDate = new Date(ifModifiedSince);
      if (!Number.isNaN(modifiedSinceDate.getTime())) {
        const lastModifiedSeconds = Math.floor(stats.mtimeMs / 1000);
        const modifiedSinceSeconds = Math.floor(modifiedSinceDate.getTime() / 1000);
        if (lastModifiedSeconds <= modifiedSinceSeconds) {
          return send(res, 304, {
            'Cache-Control': cacheControl,
            'Last-Modified': lastModified
          }, undefined);
        }
      }
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
    });

    send(res, 200, {
      'Content-Type': type,
      'Cache-Control': cacheControl,
      'Last-Modified': lastModified,
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
  let pathname = decodeURI(parsed.pathname || '/');
  console.log(`[voyage-webapp] ${req.method} ${pathname}`);

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
