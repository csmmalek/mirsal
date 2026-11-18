import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  LifeBuoy,
  LogOut,
  Palette,
  Pencil,
  Send,
  Shield,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import type { User } from '../types/chat';
import { THEMES } from '../themes';
import { FALLBACK_WALLPAPERS, applyWallpaper, currentWallpaper, getWallpapers } from '../appearance';
import { ModalShell } from './SideModals';

type Api = (path: string, init?: RequestInit) => Promise<Response>;

const btn =
  'min-h-[42px] px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50';
const primaryBtn = `${btn} bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white`;
const ghostBtn = `${btn} bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-white/10`;
const fieldCls =
  'w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[var(--d-bg)] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const d = (await res.json()) as { error?: string };
    return d.error || fallback;
  } catch {
    return fallback;
  }
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' });
};

/* ------------------------------- Profile ------------------------------- */

export const ProfileModal: React.FC<{
  user: User;
  onClose: () => void;
  onOpenDevices: () => void;
  onOpenSupport: () => void;
  onOpenThemes: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}> = ({ user, onClose, onOpenDevices, onOpenSupport, onOpenThemes, onOpenAdmin, onLogout }) => {
  const [copied, setCopied] = useState(false);
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
        <img src={user.avatar} alt="" className="w-20 h-20 rounded-full object-cover" />
        <div className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-1.5">
          {user.displayName}
          {user.isAdmin && <Shield className="w-4 h-4 text-amber-500" aria-label="المطور" />}
        </div>
        {user.email && (
          <div dir="ltr" className="text-xs text-slate-500 dark:text-slate-400">
            {user.email}
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
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onOpenThemes} className={ghostBtn}>
          <Palette className="w-4 h-4" /> الثيمات
        </button>
        <button type="button" onClick={onOpenDevices} className={ghostBtn}>
          <Smartphone className="w-4 h-4" /> الأجهزة
        </button>
        <button type="button" onClick={onOpenSupport} className={ghostBtn}>
          <LifeBuoy className="w-4 h-4" /> الدعم
        </button>
        {user.isAdmin ? (
          <button type="button" onClick={onOpenAdmin} className={primaryBtn}>
            <Shield className="w-4 h-4" /> لوحة المطور
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            className={`${btn} bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100`}
          >
            <LogOut className="w-4 h-4" /> تسجيل الخروج
          </button>
        )}
      </div>
      {user.isAdmin && (
        <button
          type="button"
          onClick={onLogout}
          className={`${btn} w-full mt-2.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100`}
        >
          <LogOut className="w-4 h-4" /> تسجيل الخروج
        </button>
      )}
    </ModalShell>
  );
};

/* -------------------------------- Themes -------------------------------- */

export const ThemeModal: React.FC<{
  current: string;
  onApply: (id: string) => void;
  onClose: () => void;
}> = ({ current, onApply, onClose }) => {
  const [picked, setPicked] = useState(current);
  const [activeWp, setActiveWp] = useState(currentWallpaper());
  return (
    <ModalShell title="اختر الثيم" onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setPicked(t.id);
              onApply(t.id); // live preview
            }}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={`relative block w-full aspect-[4/3] rounded-xl overflow-hidden border-2 ${
                picked === t.id ? 'border-[color:var(--accent)]' : 'border-transparent'
              }`}
              style={{ background: t.preview }}
            >
              {picked === t.id && (
                <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </span>
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200">{t.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        خلفيات المحادثة تظهر في الوضع الداكن. غيّر الوضع الفاتح/الداكن من زر القمر.
      </p>
      <div className="mt-5">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">خلفية المحادثة</div>
        <div className="grid grid-cols-3 gap-2">
          {[{ id: '', name: 'الافتراضية', css: '' }, ...getWallpapers()].map((w) => (
            <button
              key={w.id || 'default'}
              type="button"
              onClick={() => {
                applyWallpaper(w.id);
                setActiveWp(w.id);
              }}
              className={`h-16 rounded-xl text-[11px] font-semibold text-white flex items-end justify-center pb-1.5 border-2 ${
                activeWp === w.id ? 'border-[color:var(--accent)]' : 'border-white/10'
              }`}
              style={{ backgroundImage: w.css || 'linear-gradient(180deg,#1e293b,#0f172a)' }}
            >
              {w.name}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onClose} className="btn-glass w-full min-h-[44px] rounded-xl text-sm font-semibold mt-4">
        تطبيق الثيم
      </button>
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
  email: string;
  legacyUsername: string;
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
  email: string;
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
            {u.email || `(${u.legacyUsername})`}
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
                className={`${btn} bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400`}
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

export const AdminModal: React.FC<{ api: Api; onClose: () => void }> = ({ api, onClose }) => {
  const [tab, setTab] = useState<'users' | 'tickets' | 'stats' | 'look'>('users');
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
  const loadStats = useCallback(async () => {
    const res = await api('/api/admin/stats');
    if (res.ok) setStats((await res.json()) as Stats);
  }, [api]);

  useEffect(() => {
    loadStats();
    loadTickets();
  }, [loadStats, loadTickets]);
  useEffect(() => {
    const t = window.setTimeout(() => loadUsers(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q, loadUsers]);

  const statCards: [string, number | undefined][] = [
    ['الحسابات', stats?.users],
    ['متصل الآن', stats?.online],
    ['المحادثات', stats?.conversations],
    ['الرسائل', stats?.messages],
    ['موقوفة', stats?.banned],
    ['دعم مفتوح', stats?.openTickets],
  ];

  return (
    <ModalShell title="لوحة المطور" onClose={onClose} wide>
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl mb-4">
        {(
          [
            ['users', 'الحسابات'],
            ['tickets', `الدعم${stats?.openTickets ? ` (${stats.openTickets})` : ''}`],
            ['stats', 'الإحصائيات'],
            ['look', 'المظهر'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 min-h-[38px] text-xs font-semibold rounded-lg ${
              tab === id ? 'bg-white dark:bg-[var(--d-surface2)] text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'
            }`}
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
          {statCards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 dark:border-white/10 p-4 text-center">
              <Users className="w-4 h-4 mx-auto text-[color:var(--accent)] mb-1.5" />
              <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value ?? '—'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
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
