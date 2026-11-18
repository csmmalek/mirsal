import React, { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  Laptop,
  Lock,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  Conversation,
  DeviceSession,
  Message,
  PushNotificationItem,
  User,
} from '../types/chat';
import { formatArabicTime } from '../utils/messaging';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

export const ModalShell: React.FC<ModalShellProps> = ({ title, onClose, children, wide }) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={title}
    className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      className={`w-full ${
        wide ? 'max-w-3xl' : 'max-w-lg'
      } max-h-[88vh] bg-white dark:bg-[var(--d-surface)] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden`}
    >
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
          {title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  </div>
);

/* --- 1. New Chat / Group Modal --- */
export const NewChatModal: React.FC<{
  onSearch: (q: string) => Promise<User[]>;
  onCreate: (memberIds: string[], title?: string) => Promise<void>;
  onClose: () => void;
}> = ({ onSearch, onCreate, onClose }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [picked, setPicked] = useState<Record<string, User>>({});
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      onSearch(query.trim()).then((u) => !cancelled && setResults(u)).catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const available = [...Object.values(picked), ...results.filter((r) => !picked[r.id])];
  const toggle = (id: string) => {
    const user = available.find((u) => u.id === id);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPicked((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else if (user) next[id] = user;
      return next;
    });
  };

  const handleCreate = async () => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      await onCreate(selectedIds, selectedIds.length > 1 ? groupTitle.trim() || 'مجموعة جديدة' : undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إنشاء المحادثة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="بدء محادثة أو مجموعة مشفرة" onClose={onClose}>
      <div className="space-y-4">
        {selectedIds.length > 1 && (
          <div>
            <label htmlFor="group-title-input" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              اسم المجموعة
            </label>
            <input
              id="group-title-input"
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="مثال: فريق المشروع السحابي"
              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[var(--d-bg)] text-sm"
            />
          </div>
        )}

        {error && <div role="alert" className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">{error}</div>}
        <div className="space-y-2">
          <input
            type="search"
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالـ ID (5 أرقام) أو بالاسم"
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[var(--d-bg)] text-sm"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            اختر شخصاً للمراسلة المباشرة، أو أكثر لإنشاء مجموعة:
          </p>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {available.map((user) => {
              const checked = selectedIds.includes(user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggle(user.id)}
                  className={`w-full min-h-[56px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-right transition-colors ${
                    checked
                      ? 'bg-emerald-50 dark:bg-emerald-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={user.avatar}
                      alt={user.displayName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {user.displayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        #{user.uid}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                      checked
                        ? 'bg-[var(--accent)] border-[color:var(--accent)] text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          disabled={selectedIds.length === 0 || busy}
          onClick={handleCreate}
          className="w-full min-h-[44px] rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
        >
          {selectedIds.length > 1 ? 'إنشاء المجموعة المشفرة' : 'بدء المحادثة'}
        </button>
      </div>
    </ModalShell>
  );
};

/* --- 2. Linked Devices & Multi-Device Sync Modal --- */
export const DevicesModal: React.FC<{
  devices: DeviceSession[];
  currentDeviceId: string;
  onTogglePush: (deviceId: string, enabled: boolean) => Promise<void>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
  onClose: () => void;
}> = ({ devices, currentDeviceId, onTogglePush, onRevokeDevice, onClose }) => {
  return (
    <ModalShell title="الأجهزة المرتبطة والمزامنة الفورية" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          سجّل الدخول بنفس الحساب على أي جهاز آخر لتصله الرسائل والمكالمات فوراً. إنهاء جلسة هنا يُسجّل خروج ذلك الجهاز فعلياً.
        </p>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            الجلسات المتصلة بقاعدة البيانات ({devices.length})
          </h4>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
            {devices.map((d) => {
              const isCurrent = d.id === currentDeviceId;
              return (
                <div key={d.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
                      {d.deviceType === 'android' ? (
                        <Smartphone className="w-5 h-5" />
                      ) : (
                        <Laptop className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {d.deviceName} {isCurrent ? '(هذا الجهاز)' : ''}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        آخر نشاط: {formatArabicTime(d.lastActive)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onTogglePush(d.id, !d.pushEnabled)}
                      className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                        d.pushEnabled
                          ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {d.pushEnabled ? 'التنبيهات مفعلة' : 'التنبيهات متوقفة'}
                    </button>
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => onRevokeDevice(d.id)}
                        aria-label={`فصل ${d.deviceName}`}
                        className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

/* --- 3. Push Notification Center Modal --- */
export const NotificationsModal: React.FC<{
  notifications: PushNotificationItem[];
  browserPermission: NotificationPermission | 'unsupported';
  soundEnabled: boolean;
  onToggleSound: () => void;
  onRequestBrowserPermission: () => Promise<void>;
  onTriggerTestPush: () => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onSelectConversation: (convId: string) => void;
  onClose: () => void;
}> = ({
  notifications,
  browserPermission,
  soundEnabled,
  onToggleSound,
  onRequestBrowserPermission,
  onTriggerTestPush,
  onMarkAllRead,
  onSelectConversation,
  onClose,
}) => (
  <ModalShell title="مركز تنبيهات الدفع الفوري" onClose={onClose}>
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-[var(--d-surface2)] border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            تنبيهات النظام والمتصفح (Web Push)
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {browserPermission === 'granted'
              ? 'مفعّلة'
              : browserPermission === 'denied'
                ? 'محظورة من المتصفح'
                : 'بانتظار الإذن'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {browserPermission !== 'granted' && browserPermission !== 'unsupported' && (
            <button
              type="button"
              onClick={onRequestBrowserPermission}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold hover:bg-[var(--accent-hover)]"
            >
              تفعيل إشعارات المتصفح
            </button>
          )}
          <button
            type="button"
            onClick={onToggleSound}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {soundEnabled ? 'نغمة التنبيه: مفعلة' : 'نغمة التنبيه: صامتة'}
          </button>
          <button
            type="button"
            onClick={onTriggerTestPush}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>إرسال تنبيه تجريبي</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          سجل التنبيهات الواردة ({notifications.length})
        </span>
        {notifications.some((n) => !n.isRead) && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            تحديد الكل كمقروء
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          لا توجد تنبيهات دفع مسجلة حتى الآن.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                onSelectConversation(n.conversationId);
                onClose();
              }}
              className="w-full p-3.5 text-right flex items-start justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-start gap-3 min-w-0">
                <Bell className="w-4 h-4 text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {n.title}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {n.body}
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                {formatArabicTime(n.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  </ModalShell>
);

/* --- 4. Chat Info & E2EE Safety Fingerprint Modal --- */
export const ChatInfoModal: React.FC<{
  conversation: Conversation;
  messages: Message[];
  fingerprint: string;
  onClose: () => void;
}> = ({ conversation, messages, fingerprint, onClose }) => {
  const sharedImages = messages.filter((m) => m.type === 'image' && m.decrypted?.mediaUrl);

  return (
    <ModalShell title="معلومات المحادثة والتشفير الطرفي" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-3.5">
          {conversation.type === 'group' && !conversation.avatar ? (
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
          ) : (
            <img
              src={conversation.avatar}
              alt={conversation.title}
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-full object-cover shrink-0"
            />
          )}
          <div>
            <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {conversation.title}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {conversation.type === 'group'
                ? `مجموعة مشفرة · ${conversation.members.length} أعضاء`
                : 'محادثة ثنائية مشفرة طرف إلى طرف'}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-[var(--d-surface2)] border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>رقم الأمان وبصمة التحقق (SHA-256)</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            طابق هذه الأرقام مع الطرف الآخر للتأكد من سلامة التشفير الطرفي (AES-256-GCM):
          </p>
          <div
            dir="ltr"
            className="p-3 rounded-lg bg-white dark:bg-[var(--d-bg)] border border-slate-200 dark:border-slate-800 font-mono text-xs text-center tracking-wider leading-relaxed tabular-nums text-slate-800 dark:text-slate-200"
          >
            {fingerprint}
          </div>
        </div>

        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            الأعضاء المشاركون ({conversation.members.length})
          </h5>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
            {conversation.members.map((m) => (
              <div key={m.id} className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={m.avatar}
                    alt={m.displayName}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {m.displayName}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      #{m.uid}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {m.online ? 'متصل' : 'غير متصل'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {sharedImages.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              الوسائط المشفرة المتبادلة ({sharedImages.length})
            </h5>
            <div className="grid grid-cols-3 gap-2">
              {sharedImages.map((img) => (
                <img
                  key={img.id}
                  src={img.decrypted?.mediaUrl}
                  alt={img.decrypted?.mediaName || 'وسائط'}
                  referrerPolicy="no-referrer"
                  className="aspect-square w-full object-cover rounded-xl bg-slate-200 dark:bg-slate-800"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
