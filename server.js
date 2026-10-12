/**
 * Minimal Zero-Dependency Static File Server & Optional Hardware Mock
 * 
 * Run normally:
 *   node server.js
 * (Serves the controller on http://localhost:3000 to talk to the real ESP32 over Wi-Fi)
 * 
 * Run with offline simulation:
 *   node server.js --mock
 * (Simulates the ESP32 firmware endpoints locally for testing UI without robot)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const IS_MOCK = process.argv.includes('--mock');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Add CORS headers so direct API calls from any origin work
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch (_) {
    pathname = parsedUrl.pathname;
  }

  // Optional Mock ESP32 Endpoints (Only active if --mock is passed)
  if (IS_MOCK) {
    if (pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mock: true, mode: 'simulation', robot: 'esp32_mock_robot' }));
      return;
    }
    if (pathname === '/move') {
      const dir = parsedUrl.searchParams.get('dir') || 'unknown';
      console.log(`[SIMULATION - NO HARDWARE] Virtual Motor Command: ${dir}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'moving', dir, mock: true, mode: 'simulation' }));
      return;
    }
    if (pathname === '/stop') {
      console.log(`[SIMULATION - NO HARDWARE] Virtual Motor Command: STOP`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'stopped', mock: true, mode: 'simulation' }));
      return;
    }
  }

  // Static File Serving
  const safePath = path.resolve(__dirname, '.' + (pathname === '/' ? '/index.html' : pathname));
  const rootDir = path.resolve(__dirname);
  if (!safePath.startsWith(rootDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`500 Internal Error: ${err.code}`);
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` ESP32 Firefighting Robot Web Controller`);
    console.log(` Server running at: http://localhost:${PORT}`);
    if (IS_MOCK) {
      console.log(` [MODE: MOCK] Simulating ESP32 endpoints for testing`);
    } else {
      console.log(` [MODE: REAL] Direct Wi-Fi connection to physical robot`);
    }
    console.log(`===================================================`);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { server, PORT };
}
