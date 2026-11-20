import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDashed, Eye, ImagePlus, Plus, Trash2, Type, X } from 'lucide-react';
import { StatusFeed, StatusGroup, StatusItem, User } from '../types/chat';
import { ApiFn, errorMessage, readError } from '../api/client';
import { IMAGE_TYPES, resizeImage } from '../utils/imageResize';
import { formatArabicTime } from '../utils/messaging';
import { ModalShell } from './SideModals';

const BG_COLORS = ['#0f766e', '#7c3aed', '#be185d', '#0369a1', '#b45309', '#334155'];
const STATUS_SECONDS = 5;

/** صورة شخصية بحلقة خضراء عند وجود حالة جديدة، ورمادية إن شوهدت كلها. */
export const RingAvatar: React.FC<{ src: string; ring?: 'new' | 'seen'; className?: string }> = ({ src, ring, className = 'w-12 h-12' }) => (
  <img
    src={src}
    alt=""
    className={`${className} rounded-full object-cover shrink-0 ${ring === 'new' ? 'avatar-ring-new' : ring === 'seen' ? 'avatar-ring-seen' : ''}`}
  />
);

/* ------------------------------- List panel ------------------------------- */

interface StatusPanelProps {
  feed: StatusFeed;
  currentUser: User;
  loading: boolean;
  onAdd: () => void;
  onOpenMine: () => void;
  onOpenGroup: (index: number) => void;
}

export const StatusPanel: React.FC<StatusPanelProps> = ({ feed, currentUser, loading, onAdd, onOpenMine, onOpenGroup }) => {
  const hasMine = feed.mine.length > 0;
  const fresh = feed.groups.filter((g) => !g.allViewed);
  const seen = feed.groups.filter((g) => g.allViewed);
  const row = 'w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-[var(--glass-bg)] transition-colors min-h-[64px]';

  const renderGroup = (g: StatusGroup) => {
    const idx = feed.groups.indexOf(g);
    const last = g.statuses[g.statuses.length - 1];
    return (
      <button key={g.user.id} type="button" onClick={() => onOpenGroup(idx)} className={row}>
        <RingAvatar src={g.user.avatar} ring={g.allViewed ? 'seen' : 'new'} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{g.user.displayName}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {g.statuses.length} {g.statuses.length === 1 ? 'حالة' : 'حالات'} · {formatArabicTime(last.createdAt)}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section aria-label="الحالات" className="h-full flex flex-col bg-white dark:bg-[var(--d-surface)] border-l border-[var(--glass-border)]">
      <header className="px-4 pt-5 pb-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">الحالات</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">تظهر لمن بينك وبينهم محادثة مباشرة وتختفي بعد 24 ساعة</p>
      </header>

      <div className="flex-1 overflow-y-auto pb-4">
        <div className="flex items-center">
          <button type="button" onClick={hasMine ? onOpenMine : onAdd} className={row}>
            <span className="relative">
              <RingAvatar src={currentUser.avatar} ring={hasMine ? 'new' : undefined} />
              <span className="absolute -bottom-1 -left-1 w-6 h-6 rounded-full bg-[var(--accent)] text-[var(--on-accent)] flex items-center justify-center border-2 border-white dark:border-[var(--d-surface)]">
                <Plus className="w-3.5 h-3.5" />
              </span>
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">حالتي</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {hasMine ? `${feed.mine.length} نشطة · اضغط للمشاهدة` : 'اضغط لإضافة حالة'}
              </span>
            </span>
          </button>
          {hasMine && (
            <button type="button" onClick={onAdd} aria-label="إضافة حالة جديدة" className="btn-glass ml-3 w-11 h-11 rounded-full flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>

        {loading && feed.groups.length === 0 && (
          <div className="px-4 py-3 space-y-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-white/10" />
                  <div className="h-2.5 w-1/2 rounded bg-slate-200 dark:bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        )}

        {fresh.length > 0 && <h3 className="px-4 pt-3 pb-1 text-xs font-bold text-slate-500 dark:text-slate-400">الجديدة</h3>}
        {fresh.map(renderGroup)}
        {seen.length > 0 && <h3 className="px-4 pt-3 pb-1 text-xs font-bold text-slate-500 dark:text-slate-400">تمت مشاهدتها</h3>}
        {seen.map(renderGroup)}

        {!loading && feed.groups.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            <CircleDashed className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>لا توجد حالات من جهات اتصالك الآن.</p>
            <p className="text-xs mt-1">ابدأ محادثة مع أحد الأشخاص لتظهر حالاته هنا.</p>
          </div>
        )}
      </div>
    </section>
  );
};

/* ------------------------------ Composer modal ------------------------------ */

export const StatusComposer: React.FC<{ api: ApiFn; onClose: () => void; onPosted: () => void }> = ({ api, onClose, onPosted }) => {
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      setError('نوع الصورة غير مدعوم، اختر JPG أو PNG أو WebP');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('الصورة كبيرة جداً، اختر صورة أقل من 15 ميغابايت');
      return;
    }
    try {
      setImage(await resizeImage(file, { maxSide: 1080, maxChars: 280_000 }));
    } catch {
      setError('تعذر قراءة الصورة، جرّب صورة أخرى');
    }
  };

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'image' ? { type: 'image', image, text: text.trim() } : { type: 'text', text: text.trim(), bg };
      const res = await api('/api/statuses', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        setError(await readError(res, 'تعذر نشر الحالة'));
        return;
      }
      onPosted();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'تعذر نشر الحالة'));
    } finally {
      setBusy(false);
    }
  };

  const canPost = mode === 'image' ? !!image : text.trim().length > 0;

  return (
    <ModalShell title="حالة جديدة" onClose={onClose}>
      <div className="space-y-4">
        <div role="tablist" className="grid grid-cols-2 gap-2">
          {(
            [
              ['text', 'نص', <Type key="t" className="w-4 h-4" />],
              ['image', 'صورة', <ImagePlus key="i" className="w-4 h-4" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              className={`btn-glass ${mode === id ? '' : 'btn-ghost'} min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {mode === 'text' ? (
          <div className="rounded-[var(--radius-lg)] min-h-[200px] flex items-center justify-center p-5" style={{ background: bg }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="اكتب حالتك..."
              aria-label="نص الحالة"
              className="w-full bg-transparent text-white text-center text-xl font-bold placeholder:text-white/60 resize-none focus:outline-none"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
            {image ? (
              <img src={image} alt="معاينة الحالة" className="w-full max-h-[320px] object-contain rounded-[var(--radius-lg)] bg-black/5" />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-glass btn-ghost w-full min-h-[160px] rounded-[var(--radius-lg)] flex flex-col items-center justify-center gap-2 text-sm font-semibold"
              >
                <ImagePlus className="w-8 h-8" />
                اختر صورة
              </button>
            )}
            {image && (
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-glass btn-ghost min-h-[40px] px-4 rounded-xl text-xs font-semibold">
                تغيير الصورة
              </button>
            )}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="أضف تعليقاً (اختياري)"
              aria-label="تعليق الحالة"
              className="field-glass w-full min-h-[44px] px-3 rounded-xl text-sm text-slate-900 dark:text-slate-100"
            />
          </div>
        )}

        {mode === 'text' && (
          <div className="flex items-center gap-2" role="radiogroup" aria-label="لون الخلفية">
            {BG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={bg === c}
                aria-label={`لون ${c}`}
                onClick={() => setBg(c)}
                className={`w-11 h-11 rounded-full border-2 ${bg === c ? 'border-slate-900 dark:border-white' : 'border-transparent'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button type="button" disabled={!canPost || busy} onClick={post} className="btn-glass w-full min-h-[48px] rounded-xl text-sm font-semibold">
          {busy ? 'جارٍ النشر...' : 'نشر الحالة'}
        </button>
        <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">تظهر لجهات اتصالك فقط وتختفي بعد 24 ساعة. يمكنك التحكم بمن يراها من الإعدادات.</p>
      </div>
    </ModalShell>
  );
};

/* --------------------------------- Viewer --------------------------------- */

interface StatusViewerProps {
  api: ApiFn;
  owner: User;
  statuses: StatusItem[];
  isMine: boolean;
  onClose: () => void;
  /** يُستدعى بعد انتهاء حالات هذا الشخص؛ يعيد true إن وُجد من يليه. */
  onNextOwner?: () => boolean;
  onViewed: (statusId: string) => void;
  onDeleted: () => void;
}

export const StatusViewer: React.FC<StatusViewerProps> = ({ api, owner, statuses, isMine, onClose, onNextOwner, onViewed, onDeleted }) => {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewers, setViewers] = useState<Array<{ user: User; viewedAt: string }> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = statuses[idx];

  const next = useCallback(() => {
    if (idx < statuses.length - 1) setIdx(idx + 1);
    else if (!onNextOwner?.()) onClose();
  }, [idx, statuses.length, onNextOwner, onClose]);
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  // Reset when the owner/list changes.
  useEffect(() => {
    setIdx(0);
    setViewers(null);
    setConfirmDelete(false);
  }, [owner.id]);

  // Mark as viewed (others only).
  useEffect(() => {
    if (!isMine && current && !current.viewed) {
      api(`/api/statuses/${encodeURIComponent(current.id)}/view`, { method: 'POST', body: '{}' })
        .then((res) => {
          if (res.ok) onViewed(current.id);
        })
        .catch(() => undefined);
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto advance.
  useEffect(() => {
    if (!current || paused || viewers || confirmDelete) return;
    const t = window.setTimeout(next, STATUS_SECONDS * 1000);
    return () => window.clearTimeout(t);
  }, [current?.id, paused, viewers, confirmDelete, next]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'ArrowRight') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, onClose]);

  if (!current) return null;

  const loadViewers = async () => {
    setError(null);
    try {
      const res = await api(`/api/statuses/${encodeURIComponent(current.id)}/views`);
      if (!res.ok) {
        setError(await readError(res, 'تعذر تحميل المشاهدين'));
        return;
      }
      setViewers(((await res.json()) as { viewers: Array<{ user: User; viewedAt: string }> }).viewers);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    try {
      const res = await api(`/api/statuses/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(await readError(res, 'تعذر حذف الحالة'));
        return;
      }
      setConfirmDelete(false);
      onDeleted();
      if (statuses.length <= 1) onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`حالة ${owner.displayName}`} className="fixed inset-0 z-[70] bg-black flex items-center justify-center modal-backdrop">
      <div className="relative w-full h-full max-w-md mx-auto flex flex-col select-none">
        <div className="absolute top-0 inset-x-0 z-10 px-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-6 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex gap-1" dir="rtl" aria-hidden="true">
            {statuses.map((s, i) => (
              <div key={s.id} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
                {i < idx && <div className="h-full bg-white" />}
                {i === idx && (
                  <div
                    key={`${s.id}-${paused}`}
                    className="h-full bg-white status-progress"
                    style={{ ['--dur' as string]: `${STATUS_SECONDS}s`, animationPlayState: paused || viewers || confirmDelete ? 'paused' : 'running' } as React.CSSProperties}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3 text-white">
            <img src={owner.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{isMine ? 'حالتي' : owner.displayName}</p>
              <p className="text-[11px] opacity-80">{formatArabicTime(current.createdAt)}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="إغلاق الحالة" className="icon-btn !text-white hover:!bg-white/15">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 flex items-center justify-center relative"
          style={current.type === 'text' ? { background: current.bg || '#0f766e' } : undefined}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {current.type === 'image' ? (
            <img src={current.image} alt={current.text || 'صورة الحالة'} className="max-w-full max-h-full object-contain" />
          ) : (
            <p className="px-8 text-center text-white text-2xl font-bold leading-relaxed break-words">{current.text}</p>
          )}
          {current.type === 'image' && current.text && (
            <p className="absolute bottom-24 inset-x-0 px-6 text-center text-white text-base font-semibold drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">{current.text}</p>
          )}
          {/* tap zones: right = previous, left = next (RTL reading order) */}
          <button type="button" aria-label="الحالة السابقة" onClick={prev} className="absolute inset-y-0 right-0 w-1/3" />
          <button type="button" aria-label="الحالة التالية" onClick={next} className="absolute inset-y-0 left-0 w-2/3" />
        </div>

        {isMine && (
          <div className="absolute bottom-0 inset-x-0 z-10 px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between gap-3">
            <button type="button" onClick={loadViewers} className="btn-glass btn-ghost !text-white min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-2">
              <Eye className="w-4 h-4" />
              {current.viewCount ?? 0} مشاهدة
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label="حذف هذه الحالة" className="btn-glass btn-danger min-h-[44px] px-4 rounded-xl text-sm font-semibold flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              حذف
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="absolute bottom-24 inset-x-4 z-20 rounded-xl bg-red-600 text-white text-xs p-3 text-center">
            {error}
          </p>
        )}

        {viewers && (
          <div className="absolute inset-0 z-20 bg-black/70 flex items-end" onClick={() => setViewers(null)}>
            <div onClick={(e) => e.stopPropagation()} className="modal-card w-full max-h-[70%] overflow-y-auto bg-white dark:bg-[var(--d-surface)] rounded-t-[var(--radius-xl)] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">المشاهدون ({viewers.length})</h3>
                <button type="button" onClick={() => setViewers(null)} aria-label="إغلاق" className="icon-btn">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {viewers.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">لم يشاهد أحد هذه الحالة بعد</p>}
              {viewers.map((v) => (
                <div key={v.user.id} className="flex items-center gap-3 py-1.5">
                  <img src={v.user.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                  <span className="flex-1 text-sm text-slate-900 dark:text-slate-100 truncate">{v.user.displayName}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatArabicTime(v.viewedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {confirmDelete && (
          <div className="absolute inset-0 z-20 bg-black/70 flex items-end" onClick={() => setConfirmDelete(false)}>
            <div onClick={(e) => e.stopPropagation()} className="modal-card w-full bg-white dark:bg-[var(--d-surface)] rounded-t-[var(--radius-xl)] p-4 space-y-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              <p className="text-sm text-slate-900 dark:text-slate-100 py-1">سيتم حذف هذه الحالة لدى الجميع. هل تريد المتابعة؟</p>
              <button type="button" onClick={remove} className="btn-glass btn-danger w-full min-h-[48px] rounded-xl text-sm font-semibold">
                نعم، احذف الحالة
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn-glass btn-ghost w-full min-h-[48px] rounded-xl text-sm font-semibold">
                رجوع
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
