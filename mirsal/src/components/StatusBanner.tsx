import React, { useEffect, useState } from 'react';
import { Megaphone, Wrench, X } from 'lucide-react';

export interface PublicSettings {
  registrationOpen: boolean;
  announcement: string;
  maintenance: boolean;
}

const dismissKey = (text: string) => `mirsal_ann_${text.length}_${text.slice(0, 24)}`;

/** شريط علوي يعرض إعلان المطور ووضع الصيانة لكل المستخدمين. الإعلان قابل للإغلاق، والصيانة لا. */
export const StatusBanner: React.FC<{ settings: PublicSettings | null }> = ({ settings }) => {
  const [dismissed, setDismissed] = useState(false);
  const text = settings?.announcement ?? '';

  useEffect(() => {
    try {
      setDismissed(text ? sessionStorage.getItem(dismissKey(text)) === '1' : false);
    } catch {
      setDismissed(false);
    }
  }, [text]);

  if (!settings) return null;
  const showAnnouncement = !!text && !dismissed;
  if (!showAnnouncement && !settings.maintenance) return null;

  return (
    <div
      className="fixed inset-x-2 z-[60] flex flex-col gap-1.5 pointer-events-none"
      style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
    >
      {settings.maintenance && (
        <div
          role="status"
          className="glass-panel pointer-events-auto mx-auto max-w-xl w-full px-3.5 py-2.5 flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-100/90 dark:bg-amber-900/40"
        >
          <Wrench className="w-4 h-4 shrink-0" />
          <span>التطبيق في وضع الصيانة، لا يمكن إرسال رسائل جديدة الآن.</span>
        </div>
      )}
      {showAnnouncement && (
        <div role="status" className="glass-panel pointer-events-auto mx-auto max-w-xl w-full px-3.5 py-2.5 flex items-start gap-2 text-xs text-slate-800 dark:text-slate-100">
          <Megaphone className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--accent)]" />
          <span className="flex-1 leading-relaxed">{text}</span>
          <button
            type="button"
            aria-label="إغلاق الإعلان"
            onClick={() => {
              try {
                sessionStorage.setItem(dismissKey(text), '1');
              } catch {
                /* ignore */
              }
              setDismissed(true);
            }}
            className="icon-btn !min-h-[28px] !min-w-[28px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
