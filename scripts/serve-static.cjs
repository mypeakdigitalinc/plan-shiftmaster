// Minimal static server with SPA fallback, for serving the Expo web build in e2e tests.
// Minimal SPA static server: node static.cjs <dir> <port>
const http = require('http'), fs = require('fs'), path = require('path');
const [dir, port] = [require('path').resolve(process.argv[2]), Number(process.argv[3] || 8081)];
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('serving', dir, 'on', port));
