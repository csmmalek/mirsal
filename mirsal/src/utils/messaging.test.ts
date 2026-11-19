import test from 'node:test';
import assert from 'node:assert/strict';
import type { Conversation } from '../types/chat';
import {
  filterAndSortConversations,
  formatCallDuration,
  formatDayLabel,
  isGrouped,
  isSameDay,
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

test('day labels: today, yesterday and full dates', () => {
  const now = new Date('2026-11-19T12:00:00');
  assert.equal(formatDayLabel('2026-11-19T01:00:00', now), 'اليوم');
  assert.equal(formatDayLabel('2026-11-18T23:00:00', now), 'أمس');
  assert.notEqual(formatDayLabel('2026-10-01T10:00:00', now), 'اليوم');
  assert.equal(isSameDay('2026-11-19T01:00:00', '2026-11-19T23:00:00'), true);
  assert.equal(isSameDay('2026-11-18T23:59:00', '2026-11-19T00:01:00'), false);
});

test('message grouping needs same sender, same day and under five minutes', () => {
  const a = { senderId: 'u1', createdAt: '2026-11-19T10:00:00' };
  assert.equal(isGrouped(undefined, a), false);
  assert.equal(isGrouped(a, { senderId: 'u1', createdAt: '2026-11-19T10:04:00' }), true);
  assert.equal(isGrouped(a, { senderId: 'u1', createdAt: '2026-11-19T10:06:00' }), false);
  assert.equal(isGrouped(a, { senderId: 'u2', createdAt: '2026-11-19T10:01:00' }), false);
});
