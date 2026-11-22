import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Atom, Brain, CheckCircle2, Clock, RotateCcw, Share2, Trophy, XCircle, Zap } from 'lucide-react';
import { DiagramView } from './Diagrams';
import {
  AnswerRecord,
  CATEGORY_LABELS,
  Category,
  Question,
  TIME_PER_QUESTION,
  buildRound,
  computeResult,
  iqLabel,
} from './questions';

const BEST_KEY = 'mirsal_iq_best';
const LETTERS = ['أ', 'ب', 'ج', 'د'];
const DIFF_LABEL = { 1: 'سهل', 2: 'متوسط', 3: 'صعب' } as const;

type Phase = 'intro' | 'play' | 'result';

function readBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export const IQGame: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [round, setRound] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [chosen, setChosen] = useState<number | null | undefined>(undefined); // undefined = لم يُجب بعد
  const [left, setLeft] = useState(TIME_PER_QUESTION);
  const [best, setBest] = useState<number | null>(readBest);
  const startedAt = useRef(0);

  const q = round[index];
  const revealed = chosen !== undefined;

  const start = () => {
    setRound(buildRound());
    setIndex(0);
    setRecords([]);
    setChosen(undefined);
    setLeft(TIME_PER_QUESTION);
    startedAt.current = performance.now();
    setPhase('play');
  };

  const answer = useCallback(
    (choice: number | null) => {
      if (!q || chosen !== undefined) return;
      const seconds = Math.min(TIME_PER_QUESTION, (performance.now() - startedAt.current) / 1000);
      setChosen(choice);
      setRecords((r) => [...r, { question: q, chosen: choice, seconds }]);
    },
    [q, chosen],
  );

  // المؤقت
  useEffect(() => {
    if (phase !== 'play' || revealed) return;
    const t = setInterval(() => {
      const remaining = TIME_PER_QUESTION - (performance.now() - startedAt.current) / 1000;
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) answer(null);
    }, 100);
    return () => clearInterval(t);
  }, [phase, revealed, answer]);

  const next = () => {
    if (index + 1 >= round.length) {
      setPhase('result');
      return;
    }
    setIndex((i) => i + 1);
    setChosen(undefined);
    setLeft(TIME_PER_QUESTION);
    startedAt.current = performance.now();
  };

  // اختصارات لوحة المفاتيح: 1-4 للإجابة، Enter للتالي
  useEffect(() => {
    if (phase !== 'play') return;
    const onKey = (e: KeyboardEvent) => {
      if (!revealed && /^[1-4]$/.test(e.key)) answer(Number(e.key) - 1);
      else if (revealed && e.key === 'Enter') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const result = useMemo(() => (phase === 'result' ? computeResult(records) : null), [phase, records]);

  useEffect(() => {
    if (!result) return;
    if (best === null || result.iq > best) {
      setBest(result.iq);
      try {
        localStorage.setItem(BEST_KEY, String(result.iq));
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <div className="min-h-dvh bg-[#070b14] text-slate-100 relative overflow-hidden">
      <Backdrop />
      <div className="relative max-w-2xl mx-auto px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between mb-6">
          <a href="/" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowRight className="w-4 h-4" /> مِرسال
          </a>
          {best !== null && (
            <span className="flex items-center gap-1.5 text-sm text-amber-300/90">
              <Trophy className="w-4 h-4" /> أفضل نتيجة: <b className="tabular-nums">{best}</b>
            </span>
          )}
        </header>

        {phase === 'intro' && <Intro onStart={start} />}

        {phase === 'play' && q && (
          <div key={q.id} className="iq-fade">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-slate-400">
                السؤال <b className="text-white tabular-nums">{index + 1}</b> / {round.length}
              </span>
              <span className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs text-slate-300">
                  {CATEGORY_LABELS[q.category]}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    q.difficulty === 1 ? 'bg-emerald-500/15 text-emerald-300' : q.difficulty === 2 ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {DIFF_LABEL[q.difficulty]}
                </span>
              </span>
            </div>

            {/* شريط التقدم */}
            <div className="h-1 rounded-full bg-white/5 mb-4 overflow-hidden">
              <div className="h-full bg-gradient-to-l from-cyan-400 to-violet-500 transition-all" style={{ width: `${(index / round.length) * 100}%` }} />
            </div>

            <div className="rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur p-5 sm:p-6 shadow-2xl">
              <div className="flex items-start gap-3 mb-4">
                <Timer left={left} paused={revealed} />
                <h2 className="text-lg sm:text-xl leading-relaxed font-bold flex-1">{q.text}</h2>
              </div>

              {q.diagram && (
                <div className="mb-4">
                  <DiagramView type={q.diagram} />
                </div>
              )}

              <div className="grid gap-2.5">
                {q.options.map((opt, i) => {
                  const isRight = i === q.answer;
                  const isChosen = i === chosen;
                  let cls = 'border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-cyan-400/40';
                  if (revealed) {
                    if (isRight) cls = 'border-emerald-400/60 bg-emerald-500/15';
                    else if (isChosen) cls = 'border-rose-400/60 bg-rose-500/15';
                    else cls = 'border-white/5 bg-white/[0.02] opacity-50';
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={revealed}
                      onClick={() => answer(i)}
                      className={`flex items-center gap-3 text-right rounded-2xl border px-4 py-3 transition-all ${cls} ${!revealed ? 'active:scale-[0.98]' : ''}`}
                    >
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold">{LETTERS[i]}</span>
                      <span className="flex-1">{opt}</span>
                      {revealed && isRight && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                      {revealed && isChosen && !isRight && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {revealed && (
                <div className="iq-fade mt-4 rounded-2xl bg-cyan-500/[0.07] border border-cyan-400/20 p-4">
                  <p className="font-bold mb-1">
                    {chosen === q.answer ? (
                      <span className="text-emerald-300">إجابة صحيحة!</span>
                    ) : chosen === null ? (
                      <span className="text-amber-300">انتهى الوقت</span>
                    ) : (
                      <span className="text-rose-300">إجابة خاطئة</span>
                    )}
                  </p>
                  <p className="text-sm text-slate-300 leading-relaxed">{q.explain}</p>
                  <button
                    type="button"
                    onClick={next}
                    autoFocus
                    className="mt-4 w-full rounded-xl bg-gradient-to-l from-cyan-500 to-violet-600 py-3 font-bold hover:brightness-110 transition"
                  >
                    {index + 1 >= round.length ? 'اعرض نتيجتي' : 'السؤال التالي'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'result' && result && <Result result={result} records={records} best={best} onRestart={start} />}
      </div>
    </div>
  );
};

const Backdrop = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0">
    <div className="absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-violet-600/20 blur-3xl" />
    <div className="absolute top-1/2 -left-40 w-[26rem] h-[26rem] rounded-full bg-cyan-500/15 blur-3xl" />
    <svg className="absolute inset-0 w-full h-full opacity-[0.07]">
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="white" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  </div>
);

const Intro: React.FC<{ onStart: () => void }> = ({ onStart }) => (
  <div className="iq-fade text-center pt-6">
    <div className="relative mx-auto w-28 h-28 mb-6">
      <div className="absolute inset-0 rounded-full border border-cyan-400/30 iq-orbit" />
      <div className="absolute inset-3 rounded-full border border-violet-400/30 iq-orbit-rev" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Atom className="w-12 h-12 text-cyan-300" />
      </div>
    </div>
    <h1 className="text-3xl sm:text-4xl font-bold mb-3 bg-gradient-to-l from-cyan-300 via-white to-violet-300 bg-clip-text text-transparent">
      اختبار الذكاء الفيزيائي
    </h1>
    <p className="text-slate-300 leading-relaxed max-w-md mx-auto mb-8">
      هل يفهم عقلك كيف يتصرف العالم الحقيقي؟ 15 سؤالاً في الحركة والجاذبية والموائع والحرارة والضوء والكهرباء، تتدرج من السهل إلى الصعب.
    </p>
    <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-8 text-sm">
      {[
        { icon: <Brain className="w-5 h-5" />, t: '15 سؤالاً' },
        { icon: <Clock className="w-5 h-5" />, t: `${TIME_PER_QUESTION} ثانية لكل سؤال` },
        { icon: <Zap className="w-5 h-5" />, t: 'السرعة تزيد نقاطك' },
      ].map((x) => (
        <div key={x.t} className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex flex-col items-center gap-1.5 text-slate-300">
          <span className="text-cyan-300">{x.icon}</span>
          {x.t}
        </div>
      ))}
    </div>
    <button
      type="button"
      onClick={onStart}
      className="rounded-2xl bg-gradient-to-l from-cyan-500 to-violet-600 px-10 py-4 text-lg font-bold shadow-[0_0_40px_-8px_rgba(56,189,248,0.6)] hover:brightness-110 active:scale-95 transition"
    >
      ابدأ الاختبار
    </button>
    <p className="text-xs text-slate-500 mt-6">للتسلية والتعلّم — النتيجة تقديرية وليست اختبار ذكاء معتمداً.</p>
  </div>
);

const Timer: React.FC<{ left: number; paused: boolean }> = ({ left, paused }) => {
  const r = 20;
  const c = 2 * Math.PI * r;
  const frac = left / TIME_PER_QUESTION;
  const color = frac > 0.5 ? '#22d3ee' : frac > 0.2 ? '#fbbf24' : '#f43f5e';
  return (
    <div className={`relative w-12 h-12 shrink-0 ${paused ? 'opacity-50' : ''}`}>
      <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset 0.1s linear' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">{Math.ceil(left)}</span>
    </div>
  );
};

const Result: React.FC<{
  result: ReturnType<typeof computeResult>;
  records: AnswerRecord[];
  best: number | null;
  onRestart: () => void;
}> = ({ result, records, best, onRestart }) => {
  const { title, note } = iqLabel(result.iq);
  const [shown, setShown] = useState(60);
  const [copied, setCopied] = useState(false);

  // عدّاد متحرك للنتيجة
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1400);
      setShown(Math.round(60 + (result.iq - 60) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.iq]);

  // موقع النتيجة على منحنى التوزيع الطبيعي (60 → 160)
  const pos = ((result.iq - 60) / 100) * 300;

  const share = async () => {
    const text = `حصلت على ${result.iq} في اختبار الذكاء الفيزيائي (${title}) — جرّبه: ${location.origin}/iq`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* أُلغيت المشاركة */
    }
  };

  const wrong = records.filter((r) => r.chosen !== r.question.answer);

  return (
    <div className="iq-fade">
      <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-6 text-center shadow-2xl">
        <p className="text-slate-400 text-sm mb-1">نسبة ذكائك الفيزيائي</p>
        <p className="text-7xl font-bold tabular-nums bg-gradient-to-b from-white to-cyan-300 bg-clip-text text-transparent">{shown}</p>
        <p className="text-xl font-bold mt-2 text-amber-300">{title}</p>
        <p className="text-slate-300 text-sm mt-1">{note}</p>
        {best !== null && best > result.iq && <p className="text-xs text-slate-500 mt-2">أفضل نتيجة لك: {best}</p>}

        {/* منحنى الجرس */}
        <div dir="ltr" className="mt-6">
          <svg viewBox="0 0 300 90" className="w-full">
            <defs>
              <linearGradient id="bell" x1="0" x2="1">
                <stop offset="0" stopColor="#f43f5e" />
                <stop offset="0.5" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
            <path
              d={
                'M0 80 ' +
                Array.from({ length: 61 }, (_, i) => {
                  const x = i * 5;
                  const iq = 60 + (x / 300) * 100;
                  const y = 80 - 70 * Math.exp(-Math.pow((iq - 100) / 15, 2) / 2);
                  return `L${x} ${y.toFixed(1)}`;
                }).join(' ') +
                ' L300 80Z'
              }
              fill="url(#bell)"
              fillOpacity="0.25"
              stroke="url(#bell)"
              strokeWidth="1.5"
            />
            <line x1={pos} x2={pos} y1="4" y2="80" stroke="#fbbf24" strokeWidth="2" strokeDasharray="3 3" />
            <circle cx={pos} cy="6" r="4" fill="#fbbf24" />
            {[70, 85, 100, 115, 130, 145].map((v) => (
              <text key={v} x={((v - 60) / 100) * 300} y="89" fontSize="8" fill="#94a3b8" textAnchor="middle">
                {v}
              </text>
            ))}
          </svg>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
          <div className="rounded-2xl bg-white/[0.04] p-3">
            <p className="text-slate-400">الإجابات الصحيحة</p>
            <p className="text-2xl font-bold tabular-nums">
              {result.correct}/{result.total}
            </p>
          </div>
          <div className="rounded-2xl bg-white/[0.04] p-3">
            <p className="text-slate-400">متوسط وقت الإجابة</p>
            <p className="text-2xl font-bold tabular-nums">
              {(records.reduce((s, r) => s + r.seconds, 0) / Math.max(1, records.length)).toFixed(1)}ث
            </p>
          </div>
        </div>
      </div>

      {/* الأداء حسب المجال */}
      <div className="rounded-3xl bg-white/[0.04] border border-white/10 p-5 mt-4">
        <h3 className="font-bold mb-3">أداؤك حسب المجال</h3>
        <div className="grid gap-2.5">
          {(Object.entries(result.byCat) as [Category, { right: number; total: number }][]).map(([cat, v]) => {
            const pct = (v.right / v.total) * 100;
            return (
              <div key={cat}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-300">{CATEGORY_LABELS[cat]}</span>
                  <span className="tabular-nums text-slate-400">
                    {v.right}/{v.total}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-rose-400'}`}
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {wrong.length > 0 && (
        <details className="rounded-3xl bg-white/[0.04] border border-white/10 p-5 mt-4">
          <summary className="font-bold cursor-pointer">راجع أخطاءك ({wrong.length})</summary>
          <div className="grid gap-3 mt-3">
            {wrong.map((r) => (
              <div key={r.question.id} className="text-sm border-t border-white/5 pt-3">
                <p className="font-medium mb-1">{r.question.text}</p>
                <p className="text-emerald-300">✓ {r.question.options[r.question.answer]}</p>
                <p className="text-slate-400 mt-1 leading-relaxed">{r.question.explain}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="grid grid-cols-2 gap-3 mt-5">
        <button
          type="button"
          onClick={onRestart}
          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-cyan-500 to-violet-600 py-3.5 font-bold hover:brightness-110 transition"
        >
          <RotateCcw className="w-4 h-4" /> أعد المحاولة
        </button>
        <button
          type="button"
          onClick={share}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.06] border border-white/10 py-3.5 font-bold hover:bg-white/10 transition"
        >
          <Share2 className="w-4 h-4" /> {copied ? 'تم النسخ!' : 'شارك نتيجتك'}
        </button>
      </div>
      <p className="text-xs text-slate-500 text-center mt-5">للتسلية والتعلّم — النتيجة تقديرية وليست اختبار ذكاء معتمداً.</p>
    </div>
  );
};
