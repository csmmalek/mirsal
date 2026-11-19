import type { Conversation, ConversationFilter } from '../types/chat';

/**
 * Filters conversations by tab ('all', 'unread', 'groups') and search query,
 * then sorts descending by most recent activity.
 */
export function filterAndSortConversations(
  conversations: Conversation[],
  filter: ConversationFilter,
  searchQuery: string
): Conversation[] {
  const q = searchQuery.trim().toLowerCase();

  return conversations
    .filter((conv) => {
      if (filter === 'unread' && conv.unreadCount <= 0) return false;
      if (filter === 'groups' && conv.type !== 'group') return false;
      if (!q) return true;

      const titleMatch = conv.title.toLowerCase().includes(q);
      const memberMatch = conv.members.some(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          m.username.toLowerCase().includes(q)
      );
      const previewMatch = (conv.lastMessage?.decrypted?.text ?? '')
        .toLowerCase()
        .includes(q);
      return titleMatch || memberMatch || previewMatch;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Computes total unread message count across all conversations.
 */
export function getTotalUnreadCount(conversations: Conversation[]): number {
  return conversations.reduce((sum, conv) => sum + Math.max(0, conv.unreadCount || 0), 0);
}

/**
 * Formats an ISO timestamp into crisp Arabic clock/date text.
 */
export function formatArabicTime(isoString: string, now = new Date()): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) {
    return 'أمس';
  }

  return date.toLocaleDateString('ar-EG', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats call elapsed seconds into MM:SS tabular string.
 */
export function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** The send button is enabled only for non-blank text while no send is in flight. */
export function canSendDraft(draft: string, sending: boolean): boolean {
  return !sending && draft.trim().length > 0;
}

/** A local-calendar key ("2026-11-19") used to detect day changes in a conversation. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "اليوم", "أمس", or a long Arabic date for the separator between days. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const key = dayKey(iso);
  if (!key) return '';
  if (key === dayKey(now.toISOString())) return 'اليوم';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'أمس';
  const d = new Date(iso);
  return d.toLocaleDateString('ar', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
  });
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** True when a message should open a new visual group (new sender, new day, or a pause over 5 minutes). */
export function startsNewGroup(
  prev: { senderId: string; createdAt: string } | undefined,
  cur: { senderId: string; createdAt: string }
): boolean {
  if (!prev || prev.senderId !== cur.senderId) return true;
  const a = Date.parse(prev.createdAt);
  const b = Date.parse(cur.createdAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  if (dayKey(prev.createdAt) !== dayKey(cur.createdAt)) return true;
  return b - a > GROUP_WINDOW_MS;
}

/** Whether a scroll position is close enough to the end that new messages should follow it. */
export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 120): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
