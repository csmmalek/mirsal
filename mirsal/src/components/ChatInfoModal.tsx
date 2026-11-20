import React, { useEffect, useState } from 'react';
import { Ban, Pencil, Search, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Conversation, Message, User } from '../types/chat';
import { ApiFn, errorMessage, readError } from '../api/client';
import { ModalShell } from './SideModals';

/** كل إجراء يعيد نص الخطأ بالعربية أو null عند النجاح. */
export interface ChatInfoActions {
  rename: (title: string) => Promise<string | null>;
  addMembers: (users: User[]) => Promise<string | null>;
  removeMember: (userId: string) => Promise<string | null>;
  setRole: (userId: string, role: 'admin' | 'member') => Promise<string | null>;
  leave: () => Promise<string | null>;
  deleteForAll: () => Promise<string | null>;
  clearForMe: () => Promise<string | null>;
  block: (userId: string) => Promise<string | null>;
  unblock: (userId: string) => Promise<string | null>;
}

interface ChatInfoModalProps {
  conversation: Conversation;
  messages: Message[];
  fingerprint: string;
  currentUserId: string;
  api: ApiFn;
  actions: ChatInfoActions;
  onClose: () => void;
}

interface PendingConfirm {
  title: string;
  body: string;
  label: string;
  closeAfter: boolean;
  run: () => Promise<string | null>;
}

export const ChatInfoModal: React.FC<ChatInfoModalProps> = ({ conversation, messages, fingerprint, currentUserId, api, actions, onClose }) => {
  const isGroup = conversation.type === 'group';
  const isOwner = conversation.createdBy === currentUserId;
  const myRole = conversation.members.find((m) => m.id === currentUserId)?.role;
  const isAdmin = isOwner || myRole === 'admin';
  const other = !isGroup ? conversation.members.find((m) => m.id !== currentUserId) : undefined;
  const sharedImages = messages.filter((m) => m.type === 'image' && m.decrypted?.mediaUrl && !m.deleted);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searched, setSearched] = useState(false);

  // Who I have blocked (to show block / unblock on the direct chat).
  useEffect(() => {
    if (isGroup) return;
    api('/api/blocks')
      .then(async (res) => {
        if (res.ok) setBlockedIds(new Set(((await res.json()) as { users: User[] }).users.map((u) => u.id)));
      })
      .catch(() => undefined);
  }, [api, isGroup]);

  // Search new members by ID / username only.
  useEffect(() => {
    if (!adding) return;
    const q = query.trim().replace(/^@/, '');
    if (q.length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setError(await readError(res, 'تعذر البحث'));
          return;
        }
        const users = ((await res.json()) as { users: User[] }).users;
        setResults(users.filter((u) => !conversation.memberIds.includes(u.id)));
        setSearched(true);
      } catch (err) {
        setError(errorMessage(err, 'تعذر البحث'));
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, adding, api, conversation.memberIds]);

  const run = async (fn: () => Promise<string | null>, closeAfter = false) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    setConfirm(null);
    if (err) {
      setError(err);
      return false;
    }
    if (closeAfter) onClose();
    return true;
  };

  const ask = (c: PendingConfirm) => {
    setError(null);
    setConfirm(c);
  };

  const smallBtn = 'btn-glass btn-ghost min-h-[36px] px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0';
  const smallDanger = 'btn-glass btn-danger min-h-[36px] px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0';
  const rowBtn = 'btn-glass btn-ghost w-full min-h-[48px] px-4 rounded-xl text-sm font-semibold flex items-center gap-3 justify-start';
  const rowDanger = 'btn-glass btn-danger w-full min-h-[48px] px-4 rounded-xl text-sm font-semibold flex items-center gap-3 justify-start';

  return (
    <ModalShell title={isGroup ? 'معلومات المجموعة' : 'معلومات المحادثة'} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-3.5">
          {isGroup && !conversation.avatar ? (
            <div className="w-14 h-14 rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[color:var(--accent)] flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
          ) : (
            <img src={conversation.avatar} alt="" referrerPolicy="no-referrer" className="w-14 h-14 rounded-full object-cover shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={60}
                  aria-label="اسم المجموعة"
                  className="field-glass flex-1 min-w-0 min-h-[44px] px-3 rounded-xl text-sm text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={busy || titleDraft.trim().length < 2}
                  onClick={async () => {
                    if (await run(() => actions.rename(titleDraft.trim()))) setRenaming(false);
                  }}
                  className="btn-glass min-h-[44px] px-3 rounded-xl text-xs font-semibold"
                >
                  حفظ
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">{conversation.title}</h4>
                {isGroup && isAdmin && (
                  <button type="button" onClick={() => setRenaming(true)} aria-label="تغيير اسم المجموعة" className="icon-btn !min-h-[36px] !min-w-[36px]">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isGroup ? `مجموعة مشفرة · ${conversation.members.length} أعضاء` : other?.handle ? `@${other.handle} · #${other.uid}` : 'محادثة ثنائية مشفرة طرف إلى طرف'}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs p-3">
            {error}
          </p>
        )}

        <div className="glass-panel p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>رقم الأمان وبصمة التحقق (SHA-256)</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">طابق هذه الأرقام مع الطرف الآخر للتأكد من سلامة التشفير الطرفي (AES-256-GCM):</p>
          <div dir="ltr" className="p-3 rounded-lg bg-white dark:bg-[var(--d-bg)] border border-[var(--glass-border)] font-mono text-xs text-center tracking-wider leading-relaxed tabular-nums text-slate-800 dark:text-slate-200">
            {fingerprint}
          </div>
        </div>

        {isGroup && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400">الأعضاء ({conversation.members.length})</h5>
              {isAdmin && (
                <button type="button" onClick={() => setAdding((v) => !v)} className={smallBtn}>
                  {adding ? <X className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {adding ? 'إغلاق' : 'إضافة أعضاء'}
                </button>
              )}
            </div>

            {adding && (
              <div className="glass-panel p-3 space-y-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    dir="ltr"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ID أو اسم المستخدم الكامل"
                    aria-label="بحث عن عضو"
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="field-glass w-full min-h-[44px] pr-9 pl-3 rounded-xl text-sm text-left text-slate-900 dark:text-slate-100"
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">البحث بالـ ID (5 أرقام) أو باسم المستخدم الكامل فقط.</p>
                {results.map((u) => (
                  <div key={u.id} className="flex items-center gap-2.5">
                    <img src={u.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{u.displayName}</p>
                      <p dir="ltr" className="text-[11px] text-slate-500 dark:text-slate-400 text-right">
                        {u.handle ? `@${u.handle} · ` : ''}#{u.uid}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => actions.addMembers([u]))) {
                          setQuery('');
                          setResults([]);
                          setSearched(false);
                        }
                      }}
                      className="btn-glass min-h-[40px] px-3 rounded-lg text-xs font-semibold"
                    >
                      إضافة
                    </button>
                  </div>
                ))}
                {searched && results.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">لا يوجد مستخدم بهذا المعرّف، أو هو عضو في المجموعة أصلاً.</p>}
                <p className="text-[11px] text-slate-500 dark:text-slate-400">ملاحظة: العضو الجديد يستطيع قراءة رسائل المجموعة السابقة.</p>
              </div>
            )}

            <div className="divide-y divide-[var(--glass-border)] border border-[var(--glass-border)] rounded-xl overflow-hidden">
              {conversation.members.map((m) => {
                const mOwner = m.id === conversation.createdBy;
                const mAdmin = mOwner || m.role === 'admin';
                const canRemove = isAdmin && !mOwner && m.id !== currentUserId && (isOwner || !mAdmin);
                const canPromote = isOwner && !mOwner && m.id !== currentUserId;
                return (
                  <div key={m.id} className="p-3 flex items-center gap-2.5">
                    <img src={m.avatar} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {m.displayName}
                        {m.id === currentUserId ? ' (أنت)' : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {mOwner ? 'مالك المجموعة' : mAdmin ? 'مشرف' : m.handle ? `@${m.handle}` : `#${m.uid}`}
                        {' · '}
                        {m.online ? 'متصل' : 'غير متصل'}
                      </p>
                    </div>
                    {canPromote && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => actions.setRole(m.id, mAdmin ? 'member' : 'admin'))}
                        className={smallBtn}
                        aria-label={mAdmin ? `إلغاء إشراف ${m.displayName}` : `جعل ${m.displayName} مشرفاً`}
                      >
                        {mAdmin ? 'إلغاء الإشراف' : 'ترقية لمشرف'}
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          ask({
                            title: `إزالة ${m.displayName}؟`,
                            body: 'سيفقد وصوله إلى المجموعة ورسائلها الجديدة.',
                            label: 'نعم، أزله',
                            closeAfter: false,
                            run: () => actions.removeMember(m.id),
                          })
                        }
                        className={smallDanger}
                        aria-label={`إزالة ${m.displayName}`}
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        إزالة
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sharedImages.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400">الوسائط المشفرة المتبادلة ({sharedImages.length})</h5>
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

        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400">خيارات</h5>
          {!isGroup && other && (
            <button
              type="button"
              disabled={busy}
              className={blockedIds.has(other.id) ? rowBtn : rowDanger}
              onClick={() => {
                if (blockedIds.has(other.id)) {
                  void run(async () => {
                    const err = await actions.unblock(other.id);
                    if (!err) setBlockedIds((s) => new Set([...s].filter((x) => x !== other.id)));
                    return err;
                  });
                } else {
                  ask({
                    title: `حظر ${other.displayName}؟`,
                    body: 'لن تصلك رسائله ولن يستطيع مراسلتك أو رؤية حالاتك. يمكنك إلغاء الحظر من الإعدادات.',
                    label: 'نعم، احظره',
                    closeAfter: false,
                    run: async () => {
                      const err = await actions.block(other.id);
                      if (!err) setBlockedIds((s) => new Set([...s, other.id]));
                      return err;
                    },
                  });
                }
              }}
            >
              <Ban className="w-4 h-4" />
              <span>{blockedIds.has(other.id) ? `إلغاء حظر ${other.displayName}` : `حظر ${other.displayName}`}</span>
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={rowBtn}
            onClick={() =>
              ask({
                title: 'مسح المحادثة عندك؟',
                body: 'تُمسح الرسائل الحالية من جهازك وحسابك فقط، ولا تتأثر نسخة الطرف الآخر. تعود المحادثة إذا وصلت رسالة جديدة.',
                label: 'نعم، امسح',
                closeAfter: true,
                run: actions.clearForMe,
              })
            }
          >
            <Trash2 className="w-4 h-4" />
            <span>مسح المحادثة عندي</span>
          </button>
          {isGroup && (
            <button
              type="button"
              disabled={busy}
              className={rowDanger}
              onClick={() =>
                ask({
                  title: 'مغادرة المجموعة؟',
                  body: isOwner ? 'ستنتقل ملكية المجموعة إلى مشرف آخر أو عضو.' : 'لن تصلك رسائلها بعد المغادرة.',
                  label: 'نعم، غادر',
                  closeAfter: true,
                  run: actions.leave,
                })
              }
            >
              <UserMinus className="w-4 h-4" />
              <span>مغادرة المجموعة</span>
            </button>
          )}
          {isGroup && isOwner && (
            <button
              type="button"
              disabled={busy}
              className={rowDanger}
              onClick={() =>
                ask({
                  title: 'حذف المجموعة للجميع؟',
                  body: 'تُحذف المجموعة ورسائلها نهائياً عند جميع الأعضاء ولا يمكن التراجع.',
                  label: 'نعم، احذف المجموعة',
                  closeAfter: true,
                  run: actions.deleteForAll,
                })
              }
            >
              <Trash2 className="w-4 h-4" />
              <span>حذف المجموعة للجميع</span>
            </button>
          )}
        </div>
      </div>

      {confirm && (
        <div role="alertdialog" aria-modal="true" aria-label={confirm.title} className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center modal-backdrop" onClick={() => setConfirm(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="modal-card w-full sm:max-w-sm bg-white dark:bg-[var(--d-surface)] rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] border border-[var(--glass-border)] p-4 space-y-3"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{confirm.title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{confirm.body}</p>
            <button type="button" disabled={busy} onClick={() => run(confirm.run, confirm.closeAfter)} className="btn-glass btn-danger w-full min-h-[48px] rounded-xl text-sm font-semibold">
              {busy ? 'جارٍ التنفيذ...' : confirm.label}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="btn-glass btn-ghost w-full min-h-[48px] rounded-xl text-sm font-semibold">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};
