// HTTPS origin server for Kerai AI.
//
// `next start` has no HTTPS option (only `next dev --experimental-https`, which the
// Next docs scope to development), so serving the origin cert in production needs a
// custom server. This is that server and nothing more — it hands every request
// straight to Next's own handler.
//
// Certs come from `bash scripts/make-certs.sh`. cloudflared is the only client.

// Must be set before `next` is evaluated, hence the dynamic import below.
process.env.NODE_ENV ??= 'production';

import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const certs = join(dir, 'certs');
const port = Number(process.env.HTTPS_PORT ?? 3443);
const hostname = process.env.HOSTNAME ?? 'localhost';
const dev = process.env.NODE_ENV !== 'production';

let credentials;
try {
  credentials = {
    key: readFileSync(join(certs, 'origin-key.pem')),
    cert: readFileSync(join(certs, 'origin-fullchain.pem')),
  };
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  console.error('No certificates in ./certs — run `bash scripts/make-certs.sh` first.');
  process.exit(1);
}

const { default: next } = await import('next');

const app = next({ dev, dir, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer(credentials, (req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  });
}).listen(port, () => {
  console.log(`> HTTPS origin ready at https://${hostname}:${port} (${process.env.NODE_ENV})`);
});
