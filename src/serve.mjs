// A tiny static server so the compiled site can be checked in a browser.
// It only ever reads files under the given directory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function serve({ dir, port = 4173, host = '127.0.0.1', log = console.log }) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) throw new Error(`cannot serve missing directory: ${root}`);

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let target = path.join(root, url);
    if (!target.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${url}`);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') reject(new Error(`port ${port} is busy — pick another with --port`));
      else reject(error);
    });
    server.listen(port, host, () => {
      const url = `http://${host}:${port}/`;
      log(`serving ${root} at ${url} (ctrl-c to stop)`);
      resolve({ server, url });
    });
  });
}
