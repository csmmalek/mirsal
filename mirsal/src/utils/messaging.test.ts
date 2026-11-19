import test from 'node:test';
import assert from 'node:assert/strict';
import type { Conversation } from '../types/chat';
import {
  canSendDraft,
  filterAndSortConversations,
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
