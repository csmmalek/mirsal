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

export function isSameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return false;
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Label for the date divider between days: اليوم / أمس / full date. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isSameDay(iso, now.toISOString())) return 'اليوم';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(iso, yesterday.toISOString())) return 'أمس';
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** True when two messages belong to one visual group (same sender, same day, under 5 minutes apart). */
export function isGrouped(
  prev: { senderId: string; createdAt: string } | undefined,
  cur: { senderId: string; createdAt: string }
): boolean {
  if (!prev || prev.senderId !== cur.senderId || !isSameDay(prev.createdAt, cur.createdAt)) return false;
  return Math.abs(new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;
}
