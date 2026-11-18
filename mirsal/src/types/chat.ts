export type MessageType = 'text' | 'image' | 'audio' | 'file' | 'call';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type ConversationFilter = 'all' | 'unread' | 'groups';

export interface User {
  id: string;
  /** The public 5-digit account ID, e.g. "48213". */
  uid: string;
  /** Same as uid (kept so older UI code keeps working). */
  username: string;
  isAdmin: boolean;
  /** Present only on the signed-in user's own profile. */
  email?: string;
  displayName: string;
  avatar: string;
  bio: string;
  publicKey: string;
  online: boolean;
  lastSeen: string;
}

export interface DeviceSession {
  id: string;
  userId: string;
  deviceName: string;
  deviceType: 'web' | 'android' | 'desktop';
  lastActive: string;
  pushEnabled: boolean;
  isCurrent?: boolean;
}

export interface DecryptedMessagePayload {
  text?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  mimeType?: string;
  durationSec?: number;
  callKind?: 'audio' | 'video';
  callOutcome?: 'completed' | 'missed' | 'declined';
  replyToId?: string;
  replyPreview?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  type: MessageType;
  ciphertext: string;
  iv: string;
  status: DeliveryStatus;
  createdAt: string;
  decrypted?: DecryptedMessagePayload;
}

/** The conversation's AES key, wrapped for the current user (see utils/crypto.ts). */
export interface ConversationKeyInfo {
  wrappedKey: string;
  iv: string;
  wrappedBy: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title: string;
  avatar: string;
  memberIds: string[];
  members: User[];
  unreadCount: number;
  updatedAt: string;
  lastMessage?: Message;
  keyInfo: ConversationKeyInfo;
}

export interface PushNotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  conversationId: string;
  isRead: boolean;
  createdAt: string;
}

export interface ActiveCallState {
  callId: string;
  conversationId: string;
  peerId: string;
  peerName: string;
  peerAvatar: string;
  kind: 'audio' | 'video';
  direction: 'outgoing' | 'incoming';
  status: 'ringing' | 'connecting' | 'connected' | 'ended';
  startedAt: number | null;
  muted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  fingerprint: string;
}
