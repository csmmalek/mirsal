/**
 * واجهة API على Netlify Functions. تعيد استخدام worker/api.ts كما هو.
 * Netlify لا يدعم WebSocket، لذلك الاتصال الفوري هنا معطّل: الواجهة تحدّث البيانات بالاستعلام المتكرر.
 */
import { handleApi } from '../../worker/api';
import { makeDB } from '../../server/pgd1';
import type { Env } from '../../worker/types';

const DB = makeDB(process.env.DATABASE_URL || '');

// بديل لـ Durable Object: كل الطلبات الداخلية تُجاب بـ "لا أحد متصل"، فلا يتعطل شيء.
const hubReply = async (): Promise<Response> =>
  new Response(JSON.stringify({ ok: true, userIds: [] }), { headers: { 'content-type': 'application/json' } });

const env = {
  ...process.env,
  DB,
  HUB: {
    idFromName: () => 'global',
    get: () => ({ fetch: hubReply }),
  },
} as unknown as Env;

interface NetlifyEvent {
  httpMethod: string;
  rawUrl: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded: boolean;
}

export const handler = async (event: NetlifyEvent) => {
  // أداة تشخيص: تفحص وجود DATABASE_URL والاتصال بقاعدة البيانات، دون أن تعرض الرابط أو كلمة المرور.
  if (new URL(event.rawUrl).pathname === '/api/diag') {
    let db = 'ok';
    try {
      await DB.prepare('SELECT 1 AS x').first();
    } catch (err) {
      db = 'error: ' + String((err as Error)?.message || err).slice(0, 300);
    }
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ hasDatabaseUrl: !!process.env.DATABASE_URL, db }),
      isBase64Encoded: false,
    };
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (v) headers.set(k, v);
  }
  const hasBody = event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD' && !!event.body;
  const body = hasBody ? (event.isBase64Encoded ? Buffer.from(event.body as string, 'base64') : event.body) : undefined;
  const req = new Request(event.rawUrl, { method: event.httpMethod, headers, body: body as BodyInit | undefined });

  try {
    const res = await handleApi(req, env);
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      out[k] = v;
    });
    return { statusCode: res.status, headers: out, body: await res.text(), isBase64Encoded: false };
  } catch (err) {
    console.error('api failed', err);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'خطأ في الخادم' }),
      isBase64Encoded: false,
    };
  }
};
