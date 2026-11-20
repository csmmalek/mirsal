import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, LogIn, Mail, ShieldCheck, Smartphone, UserPlus } from 'lucide-react';
import { ADMIN_EMAIL } from '../constants';

export interface AuthParams {
  mode: 'login' | 'register';
  /** The email (or, for old accounts, the old username). It is also the key-derivation salt. */
  email: string;
  password: string;
  displayName?: string;
  /** اسم المستخدم الفريد (للتسجيل فقط). */
  handle?: string;
  setupCode?: string;
}

interface AuthGateProps {
  onSubmit: (params: AuthParams) => Promise<void>;
  loading: boolean;
  error: string | null;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const inputCls =
  'field-glass w-full min-h-[46px] px-3.5 py-2 rounded-xl text-sm text-slate-900 dark:text-slate-100';
const labelCls = 'block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export const AuthGate: React.FC<AuthGateProps> = ({ onSubmit, loading, error }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleCheck, setHandleCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const h = handle.trim().toLowerCase().replace(/^@/, '');

  // Live username availability (public endpoint), debounced.
  useEffect(() => {
    if (mode !== 'register' || !h) {
      setHandleCheck(null);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/handle/check?h=${encodeURIComponent(h)}`);
        const d = (await res.json()) as { available: boolean; reason?: string };
        setHandleCheck(d.available ? { ok: true, msg: 'اسم المستخدم متاح' } : { ok: false, msg: d.reason || 'غير متاح' });
      } catch {
        setHandleCheck(null);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [h, mode]);

  const e = email.trim().toLowerCase();
  const isAdminEmail = e === ADMIN_EMAIL;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setLocalError(null);
    if (mode === 'register') {
      if (!EMAIL_RE.test(e)) return setLocalError('يرجى إدخال بريد إلكتروني صحيح');
      if (!displayName.trim()) return setLocalError('يرجى إدخال الاسم الظاهر');
      if (!/^[a-z][a-z0-9_]{2,19}$/.test(h)) return setLocalError('اسم المستخدم من 3 إلى 20 حرفاً: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية، ويبدأ بحرف');
      if (handleCheck && !handleCheck.ok) return setLocalError(handleCheck.msg);
      if (password.length < 8) return setLocalError('كلمة المرور يجب ألا تقل عن 8 أحرف');
      if (isAdminEmail && !setupCode.trim()) return setLocalError('أدخل رمز إعداد المطور');
    } else if (!e || !password) {
      return setLocalError('يرجى إدخال البريد الإلكتروني وكلمة المرور');
    }
    await onSubmit({ mode, email: e, password, displayName: displayName.trim(), handle: h, setupCode: setupCode.trim() });
  };

  return (
    <div className="min-h-screen w-full bg-[#F4F6F8] dark:bg-[var(--d-bg)] flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 bg-white dark:bg-[var(--d-surface)] border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden shadow-xl">
        <div
          className="p-8 md:p-10 text-white flex flex-col justify-between gap-8"
          style={{ background: 'linear-gradient(160deg, var(--accent) 0%, #1b1245 120%)' }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight font-display">مِرسال</h1>
            </div>
            <h2 className="text-3xl font-bold leading-snug text-balance font-display">
              مراسلة فورية مشفّرة طرف إلى طرف عبر جميع أجهزتك
            </h2>
            <p className="text-white/85 text-sm leading-relaxed">
              رسائل ومكالمات صوتية ومرئية ووسائط، تُزامَن لحظياً بين هاتفك وحاسوبك.
            </p>
          </div>
          <div className="space-y-3 border-t border-white/15 pt-6 text-xs text-white/90">
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 shrink-0" />
              <span>تُشفَّر الرسائل على جهازك بمفتاح لا يملكه الخادم</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>سجّل الدخول من أي جهاز وستجد محادثاتك كما هي</span>
            </div>
          </div>
        </div>

        <div className="p-8 md:p-10 flex flex-col justify-between gap-6">
          <div className="space-y-5">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setLocalError(null);
                  }}
                  className={`btn-glass ${mode === m ? '' : 'btn-ghost'} flex-1 min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg`}
                >
                  {m === 'login' ? 'تسجيل الدخول' : 'حساب جديد'}
                </button>
              ))}
            </div>

            {(error || localError) && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300"
              >
                {localError || error}
              </div>
            )}

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label htmlFor="auth-email" className={labelCls}>
                  البريد الإلكتروني
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3 pointer-events-none" />
                  <input
                    id="auth-email"
                    type="email"
                    dir="ltr"
                    autoCapitalize="none"
                    autoComplete="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="name@example.com"
                    className={`${inputCls} pr-9 text-left`}
                  />
                </div>
              </div>
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-displayname" className={labelCls}>
                    الاسم الظاهر
                  </label>
                  <input
                    id="auth-displayname"
                    value={displayName}
                    onChange={(ev) => setDisplayName(ev.target.value)}
                    placeholder="أحمد العبدالله"
                    className={inputCls}
                  />
                </div>
              )}
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-handle" className={labelCls}>
                    اسم المستخدم (فريد ولا يتغير)
                  </label>
                  <input
                    id="auth-handle"
                    dir="ltr"
                    autoCapitalize="none"
                    autoCorrect="off"
                    maxLength={20}
                    value={handle}
                    onChange={(ev) => setHandle(ev.target.value)}
                    placeholder="ahmed_99"
                    className={`${inputCls} text-left`}
                  />
                  <p className={`text-[11px] mt-1 ${handleCheck ? (handleCheck.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : 'text-slate-500 dark:text-slate-400'}`}>
                    {handleCheck ? handleCheck.msg : 'يبحث به الآخرون عنك. لن يرى أحد بريدك الإلكتروني.'}
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="auth-password" className={labelCls}>
                  كلمة المرور
                </label>
                <input
                  id="auth-password"
                  type="password"
                  dir="ltr"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  className={`${inputCls} text-left`}
                />
              </div>
              {mode === 'register' && isAdminEmail && (
                <div>
                  <label htmlFor="auth-setup" className={labelCls}>
                    رمز إعداد المطور
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3 pointer-events-none" />
                    <input
                      id="auth-setup"
                      type="password"
                      dir="ltr"
                      value={setupCode}
                      onChange={(ev) => setSetupCode(ev.target.value)}
                      className={`${inputCls} pr-9 text-left`}
                    />
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="btn-glass w-full min-h-[46px] px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                <span>{loading ? 'جاري تأمين الحساب...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}</span>
              </button>
            </form>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            كلمة المرور تُحوَّل على جهازك إلى مفتاحين؛ لا تُرسل كما هي أبداً. إن نسيتها لا يمكن استعادة محادثاتك المشفرة،
            ولا يستطيع أحد (حتى المطور) إعادة تعيينها.
          </p>
        </div>
      </div>
    </div>
  );
};
