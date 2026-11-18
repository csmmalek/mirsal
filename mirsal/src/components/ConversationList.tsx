import React from 'react';
import {
  Check,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  MessageSquarePlus,
  Mic,
  Moon,
  Phone,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import type { Conversation, ConversationFilter } from '../types/chat';
import { formatArabicTime } from '../utils/messaging';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  currentUserId: string;
  filter: ConversationFilter;
  searchQuery: string;
  wsConnected: boolean;
  darkMode: boolean;
  typingByConversation: Record<string, string[]>;
  onSelectConversation: (conversationId: string) => void;
  onFilterChange: (filter: ConversationFilter) => void;
  onSearchChange: (q: string) => void;
  onOpenNewChat: () => void;
  onToggleTheme: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeConversationId,
  currentUserId,
  filter,
  searchQuery,
  wsConnected,
  darkMode,
  typingByConversation,
  onSelectConversation,
  onFilterChange,
  onSearchChange,
  onOpenNewChat,
  onToggleTheme,
}) => {
  const renderPreview = (conv: Conversation) => {
    const typingUsers = typingByConversation[conv.id];
    if (typingUsers && typingUsers.length > 0) {
      return <span className="text-emerald-700 dark:text-emerald-400 font-medium">يكتب الآن...</span>;
    }
    const msg = conv.lastMessage;
    if (!msg) {
      return <span className="text-slate-400 dark:text-slate-500">ابدأ محادثة مشفرة الآن</span>;
    }

    const isMine = msg.senderId === currentUserId;
    const prefix = conv.type === 'group' && !isMine && msg.senderName ? `${msg.senderName}: ` : '';

    let content: React.ReactNode = msg.decrypted?.text || 'رسالة مشفرة';
    if (msg.type === 'image') {
      content = (
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5 shrink-0" />
          <span>{msg.decrypted?.text || 'صورة مشفرة'}</span>
        </span>
      );
    } else if (msg.type === 'audio') {
      content = (
        <span className="inline-flex items-center gap-1">
          <Mic className="w-3.5 h-3.5 shrink-0" />
          <span>رسالة صوتية</span>
        </span>
      );
    } else if (msg.type === 'file') {
      content = (
        <span className="inline-flex items-center gap-1">
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span>{msg.decrypted?.mediaName || 'ملف مرفق'}</span>
        </span>
      );
    } else if (msg.type === 'call') {
      content = (
        <span className="inline-flex items-center gap-1">
          <Phone className="w-3.5 h-3.5 shrink-0" />
          <span>{msg.decrypted?.text || 'مكالمة مشفرة'}</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 min-w-0 max-w-full overflow-hidden">
        {isMine && (
          <span className="shrink-0">
            {msg.status === 'read' ? (
              <CheckCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : msg.status === 'delivered' ? (
              <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <Check className="w-3.5 h-3.5 text-slate-400" />
            )}
          </span>
        )}
        <span className="truncate min-w-0">
          {prefix}
          {content}
        </span>
      </span>
    );
  };

  return (
    <aside
      aria-label="قائمة المحادثات"
      className="flex flex-col h-full bg-white dark:bg-[#111820] border-l border-slate-200 dark:border-slate-800"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-display truncate">
            المحادثات
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {wsConnected ? 'متصل · مزامنة فورية نشطة' : 'جاري إعادة الاتصال...'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            className="md:hidden min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={onOpenNewChat}
            aria-label="محادثة جديدة"
            title="محادثة جديدة"
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0D7A5F] hover:bg-[#0B664F] text-white flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span className="hidden sm:inline">جديدة</span>
          </button>
        </div>
      </div>

      {/* Search + Segmented Filters */}
      <div className="p-3 space-y-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ابحث بالاسم أو نص الرسالة..."
            aria-label="البحث في المحادثات"
            className="w-full min-h-[42px] pr-9 pl-3 py-2 rounded-xl bg-slate-100 dark:bg-[#0B1117] border border-transparent focus:border-emerald-600 focus:bg-white dark:focus:bg-[#161F29] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none transition-colors"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0B1117] rounded-xl" role="tablist" aria-label="تصفية المحادثات">
          {(
            [
              { id: 'all', label: 'الكل' },
              { id: 'unread', label: 'غير مقروءة' },
              { id: 'groups', label: 'المجموعات' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => onFilterChange(tab.id)}
              className={`flex-1 min-h-[36px] px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#161F29] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
        {conversations.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              لا توجد محادثات مطابقة
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              جرّب تغيير كلمة البحث أو ابدأ محادثة مشفرة جديدة.
            </p>
            <button
              type="button"
              onClick={onOpenNewChat}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              بدء محادثة جديدة
            </button>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const otherMember =
              conv.type === 'direct'
                ? conv.members.find((m) => m.id !== currentUserId)
                : undefined;
            const isOnline = otherMember?.online ?? false;

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full min-h-[72px] px-4 py-3 flex items-center gap-3 text-right transition-colors ${
                  isActive
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="relative shrink-0">
                  {conv.type === 'group' && !conv.avatar ? (
                    <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                  ) : (
                    <img
                      src={conv.avatar}
                      alt={conv.title}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover bg-slate-200 dark:bg-slate-800"
                    />
                  )}
                  {conv.type === 'direct' && isOnline && (
                    <span
                      title="متصل الآن"
                      className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-[#111820] absolute bottom-0 left-0"
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {conv.title}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {formatArabicTime(conv.updatedAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400 min-w-0 flex-1 overflow-hidden">
                      {renderPreview(conv)}
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-md bg-[#0D7A5F] text-white text-[11px] font-semibold tabular-nums flex items-center justify-center shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
