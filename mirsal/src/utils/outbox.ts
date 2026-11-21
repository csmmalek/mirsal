/**
 * صندوق الرسائل الصادرة غير المرسلة (Offline outbox).
 * يخزّن الرسالة المشفّرة كما أُرسلت بالضبط (نفس المعرّف)، فإعادة إرسالها آمنة لأن الخادم يتجاهل المعرّف المكرر.
 * لا يحفظ أي نص واضح: الحقول هنا مشفّرة فقط.
 */

export interface OutboxItem {
  id: string;
  conversationId: string;
  type: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_ITEMS = 50;
const MAX_CIPHERTEXT_CHARS = 200_000;

/** مفتاح التخزين مرتبط بمعرّف المستخدم، فلا يرسل حساب آخر رسائل هذا الحساب. */
export function outboxKey(userId: string): string {
  return `mirsal_outbox_v1_${userId}`;
}

function isItem(x: unknown): x is OutboxItem {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.conversationId === 'string' &&
    typeof o.type === 'string' &&
    typeof o.ciphertext === 'string' &&
    typeof o.iv === 'string' &&
    typeof o.createdAt === 'string'
  );
}

/** يقرأ الصندوق. أي خلل (JSON تالف، بيانات غريبة، تخزين غير متاح) يعيد قائمة فارغة. */
export function loadOutbox(store: KeyValueStore, key: string): OutboxItem[] {
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem);
  } catch {
    return [];
  }
}

function save(store: KeyValueStore, key: string, items: OutboxItem[]): boolean {
  try {
    store.setItem(key, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

/**
 * يضيف رسالة إلى الصندوق. يرفض الرسائل الكبيرة جداً، ويستبدل أي عنصر بالمعرّف نفسه،
 * ويحتفظ بأحدث MAX_ITEMS عنصراً فقط. يعيد نتيجة الحفظ.
 */
export function addToOutbox(store: KeyValueStore, key: string, item: OutboxItem): boolean {
  if (item.ciphertext.length > MAX_CIPHERTEXT_CHARS) return false;
  const items = loadOutbox(store, key).filter((x) => x.id !== item.id);
  items.push(item);
  return save(store, key, items.slice(-MAX_ITEMS));
}

/** يحذف العنصر بالمعرّف إن وُجد. */
export function removeFromOutbox(store: KeyValueStore, key: string, id: string): void {
  const items = loadOutbox(store, key);
  if (!items.some((x) => x.id === id)) return;
  save(store, key, items.filter((x) => x.id !== id));
}
