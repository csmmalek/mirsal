import React, { useEffect, useRef, useState } from 'react';
import { ADMIN_EMAIL } from '../constants';

/** Where a Google sign-in is paused: waiting for the encryption passphrase, or for the new account's details. */
export type GoogleFlow =
  | { kind: 'unlock'; email: string; user: unknown; token: string; deviceId: string; encryptedPrivateKey: string; privateKeyIv: string }
  | { kind: 'register'; credential: string; email: string; displayName: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: object) => void;
          renderButton: (element: HTMLElement, options: object) => void;
        };
      };
    };
  }
}

const inputCls =
  'field-glass w-full min-h-[46px] px-3.5 py-2 rounded-xl text-sm text-slate-900 dark:text-slate-100';
const labelCls = 'block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5';
const primaryCls = 'btn-glass w-full min-h-[46px] rounded-xl text-sm font-semibold';
const ghostCls = 'btn-glass btn-ghost w-full min-h-[44px] rounded-xl text-xs font-semibold';

/** Renders Google's official sign-in button. It shows nothing if Google sign-in is not configured. */
export const GoogleButton: React.FC<{ onCredential: (credential: string) => void }> = ({ onCredential }) => {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    (async () => {
      try {
        const res = await fetch('/api/auth/config');
        const d = (await res.json()) as { googleClientId?: string | null };
        if (!d.googleClientId) return;
        const clientId = d.googleClientId;
        // The Google script loads asynchronously; retry for a short while.
        const init = () => {
          if (cancelled) return;
          const id = window.google?.accounts.id;
          if (!id || !ref.current) {
            if (++attempts < 30) timer = window.setTimeout(init, 300);
            return;
          }
          id.initialize({ client_id: clientId, callback: (r: { credential: string }) => callback.current(r.credential) });
          id.renderButton(ref.current, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'ar', width: 320 });
        };
        init();
      } catch {
        /* keep the email form usable */
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return <div ref={ref} className="flex justify-center min-h-[44px]" />;
};

/** Asks for the encryption passphrase after a Google sign-in (the account's keys are locked with it). */
export const GoogleUnlockPanel: React.FC<{
  email: string;
  loading: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
}> = ({ email, loading, onSubmit, onCancel }) => {
  const [passphrase, setPassphrase] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!passphrase) return setLocal('أدخل رمز التشفير');
    setLocal(null);
    onSubmit(passphrase);
  };
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        مرحباً بك، <span dir="ltr">{email}</span>. أدخل رمز التشفير الخاص بحسابك لفتح رسائلك.
      </p>
      <div>
        <label htmlFor="g-pass" className={labelCls}>رمز التشفير</label>
        <input id="g-pass" type="password" autoComplete="current-password" value={passphrase} onChange={(ev) => setPassphrase(ev.target.value)} className={inputCls} />
      </div>
      {local && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{local}</p>}
      <button type="submit" disabled={loading} className={primaryCls}>{loading ? 'جارٍ الفتح...' : 'فتح الحساب'}</button>
      <button type="button" onClick={onCancel} className={ghostCls}>رجوع</button>
    </form>
  );
};

export interface GoogleRegisterValues {
  handle: string;
  displayName: string;
  passphrase: string;
  setupCode: string;
}

/** Completes a new Google account: a username and an encryption passphrase (8+ characters). */
export const GoogleRegisterPanel: React.FC<{
  email: string;
  initialName: string;
  loading: boolean;
  onSubmit: (values: GoogleRegisterValues) => void;
  onCancel: () => void;
}> = ({ email, initialName, loading, onSubmit, onCancel }) => {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState(initialName);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const isAdmin = email === ADMIN_EMAIL;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const h = handle.trim().toLowerCase().replace(/^@/, '');
    if (!displayName.trim()) return setLocal('يرجى إدخال الاسم الظاهر');
    if (!/^[a-z][a-z0-9_]{2,19}$/.test(h)) return setLocal('اسم المستخدم من 3 إلى 20 حرفاً: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية، ويبدأ بحرف');
    if (passphrase.length < 8) return setLocal('رمز التشفير يجب ألا يقل عن 8 أحرف');
    if (passphrase !== confirm) return setLocal('رمزا التشفير غير متطابقين');
    if (isAdmin && !setupCode.trim()) return setLocal('أدخل رمز إعداد المطور');
    setLocal(null);
    onSubmit({ handle: h, displayName: displayName.trim(), passphrase, setupCode: setupCode.trim() });
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        إنشاء حساب جديد بـ <span dir="ltr">{email}</span>. رمز التشفير يحمي رسائلك، ولا يرسله التطبيق إلى أي مكان. احفظه لأنك ستحتاجه عند الدخول من جهاز جديد.
      </p>
      <div>
        <label htmlFor="g-display" className={labelCls}>الاسم الظاهر</label>
        <input id="g-display" value={displayName} onChange={(ev) => setDisplayName(ev.target.value)} className={inputCls} />
      </div>
      <div>
        <label htmlFor="g-handle" className={labelCls}>اسم المستخدم</label>
        <input id="g-handle" dir="ltr" value={handle} onChange={(ev) => setHandle(ev.target.value)} placeholder="your_handle" className={`${inputCls} text-left`} />
      </div>
      <div>
        <label htmlFor="g-new-pass" className={labelCls}>رمز التشفير (8 أحرف على الأقل)</label>
        <input id="g-new-pass" type="password" autoComplete="new-password" value={passphrase} onChange={(ev) => setPassphrase(ev.target.value)} className={inputCls} />
      </div>
      <div>
        <label htmlFor="g-confirm-pass" className={labelCls}>أعد كتابة رمز التشفير</label>
        <input id="g-confirm-pass" type="password" autoComplete="new-password" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} className={inputCls} />
      </div>
      {isAdmin && (
        <div>
          <label htmlFor="g-setup" className={labelCls}>رمز إعداد المطور</label>
          <input id="g-setup" type="password" value={setupCode} onChange={(ev) => setSetupCode(ev.target.value)} className={inputCls} />
        </div>
      )}
      {local && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{local}</p>}
      <button type="submit" disabled={loading} className={primaryCls}>{loading ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}</button>
      <button type="button" onClick={onCancel} className={ghostCls}>رجوع</button>
    </form>
  );
};
