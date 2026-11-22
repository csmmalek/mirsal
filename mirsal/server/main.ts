/**
 * تشغيل مِرسال على Node (Render). يعيد استخدام كود worker/ كما هو:
 * - طلبات /api/* وغيرها تمر عبر worker/index.ts نفسه.
 * - الـ Durable Object (Hub) يعمل داخل العملية نفسها، ونستقبل عليه اتصالات WebSocket عبر 'ws'.
 * - ملفات الواجهة تُقرأ من مجلد dist/ الناتج من vite build.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import worker from '../worker/index';
import { Hub } from '../worker/hub.node';
import { makeDB } from './pgd1';
import type { Env } from '../worker/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT || 10000);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** بديل لـ env.ASSETS: يخدم ملفات dist/ ويعيد index.html لأي مسار غير موجود (تطبيق صفحة واحدة). */
const assets = {
  fetch: async (request: Request): Promise<Response> => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    let file = path.join(DIST, pathname);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' },
    });
  },
};

const DB = makeDB(process.env.DATABASE_URL || '');

// Hub واحد يملك كل الاتصالات، مثل Durable Object 'global' في Cloudflare.
const sockets = new Set<WebSocket>();
let autoPair: { request: string; response: string } | null = null;
const hubCtx = {
  setWebSocketAutoResponse(pair: { request: string; response: string }) {
    autoPair = pair;
  },
  acceptWebSocket(ws: WebSocket) {
    sockets.add(ws);
  },
  getWebSockets() {
    return [...sockets];
  },
};
const hub = new Hub(hubCtx as never, {} as Env);

const env = {
  ...process.env,
  DB,
  ASSETS: assets,
  HUB: {
    idFromName: () => 'global',
    get: () => ({
      fetch: (input: string | Request, init?: RequestInit) =>
        hub.fetch(input instanceof Request ? input : new Request(String(input), init)),
    }),
  },
} as unknown as Env;

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  const extended = ws as WebSocket & {
    serializeAttachment: (v: unknown) => void;
    deserializeAttachment: () => unknown;
    __att?: unknown;
  };
  extended.serializeAttachment = (v: unknown) => {
    extended.__att = v;
  };
  extended.deserializeAttachment = () => extended.__att ?? null;
  sockets.add(ws);
  hubCtx.acceptWebSocket(ws);

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    const raw = isBinary ? data : data.toString('utf8');
    if (autoPair && typeof raw === 'string' && raw === autoPair.request) {
      ws.send(autoPair.response);
      return;
    }
    void hub.webSocketMessage(ws as never, raw as string);
  });
  ws.on('close', () => {
    sockets.delete(ws);
    void hub.webSocketClose(ws as never);
  });
  ws.on('error', () => {
    sockets.delete(ws);
    void hub.webSocketError(ws as never);
  });
});

const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = await worker.fetch(request, env);
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    res.writeHead(response.status, outHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('request failed', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'خطأ في الخادم' }));
  }
});

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mirsal server listening on ${PORT}`);
});
