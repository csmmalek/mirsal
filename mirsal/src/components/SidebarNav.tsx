import React from 'react';
import {
  Bell,
  LogOut,
  MessageCircle,
  Moon,
  Smartphone,
  Sun,
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
  onLogout,
  mobileHidden,
}) => {
  return (
    <>
      {/* Desktop Vertical Rail */}
      <nav
        aria-label="التنقل الرئيسي"
        className="hidden md:flex flex-col items-center justify-between w-16 py-4 bg-white dark:bg-[#111820] border-l border-slate-200 dark:border-slate-800 shrink-0"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            title={currentUser.displayName}
            className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700"
          >
            <img
              src={currentUser.avatar}
              alt={currentUser.displayName}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>

          <button
            type="button"
            aria-label="المحادثات"
            title="المحادثات"
            className="relative min-h-[44px] min-w-[44px] rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-[#0D7A5F] dark:text-emerald-400 flex items-center justify-center"
          >
            <MessageCircle className="w-5 h-5" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-md bg-[#0D7A5F] text-white text-[10px] font-bold tabular-nums flex items-center justify-center">
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
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 dark:bg-[#111820]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center px-2"
        >
          <button
            type="button"
            aria-label="المحادثات"
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[#0D7A5F] dark:text-emerald-400"
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
            onClick={onOpenDevices}
            aria-label="الأجهزة"
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300"
          >
            <Smartphone className="w-5 h-5" />
            <span className="text-[10px] font-medium">الأجهزة</span>
          </button>


          <button
            type="button"
            onClick={onLogout}
            aria-label="الحساب"
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-slate-600 dark:text-slate-300"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-[10px] font-medium">الحساب</span>
          </button>
        </nav>
      )}
    </>
  );
};
