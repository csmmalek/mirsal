import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCheck,
  Download,
  FileText,
  Info,
  Lock,
  Mic,
  Paperclip,
  Phone,
  PhoneCall,
  Reply,
  Send,
  Smile,
  Square,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { Conversation, DecryptedMessagePayload, Message, MessageType } from '../types/chat';
import { canSendDraft, formatArabicTime, formatCallDuration } from '../utils/messaging';

interface ChatWorkspaceProps {
  conversation: Conversation | null;
  messages: Message[];
  currentUserId: string;
  typingUsers: string[];
  onBackMobile: () => void;
  onSendMessage: (type: MessageType, payload: DecryptedMessagePayload) => Promise<void>;
  onRetry?: (messageId: string) => void;
  onTyping: (isTyping: boolean) => void;
  onStartCall: (kind: 'audio' | 'video') => void;
  onOpenChatInfo: () => void;
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
  onRetry,
  onTyping,
  onStartCall,
  onOpenChatInfo,
}) => {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setMediaError(null);
    setReplyTo(null);
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

  /** Sends and reports failure to the person instead of leaving an unhandled rejection. */
  const sendOrReport = async (type: MessageType, payload: DecryptedMessagePayload): Promise<boolean> => {
    try {
      await onSendMessage(type, payload);
      return true;
    } catch {
      setMediaError('تعذر إرسال الرسالة. تحقق من الاتصال ثم حاول مرة أخرى.');
      return false;
    }
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    onTyping(val.trim().length > 0);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => onTyping(false), 1800);
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!canSendDraft(draft, sending)) return;
    const quoted = replyTo;
    setSending(true);
    setMediaError(null);
    setDraft('');
    onTyping(false);
    setShowEmojiPicker(false);
    const payload: DecryptedMessagePayload = { text };
    if (quoted) {
      payload.replyToId = quoted.id;
      payload.replyPreview = quoted.decrypted?.text || 'وسائط مشفرة';
      setReplyTo(null);
    }
    try {
      await onSendMessage('text', payload);
    } catch {
      // Keep what the person wrote so nothing is lost; they can press send again.
      setDraft(text);
      setReplyTo(quoted);
      setMediaError('تعذر إرسال الرسالة. تحقق من الاتصال ثم اضغط إرسال مرة أخرى.');
    } finally {
      setSending(false);
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
        const sent = await sendOrReport('image', {
          text: draft.trim() || undefined,
          mediaUrl: dataUrl,
          mediaName: file.name,
          mediaSize: file.size,
          mimeType: file.type,
        });
        if (sent) setDraft('');
      } else if (file.type.startsWith('audio/')) {
        await sendOrReport('audio', {
          mediaUrl: dataUrl,
          mediaName: file.name,
          mediaSize: file.size,
          mimeType: file.type,
        });
      } else {
        await sendOrReport('file', {
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
          await sendOrReport('audio', {
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
                className="w-10 h-10 rounded-full object-cover bg-slate-200 dark:bg-slate-800 shrink-0"
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
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3" data-testid="message-stream">
        <div className="max-w-lg mx-auto px-4 py-2 rounded-xl bg-white/80 dark:bg-[var(--d-surface)]/90 border border-slate-200/80 dark:border-slate-800 text-center text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
          <Lock className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>الرسائل والمكالمات مشفرة طرف إلى طرف عبر AES-256-GCM</span>
        </div>

        {messages.map((msg) => {
          const isMine = msg.senderId === currentUserId;
          const d = msg.decrypted ?? { text: 'جاري فك التشفير...' };

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMine ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`group relative max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  isMine
                    ? 'bg-[var(--accent)] text-white rounded-tr-sm'
                    : 'bg-white dark:bg-[var(--d-surface2)] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-tl-sm'
                }`}
              >
                {conversation.type === 'group' && !isMine && msg.senderName && (
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
                    isMine ? 'text-emerald-100/90' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setReplyTo(msg)}
                    aria-label="الرد على هذه الرسالة"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:underline"
                  >
                    <Reply className="w-3.5 h-3.5" />
                  </button>
                  <span>{formatArabicTime(msg.createdAt)}</span>
                  {isMine && (
                    <span>
                      {msg.status === 'failed' ? (
                        <button
                          type="button"
                          onClick={() => onRetry?.(msg.id)}
                          className="text-red-200 font-semibold underline underline-offset-2"
                        >
                          فشل الإرسال، اضغط لإعادة المحاولة
                        </button>
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
          );
        })}
        <div ref={streamEndRef} />
      </div>

      {/* Composer */}
      <footer className="bg-white dark:bg-[var(--d-surface)] border-t border-slate-200 dark:border-slate-800 px-3 sm:px-4 py-3 shrink-0">
        {mediaError && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{mediaError}</span>
            <button type="button" onClick={() => setMediaError(null)} aria-label="إغلاق التنبيه">
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
                className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => stopVoiceRecording(false)}
                className="min-h-[40px] px-3.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Square className="w-3.5 h-3.5" />
                <span>إرسال الصوت</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendText} className="flex items-center gap-2">
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
              placeholder="اكتب رسالة مشفرة..."
              aria-label="كتابة رسالة مشفرة"
              enterKeyHint="send"
              className="flex-1 min-h-[44px] px-5 py-2 rounded-full bg-slate-100 dark:bg-[var(--d-bg)] border border-transparent focus:border-emerald-600 focus:bg-white dark:focus:bg-[var(--d-surface2)] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none transition-colors"
            />
            <button
              type="button"
              onClick={startVoiceRecording}
              aria-label="تسجيل رسالة صوتية"
              title="تسجيل رسالة صوتية"
              className="voice-btn text-slate-700 dark:text-slate-200"
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              type="submit"
              disabled={!canSendDraft(draft, sending)}
              aria-label="إرسال الرسالة"
              title="إرسال"
              className="send-orb"
            >
              {sending ? <span className="send-orb__spin" aria-hidden="true" /> : <Send className="w-5 h-5 send-orb__icon" />}
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
    </main>
  );
};
