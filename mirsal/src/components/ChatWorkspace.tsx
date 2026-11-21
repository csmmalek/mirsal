import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Ban,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  FileText,
  Info,
  Lock,
  Mic,
  MoreVertical,
  Flag,
  Paperclip,
  Phone,
  Pencil,
  PhoneCall,
  Reply,
  RotateCw,
  Send,
  Smile,
  Square,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { Conversation, DecryptedMessagePayload, Message, MessageType } from '../types/chat';
import { formatArabicTime, formatCallDuration, formatDayLabel, isGrouped, isSameDay } from '../utils/messaging';

interface ChatWorkspaceProps {
  conversation: Conversation | null;
  messages: Message[];
  currentUserId: string;
  typingUsers: string[];
  onBackMobile: () => void;
  /** تعيد true حين تُقبل الرسالة وتظهر في المحادثة، وfalse إن تعذّر تجهيزها (يبقى النص في الحقل). */
  onSendMessage: (type: MessageType, payload: DecryptedMessagePayload) => Promise<boolean>;
  onRetryMessage: (msg: Message) => void;
  /** تعدّل نص رسالة؛ تعيد نص الخطأ أو null عند النجاح. */
  onEditMessage: (msg: Message, text: string) => Promise<string | null>;
  /** تحذف رسالة (لي أو للجميع)؛ تعيد نص الخطأ أو null عند النجاح. */
  onDeleteMessage: (msg: Message, scope: 'me' | 'all') => Promise<string | null>;
  /** يبلّغ عن رسالة شخص آخر؛ تعيد نص الخطأ أو null عند النجاح. */
  onReport: (msg: Message, reason: string) => Promise<string | null>;
  onTyping: (isTyping: boolean) => void;
  onStartCall: (kind: 'audio' | 'video') => void;
  onOpenChatInfo: () => void;
  statusRing: Record<string, 'new' | 'seen'>;
}

const QUICK_EMOJIS = ['😊', '👍', '❤️', '🔥', '👏', '🎉', '✅', '🙏', '✨', '💡'];

/** Messages live in D1 (2 MB per row), so attachments are kept small; images are re-encoded to fit. */
const MAX_MEDIA_BYTES = 900 * 1024;

function shrinkImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      for (const q of [0.8, 0.65, 0.5, 0.35]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= MAX_MEDIA_BYTES * 1.33) return resolve(out);
      }
      reject(new Error('too large'));
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = dataUrl;
  });
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  conversation,
  messages,
  currentUserId,
  typingUsers,
  onBackMobile,
  onSendMessage,
  onRetryMessage,
  onEditMessage,
  onDeleteMessage,
  onReport,
  onTyping,
  onStartCall,
  onOpenChatInfo,
  statusRing,
}) => {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menuMsg, setMenuMsg] = useState<Message | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const sendLockRef = useRef(false);
  const headerRing =
    conversation && conversation.type === 'direct'
      ? statusRing[conversation.members.find((m) => m.id !== currentUserId)?.id ?? '']
      : undefined;

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setMediaError(null);
    setReplyTo(null);
    setEditing(null);
    setMenuMsg(null);
    setShowEmojiPicker(false);
  }, [conversation?.id]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  if (!conversation) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F4F6F8] dark:bg-[var(--d-bg)]">
        <div className="max-w-md space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 mx-auto flex items-center justify-center">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            مِرسال — المراسلة المشفرة
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            اختر محادثة من القائمة الجانبية لبدء المراسلة النصية، إرسال الوسائط المتعددة، أو إجراء مكالمة صوتية ومرئية مشفرة.
          </p>
        </div>
      </main>
    );
  }

  const otherMember =
    conversation.type === 'direct'
      ? conversation.members.find((m) => m.id !== currentUserId)
      : undefined;

  const statusText =
    typingUsers.length > 0
      ? 'يكتب الآن...'
      : conversation.type === 'group'
        ? `${conversation.members.length} أعضاء`
        : otherMember?.online
          ? 'متصل الآن'
          : otherMember
            ? `آخر ظهور ${formatArabicTime(otherMember.lastSeen)}`
            : 'محادثة مشفرة';

  const handleDraftChange = (val: string) => {
    setDraft(val);
    onTyping(val.trim().length > 0);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => onTyping(false), 1800);
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sendLockRef.current) return;
    sendLockRef.current = true;
    setMediaError(null);
    try {
      if (editing) {
        const err = await onEditMessage(editing, text);
        if (err) {
          setMediaError(err);
          return;
        }
        setEditing(null);
        setDraft('');
        return;
      }
      const payload: DecryptedMessagePayload = { text };
      if (replyTo) {
        payload.replyToId = replyTo.id;
        payload.replyPreview = replyTo.decrypted?.text || 'وسائط مشفرة';
      }
      const accepted = await onSendMessage('text', payload);
      if (!accepted) {
        // لا نفرّغ الحقل: النص باقٍ ليعيد المستخدم المحاولة.
        setMediaError('تعذر إرسال الرسالة، تحقق من الاتصال وحاول مجدداً');
        return;
      }
      setDraft('');
      setReplyTo(null);
      setShowEmojiPicker(false);
      onTyping(false);
    } finally {
      sendLockRef.current = false;
    }
  };

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setMediaError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    if (!isImage && file.size > MAX_MEDIA_BYTES) {
      setMediaError('الحد الأقصى للمرفقات غير الصور نحو 900 كيلوبايت');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      let dataUrl = String(reader.result || '');
      if (isImage) {
        try {
          dataUrl = await shrinkImage(dataUrl);
        } catch {
          setMediaError('تعذر معالجة الصورة');
          return;
        }
      }
      if (dataUrl.length > MAX_MEDIA_BYTES * 1.4) {
        setMediaError('المرفق كبير جداً');
        return;
      }
      if (file.type.startsWith('image/')) {
        const ok = await onSendMessage('image', {
          text: draft.trim() || undefined,
          mediaUrl: dataUrl,
          mediaName: file.name,
          mediaSize: file.size,
          mimeType: file.type,
        });
        if (ok) setDraft('');
        else setMediaError('تعذر إرسال الصورة، حاول مجدداً');
      } else if (file.type.startsWith('audio/')) {
        await onSendMessage('audio', {
          mediaUrl: dataUrl,
          mediaName: file.name,
          mediaSize: file.size,
          mimeType: file.type,
        });
      } else {
        await onSendMessage('file', {
          mediaUrl: dataUrl,
          mediaName: file.name,
          mediaSize: file.size,
          mimeType: file.type || 'application/octet-stream',
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const startVoiceRecording = async () => {
    setMediaError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMediaError('تسجيل الصوت غير مدعوم في هذا المتصفح، يمكنك إرفاق ملف صوتي بدلاً من ذلك');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 200) return;
        if (blob.size > MAX_MEDIA_BYTES) {
          setMediaError('الرسالة الصوتية طويلة جداً، سجّل مقطعاً أقصر');
          return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
          await onSendMessage('audio', {
            mediaUrl: String(reader.result || ''),
            mediaName: 'voice-note.webm',
            mediaSize: blob.size,
            mimeType: blob.type,
            durationSec: recordSeconds,
          });
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setMediaError('تعذر الوصول إلى الميكروفون. يرجى منح الإذن أو إرفاق ملف صوتي.');
    }
  };

  const stopVoiceRecording = (cancel = false) => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      if (cancel) {
        rec.onstop = () => {
          rec.stream.getTracks().forEach((t) => t.stop());
        };
      }
      rec.stop();
    }
    setIsRecording(false);
    setRecordSeconds(0);
  };

  return (
    <main className="flex-1 flex flex-col h-full min-w-0 chat-wallpaper">
      {/* Chat Header */}
      <header className="px-4 py-3 bg-white dark:bg-[var(--d-surface)] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackMobile}
            aria-label="العودة إلى قائمة المحادثات"
            className="md:hidden min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowRight className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={onOpenChatInfo}
            className="flex items-center gap-3 min-w-0 text-right hover:opacity-90 transition-opacity"
          >
            {conversation.type === 'group' && !conversation.avatar ? (
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
            ) : (
              <img
                src={conversation.avatar}
                alt={conversation.title}
                referrerPolicy="no-referrer"
                className={`w-10 h-10 rounded-full object-cover bg-slate-200 dark:bg-slate-800 shrink-0 ${
                  headerRing === 'new' ? 'avatar-ring-new' : headerRing === 'seen' ? 'avatar-ring-seen' : ''
                }`}
              />
            )}
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {conversation.title}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {statusText}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onStartCall('audio')}
            aria-label="مكالمة صوتية مشفرة"
            title="مكالمة صوتية مشفرة"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Phone className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => onStartCall('video')}
            aria-label="مكالمة فيديو مشفرة"
            title="مكالمة فيديو مشفرة"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Video className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onOpenChatInfo}
            aria-label="معلومات المحادثة وبصمة التشفير"
            title="معلومات المحادثة وبصمة التشفير"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-5" data-testid="message-stream">
        <div className="max-w-lg mx-auto px-4 py-2 rounded-xl bg-white/80 dark:bg-[var(--d-surface)]/90 border border-slate-200/80 dark:border-slate-800 text-center text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
          <Lock className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>الرسائل والمكالمات مشفرة طرف إلى طرف عبر AES-256-GCM</span>
        </div>

        {messages.map((msg, idx) => {
          const isMine = msg.senderId === currentUserId;
          const d = msg.decrypted ?? { text: 'جاري فك التشفير...' };
          const prev = messages[idx - 1];
          const showDate = !prev || !isSameDay(prev.createdAt, msg.createdAt);
          const groupedWithPrev = !showDate && isGrouped(prev, msg);

          const dateDivider = showDate && (
            <div className="flex justify-center my-4">
              <span className="date-chip px-3 py-1 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {formatDayLabel(msg.createdAt)}
              </span>
            </div>
          );

          if (msg.deleted) {
            return (
              <React.Fragment key={msg.id}>
                {dateDivider}
                <div className={`flex flex-col ${isMine ? 'items-start' : 'items-end'} ${groupedWithPrev ? 'mt-0.5' : showDate ? '' : 'mt-3'}`}>
                  <div className="msg-in max-w-[78%] rounded-[var(--radius-lg)] px-3.5 py-2 text-xs italic flex items-center gap-1.5 border border-dashed border-[var(--glass-border)] text-slate-500 dark:text-slate-400">
                    <Ban className="w-3.5 h-3.5 shrink-0" />
                    <span>تم حذف هذه الرسالة</span>
                  </div>
                </div>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={msg.id}>
              {dateDivider}
            <div
              className={`flex flex-col ${isMine ? 'items-start' : 'items-end'} ${groupedWithPrev ? 'mt-0.5' : showDate ? '' : 'mt-3'}`}
            >
              <div
                className={`msg-in group relative max-w-[78%] rounded-[var(--radius-lg)] px-3.5 py-2.5 text-sm leading-relaxed ${
                  isMine
                    ? `bubble-out ${groupedWithPrev ? '' : 'rounded-tr-md'}`
                    : `bubble-in text-slate-900 dark:text-slate-100 ${groupedWithPrev ? '' : 'rounded-tl-md'}`
                }`}
              >
                {conversation.type === 'group' && !isMine && !groupedWithPrev && msg.senderName && (
                  <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                    {msg.senderName}
                  </div>
                )}

                {d.replyPreview && (
                  <div
                    className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs border ${
                      isMine
                        ? 'bg-black/15 border-white/20 text-emerald-50'
                        : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {d.replyPreview}
                  </div>
                )}

                {msg.type === 'image' && d.mediaUrl && (
                  <div className="mb-2">
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(d.mediaUrl)}
                      aria-label="عرض الصورة بالحجم الكامل"
                      className="block rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      <img
                        src={d.mediaUrl}
                        alt={d.mediaName || 'صورة مرسلة'}
                        referrerPolicy="no-referrer"
                        className="max-h-64 w-full object-cover rounded-xl bg-slate-200 dark:bg-slate-800"
                      />
                    </button>
                  </div>
                )}

                {msg.type === 'audio' && d.mediaUrl && (
                  <div className="my-1 min-w-[210px]">
                    <audio controls src={d.mediaUrl} className="w-full h-9" />
                  </div>
                )}

                {msg.type === 'file' && (
                  <div
                    className={`my-1 p-2.5 rounded-xl flex items-center justify-between gap-3 ${
                      isMine
                        ? 'bg-black/15'
                        : 'bg-slate-100 dark:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-5 h-5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {d.mediaName || 'ملف مرفق'}
                        </div>
                        {d.mediaSize && (
                          <div className="text-[11px] opacity-80 tabular-nums">
                            {Math.max(1, Math.round(d.mediaSize / 1024))} كيلوبايت
                          </div>
                        )}
                      </div>
                    </div>
                    {d.mediaUrl && (
                      <a
                        href={d.mediaUrl}
                        download={d.mediaName || 'attachment'}
                        aria-label={`تنزيل ${d.mediaName || 'الملف'}`}
                        className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center hover:bg-black/10"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}

                {msg.type === 'call' && (
                  <div className="flex items-center gap-2 py-0.5">
                    <PhoneCall className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{d.text || 'مكالمة مشفرة'}</span>
                    {typeof d.durationSec === 'number' && (
                      <span className="text-xs opacity-80 tabular-nums">
                        · {formatCallDuration(d.durationSec)}
                      </span>
                    )}
                  </div>
                )}

                {d.text && msg.type !== 'call' && (
                  <p className="whitespace-pre-wrap break-words">{d.text}</p>
                )}

                <div
                  className={`mt-1.5 flex items-center justify-end gap-1.5 text-[11px] tabular-nums ${
                    isMine ? 'opacity-80' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmAll(false);
                      setMenuMsg(msg);
                    }}
                    aria-label="خيارات الرسالة"
                    className="icon-btn !min-h-[28px] !min-w-[28px] -my-1 opacity-70 hover:opacity-100"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {msg.editedAt && <span>معدّلة</span>}
                  <span>{formatArabicTime(msg.createdAt)}</span>
                  {isMine && (
                    <span className="flex items-center gap-1">
                      {msg.status === 'failed' ? (
                        <>
                          <span className="text-red-200 font-semibold">
                            {msg.queued ? 'سيُرسل تلقائياً عند عودة الاتصال' : 'فشل الإرسال'}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRetryMessage(msg)}
                            aria-label="إعادة محاولة الإرسال"
                            className="min-h-[24px] px-1.5 rounded-md bg-white/20 hover:bg-white/30 flex items-center gap-1 font-semibold"
                          >
                            <RotateCw className="w-3 h-3" />
                            <span>إعادة المحاولة</span>
                          </button>
                        </>
                      ) : msg.status === 'sending' ? (
                        <span className="flex items-center gap-1 opacity-80">
                          <Clock className="w-3.5 h-3.5 animate-pulse" />
                          <span>جارٍ الإرسال</span>
                        </span>
                      ) : msg.status === 'read' ? (
                        <CheckCheck className="w-3.5 h-3.5" />
                      ) : msg.status === 'delivered' ? (
                        <CheckCheck className="w-3.5 h-3.5 opacity-75" />
                      ) : (
                        <Check className="w-3.5 h-3.5 opacity-75" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
            </React.Fragment>
          );
        })}
        {typingUsers.length > 0 && (
          <div className="flex flex-col items-end mt-3" role="status" aria-label="يكتب الآن">
            <div className="bubble-in rounded-[var(--radius-lg)] rounded-tl-md px-4 py-3 text-slate-500 dark:text-slate-300 typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={streamEndRef} />
      </div>

      {/* Composer */}
      <footer className="composer-bar px-2 sm:px-3 pt-2.5 shrink-0">
        {mediaError && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{mediaError}</span>
            <button type="button" onClick={() => setMediaError(null)} aria-label="إغلاق التنبيه">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {editing && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0 truncate text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5 shrink-0" />
              <span>تعديل الرسالة</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft('');
              }}
              aria-label="إلغاء التعديل"
              className="icon-btn !min-h-[28px] !min-w-[28px]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {replyTo && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/70 flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0 truncate text-slate-600 dark:text-slate-300">
              رد على: {replyTo.decrypted?.text || 'وسائط مشفرة'}
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="إلغاء الرد"
              className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {showEmojiPicker && (
          <div className="mb-2 p-2 rounded-xl bg-slate-50 dark:bg-[var(--d-surface2)] border border-slate-200 dark:border-slate-700 flex items-center gap-1 flex-wrap">
            {QUICK_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setDraft((prev) => `${prev}${em}`)}
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-lg transition-colors"
              >
                {em}
              </button>
            ))}
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm font-medium">
              <Mic className="w-4 h-4" />
              <span>جاري تسجيل رسالة صوتية مشفرة...</span>
              <span className="font-mono tabular-nums">{formatCallDuration(recordSeconds)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stopVoiceRecording(true)}
                className="btn-glass btn-ghost min-h-[40px] px-3 rounded-lg text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => stopVoiceRecording(false)}
                className="btn-glass min-h-[40px] px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <Square className="w-3.5 h-3.5" />
                <span>إرسال الصوت</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendText} className="flex items-center gap-1.5 sm:gap-2 w-full min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,audio/*,.pdf,.doc,.docx,.txt,.zip"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label="إدراج رمز تعبيري"
              title="رموز تعبيرية"
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="إرفاق صورة أو ملف"
              title="إرفاق صورة أو ملف"
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={handleDraftKeyDown}
              enterKeyHint="send"
              autoComplete="off"
              placeholder="اكتب رسالة مشفرة..."
              aria-label="كتابة رسالة مشفرة"
              className="field-glass flex-1 min-w-0 w-0 min-h-[44px] px-4 py-2 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={startVoiceRecording}
              aria-label="تسجيل رسالة صوتية"
              title="تسجيل رسالة صوتية"
              className="min-h-[44px] min-w-[44px] rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors shrink-0"
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="إرسال الرسالة"
              title="إرسال"
              className="btn-glass send-btn w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shrink-0 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5 -scale-x-100" />
            </button>
          </form>
        )}
      </footer>

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الصورة"
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="إغلاق المعاينة"
            className="absolute top-4 left-4 min-h-[44px] min-w-[44px] rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="معاينة الصورة المرفقة"
            referrerPolicy="no-referrer"
            className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {menuMsg && (() => {
        const m = menuMsg;
        const mine = m.senderId === currentUserId;
        const age = Date.now() - new Date(m.createdAt).getTime();
        const canEdit = mine && m.type === 'text' && age <= 15 * 60_000;
        const canDeleteAll = mine && age <= 48 * 3_600_000;
        const text = m.decrypted?.text;
        const close = () => {
          setMenuMsg(null);
          setConfirmAll(false);
        };
        const run = async (scope: 'me' | 'all') => {
          setMenuBusy(true);
          const err = await onDeleteMessage(m, scope);
          setMenuBusy(false);
          if (err) setMediaError(err);
          close();
        };
        const item = 'btn-glass btn-ghost w-full min-h-[48px] px-4 rounded-xl text-sm font-semibold flex items-center gap-3 justify-start';
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="خيارات الرسالة"
            className="modal-backdrop fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
            onClick={close}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="modal-card w-full sm:max-w-sm bg-white dark:bg-[var(--d-surface)] rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] border border-[var(--glass-border)] p-3 space-y-2"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {confirmAll ? (
                <>
                  <p className="px-2 py-2 text-sm text-slate-800 dark:text-slate-100 leading-relaxed">
                    سيُمسح محتوى هذه الرسالة عند جميع الأعضاء ولا يمكن التراجع عن ذلك. هل تريد المتابعة؟
                  </p>
                  <button type="button" disabled={menuBusy} onClick={() => run('all')} className="btn-glass btn-danger w-full min-h-[48px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    <span>{menuBusy ? 'جارٍ الحذف...' : 'نعم، احذف للجميع'}</span>
                  </button>
                  <button type="button" onClick={() => setConfirmAll(false)} className="btn-glass btn-ghost w-full min-h-[48px] rounded-xl text-sm font-semibold">
                    رجوع
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={item}
                    onClick={() => {
                      setEditing(null);
                      setReplyTo(m);
                      close();
                    }}
                  >
                    <Reply className="w-4 h-4" />
                    <span>رد</span>
                  </button>
                  {([
                    ['spam', 'إبلاغ: رسالة مزعجة'],
                    ['harassment', 'إبلاغ: مضايقة'],
                    ['other', 'إبلاغ: سبب آخر'],
                  ] as const).map(([reason, label]) => (
                    <button
                      key={reason}
                      type="button"
                      disabled={menuBusy}
                      className={item}
                      onClick={async () => {
                        setMenuBusy(true);
                        const err = await onReport(m, reason);
                        setMenuBusy(false);
                        setMediaError(err ?? 'تم إرسال البلاغ، شكراً لك');
                        close();
                      }}
                    >
                      <Flag className="w-4 h-4" />
                      <span>{label}</span>
                    </button>
                  ))}
                  {text && (
                    <button
                      type="button"
                      className={item}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(text);
                        } catch {
                          setMediaError('تعذر النسخ، انسخ النص يدوياً');
                        }
                        close();
                      }}
                    >
                      <Copy className="w-4 h-4" />
                      <span>نسخ النص</span>
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className={item}
                      onClick={() => {
                        setReplyTo(null);
                        setEditing(m);
                        setDraft(text ?? '');
                        close();
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                      <span>تعديل</span>
                    </button>
                  )}
                  <button type="button" disabled={menuBusy} className={item} onClick={() => run('me')}>
                    <Trash2 className="w-4 h-4" />
                    <span>حذف لي فقط</span>
                  </button>
                  {canDeleteAll && (
                    <button type="button" className="btn-glass btn-danger w-full min-h-[48px] px-4 rounded-xl text-sm font-semibold flex items-center gap-3 justify-start" onClick={() => setConfirmAll(true)}>
                      <Trash2 className="w-4 h-4" />
                      <span>حذف للجميع</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
    </main>
  );
};
