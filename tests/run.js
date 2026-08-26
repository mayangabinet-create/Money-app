// Starts the static server and the mock Supabase, runs the test suite, cleans up.
//   npm test
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.png':'image/png', '.svg':'image/svg+xml', '.css':'text/css' };

const statics = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const mock = spawn(process.execPath, [path.join(__dirname, 'mock-supabase.js')], { stdio: 'inherit' });

statics.listen(8080, () => {
  const test = spawn(process.execPath, [path.join(__dirname, 'app.test.js')], {
    stdio: 'inherit',
    env: { ...process.env, CHROMIUM: process.env.CHROMIUM || '' }
  });
  test.on('exit', code => {
    mock.kill();
    statics.close();
    process.exit(code || 0);
  });
});
