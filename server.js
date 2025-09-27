// Simple static file server for the `public` directory
// Usage: node server.js
// Serves on http://localhost:3645

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execFile } = require('child_process');

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

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  // If body is a readable stream, pipe it; otherwise end with string/undefined
  if (body && typeof body.pipe === 'function') {
    body.pipe(res);
  } else {
    res.end(body);
  }
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
    });

    send(res, 200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
    }, stream);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let pathname = decodeURI(parsed.pathname || '/');

  if (req.method === 'GET' && pathname === '/generate') {
    execFile('node', [path.join(__dirname, 'parse_logbook.js'), LOG_DIR], (err, stdout, stderr) => {
      if (err) {
        console.error(`Failed to generate voyages: ${stderr}`);
        return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Error running parser' }));
      }
      try {
        const voyagesData = JSON.parse(stdout);
        const voyagesJson = JSON.stringify(voyagesData, null, 2);
        const polarData = generatePolar(voyagesData);
        const polarJson = JSON.stringify(polarData, null, 2);
        fs.writeFileSync(OUTPUT_JSON, voyagesJson);
        fs.writeFileSync(OUTPUT_POLAR, polarJson);
        return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'ok' }));
      } catch (error) {
        console.error(`Failed to process voyages output: ${error.message}`);
        return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Error processing parser output' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/generate/polar') {
    fs.readFile(OUTPUT_JSON, 'utf8', (readErr, contents) => {
      if (readErr) {
        console.error(`Failed to read voyages.json: ${readErr.message}`);
        return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Could not read voyages data' }));
      }
      try {
        const voyagesData = JSON.parse(contents);
        const polarData = generatePolar(voyagesData);
        const polarJson = JSON.stringify(polarData, null, 2);
        fs.writeFile(OUTPUT_POLAR, polarJson, writeErr => {
          if (writeErr) {
            console.error(`Failed to write Polar.json: ${writeErr.message}`);
            return send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ message: 'Could not write polar data' }));
          }
          return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'ok' }));
        });
      } catch (parseErr) {
        console.error(`Failed to generate polar data: ${parseErr.message}`);
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
      return serveFile(res, indexPath);
    }
    if (!err && stats.isFile()) {
      return serveFile(res, unsafePath);
    }

    // For routes without file extensions (e.g. /8), fall back to SPA index
    if (!path.extname(pathname)) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      return serveFile(res, indexPath);
    }

    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
  });
});

server.listen(PORT, () => {
  console.log(`Serving public/ at http://localhost:${PORT}`);
});
