import React, { useEffect, useRef, useState } from 'react';
import {
  Lock,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ActiveCallState } from '../types/chat';
import { formatCallDuration } from '../utils/messaging';

interface CallOverlayProps {
  call: ActiveCallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAcceptIncoming: () => void;
  onRejectIncoming: () => void;
  onEndCall: (durationSec: number) => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleSpeaker: () => void;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  call,
  localStream,
  remoteStream,
  onAcceptIncoming,
  onRejectIncoming,
  onEndCall,
  onToggleMute,
  onToggleCamera,
  onToggleSpeaker,
}) => {
  const [elapsedSec, setElapsedSec] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => undefined);
    }
  }, [remoteStream, call.kind, call.status]);

  useEffect(() => {
    if (call.status !== 'connected' || !call.startedAt) {
      setElapsedSec(0);
      return;
    }
    const update = () => {
      setElapsedSec(Math.floor((Date.now() - call.startedAt!) / 1000));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [call.status, call.startedAt]);

  const statusLabel =
    call.status === 'ringing' && call.direction === 'incoming'
      ? call.kind === 'video'
        ? 'مكالمة فيديو مشفرة واردة...'
        : 'مكالمة صوتية مشفرة واردة...'
      : call.status === 'ringing'
        ? 'جاري الرنين...'
        : call.status === 'connecting'
          ? 'جاري الاتصال...'
          : formatCallDuration(elapsedSec);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="نافذة المكالمة المشفرة"
      className="fixed inset-0 z-50 bg-[#0B1117]/95 backdrop-blur-md text-white flex flex-col justify-between p-6"
    >
      {/* Remote audio plays through a dedicated element (the video element is muted) */}
      <audio ref={remoteAudioRef} autoPlay muted={!call.speakerOn} />

      {/* Top Bar: Encryption verification */}
      <div className="flex items-center justify-between gap-4 max-w-4xl w-full mx-auto">
        <div className="flex items-center gap-2 text-xs text-emerald-300">
          <Lock className="w-4 h-4 shrink-0" />
          <span>مكالمة مشفرة طرف إلى طرف (DTLS-SRTP)</span>
        </div>
        <div className="text-xs font-mono text-slate-400 tabular-nums hidden sm:block">
          {call.fingerprint.slice(0, 23)}
        </div>
      </div>

      {/* Center Stage: Video streams or Avatar */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 max-w-4xl w-full mx-auto my-4 relative">
        {call.kind === 'video' && (remoteStream || localStream) ? (
          <div className="relative w-full max-w-3xl aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center space-y-3 p-6">
                <img
                  src={call.peerAvatar}
                  alt={call.peerName}
                  referrerPolicy="no-referrer"
                  className="w-24 h-24 rounded-full object-cover mx-auto border-2 border-emerald-500"
                />
                <p className="text-lg font-bold font-display">{call.peerName}</p>
                <p className="text-sm text-slate-400 tabular-nums">{statusLabel}</p>
              </div>
            )}

            {localStream && !call.cameraOff && (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-32 sm:w-44 aspect-video object-cover rounded-xl border border-slate-700 absolute bottom-4 left-4 bg-slate-950"
              />
            )}
          </div>
        ) : (
          <div className="text-center space-y-4">
            <div className="relative inline-block">
              <img
                src={call.peerAvatar}
                alt={call.peerName}
                referrerPolicy="no-referrer"
                className="w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover border-2 border-emerald-500/70 bg-slate-800"
              />
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold font-display">{call.peerName}</h2>
              <p className="text-sm text-emerald-300 tabular-nums">{statusLabel}</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-center gap-4 pb-4">
        {call.status === 'ringing' && call.direction === 'incoming' ? (
          <>
            <button
              type="button"
              onClick={onRejectIncoming}
              aria-label="رفض المكالمة"
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={onAcceptIncoming}
              aria-label="قبول المكالمة"
              className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition-colors"
            >
              <Phone className="w-6 h-6" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={call.muted ? 'إلغاء كتم الصوت' : 'كتم الميكروفون'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                call.muted ? 'bg-white text-slate-900' : 'bg-slate-800 hover:bg-slate-700 text-white'
              }`}
            >
              {call.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {call.kind === 'video' && (
              <button
                type="button"
                onClick={onToggleCamera}
                aria-label={call.cameraOff ? 'تشغيل الكاميرا' : 'إيقاف الكاميرا'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                  call.cameraOff ? 'bg-white text-slate-900' : 'bg-slate-800 hover:bg-slate-700 text-white'
                }`}
              >
                {call.cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
            )}

            <button
              type="button"
              onClick={onToggleSpeaker}
              aria-label={call.speakerOn ? 'كتم السماعة' : 'تشغيل مكبر الصوت'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                !call.speakerOn ? 'bg-white text-slate-900' : 'bg-slate-800 hover:bg-slate-700 text-white'
              }`}
            >
              {call.speakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={() => onEndCall(elapsedSec)}
              aria-label="إنهاء المكالمة"
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
