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
  /** اسم المستخدم الفريد (يُختار مرة واحدة ولا يتغير). */
  handle?: string;
  /** من يرى حالاتي (يظهر في حسابي فقط). */
  statusPrivacy?: 'contacts' | 'nobody';
  /** دور العضو داخل مجموعة (يظهر فقط ضمن أعضاء المحادثة). */
  role?: 'admin' | 'member';
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
  /** Set when the sender edited the message (ISO time of the last edit). */
  editedAt?: string;
  /** True when the message was deleted for everyone, or hidden for the current user. Its ciphertext is empty. */
  deleted?: boolean;
  /** True while a failed message waits in the offline outbox and will be resent automatically. */
  queued?: boolean;
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
  /** معرّف مالك المجموعة (منشئها أو من انتقلت إليه الملكية). */
  createdBy?: string;
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

export interface StatusItem {
  id: string;
  userId: string;
  type: 'text' | 'image';
  text: string;
  bg: string;
  image: string;
  createdAt: string;
  expiresAt: string;
  /** هل شاهدتَها (لحالات الآخرين). */
  viewed?: boolean;
  /** عدد المشاهدين (لحالاتي). */
  viewCount?: number;
}

export interface StatusGroup {
  user: User;
  statuses: StatusItem[];
  allViewed: boolean;
}

export interface StatusFeed {
  mine: StatusItem[];
  groups: StatusGroup[];
}
