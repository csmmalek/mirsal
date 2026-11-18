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
