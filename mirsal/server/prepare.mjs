// يُشغَّل مرة عند البناء على Render: ينشئ نسخة من hub.ts تعمل على Node بدل Cloudflare.
// hub.ts الأصلي لا يتغير.
import fs from 'node:fs';

const src = fs.readFileSync('worker/hub.ts', 'utf8');
const from = "import { DurableObject } from 'cloudflare:workers';";
if (!src.includes(from)) {
  throw new Error('hub.ts: سطر استيراد cloudflare:workers تغيّر، حدّث prepare.mjs');
}
const out = src.replace(from, "import { DurableObject, WebSocketRequestResponsePair } from '../server/cf-shim';");
fs.writeFileSync('worker/hub.node.ts', out);
console.log('wrote worker/hub.node.ts');
