import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

function parseJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

export async function startHttpbinServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    const base = `http://localhost:${server.address().port}`;
    const url = new URL(req.url, base);
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : v]));

    const send = (status, body) => {
      const json = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(json);
    };

    if (req.method === 'GET' && url.pathname === '/get') {
      send(200, { args: Object.fromEntries(url.searchParams), headers, origin: req.socket.remoteAddress, url: url.href });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/post') {
      const json = await parseJson(req);
      send(200, { json, headers });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/uuid') {
      send(200, { uuid: randomUUID() });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/delay/')) {
      const secs = parseInt(url.pathname.split('/').pop(), 10) || 0;
      setTimeout(() => send(200, { delay: secs }), secs * 1000);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
      const code = parseInt(url.pathname.split('/').pop(), 10) || 200;
      send(code, { status: code });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/json') {
      send(200, { slideshow: { slides: [ { title: 'Wake up to WonderWidgets!' }, { title: 'Overview' } ] } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/headers') {
      send(200, { headers });
      return;
    }

    if (url.pathname.startsWith('/anything')) {
      const json = req.method === 'POST' || req.method === 'PUT' ? await parseJson(req) : undefined;
      send(200, { args: Object.fromEntries(url.searchParams), data: '', json, headers, method: req.method, url: url.href });
      return;
    }

    send(404, { error: 'Not Found' });
  });

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  const baseUrl = `http://localhost:${actualPort}`;
  return { server, port: actualPort, baseUrl };
}

export function stopHttpbinServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}
