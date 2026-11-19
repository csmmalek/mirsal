import test from 'node:test';
import assert from 'node:assert/strict';
import type { Conversation } from '../types/chat';
import {
  canSendDraft,
  dayKey,
  filterAndSortConversations,
  formatDayLabel,
  isNearBottom,
  startsNewGroup,
  formatCallDuration,
  getTotalUnreadCount,
} from './messaging';

const sampleConversations: Conversation[] = [
  {
    id: 'c1',
    type: 'direct',
    title: 'ليلى الحسن',
    avatar: '/layla.jpg',
    memberIds: ['u1', 'u2'],
    members: [],
    unreadCount: 2,
    updatedAt: '2026-11-15T08:00:00Z',
    lastMessage: {
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u2',
      type: 'text',
      ciphertext: 'x',
      iv: 'y',
      status: 'delivered',
      createdAt: '2026-11-15T08:00:00Z',
      decrypted: { text: 'تم إرسال ملف الواجهة' },
    },
  },
  {
    id: 'c2',
    type: 'group',
    title: 'فريق تطوير مِرسال',
    avatar: '',
    memberIds: ['u1', 'u2', 'u3'],
    members: [],
    unreadCount: 0,
    updatedAt: '2026-11-15T10:00:00Z',
    lastMessage: {
      id: 'm2',
      conversationId: 'c2',
      senderId: 'u3',
      type: 'text',
      ciphertext: 'x',
      iv: 'y',
      status: 'read',
      createdAt: '2026-11-15T10:00:00Z',
      decrypted: { text: 'جاهزون للإطلاق' },
    },
  },
];

test('filterAndSortConversations sorts newest first and filters by tab and search', () => {
  const all = filterAndSortConversations(sampleConversations, 'all', '');
  assert.equal(all[0].id, 'c2');
  assert.equal(all[1].id, 'c1');

  const unread = filterAndSortConversations(sampleConversations, 'unread', '');
  assert.equal(unread.length, 1);
  assert.equal(unread[0].id, 'c1');

  const groups = filterAndSortConversations(sampleConversations, 'groups', '');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'c2');

  const searched = filterAndSortConversations(sampleConversations, 'all', 'الواجهة');
  assert.equal(searched.length, 1);
  assert.equal(searched[0].id, 'c1');
});

test('getTotalUnreadCount sums unread counters accurately', () => {
  assert.equal(getTotalUnreadCount(sampleConversations), 2);
});

test('formatCallDuration formats MM:SS cleanly', () => {
  assert.equal(formatCallDuration(0), '00:00');
  assert.equal(formatCallDuration(65), '01:05');
  assert.equal(formatCallDuration(612), '10:12');
});

test('canSendDraft: enabled only for non-blank text while nothing is being sent', () => {
  assert.equal(canSendDraft('مرحبا', false), true);
  assert.equal(canSendDraft('  hi  ', false), true);
  assert.equal(canSendDraft('', false), false);
  assert.equal(canSendDraft('   \n\t ', false), false);
  assert.equal(canSendDraft('مرحبا', true), false);
});

test('formatDayLabel: today, yesterday, older', () => {
  const now = new Date(2026, 10, 19, 15, 0);
  assert.equal(formatDayLabel(new Date(2026, 10, 19, 1, 0).toISOString(), now), 'اليوم');
  assert.equal(formatDayLabel(new Date(2026, 10, 18, 23, 59).toISOString(), now), 'أمس');
  const older = formatDayLabel(new Date(2026, 9, 1, 12, 0).toISOString(), now);
  assert.ok(older.length > 0 && older !== 'اليوم' && older !== 'أمس');
  assert.equal(formatDayLabel('not-a-date', now), '');
});

test('dayKey differs across days and matches within a day', () => {
  const a = new Date(2026, 10, 19, 0, 5).toISOString();
  const b = new Date(2026, 10, 19, 23, 50).toISOString();
  const c = new Date(2026, 10, 20, 0, 5).toISOString();
  assert.equal(dayKey(a), dayKey(b));
  assert.notEqual(dayKey(b), dayKey(c));
});

test('startsNewGroup: same sender within 5 minutes and same day stays grouped', () => {
  const t = (h: number, m: number) => new Date(2026, 10, 19, h, m).toISOString();
  const m1 = { senderId: 'a', createdAt: t(10, 0) };
  assert.equal(startsNewGroup(undefined, m1), true);
  assert.equal(startsNewGroup(m1, { senderId: 'a', createdAt: t(10, 4) }), false);
  assert.equal(startsNewGroup(m1, { senderId: 'a', createdAt: t(10, 6) }), true);
  assert.equal(startsNewGroup(m1, { senderId: 'b', createdAt: t(10, 1) }), true);
  const late = { senderId: 'a', createdAt: new Date(2026, 10, 19, 23, 59).toISOString() };
  assert.equal(startsNewGroup(late, { senderId: 'a', createdAt: new Date(2026, 10, 20, 0, 1).toISOString() }), true);
});

test('isNearBottom uses a distance threshold', () => {
  assert.equal(isNearBottom(2000, 1500, 500), true); // exactly at the bottom
  assert.equal(isNearBottom(2000, 1400, 500), true); // 100px away
  assert.equal(isNearBottom(2000, 1000, 500), false); // 500px away
});
