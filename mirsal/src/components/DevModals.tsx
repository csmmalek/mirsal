import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban,
  Camera,
  Check,
  Copy,
  LifeBuoy,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Palette,
  Pencil,
  Send,
  Settings,
  Shield,
  Smartphone,
  Trash2,
  UserX,
  Users,
  Wifi,
} from 'lucide-react';
import type { User } from '../types/chat';
import { THEMES } from '../themes';
import { FALLBACK_WALLPAPERS, applyWallpaper, currentWallpaper, getWallpapers } from '../appearance';
import { ModalShell } from './SideModals';
import { errorMessage, readError } from '../api/client';

type Api = (path: string, init?: RequestInit) => Promise<Response>;

const btn = 'min-h-[44px] px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2';
const primaryBtn = `btn-glass ${btn}`;
const ghostBtn = `btn-glass btn-ghost ${btn}`;
const dangerBtn = `btn-glass btn-danger ${btn}`;
const fieldCls =
  'field-glass w-full min-h-[44px] px-3 py-2 rounded-xl text-sm text-slate-900 dark:text-slate-100';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' });
};

/* ------------------------------- Profile ------------------------------- */

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_AVATAR_SOURCE_BYTES = 12 * 1024 * 1024;

/** يقصّ الصورة مربعة ويصغّرها إلى 256px بصيغة JPEG (حجمها نحو 15-30 كيلوبايت). */
function prepareAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) return reject(new Error('bad'));
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('bad'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= 80_000) return resolve(out);
      }
      reject(new Error('too large'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad'));
    };
    img.src = url;
  });
}


/** يعرف إن كان التطبيق يعمل داخل غلاف أندرويد (جسر MirsalAndroid) أو متصفح أندرويد. */
const isAndroidDevice = (): boolean =>
  Boolean((window as unknown as { MirsalAndroid?: unknown }).MirsalAndroid) ||
  /Android/i.test(navigator.userAgent);

/** إرشاد لإعدادات الهاتف كي لا يوقف النظام تطبيق الإشعارات. يظهر على أندرويد فقط. */
const PhoneSetupHelp: React.FC = () => {
  const [open, setOpen] = useState(true);
  if (!isAndroidDevice()) return null;
  return (
    <section aria-labelledby="phone-setup-title" className="w-full max-w-xs mt-2 space-y-2 text-right glass-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="phone-setup-title" className="text-xs font-semibold text-slate-800 dark:text-slate-100">
          لتصل الإشعارات بسرعة
        </h3>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${ghostBtn} !min-h-[34px] !px-2.5 !text-[11px]`}>
          {open ? 'إخفاء' : 'عرض الخطوات'}
        </button>
      </div>
      {open && (
        <ol className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 space-y-1.5 list-decimal pr-4">
          <li>اسمح للتطبيق بالعمل في الخلفية: البطارية ← «بدون قيود» (Unrestricted).</li>
          <li>فعّل التشغيل التلقائي: الإعدادات ← التطبيقات ← مِرسال ← التشغيل التلقائي.</li>
          <li>ثبّت التطبيق في الذاكرة: افتح التطبيقات الأخيرة، ثم اضغط على القفل في بطاقة مِرسال إن ظهر على جهازك.</li>
        </ol>
      )}
    </section>
  );
};

export const ProfileModal: React.FC<{
  user: User;
  api: Api;
  onUserChange: (user: User) => void;
  onClose: () => void;
  onOpenDevices: () => void;
  onOpenSupport: () => void;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}> = ({ user, api, onUserChange, onClose, onOpenDevices, onOpenSupport, onOpenSettings, onOpenAdmin, onLogout }) => {
  const [copied, setCopied] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [handleState, setHandleState] = useState<{ ok: boolean; msg: string } | null>(null);
  const [handleBusy, setHandleBusy] = useState(false);

  // Live availability check while choosing a username (debounced).
  useEffect(() => {
    if (user.handle) return;
    const h = handleInput.trim().toLowerCase().replace(/^@/, '');
    if (!h) {
      setHandleState(null);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await api(`/api/handle/check?h=${encodeURIComponent(h)}`);
        const d = (await res.json()) as { available: boolean; reason?: string };
        setHandleState(d.available ? { ok: true, msg: 'اسم المستخدم متاح' } : { ok: false, msg: d.reason || 'غير متاح' });
      } catch {
        setHandleState({ ok: false, msg: 'تعذر التحقق، تحقق من الاتصال' });
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [handleInput, user.handle, api]);

  const saveHandle = async () => {
    setHandleBusy(true);
    try {
      const res = await api('/api/me/handle', { method: 'PUT', body: JSON.stringify({ handle: handleInput }) });
      if (!res.ok) {
        setHandleState({ ok: false, msg: await readError(res, 'تعذر حفظ اسم المستخدم') });
        return;
      }
      onUserChange(((await res.json()) as { user: User }).user);
    } catch (err) {
      setHandleState({ ok: false, msg: errorMessage(err, 'تعذر حفظ اسم المستخدم') });
    } finally {
      setHandleBusy(false);
    }
  };
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const hasCustomAvatar = !user.avatar.startsWith('data:image/svg+xml');

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarError(null);
    if (!AVATAR_TYPES.includes(file.type)) {
      setAvatarError('نوع الصورة غير مدعوم، اختر صورة بصيغة JPG أو PNG أو WebP');
      return;
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      setAvatarError('حجم الصورة كبير جداً، اختر صورة أقل من 12 ميغابايت');
      return;
    }
    setAvatarBusy(true);
    try {
      let avatar: string;
      try {
        avatar = await prepareAvatar(file);
      } catch {
        setAvatarError('تعذر قراءة الصورة، جرّب صورة أخرى');
        return;
      }
      const res = await api('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar }) });
      if (!res.ok) {
        setAvatarError(await readError(res, 'تعذر حفظ الصورة'));
        return;
      }
      onUserChange(((await res.json()) as { user: User }).user);
    } catch (err) {
      setAvatarError(errorMessage(err, 'تعذر رفع الصورة'));
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const res = await api('/api/me/avatar', { method: 'DELETE' });
      if (!res.ok) {
        setAvatarError(await readError(res, 'تعذر حذف الصورة'));
        return;
      }
      onUserChange(((await res.json()) as { user: User }).user);
    } catch (err) {
      setAvatarError(errorMessage(err, 'تعذر حذف الصورة'));
    } finally {
      setAvatarBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(user.uid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <ModalShell title="الملف الشخصي" onClose={onClose}>
      <div className="flex flex-col items-center text-center gap-2 mb-5">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickAvatar} />
        <div className="relative">
          <img src={user.avatar} alt="" className="w-24 h-24 rounded-full object-cover" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            aria-label="تغيير الصورة الشخصية"
            className="btn-glass absolute -bottom-1 -left-1 w-9 h-9 rounded-full flex items-center justify-center"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>
        {avatarBusy && <p className="text-[11px] text-slate-500 dark:text-slate-400">جارٍ حفظ الصورة...</p>}
        {avatarError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400 max-w-[260px]">
            {avatarError}
          </p>
        )}
        {hasCustomAvatar && !avatarBusy && (
          <button type="button" onClick={removeAvatar} className="text-[11px] text-slate-500 dark:text-slate-400 hover:underline">
            إزالة الصورة
          </button>
        )}
        <div className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-1.5">
          {user.displayName}
          {user.isAdmin && <Shield className="w-4 h-4 text-amber-500" aria-label="المطور" />}
        </div>
        {user.handle && (
          <div dir="ltr" className="text-sm font-semibold text-[color:var(--accent)]">
            @{user.handle}
          </div>
        )}
        {user.email && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400" title="بريدك لا يراه أي شخص آخر">
            <span dir="ltr">{user.email}</span> · <span>لا يظهر لغيرك</span>
          </div>
        )}
        {!user.handle && (
          <div className="w-full max-w-xs mt-2 space-y-2 text-right glass-panel p-3">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">اختر اسم مستخدم فريداً</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">يبحث به الآخرون عنك. لا يمكن تغييره بعد حفظه.</p>
            <input
              dir="ltr"
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              placeholder="مثال: ahmed_99"
              aria-label="اسم المستخدم"
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              className={`${fieldCls} text-left`}
            />
            {handleState && (
              <p role="status" className={`text-[11px] ${handleState.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {handleState.msg}
              </p>
            )}
            <button type="button" disabled={!handleState?.ok || handleBusy} onClick={saveHandle} className={`${primaryBtn} w-full`}>
              {handleBusy ? 'جارٍ الحفظ...' : 'حفظ اسم المستخدم'}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={copy}
          className="mt-1 px-4 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-[color:var(--accent)] text-sm font-bold flex items-center gap-2"
          title="انسخ الـ ID وشاركه ليضيفك الآخرون"
        >
          <span className="text-xs font-medium opacity-80">ID</span>
          <span className="tabular-nums tracking-widest text-base">{user.uid}</span>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">شارك الـ ID مع أصدقائك ليبحثوا عنك به.</p>
      </div>
      <PhoneSetupHelp />
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onOpenSettings} className={primaryBtn}>
          <Settings className="w-4 h-4" /> الإعدادات
        </button>
        <button type="button" onClick={onOpenDevices} className={ghostBtn}>
          <Smartphone className="w-4 h-4" /> الأجهزة
        </button>
        <button type="button" onClick={onOpenSupport} className={ghostBtn}>
          <LifeBuoy className="w-4 h-4" /> الدعم
        </button>
        {user.isAdmin ? (
          <button type="button" onClick={onOpenAdmin} className={ghostBtn}>
            <Shield className="w-4 h-4" /> لوحة المطور
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            className={`${dangerBtn}`}
          >
            <LogOut className="w-4 h-4" /> تسجيل الخروج
          </button>
        )}
      </div>
      {user.isAdmin && (
        <button
          type="button"
          onClick={onLogout}
          className={`${dangerBtn} w-full mt-2.5`}
        >
          <LogOut className="w-4 h-4" /> تسجيل الخروج
        </button>
      )}
    </ModalShell>
  );
};

/* -------------------------------- Support -------------------------------- */

interface MyTicket {
  id: string;
  message: string;
  reply: string | null;
  status: string;
  createdAt: string;
}

export const SupportModal: React.FC<{ api: Api; onClose: () => void }> = ({ api, onClose }) => {
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api('/api/support');
      if (res.ok) setTickets(((await res.json()) as { tickets: MyTicket[] }).tickets);
    } catch {
      /* offline */
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api('/api/support', { method: 'POST', body: JSON.stringify({ message: text.trim() }) });
      if (!res.ok) throw new Error(await readError(res, 'تعذر إرسال الرسالة'));
      setText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال الرسالة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="الدعم الفني" onClose={onClose}>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
        اكتب مشكلتك أو اقتراحك وسيصل مباشرة إلى المطور. يظهر الرد هنا.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="اكتب رسالتك للدعم..."
        className={`${fieldCls} resize-none`}
      />
      {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
      <button type="button" onClick={send} disabled={busy || text.trim().length < 3} className={`${primaryBtn} w-full mt-2.5`}>
        <Send className="w-4 h-4" /> إرسال للمطور
      </button>
      <div className="mt-5 space-y-3">
        {tickets.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 dark:border-white/10 p-3 text-sm">
            <div className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">{t.message}</div>
            <div className="text-[11px] text-slate-400 mt-1">{fmtDate(t.createdAt)}</div>
            {t.reply ? (
              <div className="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap break-words">
                <div className="text-[11px] font-bold mb-0.5">رد المطور</div>
                {t.reply}
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">بانتظار رد المطور</div>
            )}
          </div>
        ))}
      </div>
    </ModalShell>
  );
};

/* ------------------------------ Developer panel ------------------------------ */

interface Stats {
  users: number;
  banned: number;
  conversations: number;
  messages: number;
  openTickets: number;
  online: number;
}
interface AdminUser {
  id: string;
  uid: string;
  handle: string;
  displayName: string;
  bio: string;
  banned: boolean;
  isAdmin: boolean;
  online: boolean;
  devices: number;
  createdAt: string;
  lastSeen: string;
}
interface AdminTicket {
  id: string;
  displayName: string;
  uid: string;
  message: string;
  reply: string | null;
  status: string;
  createdAt: string;
}

const UserRow: React.FC<{ u: AdminUser; api: Api; onChanged: () => void }> = ({ u, api, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(u.displayName);
  const [bio, setBio] = useState(u.bio);
  const [uid, setUid] = useState(u.uid);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const call = async (path: string, init: RequestInit, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api(path, init);
      if (!res.ok) throw new Error(await readError(res, 'فشلت العملية'));
      setMsg(okText);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'فشلت العملية');
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Record<string, unknown>, okText: string) =>
    call(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', body: JSON.stringify(body) }, okText);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full p-3 flex items-center gap-3 text-right">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${u.online ? 'bg-green-500' : 'bg-slate-400/60'}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {u.displayName} {u.isAdmin && '👑'}
          </span>
          <span dir="ltr" className="block text-[11px] text-slate-500 dark:text-slate-400 truncate text-right">
            {u.handle ? `@${u.handle}` : 'بلا اسم مستخدم'}
          </span>
        </span>
        {u.banned && <span className="text-[10px] px-2 py-0.5 rounded-md bg-red-100 text-red-700">موقوف</span>}
        <span className="text-xs font-bold tabular-nums text-[color:var(--accent)]">#{u.uid}</span>
      </button>
      {open && (
        <div className="p-3 border-t border-slate-200 dark:border-white/10 space-y-2.5 bg-slate-50/60 dark:bg-white/[0.02]">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            سُجّل {fmtDate(u.createdAt)} · آخر ظهور {fmtDate(u.lastSeen)} · الأجهزة {u.devices}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={fieldCls} aria-label="الاسم" />
            <button type="button" disabled={busy || !name.trim()} onClick={() => patch({ displayName: name }, 'تم حفظ الاسم')} className={ghostBtn}>
              <Pencil className="w-3.5 h-3.5" /> حفظ
            </button>
            <input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} placeholder="النبذة" className={fieldCls} aria-label="النبذة" />
            <button type="button" disabled={busy} onClick={() => patch({ bio }, 'تم حفظ النبذة')} className={ghostBtn}>
              <Pencil className="w-3.5 h-3.5" /> حفظ
            </button>
            <input
              value={uid}
              onChange={(e) => setUid(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              dir="ltr"
              className={`${fieldCls} text-left tabular-nums`}
              aria-label="ID"
            />
            <button type="button" disabled={busy || uid.length !== 5} onClick={() => patch({ uid }, 'تم تغيير الـ ID')} className={ghostBtn}>
              <Pencil className="w-3.5 h-3.5" /> تغيير ID
            </button>
          </div>
          {!u.isAdmin && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ banned: !u.banned }, u.banned ? 'تم رفع الإيقاف' : 'تم إيقاف الحساب')}
                className={ghostBtn}
              >
                <Ban className="w-3.5 h-3.5" /> {u.banned ? 'رفع الإيقاف' : 'إيقاف الحساب'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => call(`/api/admin/users/${encodeURIComponent(u.id)}/logout`, { method: 'POST', body: '{}' }, 'تم إنهاء كل جلساته')}
                className={ghostBtn}
              >
                <LogOut className="w-3.5 h-3.5" /> إنهاء الجلسات
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`حذف حساب ${u.displayName} نهائياً مع كل رسائله؟ لا يمكن التراجع.`)) {
                    call(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' }, 'تم حذف الحساب');
                  }
                }}
                className={dangerBtn}
              >
                <Trash2 className="w-3.5 h-3.5" /> حذف
              </button>
            </div>
          )}
          {msg && <div className="text-xs text-slate-600 dark:text-slate-300">{msg}</div>}
        </div>
      )}
    </div>
  );
};

const TicketRow: React.FC<{ t: AdminTicket; api: Api; onChanged: () => void }> = ({ t, api, onChanged }) => {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await api(`/api/admin/tickets/${encodeURIComponent(t.id)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply }),
      });
      if (res.ok) {
        setReply('');
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 text-sm">
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
        {t.displayName} · #{t.uid} · {fmtDate(t.createdAt)}
      </div>
      <div className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">{t.message}</div>
      {t.reply && (
        <div className="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap break-words">
          {t.reply}
        </div>
      )}
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={1000}
          placeholder={t.reply ? 'عدّل الرد...' : 'اكتب الرد...'}
          className={fieldCls}
        />
        <button type="button" disabled={busy || !reply.trim()} onClick={send} className={primaryBtn}>
          <Send className="w-3.5 h-3.5" /> رد
        </button>
      </div>
    </div>
  );
};

interface AppSettingsState {
  registrationOpen: boolean;
  announcement: string;
  maintenance: boolean;
}

interface AuditRow {
  id: string;
  action: string;
  target: string | null;
  detail: string;
  created_at: string;
  actor_name: string | null;
}

export const AdminModal: React.FC<{ api: Api; onClose: () => void }> = ({ api, onClose }) => {
  const [tab, setTab] = useState<'users' | 'tickets' | 'stats' | 'look' | 'settings' | 'audit' | 'health' | 'errors'>('stats');
  const [appSettings, setAppSettings] = useState<AppSettingsState | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wpText, setWpText] = useState('');
  const [wpMsg, setWpMsg] = useState<string | null>(null);

  const loadLook = useCallback(async () => {
    const res = await api('/api/appearance');
    if (!res.ok) return;
    const data = (await res.json()) as { wallpapers: unknown[] };
    setWpText(JSON.stringify(data.wallpapers.length ? data.wallpapers : FALLBACK_WALLPAPERS, null, 2));
  }, [api]);
  useEffect(() => {
    if (tab === 'look') loadLook();
  }, [tab, loadLook]);

  const loadSettings = useCallback(async () => {
    const res = await api('/api/admin/settings');
    if (res.ok) setAppSettings(((await res.json()) as { settings: AppSettingsState }).settings);
  }, [api]);
  const loadAudit = useCallback(async () => {
    const res = await api('/api/admin/audit?limit=100');
    if (res.ok) setAudit(((await res.json()) as { entries: AuditRow[] }).entries);
  }, [api]);
  useEffect(() => {
    if (tab === 'settings') loadSettings();
    if (tab === 'audit') loadAudit();
  }, [tab, loadSettings, loadAudit]);

  const saveSettings = async (patch: Partial<AppSettingsState>) => {
    setSettingsMsg(null);
    const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
    if (!res.ok) {
      setSettingsMsg(await readError(res, 'تعذر حفظ الإعدادات'));
      return;
    }
    setAppSettings(((await res.json()) as { settings: AppSettingsState }).settings);
    setSettingsMsg('تم الحفظ');
  };

  const saveLook = async () => {
    setWpMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(wpText);
    } catch {
      setWpMsg('صيغة JSON غير صحيحة، تحقق من الأقواس والفواصل');
      return;
    }
    const res = await api('/api/admin/appearance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallpapers: parsed }),
    });
    if (!res.ok) {
      setWpMsg(await readError(res, 'تعذر حفظ الخلفيات'));
      return;
    }
    setWpMsg('تم الحفظ. ستظهر التغييرات عند فتح التطبيق.');
  };

  const loadUsers = useCallback(
    async (query: string) => {
      try {
        const res = await api(`/api/admin/users?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error(await readError(res, 'تعذر تحميل الحسابات'));
        setUsers(((await res.json()) as { users: AdminUser[] }).users);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر تحميل الحسابات');
      }
    },
    [api]
  );
  const loadTickets = useCallback(async () => {
    const res = await api('/api/admin/tickets');
    if (res.ok) setTickets(((await res.json()) as { tickets: AdminTicket[] }).tickets);
  }, [api]);
  const [health, setHealth] = useState<{ name: string; ok: boolean; note: string }[]>([]);
  const [serverErrors, setServerErrors] = useState<{ id: string; created_at: string; path: string; status: number; message: string }[]>([]);
  const loadHealth = useCallback(async () => {
    const res = await api('/api/admin/health');
    if (res.ok) setHealth(((await res.json()) as { checks: typeof health }).checks);
  }, [api]);
  const loadErrors = useCallback(async () => {
    const res = await api('/api/admin/errors');
    if (res.ok) setServerErrors(((await res.json()) as { errors: typeof serverErrors }).errors);
  }, [api]);
  const loadStats = useCallback(async () => {
    const res = await api('/api/admin/stats');
    if (res.ok) setStats((await res.json()) as Stats);
  }, [api]);

  useEffect(() => {
    loadStats();
    loadTickets();
  }, [loadStats, loadTickets]);
  useEffect(() => {
    if (tab === 'health') loadHealth();
    if (tab === 'errors') loadErrors();
  }, [tab, loadHealth, loadErrors]);
  useEffect(() => {
    const t = window.setTimeout(() => loadUsers(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q, loadUsers]);

  const statCards: [string, number | undefined, React.ReactNode][] = [
    ['الحسابات', stats?.users, <Users key="u" className="w-5 h-5" />],
    ['متصل الآن', stats?.online, <Wifi key="o" className="w-5 h-5" />],
    ['المحادثات', stats?.conversations, <MessagesSquare key="c" className="w-5 h-5" />],
    ['الرسائل', stats?.messages, <MessageSquare key="m" className="w-5 h-5" />],
    ['موقوفة', stats?.banned, <UserX key="b" className="w-5 h-5" />],
    ['دعم مفتوح', stats?.openTickets, <LifeBuoy key="t" className="w-5 h-5" />],
  ];

  return (
    <ModalShell title="لوحة المطور" onClose={onClose} wide>
      <div role="tablist" aria-label="أقسام لوحة المطور" className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {(
          [
            ['stats', 'الإحصائيات'],
            ['users', 'الحسابات'],
            ['tickets', `الدعم${stats?.openTickets ? ` (${stats.openTickets})` : ''}`],
            ['settings', 'الإعدادات'],
            ['look', 'المظهر'],
            ['audit', 'السجل'],
            ['health', 'الفحص'],
            ['errors', 'الأخطاء'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`btn-glass ${tab === id ? '' : 'btn-ghost'} shrink-0 min-h-[44px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="space-y-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالـ ID أو البريد أو الاسم"
            className={fieldCls}
          />
          {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
          {users.map((u) => (
            <UserRow
              key={u.id + u.uid + String(u.banned) + u.displayName}
              u={u}
              api={api}
              onChanged={() => {
                loadUsers(q.trim());
                loadStats();
              }}
            />
          ))}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-2">
            لا يمكنك قراءة رسائل أي مستخدم (التشفير طرف لطرف) ولا إعادة تعيين كلمة مروره؛ لو نسيها، احذف الحساب ليسجّل من جديد.
          </p>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="space-y-2.5">
          {tickets.length === 0 && <div className="text-sm text-slate-500 text-center py-6">لا توجد رسائل دعم</div>}
          {tickets.map((t) => (
            <TicketRow
              key={t.id + (t.reply ?? '')}
              t={t}
              api={api}
              onChanged={() => {
                loadTickets();
                loadStats();
              }}
            />
          ))}
        </div>
      )}

      {tab === 'stats' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {statCards.map(([label, value, icon]) => (
            <div key={label} className="glass-panel p-4 text-center">
              <div className="mx-auto mb-2 w-10 h-10 rounded-full flex items-center justify-center bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[color:var(--accent)]">{icon}</div>
              <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value ?? '—'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      )}


      {tab === 'settings' && appSettings && (
        <div className="space-y-3">
          <label className="glass-panel flex items-center justify-between gap-3 p-3.5 min-h-[56px]">
            <span className="text-sm text-slate-800 dark:text-slate-100">السماح بالتسجيل الجديد</span>
            <input
              type="checkbox"
              checked={appSettings.registrationOpen}
              onChange={(e) => saveSettings({ registrationOpen: e.target.checked })}
              className="w-5 h-5 accent-[var(--accent)]"
            />
          </label>
          <label className="glass-panel flex items-center justify-between gap-3 p-3.5 min-h-[56px]">
            <span className="text-sm text-slate-800 dark:text-slate-100">وضع الصيانة (يمنع إرسال الرسائل)</span>
            <input
              type="checkbox"
              checked={appSettings.maintenance}
              onChange={(e) => saveSettings({ maintenance: e.target.checked })}
              className="w-5 h-5 accent-[var(--accent)]"
            />
          </label>
          <div className="glass-panel p-3.5 space-y-2">
            <span className="text-sm text-slate-800 dark:text-slate-100">إعلان يظهر للجميع (فارغ = مخفي)</span>
            <textarea
              defaultValue={appSettings.announcement}
              maxLength={300}
              rows={2}
              id="announcement-input"
              className="field-glass w-full rounded-lg p-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('announcement-input') as HTMLTextAreaElement | null;
                saveSettings({ announcement: el?.value ?? '' });
              }}
              className="btn-glass min-h-[40px] px-4 rounded-lg text-xs font-semibold"
            >
              حفظ الإعلان
            </button>
          </div>
          {settingsMsg && (
            <p role="status" className="text-xs text-slate-600 dark:text-slate-300">
              {settingsMsg}
            </p>
          )}
        </div>
      )}

      {tab === 'health' && (
        <div className="space-y-2">
          {health.map((c) => (
            <div key={c.name} className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/10 p-2.5 text-xs">
              <span className={`font-bold ${c.ok ? 'text-emerald-600' : 'text-red-600'}`}>{c.ok ? '✓' : '✗'}</span>
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                <div className="text-slate-600 dark:text-slate-300">{c.note}</div>
              </div>
            </div>
          ))}
          <button type="button" onClick={loadHealth} className="btn-glass w-full min-h-[44px] rounded-xl text-xs font-semibold">تحديث الفحص</button>
        </div>
      )}

      {tab === 'errors' && (
        <div className="space-y-2">
          {serverErrors.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">لا توجد أخطاء مسجّلة</p>}
          {serverErrors.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-200 dark:border-white/10 p-2.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-red-600" dir="ltr">{row.status} · {row.path}</span>
                <span className="text-slate-500 dark:text-slate-400 tabular-nums">{new Date(row.created_at).toLocaleString('ar')}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300 mt-0.5">{row.message}</div>
            </div>
          ))}
          <button type="button" onClick={loadErrors} className="btn-glass w-full min-h-[44px] rounded-xl text-xs font-semibold">تحديث</button>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          {audit.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">لا توجد إجراءات مسجّلة بعد</p>}
          {audit.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-200 dark:border-white/10 p-2.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-slate-900 dark:text-white">{row.action}</span>
                <span className="text-slate-500 dark:text-slate-400 tabular-nums">{new Date(row.created_at).toLocaleString('ar')}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                بواسطة: {row.actor_name ?? 'غير معروف'}
                {row.target ? ` · الهدف: ${row.target}` : ''}
                {row.detail ? ` · ${row.detail}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'look' && (
        <div className="space-y-2.5">
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            عدّل خلفيات المحادثة هنا. لكل خلفية: معرّف بالإنجليزية (مثل aurora)، واسم، وقيمة CSS من التدرجات فقط.
            لا تستخدم روابط صور. تظهر التغييرات عند فتح التطبيق.
          </p>
          <textarea
            value={wpText}
            onChange={(e) => setWpText(e.target.value)}
            spellCheck={false}
            dir="ltr"
            rows={14}
            className={`${fieldCls} font-mono text-xs leading-relaxed`}
          />
          {wpMsg && <div className="text-xs text-slate-700 dark:text-slate-300">{wpMsg}</div>}
          <button type="button" onClick={saveLook} className="btn-glass w-full min-h-[44px] rounded-xl text-sm font-semibold">
            حفظ الخلفيات
          </button>
        </div>
      )}
    </ModalShell>
  );
};
