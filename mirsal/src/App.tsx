import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { AuthGate, type AuthParams } from './components/AuthGate';
import type { GoogleFlow, GoogleRegisterValues } from './components/GoogleAuth';
import { CallOverlay } from './components/CallOverlay';
import { ChatWorkspace } from './components/ChatWorkspace';
import { ConversationList } from './components/ConversationList';
import { SidebarNav } from './components/SidebarNav';
import { DevicesModal, NewChatModal, NotificationsModal } from './components/SideModals';
import { AdminModal, ProfileModal, SupportModal } from './components/DevModals';
import { ChatInfoModal, ChatInfoActions } from './components/ChatInfoModal';
import { DEFAULT_THEME, THEMES, applyTheme } from './themes';
import { createApi, errorMessage, readError } from './api/client';
import type { StatusFeed } from './types/chat';
import { SettingsModal } from './components/SettingsModal';
import { StatusComposer, StatusPanel, StatusViewer } from './components/StatusPanel';
import type { AppSection } from './components/SidebarNav';
import { PublicSettings, StatusBanner } from './components/StatusBanner';
import { ThemeMode } from './preferences';
import type {
  ActiveCallState,
  Conversation,
  ConversationFilter,
  DecryptedMessagePayload,
  DeviceSession,
  Message,
  MessageType,
  PushNotificationItem,
  User,
} from './types/chat';
import {
  computeSafetyFingerprint,
  decryptMessagePayload,
  deriveFromPassword,
  encryptMessagePayload,
  generateConversationKeyBytes,
  generateIdentityKeyPair,
  unwrapConversationKeyRaw,
  importConversationKey,
  unwrapConversationKey,
  unwrapPrivateKey,
  wrapConversationKey,
  wrapPrivateKey,
} from './utils/crypto';
import { filterAndSortConversations, getTotalUnreadCount } from './utils/messaging';

interface AndroidBridge {
  setSession(baseUrl: string, token: string): void;
  clearSession(): void;
}
const androidBridge = (): AndroidBridge | undefined =>
  (window as unknown as { MirsalAndroid?: AndroidBridge }).MirsalAndroid;

const LS = { token: 'mirsal_token', priv: 'mirsal_priv', device: 'mirsal_device_id', theme: 'mirsal_theme', color: 'mirsal_color_theme' };
const CALL_RING_TIMEOUT_MS = 45_000;

function playNotificationTone() {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    // autoplay restrictions
  }
}

function deviceInfo(): { deviceName: string; deviceType: 'web' | 'android' } {
  if (androidBridge()) return { deviceName: 'تطبيق مِرسال للأندرويد', deviceType: 'android' };
  if (/Android/i.test(navigator.userAgent)) return { deviceName: 'متصفح الهاتف', deviceType: 'android' };
  return { deviceName: `متصفح الويب (${navigator.platform || 'Desktop'})`, deviceType: 'web' };
}

const newMsgId = () => `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(() => Boolean(localStorage.getItem(LS.token)));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleFlow, setGoogleFlow] = useState<GoogleFlow | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [notifications, setNotifications] = useState<PushNotificationItem[]>([]);
  const [typingByConv, setTypingByConv] = useState<Record<string, string[]>>({});
  const [wsConnected, setWsConnected] = useState(false);

  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [section, setSection] = useState<AppSection>('chats');
  const [statusFeed, setStatusFeed] = useState<StatusFeed>({ mine: [], groups: [] });
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusViewer, setStatusViewer] = useState<null | { kind: 'mine' } | { kind: 'group'; index: number }>(null);
  const [statusComposer, setStatusComposer] = useState(false);

  const [activeModal, setActiveModal] = useState<
    null | 'new_chat' | 'devices' | 'notifications' | 'chat_info' | 'profile' | 'themes' | 'settings' | 'support' | 'admin'
  >(null);
  const [chatFingerprint, setChatFingerprint] = useState('');
  const [toastNotification, setToastNotification] = useState<PushNotificationItem | null>(null);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const v = localStorage.getItem(LS.theme);
    return v === 'light' || v === 'auto' ? v : 'dark';
  });
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
  );
  const darkMode = themeMode === 'auto' ? systemDark : themeMode === 'dark';
  const setDarkMode = useCallback((next: boolean | ((d: boolean) => boolean)) => {
    setThemeMode((prev) => {
      const cur = prev === 'auto' ? systemDark : prev === 'dark';
      const v = typeof next === 'function' ? next(cur) : next;
      return v ? 'dark' : 'light';
    });
  }, [systemDark]);
  const [colorTheme, setColorTheme] = useState(() => {
    const saved = localStorage.getItem(LS.color);
    return THEMES.some((t) => t.id === saved) ? (saved as string) : DEFAULT_THEME;
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  // WebRTC
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimerRef = useRef<number | null>(null);
  const activeCallRef = useRef<ActiveCallState | null>(null);
  activeCallRef.current = activeCall;

  const tokenRef = useRef<string | null>(localStorage.getItem(LS.token));
  const privRef = useRef<string | null>(localStorage.getItem(LS.priv));
  const deviceIdRef = useRef<string>(localStorage.getItem(LS.device) || '');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const convKeysRef = useRef<Map<string, CryptoKey>>(new Map());
  const knownUsersRef = useRef<Map<string, User>>(new Map());
  const iceServersRef = useRef<RTCIceServer[] | null>(null);

  const activeConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConversationId;
  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  const devicesRef = useRef<DeviceSession[]>([]);
  devicesRef.current = devices;
  const soundRef = useRef(true);
  soundRef.current = soundEnabled;

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(LS.theme, themeMode);
  }, [darkMode, themeMode]);

  useEffect(() => {
    applyTheme(colorTheme);
    localStorage.setItem(LS.color, colorTheme);
  }, [colorTheme]);

  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok && alive) setPublicSettings((await res.json()) as PublicSettings);
      } catch {
        /* offline: keep the last known settings */
      }
    };
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  /** ثيم «فاتح» (مثل لؤلؤ) يفرض الوضع الفاتح؛ غيره يترك الوضع كما اختاره المستخدم. */
  const pickColorTheme = useCallback(
    (id: string) => {
      const t = THEMES.find((x) => x.id === id);
      if (t?.light) setThemeMode('light');
      else if (t && themeMode === 'light' && colorTheme === 'pearl') setThemeMode('dark');
      setColorTheme(id);
    },
    [colorTheme, themeMode]
  );

  /* ------------------------------- session ------------------------------- */

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    privRef.current = null;
    convKeysRef.current.clear();
    localStorage.removeItem(LS.token);
    localStorage.removeItem(LS.priv);
    localStorage.removeItem(LS.device);
    androidBridge()?.clearSession();
    wsRef.current?.close();
    setCurrentUser(null);
    setConversations([]);
    setMessagesByConv({});
    setActiveConversationId(null);
    setActiveCall(null);
  }, []);

  const api = useMemo(
    () => createApi({ getToken: () => tokenRef.current, onUnauthorized: clearSession }),
    [clearSession]
  );

  /* ---------------------------- encryption keys ---------------------------- */

  const getConversationKey = useCallback(
    async (convId: string): Promise<CryptoKey> => {
      const cached = convKeysRef.current.get(convId);
      if (cached) return cached;
      let conv = conversationsRef.current.find((c) => c.id === convId);
      if (!conv) {
        const res = await api(`/api/conversations/${encodeURIComponent(convId)}`);
        if (!res.ok) throw new Error('conversation unavailable');
        conv = ((await res.json()) as { conversation: Conversation }).conversation;
      }
      const wrapper = conv.members.find((m) => m.id === conv!.keyInfo.wrappedBy);
      if (!wrapper || !privRef.current) throw new Error('missing key material');
      const key = await unwrapConversationKey(conv.keyInfo.wrappedKey, conv.keyInfo.iv, privRef.current, wrapper.publicKey);
      convKeysRef.current.set(convId, key);
      return key;
    },
    [api]
  );

  const decryptMessage = useCallback(
    async (msg: Message): Promise<Message> => {
      if (msg.deleted) return { ...msg, decrypted: { text: '' } };
      try {
        const key = await getConversationKey(msg.conversationId);
        return { ...msg, decrypted: await decryptMessagePayload(msg.ciphertext, msg.iv, key) };
      } catch {
        return { ...msg, decrypted: { text: 'تعذر فك تشفير الرسالة' } };
      }
    },
    [getConversationKey]
  );

  /* ------------------------------ data loading ------------------------------ */

  const loadWorkspaceData = useCallback(async () => {
    const [convRes, devRes, notifRes] = await Promise.all([
      api('/api/conversations'),
      api('/api/devices'),
      api('/api/notifications'),
    ]);
    if (devRes.ok) setDevices(((await devRes.json()) as { devices: DeviceSession[] }).devices);
    if (notifRes.ok) setNotifications(((await notifRes.json()) as { notifications: PushNotificationItem[] }).notifications);
    if (convRes.ok) {
      const { conversations: list } = (await convRes.json()) as { conversations: Conversation[] };
      conversationsRef.current = list;
      const withLast = await Promise.all(
        list.map(async (c) => ({ ...c, lastMessage: c.lastMessage ? await decryptMessage(c.lastMessage) : undefined }))
      );
      setConversations(withLast);
      if (!activeConvIdRef.current && withLast.length > 0) setActiveConversationId(withLast[0].id);
    }
  }, [api, decryptMessage]);

  const loadMessagesForConversation = useCallback(
    async (convId: string) => {
      const res = await api(`/api/conversations/${encodeURIComponent(convId)}/messages`);
      if (!res.ok) return;
      const json = (await res.json()) as { messages: Message[] };
      const decrypted = await Promise.all(json.messages.map(decryptMessage));
      setMessagesByConv((prev) => ({ ...prev, [convId]: decrypted }));
    },
    [api, decryptMessage]
  );

  const finishLogin = useCallback(
    async (user: User, token: string, deviceId: string, privateKeyJwk: string) => {
      tokenRef.current = token;
      privRef.current = privateKeyJwk;
      deviceIdRef.current = deviceId;
      localStorage.setItem(LS.token, token);
      localStorage.setItem(LS.priv, privateKeyJwk);
      localStorage.setItem(LS.device, deviceId);
      androidBridge()?.setSession(window.location.origin, token);
      setCurrentUser(user);
      await loadWorkspaceData();
    },
    [loadWorkspaceData]
  );

  const handleAuth = useCallback(
    async (p: AuthParams) => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const { authSecret, wrapKey } = await deriveFromPassword(p.email, p.password);
        const info = deviceInfo();
        if (p.mode === 'register') {
          const kp = await generateIdentityKeyPair();
          const wrapped = await wrapPrivateKey(kp.privateKeyJwk, wrapKey);
          const res = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              email: p.email,
              setupCode: p.setupCode,
              code: p.code,
              displayName: p.displayName,
              handle: p.handle,
              authSecret,
              publicKey: kp.publicKeyJwk,
              encryptedPrivateKey: wrapped.ciphertext,
              privateKeyIv: wrapped.iv,
              ...info,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'تعذر إنشاء الحساب');
          await finishLogin(data.user, data.token, data.deviceId, kp.privateKeyJwk);
        } else {
          const res = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identifier: p.email, authSecret, ...info }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'فشل تسجيل الدخول');
          const priv = await unwrapPrivateKey(data.encryptedPrivateKey, data.privateKeyIv, wrapKey);
          await finishLogin(data.user, data.token, data.deviceId, priv);
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الدخول');
      } finally {
        setAuthLoading(false);
      }
    },
    [api, finishLogin]
  );

  // Google sign-in: an existing account asks for its passphrase; a new one asks for a username and a passphrase.
  const handleGoogle = useCallback(
    async (credential: string) => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const res = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential, ...deviceInfo() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر تسجيل الدخول بـ Google');
        if (data.needsRegistration) {
          setGoogleFlow({ kind: 'register', credential, email: data.email, displayName: data.displayName ?? '' });
        } else {
          setGoogleFlow({
            kind: 'unlock',
            email: data.email,
            user: data.user,
            token: data.token,
            deviceId: data.deviceId,
            encryptedPrivateKey: data.encryptedPrivateKey,
            privateKeyIv: data.privateKeyIv,
          });
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول بـ Google');
      } finally {
        setAuthLoading(false);
      }
    },
    [api]
  );

  const handleGoogleUnlock = useCallback(
    async (passphrase: string) => {
      if (!googleFlow || googleFlow.kind !== 'unlock') return;
      setAuthLoading(true);
      setAuthError(null);
      try {
        const { wrapKey } = await deriveFromPassword(googleFlow.email, passphrase);
        let priv: string;
        try {
          priv = await unwrapPrivateKey(googleFlow.encryptedPrivateKey, googleFlow.privateKeyIv, wrapKey);
        } catch {
          throw new Error('رمز التشفير غير صحيح');
        }
        setGoogleFlow(null);
        await finishLogin(googleFlow.user as User, googleFlow.token, googleFlow.deviceId, priv);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'تعذر فتح الحساب');
      } finally {
        setAuthLoading(false);
      }
    },
    [api, finishLogin, googleFlow]
  );

  const handleGoogleRegister = useCallback(
    async (values: GoogleRegisterValues) => {
      if (!googleFlow || googleFlow.kind !== 'register') return;
      setAuthLoading(true);
      setAuthError(null);
      try {
        const { authSecret, wrapKey } = await deriveFromPassword(googleFlow.email, values.passphrase);
        const kp = await generateIdentityKeyPair();
        const wrapped = await wrapPrivateKey(kp.privateKeyJwk, wrapKey);
        const res = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({
            credential: googleFlow.credential,
            displayName: values.displayName,
            handle: values.handle,
            setupCode: values.setupCode,
            authSecret,
            publicKey: kp.publicKeyJwk,
            encryptedPrivateKey: wrapped.ciphertext,
            privateKeyIv: wrapped.iv,
            ...deviceInfo(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر إنشاء الحساب');
        setGoogleFlow(null);
        await finishLogin(data.user, data.token, data.deviceId, kp.privateKeyJwk);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب');
      } finally {
        setAuthLoading(false);
      }
    },
    [api, finishLogin, googleFlow]
  );

  // Restore a saved session on startup
  useEffect(() => {
    if (!tokenRef.current || !privRef.current) {
      setBooting(false);
      return;
    }
    (async () => {
      try {
        const res = await api('/api/me');
        if (res.ok) {
          const data = (await res.json()) as { user: User; deviceId: string };
          deviceIdRef.current = data.deviceId;
          androidBridge()?.setSession(window.location.origin, tokenRef.current!);
          setCurrentUser(data.user);
          await loadWorkspaceData();
        } else if (res.status === 401) {
          clearSession();
        }
      } catch {
        // offline: stay on the sign-in screen but keep the saved session for next time
      } finally {
        setBooting(false);
      }
    })();
  }, [api, clearSession, loadWorkspaceData]);

  // Load messages + safety number when switching conversations
  useEffect(() => {
    if (!activeConversationId || !currentUser) return;
    loadMessagesForConversation(activeConversationId);
    api(`/api/conversations/${encodeURIComponent(activeConversationId)}/read`, { method: 'POST', body: '{}' }).catch(
      () => undefined
    );
    setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, unreadCount: 0 } : c)));
  }, [activeConversationId, currentUser?.id, loadMessagesForConversation, api]);

  useEffect(() => {
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) {
      setChatFingerprint('');
      return;
    }
    computeSafetyFingerprint(conv.members.map((m) => m.publicKey)).then(setChatFingerprint);
  }, [activeConversationId, conversations.length]);

  /* ---------------------------------- calls ---------------------------------- */

  const cleanupWebRtc = useCallback(() => {
    if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
    ringTimerRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    setLocalStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setRemoteStream(null);
  }, []);

  const wsSend = useCallback((payload: unknown): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(payload));
    return true;
  }, []);

  const sendMessageTo = useCallback(
    async (convId: string, type: MessageType, payload: DecryptedMessagePayload): Promise<boolean> => {
      const user = currentUserRef.current;
      if (!user) return false;
      const id = newMsgId();
      const createdAt = new Date().toISOString();
      const setStatus = (status: Message['status']) =>
        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: (prev[convId] || []).map((m) => (m.id === id ? { ...m, status } : m)),
        }));

      let ciphertext = '';
      let iv = '';
      try {
        const key = await getConversationKey(convId);
        ({ ciphertext, iv } = await encryptMessagePayload(payload, key));
      } catch {
        // تعذّر التشفير (مفتاح المحادثة غير متاح): لا نُظهر رسالة وهمية، ويحتفظ الحقل بالنص ليعيد المستخدم المحاولة.
        return false;
      }

      const optimistic: Message = {
        id,
        conversationId: convId,
        senderId: user.id,
        senderName: user.displayName,
        type,
        ciphertext,
        iv,
        status: 'sending',
        createdAt,
        decrypted: payload,
      };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), optimistic] }));
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, updatedAt: createdAt, lastMessage: optimistic } : c))
      );

      // الرسالة ظاهرة الآن (حالة «جارٍ الإرسال»)؛ التسليم للخادم يكمل في الخلفية دون حجب الواجهة.
      void (async () => {
        try {
          const res = await api(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({ id, type, ciphertext, iv }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const { message } = (await res.json()) as { message: Message };
          // Never downgrade: the realtime echo may already have marked it delivered/read.
          setMessagesByConv((prev) => ({
            ...prev,
            [convId]: (prev[convId] || []).map((m) =>
              m.id === id && m.status === 'sending' ? { ...m, status: message.status, createdAt: message.createdAt } : m
            ),
          }));
        } catch {
          setStatus('failed');
        }
      })();
      return true;
    },
    [api, getConversationKey]
  );

  const handleSendMessage = useCallback(
    async (type: MessageType, payload: DecryptedMessagePayload): Promise<boolean> => {
      if (!activeConvIdRef.current) return false;
      return sendMessageTo(activeConvIdRef.current, type, payload);
    },
    [sendMessageTo]
  );

  /* ------------------------------ statuses ------------------------------ */
  const loadStatuses = useCallback(async () => {
    try {
      const res = await api('/api/statuses');
      if (res.ok) setStatusFeed((await res.json()) as StatusFeed);
    } catch {
      /* offline: keep the last feed */
    } finally {
      setStatusLoading(false);
    }
  }, [api]);
  const loadStatusesRef = useRef(loadStatuses);
  loadStatusesRef.current = loadStatuses;

  useEffect(() => {
    if (!currentUser?.id) return;
    setStatusLoading(true);
    void loadStatuses();
  }, [currentUser?.id, loadStatuses]);

  /** خريطة الحلقة الخضراء: معرّف المستخدم ← جديدة / مشاهدة. */
  const statusRing = useMemo(() => {
    const m: Record<string, 'new' | 'seen'> = {};
    for (const g of statusFeed.groups) m[g.user.id] = g.allViewed ? 'seen' : 'new';
    return m;
  }, [statusFeed.groups]);
  const statusUnseen = statusFeed.groups.filter((g) => !g.allViewed).length;

  const markStatusViewed = useCallback((statusId: string) => {
    setStatusFeed((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        const statuses = g.statuses.map((s) => (s.id === statusId ? { ...s, viewed: true } : s));
        return { ...g, statuses, allViewed: statuses.every((s) => s.viewed) };
      }),
    }));
  }, []);

  /** تحديث رسالة في الحالة المحلية وفي معاينة المحادثة إن كانت آخر رسالة. */
  const patchMessage = useCallback((convId: string, messageId: string, patch: (m: Message) => Message) => {
    setMessagesByConv((prev) => ({
      ...prev,
      [convId]: (prev[convId] || []).map((m) => (m.id === messageId ? patch(m) : m)),
    }));
    setConversations((prev) =>
      prev.map((c) => (c.id === convId && c.lastMessage?.id === messageId ? { ...c, lastMessage: patch(c.lastMessage) } : c))
    );
  }, []);

  /** تعديل نص رسالة: يُعاد تشفيرها بالمفتاح نفسه، وتبقى بيانات الرد كما هي. */
  const handleEditMessage = useCallback(
    async (msg: Message, newText: string): Promise<string | null> => {
      const text = newText.trim();
      if (!text) return 'لا يمكن أن تكون الرسالة فارغة';
      try {
        const key = await getConversationKey(msg.conversationId);
        const payload: DecryptedMessagePayload = { ...(msg.decrypted ?? {}), text };
        const { ciphertext, iv } = await encryptMessagePayload(payload, key);
        const res = await api(`/api/messages/${encodeURIComponent(msg.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ciphertext, iv }),
        });
        if (!res.ok) return await readError(res, 'تعذر تعديل الرسالة');
        const { message } = (await res.json()) as { message: Message };
        patchMessage(msg.conversationId, msg.id, (m) => ({ ...m, ciphertext, iv, editedAt: message.editedAt, decrypted: payload }));
        return null;
      } catch (err) {
        return errorMessage(err, 'تعذر تعديل الرسالة');
      }
    },
    [api, getConversationKey, patchMessage]
  );

  /** حذف رسالة: «لي» يخفيها عندي فقط، و«للجميع» يمسح محتواها عند الجميع. يعيد نص الخطأ أو null. */
  const handleDeleteMessage = useCallback(
    async (msg: Message, scope: 'me' | 'all'): Promise<string | null> => {
      try {
        const res = await api(`/api/messages/${encodeURIComponent(msg.id)}?scope=${scope}`, { method: 'DELETE' });
        if (!res.ok) return await readError(res, 'تعذر حذف الرسالة');
        if (scope === 'me') {
          setMessagesByConv((prev) => ({ ...prev, [msg.conversationId]: (prev[msg.conversationId] || []).filter((m) => m.id !== msg.id) }));
          patchMessage(msg.conversationId, msg.id, (m) => ({ ...m, deleted: true, decrypted: { text: '' } }));
        } else {
          patchMessage(msg.conversationId, msg.id, (m) => ({ ...m, deleted: true, ciphertext: '', iv: '', decrypted: { text: '' } }));
        }
        return null;
      } catch (err) {
        return errorMessage(err, 'تعذر حذف الرسالة');
      }
    },
    [api, patchMessage]
  );

  /** إعادة إرسال رسالة فشلت: نفس المعرّف، والخادم يتجاهل التكرار فلا تصل نسختان. */
  const handleRetryMessage = useCallback(
    async (msg: Message) => {
      const convId = msg.conversationId;
      const setStatus = (status: Message['status']) =>
        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: (prev[convId] || []).map((m) => (m.id === msg.id ? { ...m, status } : m)),
        }));
      setStatus('sending');
      try {
        const res = await api(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ id: msg.id, type: msg.type, ciphertext: msg.ciphertext, iv: msg.iv }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { message } = (await res.json()) as { message: Message };
        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: (prev[convId] || []).map((m) =>
            m.id === msg.id && m.status === 'sending' ? { ...m, status: message.status, createdAt: message.createdAt } : m
          ),
        }));
      } catch {
        setStatus('failed');
      }
    },
    [api]
  );

  /** Ends local call state; the caller's device writes the call record into the chat. */
  const finishCall = useCallback(
    (notifyPeer: boolean, outcome?: 'completed' | 'missed' | 'declined') => {
      const call = activeCallRef.current;
      if (!call) return;
      if (notifyPeer) wsSend({ type: 'call:end', callId: call.callId, toUserId: call.peerId });
      const duration = call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0;
      cleanupWebRtc();
      setActiveCall(null);
      activeCallRef.current = null;
      if (call.direction === 'outgoing') {
        const result = outcome ?? (call.startedAt ? 'completed' : 'missed');
        void sendMessageTo(call.conversationId, 'call', {
          text: call.kind === 'video' ? 'مكالمة فيديو مشفرة' : 'مكالمة صوتية مشفرة',
          callKind: call.kind,
          callOutcome: result,
          durationSec: duration,
        });
      }
    },
    [cleanupWebRtc, sendMessageTo, wsSend]
  );
  const finishCallRef = useRef(finishCall);
  finishCallRef.current = finishCall;

  const loadIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    if (iceServersRef.current) return iceServersRef.current;
    try {
      const res = await api('/api/ice');
      if (res.ok) {
        const data = (await res.json()) as { iceServers: RTCIceServer[] };
        iceServersRef.current = data.iceServers;
        return data.iceServers;
      }
    } catch {
      // fall through
    }
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }, [api]);

  const createPeer = useCallback(
    async (callId: string, peerId: string, stream: MediaStream): Promise<RTCPeerConnection> => {
      const pc = new RTCPeerConnection({ iceServers: await loadIceServers() });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.ontrack = (ev) => {
        if (ev.streams[0]) setRemoteStream(ev.streams[0]);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) wsSend({ type: 'call:ice', callId, toUserId: peerId, candidate: ev.candidate });
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        if (pc.connectionState === 'connected') {
          if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
          setActiveCall((p) =>
            p && p.callId === callId && p.status !== 'connected' ? { ...p, status: 'connected', startedAt: Date.now() } : p
          );
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (activeCallRef.current?.callId === callId) {
            window.alert('انقطع الاتصال بالمكالمة');
            finishCallRef.current(true);
          }
        }
      };
      return pc;
    },
    [loadIceServers, wsSend]
  );

  const getMedia = async (kind: 'audio' | 'video'): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
    } catch {
      window.alert('تعذر الوصول إلى الميكروفون/الكاميرا. تحقق من الأذونات وحاول مجدداً.');
      return null;
    }
  };

  const handleStartCall = useCallback(
    async (kind: 'audio' | 'video') => {
      const user = currentUserRef.current;
      const conv = conversationsRef.current.find((c) => c.id === activeConvIdRef.current);
      if (!user || !conv || activeCallRef.current) return;
      if (conv.type === 'group') {
        window.alert('المكالمات متاحة في المحادثات الفردية فقط');
        return;
      }
      const peer = conv.members.find((m) => m.id !== user.id);
      if (!peer) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        window.alert('لا يوجد اتصال بالخادم حالياً');
        return;
      }
      const stream = await getMedia(kind);
      if (!stream) return;

      const callId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const call: ActiveCallState = {
        callId,
        conversationId: conv.id,
        peerId: peer.id,
        peerName: peer.displayName,
        peerAvatar: peer.avatar,
        kind,
        direction: 'outgoing',
        status: 'ringing',
        startedAt: null,
        muted: false,
        cameraOff: false,
        speakerOn: true,
        fingerprint: await computeSafetyFingerprint(conv.members.map((m) => m.publicKey)),
      };
      activeCallRef.current = call;
      setActiveCall(call);
      setLocalStream(stream);

      try {
        const pc = await createPeer(callId, peer.id, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsSend({ type: 'call:offer', callId, conversationId: conv.id, toUserId: peer.id, kind, offer });
        ringTimerRef.current = window.setTimeout(() => {
          if (activeCallRef.current?.callId === callId && activeCallRef.current.status !== 'connected') {
            finishCallRef.current(true, 'missed');
          }
        }, CALL_RING_TIMEOUT_MS);
      } catch {
        window.alert('تعذر بدء المكالمة');
        finishCallRef.current(false);
      }
    },
    [createPeer, wsSend]
  );

  const handleAcceptIncomingCall = useCallback(async () => {
    const call = activeCallRef.current;
    const offer = pendingOfferRef.current;
    if (!call || !offer) return;
    const stream = await getMedia(call.kind);
    if (!stream) {
      wsSend({ type: 'call:reject', callId: call.callId, toUserId: call.peerId });
      cleanupWebRtc();
      setActiveCall(null);
      return;
    }
    setLocalStream(stream);
    setActiveCall((p) => (p ? { ...p, status: 'connecting' } : p));
    try {
      const pc = await createPeer(call.callId, call.peerId, stream);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of pendingIceRef.current) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
      pendingIceRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend({ type: 'call:answer', callId: call.callId, toUserId: call.peerId, answer });
    } catch {
      window.alert('تعذر الرد على المكالمة');
      finishCallRef.current(true);
    }
  }, [cleanupWebRtc, createPeer, wsSend]);

  const handleRejectIncomingCall = useCallback(() => {
    const call = activeCallRef.current;
    if (call) wsSend({ type: 'call:reject', callId: call.callId, toUserId: call.peerId });
    cleanupWebRtc();
    setActiveCall(null);
  }, [cleanupWebRtc, wsSend]);

  /* ------------------------------- realtime ------------------------------- */

  useEffect(() => {
    if (!currentUser) return;
    let unmounted = false;
    let heartbeat: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        ws.send(JSON.stringify({ type: 'auth:hello', token: tokenRef.current }));
        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 25_000);
      };

      ws.onclose = () => {
        window.clearInterval(heartbeat);
        if (unmounted) return;
        setWsConnected(false);
        reconnectTimerRef.current = window.setTimeout(connect, 2500);
      };

      ws.onmessage = async (event) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return; // "pong"
        }
        const evType = String(data.type || '');
        const me = currentUserRef.current;
        if (!me) return;

        if (evType === 'auth:ok') {
          setWsConnected(true);
          // Catch up on anything missed while offline
          loadWorkspaceData();
          if (activeConvIdRef.current) loadMessagesForConversation(activeConvIdRef.current);
          return;
        }
        if (evType === 'auth:error') {
          clearSession();
          return;
        }
        if (evType === 'presence:update') {
          const onlineSet = new Set((data.onlineUserIds as string[]) || []);
          setConversations((prev) =>
            prev.map((c) => ({ ...c, members: c.members.map((m) => ({ ...m, online: onlineSet.has(m.id) })) }))
          );
          return;
        }
        if (evType === 'devices:updated') {
          setDevices((data.devices as DeviceSession[]) || []);
          return;
        }
        if (evType === 'device:revoked') {
          if (data.deviceId === deviceIdRef.current) clearSession();
          return;
        }
        if (evType === 'conversation:updated') {
          loadWorkspaceData();
          return;
        }
        if (evType === 'status:updated') {
          loadStatusesRef.current();
          return;
        }
        if (evType === 'conversation:removed') {
          const removedId = String(data.conversationId || '');
          setConversations((prev) => prev.filter((c) => c.id !== removedId));
          setMessagesByConv((prev) => {
            const { [removedId]: _gone, ...rest } = prev;
            return rest;
          });
          if (activeConvIdRef.current === removedId) {
            setActiveConversationId(null);
            setMobileView('list');
          }
          return;
        }

        if (evType === 'message:new') {
          const rawMsg = data.message as Message;
          if (!rawMsg) return;
          const known = conversationsRef.current.some((c) => c.id === rawMsg.conversationId);
          if (!known) await loadWorkspaceData();
          const msg = await decryptMessage(rawMsg);
          const isViewing = activeConvIdRef.current === msg.conversationId;
          const isMine = msg.senderId === me.id;

          setMessagesByConv((prev) => {
            const existing = prev[msg.conversationId] || [];
            if (existing.some((m) => m.id === msg.id)) {
              return {
                ...prev,
                [msg.conversationId]: existing.map((m) => (m.id === msg.id ? { ...m, status: msg.status } : m)),
              };
            }
            return { ...prev, [msg.conversationId]: [...existing, msg] };
          });
          setConversations((prev) =>
            prev
              .map((c) =>
                c.id === msg.conversationId
                  ? { ...c, updatedAt: msg.createdAt, lastMessage: msg, unreadCount: isViewing || isMine ? 0 : c.unreadCount + 1 }
                  : c
              )
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          );
          if (isViewing && !isMine) {
            api(`/api/conversations/${encodeURIComponent(msg.conversationId)}/read`, { method: 'POST', body: '{}' }).catch(
              () => undefined
            );
          }
          return;
        }

        if (evType === 'message:edited') {
          const raw = data.message as Message;
          if (!raw) return;
          const dec = await decryptMessage(raw);
          patchMessage(dec.conversationId, dec.id, (m) => ({ ...m, ciphertext: dec.ciphertext, iv: dec.iv, editedAt: dec.editedAt, decrypted: dec.decrypted }));
          return;
        }
        if (evType === 'message:deleted') {
          const convId = String(data.conversationId || '');
          const id = String(data.messageId || '');
          patchMessage(convId, id, (m) => ({ ...m, deleted: true, ciphertext: '', iv: '', decrypted: { text: '' } }));
          return;
        }
        if (evType === 'message:hidden') {
          const convId = String(data.conversationId || '');
          const id = String(data.messageId || '');
          setMessagesByConv((prev) => ({ ...prev, [convId]: (prev[convId] || []).filter((m) => m.id !== id) }));
          patchMessage(convId, id, (m) => ({ ...m, deleted: true, decrypted: { text: '' } }));
          return;
        }

        if (evType === 'message:read_receipt') {
          const convId = String(data.conversationId || '');
          if (String(data.readerId) !== me.id) {
            setMessagesByConv((prev) => ({
              ...prev,
              [convId]: (prev[convId] || []).map((m) => (m.senderId === me.id ? { ...m, status: 'read' } : m)),
            }));
          }
          return;
        }

        if (evType === 'typing:start' || evType === 'typing:stop') {
          const convId = String(data.conversationId || '');
          const uid = String(data.userId || '');
          setTypingByConv((prev) => {
            const list = prev[convId] || [];
            return {
              ...prev,
              [convId]: evType === 'typing:start' ? Array.from(new Set([...list, uid])) : list.filter((x) => x !== uid),
            };
          });
          return;
        }

        if (evType === 'notification:push') {
          const notif = data.notification as PushNotificationItem;
          if (!notif) return;
          setNotifications((prev) => [notif, ...prev]);
          const mine = devicesRef.current.find((d) => d.id === deviceIdRef.current);
          if (mine && !mine.pushEnabled) return;
          if (activeConvIdRef.current === notif.conversationId && document.visibilityState === 'visible') return;
          setToastNotification(notif);
          if (soundRef.current) playNotificationTone();
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
            try {
              new Notification(notif.title, { body: notif.body });
            } catch {
              // not supported in this WebView
            }
          }
          window.setTimeout(() => setToastNotification((cur) => (cur?.id === notif.id ? null : cur)), 5000);
          return;
        }

        /* ---- WebRTC signaling (server stamps fromUserId; we also match callId) ---- */
        if (evType === 'call:offer') {
          if (activeCallRef.current) {
            wsSend({ type: 'call:reject', callId: String(data.callId), toUserId: String(data.fromUserId) });
            return;
          }
          const conv = conversationsRef.current.find((c) => c.id === String(data.conversationId));
          const fp = conv ? await computeSafetyFingerprint(conv.members.map((m) => m.publicKey)) : '';
          pendingOfferRef.current = data.offer as RTCSessionDescriptionInit;
          pendingIceRef.current = [];
          const call: ActiveCallState = {
            callId: String(data.callId),
            conversationId: String(data.conversationId),
            peerId: String(data.fromUserId),
            peerName: String(data.fromName || 'مكالمة واردة'),
            peerAvatar: String(data.fromAvatar || ''),
            kind: data.kind === 'video' ? 'video' : 'audio',
            direction: 'incoming',
            status: 'ringing',
            startedAt: null,
            muted: false,
            cameraOff: false,
            speakerOn: true,
            fingerprint: fp,
          };
          activeCallRef.current = call;
          setActiveCall(call);
          if (soundRef.current) playNotificationTone();
          return;
        }

        const current = activeCallRef.current;
        if (evType === 'call:unavailable') {
          if (current?.callId === data.callId) {
            window.alert('المستخدم غير متصل حالياً');
            finishCallRef.current(false, 'missed');
          }
          return;
        }
        if (!current || current.callId !== data.callId) return;

        if (evType === 'call:answer' && pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer as RTCSessionDescriptionInit));
          for (const c of pendingIceRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
          pendingIceRef.current = [];
          setActiveCall((p) => (p && p.status === 'ringing' ? { ...p, status: 'connecting' } : p));
          return;
        }
        if (evType === 'call:ice' && data.candidate) {
          const pc = pcRef.current;
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit)).catch(() => undefined);
          } else {
            pendingIceRef.current.push(data.candidate as RTCIceCandidateInit);
          }
          return;
        }
        if (evType === 'call:handled') {
          // another device of ours answered / declined
          cleanupWebRtc();
          setActiveCall(null);
          return;
        }
        if (evType === 'call:reject') {
          finishCallRef.current(false, 'declined');
          return;
        }
        if (evType === 'call:end') {
          finishCallRef.current(false);
        }
      };
    };

    connect();
    return () => {
      unmounted = true;
      window.clearInterval(heartbeat);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [currentUser?.id, api, clearSession, cleanupWebRtc, decryptMessage, patchMessage, loadMessagesForConversation, loadWorkspaceData, wsSend]);

  const handleTyping = useCallback(
    (isTyping: boolean) => {
      if (!activeConvIdRef.current) return;
      wsSend({ type: isTyping ? 'typing:start' : 'typing:stop', conversationId: activeConvIdRef.current });
    },
    [wsSend]
  );

  const searchUsers = useCallback(
    async (q: string): Promise<User[]> => {
      const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const { users } = (await res.json()) as { users: User[] };
      users.forEach((u) => knownUsersRef.current.set(u.id, u));
      return users;
    },
    [api]
  );

  const createChat = useCallback(
    async (memberIds: string[], title?: string) => {
      const me = currentUserRef.current;
      const priv = privRef.current;
      if (!me || !priv) throw new Error('الجلسة غير جاهزة');
      const raw = generateConversationKeyBytes();
      const everyone: User[] = [me, ...memberIds.map((id) => knownUsersRef.current.get(id)).filter((u): u is User => !!u)];
      if (everyone.length !== memberIds.length + 1) throw new Error('تعذر العثور على مفاتيح الأعضاء، أعد البحث');
      const keys = await Promise.all(
        everyone.map(async (u) => ({ userId: u.id, ...(await wrapConversationKey(raw, priv, u.publicKey)) }))
      );
      const res = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ memberIds, title, keys }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر إنشاء المحادثة');
      await loadWorkspaceData();
      setActiveConversationId((data as { conversation: Conversation }).conversation.id);
      setMobileView('chat');
    },
    [api, loadWorkspaceData]
  );

  /* ---------------------- group & chat management ---------------------- */
  const dropConversationLocally = useCallback((convId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    setMessagesByConv((prev) => {
      const { [convId]: _gone, ...rest } = prev;
      return rest;
    });
    convKeysRef.current.delete(convId);
    if (activeConvIdRef.current === convId) {
      setActiveConversationId(null);
      setMobileView('list');
    }
  }, []);

  /** ينفّذ طلباً ويعيد نص الخطأ أو null. */
  const call = useCallback(
    async (path: string, init: RequestInit, fallback: string): Promise<string | null> => {
      try {
        const res = await api(path, init);
        if (!res.ok) return await readError(res, fallback);
        return null;
      } catch (err) {
        return errorMessage(err, fallback);
      }
    },
    [api]
  );

  const makeChatActions = useCallback(
    (conv: Conversation): ChatInfoActions => {
      const base = `/api/conversations/${encodeURIComponent(conv.id)}`;
      const refresh = async (err: string | null) => {
        if (!err) await loadWorkspaceData();
        return err;
      };
      return {
        rename: async (title) => refresh(await call(base, { method: 'PATCH', body: JSON.stringify({ title }) }, 'تعذر تغيير الاسم')),
        addMembers: async (users) => {
          try {
            const priv = privRef.current;
            const wrapper = conv.members.find((m) => m.id === conv.keyInfo.wrappedBy);
            if (!priv || !wrapper) return 'مفاتيح التشفير غير جاهزة، أعد تحميل التطبيق';
            const raw = await unwrapConversationKeyRaw(conv.keyInfo.wrappedKey, conv.keyInfo.iv, priv, wrapper.publicKey);
            const members = await Promise.all(users.map(async (u) => ({ userId: u.id, ...(await wrapConversationKey(raw, priv, u.publicKey)) })));
            return refresh(await call(`${base}/members`, { method: 'POST', body: JSON.stringify({ members }) }, 'تعذر إضافة الأعضاء'));
          } catch (err) {
            return errorMessage(err, 'تعذر إضافة الأعضاء');
          }
        },
        removeMember: async (userId) => refresh(await call(`${base}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }, 'تعذر إزالة العضو')),
        setRole: async (userId, role) =>
          refresh(await call(`${base}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }, 'تعذر تغيير الصلاحية')),
        leave: async () => {
          const err = await call(`${base}/leave`, { method: 'POST', body: '{}' }, 'تعذرت المغادرة');
          if (!err) dropConversationLocally(conv.id);
          return err;
        },
        deleteForAll: async () => {
          const err = await call(`${base}?scope=all`, { method: 'DELETE' }, 'تعذر حذف المجموعة');
          if (!err) dropConversationLocally(conv.id);
          return err;
        },
        clearForMe: async () => {
          const err = await call(`${base}?scope=me`, { method: 'DELETE' }, 'تعذر مسح المحادثة');
          if (!err) dropConversationLocally(conv.id);
          return err;
        },
        block: async (userId) => {
          const err = await call('/api/blocks', { method: 'POST', body: JSON.stringify({ userId }) }, 'تعذر الحظر');
          if (!err) void loadStatusesRef.current();
          return err;
        },
        unblock: async (userId) => {
          const err = await call(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }, 'تعذر إلغاء الحظر');
          if (!err) void loadStatusesRef.current();
          return err;
        },
      };
    },
    [call, dropConversationLocally, loadWorkspaceData]
  );

  const visibleConversations = useMemo(
    () => filterAndSortConversations(conversations, filter, searchQuery),
    [conversations, filter, searchQuery]
  );

  const totalUnread = useMemo(() => getTotalUnreadCount(conversations), [conversations]);
  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  if (booting) {
    return <div className="h-screen w-full flex items-center justify-center bg-[#F4F6F8] dark:bg-[var(--d-bg)] text-sm text-slate-500">جاري التحميل...</div>;
  }

  if (!currentUser) {
    return (
      <AuthGate
        onSubmit={handleAuth}
        loading={authLoading}
        error={authError}
        google={googleFlow}
        onGoogle={handleGoogle}
        onGoogleUnlock={handleGoogleUnlock}
        onGoogleRegister={handleGoogleRegister}
        onGoogleCancel={() => {
          setGoogleFlow(null);
          setAuthError(null);
        }}
      />
    );
  }

  return (
    <div className="app-shell w-full overflow-hidden flex bg-[#F4F6F8] dark:bg-[var(--d-bg)] text-slate-900 dark:text-slate-100">
      <StatusBanner settings={publicSettings} />
      {/* Navigation Rail (Right side in RTL) */}
      <SidebarNav
        currentUser={currentUser}
        totalUnread={totalUnread}
        statusUnseen={statusUnseen}
        unreadNotifications={unreadNotifications}
        section={section}
        onSection={(s) => {
          setSection(s);
          setMobileView('list');
        }}
        onOpenProfile={() => setActiveModal('profile')}
        mobileHidden={mobileView === 'chat'}
      />

      {/* Conversation List Panel */}
      <div
        className={`w-full md:w-[340px] lg:w-[370px] shrink-0 h-full ${
          mobileView === 'chat' ? 'hidden md:block' : 'block pb-16 md:pb-0'
        }`}
      >
        {section === 'status' ? (
          <StatusPanel
            feed={statusFeed}
            currentUser={currentUser}
            loading={statusLoading}
            onAdd={() => setStatusComposer(true)}
            onOpenMine={() => setStatusViewer({ kind: 'mine' })}
            onOpenGroup={(index) => setStatusViewer({ kind: 'group', index })}
          />
        ) : (
        <ConversationList
          statusRing={statusRing}
          conversations={visibleConversations}
          activeConversationId={activeConversationId}
          currentUserId={currentUser.id}
          filter={filter}
          searchQuery={searchQuery}
          wsConnected={wsConnected}
          typingByConversation={typingByConv}
          onSelectConversation={(id) => {
            setActiveConversationId(id);
            setMobileView('chat');
          }}
          onFilterChange={setFilter}
          onSearchChange={setSearchQuery}
          onOpenNewChat={() => setActiveModal('new_chat')}
        />
        )}
      </div>

      {/* Main Chat Workspace */}
      <div className={`flex-1 min-w-0 h-full ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
        <ChatWorkspace
          statusRing={statusRing}
          conversation={activeConversation}
          messages={activeConversationId ? messagesByConv[activeConversationId] || [] : []}
          currentUserId={currentUser.id}
          typingUsers={activeConversationId ? typingByConv[activeConversationId] || [] : []}
          onBackMobile={() => setMobileView('list')}
          onSendMessage={handleSendMessage}
          onRetryMessage={handleRetryMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onTyping={handleTyping}
          onStartCall={handleStartCall}
          onOpenChatInfo={() => setActiveModal('chat_info')}
        />
      </div>

      {/* Live Push Notification Toast */}
      {toastNotification && (
        <div
          role="status"
          className="fixed top-4 left-4 z-40 max-w-sm bg-white dark:bg-[var(--d-surface2)] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-lg p-3.5 flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
              {toastNotification.title}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
              {toastNotification.body}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToastNotification(null)}
            aria-label="إخفاء التنبيه"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Encrypted Call Overlay */}
      {activeCall && (
        <CallOverlay
          call={activeCall}
          localStream={localStream}
          remoteStream={remoteStream}
          onAcceptIncoming={handleAcceptIncomingCall}
          onRejectIncoming={handleRejectIncomingCall}
          onEndCall={() => finishCall(true)}
          onToggleMute={() => {
            localStream?.getAudioTracks().forEach((t) => {
              t.enabled = activeCall.muted;
            });
            setActiveCall((p) => (p ? { ...p, muted: !p.muted } : null));
          }}
          onToggleCamera={() => {
            localStream?.getVideoTracks().forEach((t) => {
              t.enabled = activeCall.cameraOff;
            });
            setActiveCall((p) => (p ? { ...p, cameraOff: !p.cameraOff } : null));
          }}
          onToggleSpeaker={() => setActiveCall((p) => (p ? { ...p, speakerOn: !p.speakerOn } : null))}
        />
      )}

      {/* Workspace Modals */}
      {activeModal === 'profile' && (
        <ProfileModal
          user={currentUser}
          api={api}
          onUserChange={setCurrentUser}
          onClose={() => setActiveModal(null)}
          onOpenDevices={() => setActiveModal('devices')}
          onOpenSupport={() => setActiveModal('support')}
          onOpenSettings={() => setActiveModal('settings')}
          onOpenAdmin={() => setActiveModal('admin')}
          onLogout={() => {
            setActiveModal(null);
            api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined).finally(clearSession);
          }}
        />
      )}
      {statusComposer && <StatusComposer api={api} onClose={() => setStatusComposer(false)} onPosted={() => void loadStatuses()} />}
      {statusViewer?.kind === 'mine' && statusFeed.mine.length > 0 && (
        <StatusViewer
          api={api}
          owner={currentUser}
          statuses={statusFeed.mine}
          isMine
          onClose={() => setStatusViewer(null)}
          onViewed={() => undefined}
          onDeleted={() => void loadStatuses()}
        />
      )}
      {statusViewer?.kind === 'group' && statusFeed.groups[statusViewer.index] && (
        <StatusViewer
          api={api}
          owner={statusFeed.groups[statusViewer.index].user}
          statuses={statusFeed.groups[statusViewer.index].statuses}
          isMine={false}
          onClose={() => {
            setStatusViewer(null);
            void loadStatuses();
          }}
          onNextOwner={() => {
            const nextIndex = statusViewer.index + 1;
            if (nextIndex < statusFeed.groups.length) {
              setStatusViewer({ kind: 'group', index: nextIndex });
              return true;
            }
            return false;
          }}
          onViewed={markStatusViewed}
          onDeleted={() => undefined}
        />
      )}
      {activeModal === 'settings' && (
        <SettingsModal
          user={currentUser}
          api={api}
          onUserChange={setCurrentUser}
          themeMode={themeMode}
          onThemeMode={setThemeMode}
          colorTheme={colorTheme}
          onColorTheme={pickColorTheme}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled((v) => !v)}
          browserPermission={browserPermission}
          onRequestBrowserPermission={async () => {
            if (typeof Notification !== 'undefined') setBrowserPermission(await Notification.requestPermission());
          }}
          unreadNotifications={unreadNotifications}
          onOpenNotifications={() => setActiveModal('notifications')}
          onOpenDevices={() => setActiveModal('devices')}
          onOpenSupport={() => setActiveModal('support')}
          onOpenProfile={() => setActiveModal('profile')}
          onLogout={() => {
            setActiveModal(null);
            api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined).finally(clearSession);
          }}
          onAccountDeleted={() => {
            setActiveModal(null);
            clearSession();
          }}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'support' && <SupportModal api={api} onClose={() => setActiveModal(null)} />}
      {activeModal === 'admin' && currentUser.isAdmin && <AdminModal api={api} onClose={() => setActiveModal(null)} />}

      {activeModal === 'new_chat' && (
        <NewChatModal onSearch={searchUsers} onCreate={createChat} onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'devices' && (
        <DevicesModal
          devices={devices}
          currentDeviceId={deviceIdRef.current}
          onTogglePush={async (devId, enabled) => {
            await api(`/api/devices/${encodeURIComponent(devId)}`, {
              method: 'PATCH',
              body: JSON.stringify({ pushEnabled: enabled }),
            });
            setDevices((prev) =>
              prev.map((d) => (d.id === devId ? { ...d, pushEnabled: enabled } : d))
            );
          }}
          onRevokeDevice={async (devId) => {
            await api(`/api/devices/${encodeURIComponent(devId)}`, { method: 'DELETE' });
            setDevices((prev) => prev.filter((d) => d.id !== devId));
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'notifications' && (
        <NotificationsModal
          notifications={notifications}
          browserPermission={browserPermission}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled((s) => !s)}
          onRequestBrowserPermission={async () => {
            if (typeof Notification !== 'undefined') {
              const perm = await Notification.requestPermission();
              setBrowserPermission(perm);
            }
          }}
          onTriggerTestPush={async () => {
            await api('/api/notifications/test', {
              method: 'POST',
              body: JSON.stringify({ conversationId: activeConversationId || '' }),
            });
          }}
          onMarkAllRead={async () => {
            await api('/api/notifications/read', { method: 'POST', body: '{}' });
            setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
          }}
          onSelectConversation={(convId) => {
            setActiveConversationId(convId);
            setMobileView('chat');
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'chat_info' && activeConversation && (
        <ChatInfoModal
          conversation={activeConversation}
          messages={messagesByConv[activeConversation.id] || []}
          fingerprint={chatFingerprint}
          currentUserId={currentUser.id}
          api={api}
          actions={makeChatActions(activeConversation)}
          onClose={() => setActiveModal(null)}
        />
      )}

    </div>
  );
}
