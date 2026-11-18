import React, { useState } from 'react';
import { Lock, LogIn, ShieldCheck, Smartphone, UserPlus } from 'lucide-react';

export interface AuthParams {
  mode: 'login' | 'register';
  username: string;
  password: string;
  displayName?: string;
}

interface AuthGateProps {
  onSubmit: (params: AuthParams) => Promise<void>;
  loading: boolean;
  error: string | null;
}

const inputCls =
  'w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1117] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600';
const labelCls = 'block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export const AuthGate: React.FC<AuthGateProps> = ({ onSubmit, loading, error }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const u = username.trim().toLowerCase();
    if (mode === 'register') {
      if (!/^[a-z0-9_]{3,24}$/.test(u)) {
        setLocalError('اسم المستخدم: من 3 إلى 24 حرفاً إنجليزياً صغيراً أو أرقاماً أو _');
        return;
      }
      if (!displayName.trim()) {
        setLocalError('يرجى إدخال الاسم الظاهر');
        return;
      }
      if (password.length < 8) {
        setLocalError('كلمة المرور يجب ألا تقل عن 8 أحرف');
        return;
      }
    } else if (!u || !password) {
      setLocalError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    await onSubmit({ mode, username: u, password, displayName: displayName.trim() });
  };

  return (
    <div className="min-h-screen w-full bg-[#F4F6F8] dark:bg-[#0B1117] flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-8 md:p-10 bg-[#0D7A5F] text-white flex flex-col justify-between gap-8">
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
            <p className="text-emerald-50/90 text-sm leading-relaxed">
              رسائل ومكالمات صوتية ومرئية ووسائط، تُزامَن لحظياً بين هاتفك وحاسوبك.
            </p>
          </div>
          <div className="space-y-3 border-t border-white/15 pt-6 text-xs text-emerald-50/90">
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
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-xl">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setLocalError(null);
                  }}
                  className={`flex-1 min-h-[40px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                    mode === m
                      ? 'bg-white dark:bg-[#161F29] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
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
                <label htmlFor="auth-username" className={labelCls}>اسم المستخدم</label>
                <input
                  id="auth-username"
                  dir="ltr"
                  autoCapitalize="none"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ahmed_dev"
                  className={`${inputCls} text-right`}
                />
              </div>
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-displayname" className={labelCls}>الاسم الظاهر</label>
                  <input
                    id="auth-displayname"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="أحمد العبدالله"
                    className={inputCls}
                  />
                </div>
              )}
              <div>
                <label htmlFor="auth-password" className={labelCls}>كلمة المرور</label>
                <input
                  id="auth-password"
                  type="password"
                  dir="ltr"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} text-right`}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0D7A5F] hover:bg-[#0B664F] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                <span>
                  {loading ? 'جاري تأمين الحساب...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
                </span>
              </button>
            </form>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            كلمة المرور تُحوَّل على جهازك إلى مفتاحين؛ لا تُرسل كما هي أبداً. إن نسيتها لا يمكن استعادة محادثاتك المشفرة.
          </p>
        </div>
      </div>
    </div>
  );
};
