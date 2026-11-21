import type { Env } from './types';
import { HttpError, newId, nowIso, str } from './util';

const REASONS = ['spam', 'harassment', 'abuse', 'other'] as const;
/** A reporter can file at most this many reports per day, so the queue cannot be flooded. */
const DAILY_LIMIT = 10;

/** Stores a report. The message text is never read here: the server only sees ids and the reason. */
export async function createReport(env: Env, reporterId: string, b: Record<string, unknown>): Promise<void> {
  const reason = str(b.reason, 20);
  if (!(REASONS as readonly string[]).includes(reason)) throw new HttpError(400, 'سبب البلاغ غير صالح');
  const messageId = str(b.messageId, 80) || null;
  const conversationId = str(b.conversationId, 80) || null;
  const targetUserId = str(b.targetUserId, 80) || null;
  const note = str(b.note, 300).trim() || null;
  if (!messageId && !targetUserId) throw new HttpError(400, 'حدد الرسالة أو المستخدم المراد الإبلاغ عنه');
  if (targetUserId === reporterId) throw new HttpError(400, 'لا يمكن الإبلاغ عن نفسك');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at >= ?')
    .bind(reporterId, since)
    .first<{ n: number }>();
  if (Number(count?.n ?? 0) >= DAILY_LIMIT) throw new HttpError(429, 'وصلت للحد اليومي من البلاغات، حاول غداً');

  if (messageId) {
    const dup = await env.DB.prepare('SELECT 1 AS x FROM reports WHERE reporter_id = ? AND message_id = ?')
      .bind(reporterId, messageId)
      .first();
    if (dup) throw new HttpError(409, 'أبلغت عن هذه الرسالة من قبل');
  }

  await env.DB.prepare(
    'INSERT INTO reports (id, reporter_id, target_user_id, message_id, conversation_id, reason, note, status, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(newId('rep'), reporterId, targetUserId, messageId, conversationId, reason, note, 'open', nowIso())
    .run();
}

export async function listReports(env: Env, limit = 100): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    'SELECT r.id, r.reason, r.note, r.status, r.message_id, r.conversation_id, r.created_at, ' +
      'rep.display_name AS reporter_name, tu.display_name AS target_name ' +
      'FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users tu ON tu.id = r.target_user_id ' +
      "ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT ?"
  )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all();
  return results;
}

export async function setReportStatus(env: Env, id: string, status: 'resolved' | 'dismissed'): Promise<void> {
  await env.DB.prepare('UPDATE reports SET status = ?, reviewed_at = ? WHERE id = ?').bind(status, nowIso(), id).run();
}
