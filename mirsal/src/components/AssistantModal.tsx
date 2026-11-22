import React, { useState } from 'react';
import { X, Send, Sparkles } from 'lucide-react';
import type { ApiFn } from '../api/client';
import { readError } from '../api/client';

interface AssistantModalProps {
  open: boolean;
  onClose: () => void;
  api: ApiFn;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/** مساعد ذكي داخل التطبيق. الرسائل إليه لا تُشفَّر طرفياً لأنها تُرسل إلى خدمة الذكاء الاصطناعي. */
export const AssistantModal: React.FC<AssistantModalProps> = ({ open, onClose, api }) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    setTurns((prev) => [...prev, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await api('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(await readError(res, 'تعذّر الحصول على رد'));
      const data = (await res.json()) as { reply: string };
      setTurns((prev) => [...prev, { role: 'assistant', text: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحصول على رد');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md h-[80vh] sm:h-[70vh] bg-[var(--glass-bg-strong)] backdrop-blur-xl rounded-t-3xl sm:rounded-3xl border border-[var(--glass-border)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2 font-bold">
            <Sparkles className="w-5 h-5" />
            <span>المساعد</span>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="icon-btn !p-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="px-4 py-2 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-900/20">
          هذه المحادثة غير مشفّرة طرفياً، لأن رسائلك تُرسل إلى خدمة الذكاء الاصطناعي. لا تكتب فيها كلمات مرور أو بيانات حساسة.
        </p>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {turns.length === 0 && <p className="text-sm opacity-70">اسألني عن استخدام مِرسال، أو اطلب مساعدة في كتابة رسالة.</p>}
          {turns.map((t, i) => (
            <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${t.role === 'user' ? 'ms-auto bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-white/60 dark:bg-white/10'}`}>
              {t.text}
            </div>
          ))}
          {busy && <p className="text-xs opacity-60">جارٍ الكتابة...</p>}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="p-3 border-t border-[var(--glass-border)] flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            maxLength={1000}
            placeholder="اكتب سؤالك..."
            className="flex-1 rounded-full px-4 py-2 bg-white/70 dark:bg-white/10 outline-none"
          />
          <button type="button" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="إرسال" className="icon-btn !p-2">
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
