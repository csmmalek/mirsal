import type {
  Conversation,
  DeliveryStatus,
  DeviceSession,
  Message,
  MessageType,
  PushNotificationItem,
  User,
} from '../src/types/chat';
import { isAdminEmail } from './admin';
import { makeAvatar } from './util';

type Row = Record<string, unknown>;

/** A user-uploaded photo is stored as a small data URI; anything else falls back to the generated initials avatar. */
function customAvatar(v: unknown): string | null {
  return typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v) ? v : null;
}

/** `includeEmail` is only true for a user's own profile: emails are never shown to other people. */
export function mapUser(row: Row, online: Set<string>, includeEmail = false): User {
  const id = String(row.id);
  const displayName = String(row.display_name);
  const uid = String(row.uid ?? row.username);
  return {
    id,
    uid,
    username: uid,
    handle: row.handle ? String(row.handle) : undefined,
    isAdmin: isAdminEmail(row.email),
    ...(includeEmail
      ? { email: String(row.email ?? ''), statusPrivacy: (row.status_privacy === 'nobody' ? 'nobody' : 'contacts') as 'nobody' | 'contacts' }
      : {}),
    ...(row.member_role !== undefined ? { role: String(row.member_role) as 'admin' | 'member' } : {}),
    displayName,
    avatar: customAvatar(row.avatar_url) ?? makeAvatar(displayName, id),
    bio: String(row.bio ?? ''),
    publicKey: String(row.public_key),
    online: online.has(id),
    lastSeen: String(row.last_seen),
  };
}

export function mapMessage(row: Row): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    senderName: row.sender_name ? String(row.sender_name) : undefined,
    type: String(row.type) as MessageType,
    ciphertext: String(row.ciphertext),
    iv: String(row.iv),
    status: String(row.status) as DeliveryStatus,
    createdAt: String(row.created_at),
    editedAt: row.edited_at ? String(row.edited_at) : undefined,
    deleted: row.deleted_at || row.hidden_for_me ? true : undefined,
  };
}

export function mapDevice(row: Row): DeviceSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceName: String(row.device_name),
    deviceType: String(row.device_type) as DeviceSession['deviceType'],
    lastActive: String(row.last_active),
    pushEnabled: Boolean(row.push_enabled),
  };
}

export function mapNotification(row: Row): PushNotificationItem {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    body: String(row.body),
    conversationId: String(row.conversation_id),
    isRead: Boolean(row.is_read),
    createdAt: String(row.created_at),
  };
}

export async function getMemberIds(db: D1Database, conversationId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .bind(conversationId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export async function isMember(db: D1Database, conversationId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .bind(conversationId, userId)
    .first();
  return Boolean(row);
}

/**
 * Conversations for a user, in 3 queries regardless of how many chats they have
 * (D1 round-trips are the expensive part, so no per-conversation lookups).
 */
export async function getConversationsForUser(
  db: D1Database,
  userId: string,
  online: Set<string>,
  onlyId?: string
): Promise<Conversation[]> {
  const filter = onlyId ? 'AND c.id = ?' : '';
  const convStmt = db
    .prepare(
      `SELECT c.*, cm.unread_count, cm.wrapped_key, cm.wrap_iv, cm.wrapped_by,
              m.id AS m_id, m.conversation_id AS m_conversation_id, m.sender_id AS m_sender_id,
              m.type AS m_type, m.ciphertext AS m_ciphertext, m.iv AS m_iv, m.status AS m_status,
              m.created_at AS m_created_at, m.edited_at AS m_edited_at, m.deleted_at AS m_deleted_at,
              mu.display_name AS m_sender_name, h.user_id AS m_hidden
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
       LEFT JOIN messages m ON m.id = c.last_message_id
       LEFT JOIN users mu ON mu.id = m.sender_id
       LEFT JOIN message_hidden h ON h.message_id = m.id AND h.user_id = ?
       WHERE 1 = 1 ${filter} ${onlyId ? '' : 'AND (cm.hidden_at IS NULL OR c.updated_at > cm.hidden_at)'}
       ORDER BY c.updated_at DESC`
    )
    .bind(...(onlyId ? [userId, userId, onlyId] : [userId, userId]));
  const { results: convRows } = await convStmt.all<Row>();
  if (convRows.length === 0) return [];

  const { results: memberRows } = await db
    .prepare(
      `SELECT cm.conversation_id AS conv_id, cm.role AS member_role, u.*
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id IN (
         SELECT conversation_id FROM conversation_members WHERE user_id = ?
       )`
    )
    .bind(userId)
    .all<Row>();

  const membersByConv = new Map<string, User[]>();
  for (const r of memberRows) {
    const key = String(r.conv_id);
    const list = membersByConv.get(key) ?? [];
    list.push(mapUser(r, online));
    membersByConv.set(key, list);
  }

  return convRows.map((c) => {
    const id = String(c.id);
    const members = membersByConv.get(id) ?? [];
    const type = String(c.type) as 'direct' | 'group';
    const other = members.find((m) => m.id !== userId);
    return {
      id,
      type,
      title: type === 'direct' && other ? other.displayName : String(c.title),
      avatar: type === 'direct' && other ? other.avatar : '',
      memberIds: members.map((m) => m.id),
      createdBy: String(c.created_by),
      members,
      unreadCount: Number(c.unread_count || 0),
      updatedAt: String(c.updated_at),
      lastMessage: c.m_id
        ? mapMessage({
            id: c.m_id,
            conversation_id: c.m_conversation_id,
            sender_id: c.m_sender_id,
            sender_name: c.m_sender_name,
            type: c.m_type,
            ciphertext: c.m_ciphertext,
            iv: c.m_iv,
            status: c.m_status,
            created_at: c.m_created_at,
            edited_at: c.m_edited_at,
            deleted_at: c.m_deleted_at,
            hidden_for_me: c.m_hidden,
          })
        : undefined,
      keyInfo: {
        wrappedKey: String(c.wrapped_key),
        iv: String(c.wrap_iv),
        wrappedBy: String(c.wrapped_by),
      },
    };
  });
}
