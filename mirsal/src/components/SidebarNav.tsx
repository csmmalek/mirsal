import React from 'react';
import {
  Bell,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Moon,
  Palette,
  Shield,
  Smartphone,
  Sun,
  User as UserIcon,
} from 'lucide-react';
import type { User } from '../types/chat';

interface SidebarNavProps {
  currentUser: User;
  totalUnread: number;
  unreadNotifications: number;
  darkMode: boolean;
  onToggleTheme: () => void;
  onOpenNotifications: () => void;
  onOpenDevices: () => void;
  onOpenProfile: () => void;
  onOpenThemes: () => void;
  onOpenSupport: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  mobileHidden?: boolean;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  currentUser,
  totalUnread,
  unreadNotifications,
  darkMode,
  onToggleTheme,
  onOpenNotifications,
  onOpenDevices,
  onOpenProfile,
  onOpenThemes,
  onOpenSupport,
  onOpenAdmin,
  onLogout,
  mobileHidden,
}) => {
  const railBtn =
    'min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors';
  return (
    <>
      {/* Desktop Vertical Rail */}
      <nav
        aria-label="التنقل الرئيسي"
        className="hidden md:flex flex-col items-center justify-between w-16 py-4 bg-white dark:bg-[var(--d-surface)] border-l border-slate-200 dark:border-slate-800 shrink-0"
      >
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="الملف الشخصي"
            title={`${currentUser.displayName} · ID ${currentUser.uid}`}
            className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700"
          >
            <img
              src={currentUser.avatar}
              alt={currentUser.displayName}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </button>

          <button
            type="button"
            aria-label="المحادثات"
            title="المحادثات"
            className="relative min-h-[44px] min-w-[44px] rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-[color:var(--accent)] dark:text-emerald-400 flex items-center justify-center"
          >
            <MessageCircle className="w-5 h-5" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-md bg-[var(--accent)] text-white text-[10px] font-bold tabular-nums flex items-center justify-center">
                {totalUnread}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            aria-label="التنبيهات الفورية"
            title="التنبيهات الفورية"
            className="relative min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-md bg-red-600 text-white text-[10px] font-bold tabular-nums flex items-center justify-center">
                {unreadNotifications}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenDevices}
            aria-label="الأجهزة المرتبطة"
            title="الأجهزة المرتبطة والمزامنة"
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <Smartphone className="w-5 h-5" />
          </button>

          <button type="button" onClick={onOpenThemes} aria-label="الثيمات" title="الثيمات" className={railBtn}>
            <Palette className="w-5 h-5" />
          </button>
          <button type="button" onClick={onOpenSupport} aria-label="الدعم" title="الدعم" className={railBtn}>
            <LifeBuoy className="w-5 h-5" />
          </button>
          {currentUser.isAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              aria-label="لوحة المطور"
              title="لوحة المطور"
              className="min-h-[44px] min-w-[44px] rounded-xl text-amber-500 hover:bg-amber-500/10 flex items-center justify-center transition-colors"
            >
              <Shield className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={onLogout}
            aria-label="تبديل الحساب"
            title="تبديل الحساب"
            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 flex items-center justify-center transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Navigation Bar (only shown on conversation list screen, <= 64px) */}
      {!mobileHidden && (
        <nav
          aria-label="شريط التنقل للجوال"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 dark:bg-[var(--d-surface)]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center px-2"
        >
          <button
            type="button"
            aria-label="المحادثات"
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[color:var(--accent)] dark:text-emerald-400"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="text-[10px] font-semibold">المحادثات</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            aria-label="التنبيهات"
            className="relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300"
          >
            <Bell className="w-5 h-5" />
            <span className="text-[10px] font-medium">التنبيهات</span>
            {unreadNotifications > 0 && (
              <span className="absolute top-1.5 right-1/4 w-2 h-2 rounded-full bg-red-600" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenThemes}
            aria-label="الثيمات"
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300"
          >
            <Palette className="w-5 h-5" />
            <span className="text-[10px] font-medium">الثيم</span>
          </button>


          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="الحساب"
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300"
          >
            <UserIcon className="w-5 h-5" />
            <span className="text-[10px] font-medium">حسابي</span>
          </button>
        </nav>
      )}
    </>
  );
};
