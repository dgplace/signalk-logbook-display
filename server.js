// Simple static file server for the `public` directory
// Usage: node server.js
// Serves on http://localhost:3645

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3645;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
