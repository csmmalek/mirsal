import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  LifeBuoy,
  LogOut,
  Moon,
  Smartphone,
  Sun,
  SunMoon,
  Trash2,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ModalShell } from './SideModals';
import { THEMES } from '../themes';
import { applyWallpaper, currentWallpaper, getWallpapers } from '../appearance';
import {
  BUTTON_STYLES,
  FONT_SCALES,
  ButtonStyle,
  FontScale,
  ThemeMode,
  applyButtonStyle,
  applyFontScale,
  getButtonStyle,
  getFontScale,
} from '../preferences';
import { ApiFn, errorMessage, readError } from '../api/client';
import { deriveFromPassword } from '../utils/crypto';
import { User } from '../types/chat';

interface SettingsModalProps {
  user: User;
  api: ApiFn;
  onUserChange: (u: User) => void;
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  colorTheme: string;
  onColorTheme: (id: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  browserPermission: NotificationPermission | 'unsupported';
  onRequestBrowserPermission: () => void;
  unreadNotifications: number;
  onOpenNotifications: () => void;
  onOpenDevices: () => void;
  onOpenSupport: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  /** بعد حذف الحساب بنجاح: ينهي الجلسة محلياً. */
  onAccountDeleted: () => void;
  onClose: () => void;
}

const MODES: { id: ThemeMode; name: string; icon: React.ReactNode }[] = [
  { id: 'light', name: 'فاتح', icon: <Sun className="w-4 h-4" /> },
  { id: 'dark', name: 'داكن', icon: <Moon className="w-4 h-4" /> },
  { id: 'auto', name: 'تلقائي', icon: <SunMoon className="w-4 h-4" /> },
];

/** مجموعة أزرار اختيار: الخيار المحدد بالنمط الأساسي والبقية ghost. */
const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; name: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) => (
  <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
    {options.map((o) => {
      const active = o.id === value;
      return (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(o.id)}
          className={`btn-glass ${active ? '' : 'btn-ghost'} min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 px-2`}
        >
          {o.icon}
          <span>{o.name}</span>
        </button>
      );
    })}
  </div>
);

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="glass-panel p-4 space-y-3">
    <div>
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{title}</h3>
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{hint}</p>}
    </div>
    {children}
  </section>
);

const inputCls = 'field-glass w-full min-h-[44px] px-3 py-2 rounded-xl text-sm text-slate-900 dark:text-slate-100';
const rowBtn = 'btn-glass btn-ghost min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 px-2';

type UserWithBio = User & { bio?: string };

export const SettingsModal: React.FC<SettingsModalProps> = ({
  user,
  api,
  onUserChange,
  themeMode,
  onThemeMode,
  colorTheme,
  onColorTheme,
  soundEnabled,
  onToggleSound,
  browserPermission,
  onRequestBrowserPermission,
  unreadNotifications,
  onOpenNotifications,
  onOpenDevices,
  onOpenSupport,
  onOpenProfile,
  onLogout,
  onAccountDeleted,
  onClose,
}) => {
  const [btnStyle, setBtnStyle] = useState<ButtonStyle>(getButtonStyle);
  const [fontScale, setFontScale] = useState<FontScale>(getFontScale);
  const [activeWp, setActiveWp] = useState(currentWallpaper());

  // ----- account -----
  const savedBio = (user as UserWithBio).bio ?? '';
  const [name, setName] = useState(user.displayName);
  const [bio, setBio] = useState(savedBio);
  const [accountMsg, setAccountMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const patchMe = useCallback(
    async (body: Record<string, unknown>, okText: string) => {
      setSaving(true);
      setAccountMsg(null);
      try {
        const res = await api('/api/me', { method: 'PATCH', body: JSON.stringify(body) });
        if (!res.ok) {
          setAccountMsg({ ok: false, text: await readError(res, 'تعذر حفظ التغييرات') });
          return false;
        }
        onUserChange(((await res.json()) as { user: User }).user);
        setAccountMsg({ ok: true, text: okText });
        return true;
      } catch (err) {
        setAccountMsg({ ok: false, text: errorMessage(err, 'تعذر حفظ التغييرات') });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, onUserChange]
  );

  // ----- blocked people -----
  const [blocked, setBlocked] = useState<User[] | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const loadBlocked = useCallback(async () => {
    try {
      const res = await api('/api/blocks');
      if (!res.ok) {
        setBlockedError(await readError(res, 'تعذر تحميل قائمة المحظورين'));
        return;
      }
      setBlocked(((await res.json()) as { users: User[] }).users);
    } catch (err) {
      setBlockedError(errorMessage(err));
    }
  }, [api]);
  useEffect(() => {
    void loadBlocked();
  }, [loadBlocked]);

  const unblock = async (id: string) => {
    setBlockedError(null);
    try {
      const res = await api(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        setBlockedError(await readError(res, 'تعذر إلغاء الحظر'));
        return;
      }
      setBlocked((list) => (list ?? []).filter((u) => u.id !== id));
    } catch (err) {
      setBlockedError(errorMessage(err));
    }
  };

  // ----- delete account -----
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const deleteAccount = async () => {
    if (!user.email) {
      setDeleteError('تعذر التحقق من حسابك، أعد تسجيل الدخول ثم حاول مجدداً');
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const { authSecret } = await deriveFromPassword(user.email, password);
      const res = await api('/api/me', { method: 'DELETE', body: JSON.stringify({ authSecret }) });
      if (!res.ok) {
        setDeleteError(await readError(res, 'تعذر حذف الحساب'));
        return;
      }
      onAccountDeleted();
    } catch (err) {
      setDeleteError(errorMessage(err, 'تعذر حذف الحساب'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const privacy = user.statusPrivacy ?? 'contacts';
  const unchanged = name.trim() === user.displayName && bio === savedBio;

  return (
    <ModalShell title="الإعدادات" onClose={onClose} wide>
      <div className="space-y-4">
        <Section title="الحساب" hint="اسم المستخدم لا يمكن تغييره. بريدك الإلكتروني يظهر لك أنت فقط في ملفك الشخصي.">
          <div className="flex items-center gap-3">
            <img src={user.avatar} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.displayName}</p>
              <p dir="ltr" className="text-xs text-slate-500 dark:text-slate-400 text-right">
                {user.handle ? `@${user.handle}` : 'لم تختر اسم مستخدم بعد'} · #{user.uid}
              </p>
            </div>
            <button type="button" onClick={onOpenProfile} className={`${rowBtn} shrink-0`}>
              <UserRound className="w-4 h-4" />
              <span>الصورة واسم المستخدم</span>
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">الاسم المعروض</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputCls} aria-label="الاسم المعروض" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">نبذة عنك</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={140} rows={2} className={inputCls} aria-label="نبذة عنك" />
            <span className="text-[11px] text-slate-400 tabular-nums">{bio.length}/140</span>
          </label>
          <button
            type="button"
            disabled={saving || name.trim().length < 2 || unchanged}
            onClick={() => patchMe({ displayName: name.trim(), bio }, 'تم حفظ بيانات الحساب')}
            className="btn-glass w-full min-h-[44px] rounded-xl text-sm font-semibold"
          >
            {saving ? 'جارٍ الحفظ...' : 'حفظ بيانات الحساب'}
          </button>
          {accountMsg && (
            <p role="status" className={`text-xs ${accountMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {accountMsg.text}
            </p>
          )}
        </Section>

        <Section title="الحالات والخصوصية" hint="الحالات تظهر لمن بينك وبينهم محادثة مباشرة وتختفي بعد 24 ساعة. من تحظرهم لا يرونها.">
          <Segmented<'contacts' | 'nobody'>
            label="من يرى حالاتي"
            value={privacy}
            options={[
              { id: 'contacts', name: 'جهات اتصالي' },
              { id: 'nobody', name: 'لا أحد' },
            ]}
            onChange={(v) => void patchMe({ statusPrivacy: v }, v === 'nobody' ? 'أُخفيت حالاتك عن الجميع' : 'تظهر حالاتك لجهات اتصالك')}
          />
        </Section>

        <Section title="الأشخاص المحظورون" hint="المحظور لا يستطيع مراسلتك ولا يجدك في البحث. لحظر شخص افتح معلومات محادثته.">
          {blockedError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {blockedError}
            </p>
          )}
          {blocked === null && !blockedError && <p className="text-xs text-slate-500 dark:text-slate-400">جارٍ التحميل...</p>}
          {blocked?.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">لا يوجد أشخاص محظورون.</p>}
          {blocked?.map((u) => (
            <div key={u.id} className="flex items-center gap-3">
              <img src={u.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{u.displayName}</p>
                <p dir="ltr" className="text-[11px] text-slate-500 dark:text-slate-400 text-right">
                  {u.handle ? `@${u.handle} · ` : ''}#{u.uid}
                </p>
              </div>
              <button type="button" onClick={() => unblock(u.id)} className="btn-glass btn-ghost min-h-[40px] px-3 rounded-lg text-xs font-semibold">
                إلغاء الحظر
              </button>
            </div>
          ))}
        </Section>

        <Section title="المظهر">
          <Segmented<ThemeMode> label="وضع العرض" value={themeMode} options={MODES} onChange={onThemeMode} />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">«تلقائي» يتبع إعداد الجهاز. ثيم «لؤلؤ» يعمل بالوضع الفاتح.</p>
        </Section>

        <Section title="الثيم">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {THEMES.map((t) => {
              const active = t.id === colorTheme;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onColorTheme(t.id)}
                  aria-pressed={active}
                  className={`btn-glass ${active ? '' : 'btn-ghost'} min-h-[56px] rounded-xl p-2 flex flex-col items-center justify-center gap-1 text-xs font-semibold`}
                >
                  <span className="w-6 h-6 rounded-full border border-white/60" style={{ background: t.accent }} />
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="خلفية المحادثة">
          <div className="grid grid-cols-3 gap-2">
            {[{ id: '', name: 'الافتراضية', css: '' }, ...getWallpapers()].map((w) => (
              <button
                key={w.id || 'default'}
                type="button"
                onClick={() => {
                  applyWallpaper(w.id);
                  setActiveWp(w.id);
                }}
                aria-pressed={activeWp === w.id}
                className={`h-16 rounded-xl text-[11px] font-semibold text-white flex items-end justify-center pb-1.5 border-2 ${
                  activeWp === w.id ? 'border-[color:var(--accent)]' : 'border-white/10'
                }`}
                style={{ backgroundImage: w.css || 'linear-gradient(180deg,#1e293b,#0f172a)' }}
              >
                {w.name}
              </button>
            ))}
          </div>
        </Section>

        <Section title="نمط الأزرار">
          <Segmented<ButtonStyle>
            label="نمط الأزرار"
            value={btnStyle}
            options={BUTTON_STYLES}
            onChange={(v) => {
              setBtnStyle(v);
              applyButtonStyle(v);
            }}
          />
        </Section>

        <Section title="حجم الخط">
          <Segmented<FontScale>
            label="حجم الخط"
            value={fontScale}
            options={FONT_SCALES}
            onChange={(v) => {
              setFontScale(v);
              applyFontScale(v);
            }}
          />
        </Section>

        <Section title="الإشعارات والصوت">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onToggleSound} className={`btn-glass ${soundEnabled ? '' : 'btn-ghost'} min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5`}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span>{soundEnabled ? 'الصوت مفعّل' : 'الصوت متوقف'}</span>
            </button>
            {browserPermission === 'unsupported' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 self-center">المتصفح لا يدعم الإشعارات</p>
            ) : (
              <button type="button" onClick={onRequestBrowserPermission} disabled={browserPermission === 'granted'} className={rowBtn}>
                {browserPermission === 'granted' ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                <span>{browserPermission === 'granted' ? 'الإشعارات مفعّلة' : 'تفعيل الإشعارات'}</span>
              </button>
            )}
          </div>
          <button type="button" onClick={onOpenNotifications} className={`${rowBtn} w-full`}>
            <Bell className="w-4 h-4" />
            <span>سجل الإشعارات{unreadNotifications > 0 ? ` (${unreadNotifications} جديد)` : ''}</span>
          </button>
        </Section>

        <Section title="الأجهزة والدعم">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onOpenDevices} className={rowBtn}>
              <Smartphone className="w-4 h-4" />
              <span>الأجهزة المرتبطة</span>
            </button>
            <button type="button" onClick={onOpenSupport} className={rowBtn}>
              <LifeBuoy className="w-4 h-4" />
              <span>الدعم الفني</span>
            </button>
          </div>
        </Section>

        <Section title="الجلسة والحذف">
          <button type="button" onClick={onLogout} className="btn-glass btn-danger w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
          {!deleting ? (
            <button type="button" onClick={() => setDeleting(true)} className="btn-glass btn-danger w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
              <Trash2 className="w-4 h-4" />
              <span>حذف حسابي نهائياً</span>
            </button>
          ) : (
            <div className="rounded-xl border border-red-300/60 dark:border-red-500/40 p-3 space-y-2">
              <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                سيُحذف حسابك ورسائلك وحالاتك نهائياً ولا يمكن استرجاعها، ولا تستطيع الإدارة استرجاع المحادثات المشفرة. أدخل كلمة المرور للتأكيد.
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="كلمة المرور"
                aria-label="كلمة المرور للتأكيد"
                autoComplete="current-password"
                className={inputCls}
              />
              {deleteError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {deleteError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={deleteBusy || password.length === 0}
                  onClick={deleteAccount}
                  className="btn-glass btn-danger min-h-[44px] rounded-xl text-sm font-semibold"
                >
                  {deleteBusy ? 'جارٍ الحذف...' : 'تأكيد الحذف'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleting(false);
                    setPassword('');
                    setDeleteError(null);
                  }}
                  className="btn-glass btn-ghost min-h-[44px] rounded-xl text-sm font-semibold"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </ModalShell>
  );
};
