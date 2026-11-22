import React from 'react';
import { CircleDashed, MessageCircle } from 'lucide-react';
import { User } from '../types/chat';

export type AppSection = 'chats' | 'status';

interface SidebarNavProps {
  currentUser: User;
  totalUnread: number;
  /** عدد أصحاب الحالات الذين لديهم حالة جديدة لم تُشاهد. */
  statusUnseen: number;
  /** إشعارات غير مقروءة: تظهر كنقطة على صورتي لأن سجل الإشعارات داخل الإعدادات. */
  unreadNotifications: number;
  section: AppSection;
  onSection: (s: AppSection) => void;
  onOpenProfile: () => void;
  mobileHidden?: boolean;
}

const Badge: React.FC<{ n: number }> = ({ n }) =>
  n > 0 ? (
    <span key={n} className="badge-pop absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent)] text-[var(--on-accent)] text-[10px] font-bold flex items-center justify-center tabular-nums">
      {n > 99 ? '99+' : n}
    </span>
  ) : null;

export const SidebarNav: React.FC<SidebarNavProps> = ({
  currentUser,
  totalUnread,
  statusUnseen,
  unreadNotifications,
  section,
  onSection,
  onOpenProfile,
  mobileHidden,
}) => {
  const items = [
    { id: 'chats' as const, label: 'المحادثات', icon: <MessageCircle className="w-5 h-5" />, badge: totalUnread },
    { id: 'status' as const, label: 'الحالات', icon: <CircleDashed className="w-5 h-5" />, badge: statusUnseen },
  ];

  const profileAvatar = (size: string) => (
    <span className="relative inline-block">
      <img src={currentUser.avatar} alt="" className={`${size} rounded-full object-cover`} />
      {unreadNotifications > 0 && (
        <span aria-label="إشعارات جديدة" className="absolute -top-0.5 -left-0.5 w-3 h-3 rounded-full bg-[var(--accent)] border-2 border-white dark:border-[var(--d-surface)]" />
      )}
    </span>
  );

  return (
    <>
      {/* Desktop vertical rail */}
      <nav
        aria-label="التنقل الرئيسي"
        className="hidden md:flex flex-col items-center justify-between w-16 py-4 bg-white dark:bg-[var(--d-surface)] border-l border-[var(--glass-border)] shrink-0"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 mb-2 rounded-2xl flex items-center justify-center bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--glow)]" aria-hidden="true">
            <MessageCircle className="w-5 h-5" />
          </div>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onSection(it.id)}
              aria-label={it.label}
              aria-current={section === it.id ? 'page' : undefined}
              title={it.label}
              className={`icon-btn relative text-slate-600 dark:text-slate-300 ${section === it.id ? 'is-active' : ''}`}
            >
              {it.icon}
              <Badge n={it.badge} />
            </button>
          ))}
        </div>
        <button type="button" onClick={onOpenProfile} aria-label="حسابي" title="حسابي" className="icon-btn !p-0">
          {profileAvatar('w-9 h-9')}
        </button>
      </nav>

      {/* Mobile bottom bar */}
      {!mobileHidden && (
        <nav
          aria-label="التنقل الرئيسي"
          className="mobile-nav md:hidden fixed bottom-16 left-0 right-0 z-30 bg-[var(--glass-bg-strong)] backdrop-blur-xl border-t border-[var(--glass-border)] grid grid-cols-3 items-center px-2"
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onSection(it.id)}
              aria-label={it.label}
              aria-current={section === it.id ? 'page' : undefined}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                section === it.id ? 'text-[color:var(--accent)] font-bold' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <span className="relative">
                {it.icon}
                <Badge n={it.badge} />
              </span>
              <span className="text-[10px] font-medium">{it.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="حسابي"
            className="min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300"
          >
            {profileAvatar('w-6 h-6')}
            <span className="text-[10px] font-medium">حسابي</span>
          </button>
        </nav>
      )}
    </>
  );
};
