import React from 'react';
import type { Diagram } from './questions';

const stroke = 'currentColor';
const label = { fontSize: 14, fontWeight: 700, fill: '#fbbf24', fontFamily: 'Cairo, sans-serif' } as const;

const StringCut = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <circle cx="140" cy="110" r="70" fill="none" stroke={stroke} strokeOpacity="0.25" strokeDasharray="4 6" />
    <circle cx="140" cy="110" r="4" fill={stroke} />
    <line x1="140" y1="110" x2="140" y2="40" stroke={stroke} strokeOpacity="0.4" strokeDasharray="3 3" />
    <circle cx="140" cy="40" r="9" fill="#38bdf8" />
    {/* أ: يكمل الانحناء */}
    <path d="M140 40 A70 70 0 0 1 200 70" fill="none" stroke="#f472b6" strokeWidth="2.5" />
    <text x="208" y="78" style={label}>أ</text>
    {/* ب: مماس */}
    <line x1="149" y1="40" x2="290" y2="40" stroke="#34d399" strokeWidth="2.5" />
    <text x="292" y="34" style={label}>ب</text>
    {/* ج: شعاعي */}
    <line x1="140" y1="31" x2="140" y2="0" stroke="#a78bfa" strokeWidth="2.5" />
    <text x="122" y="16" style={label}>ج</text>
    <path d="M90 60 a70 70 0 0 1 30 -18" fill="none" stroke={stroke} strokeOpacity="0.6" markerEnd="url(#arr)" />
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8z" fill={stroke} fillOpacity="0.6" />
      </marker>
    </defs>
    <text x="20" y="190" fontSize="11" fill={stroke} fillOpacity="0.5">اتجاه الدوران ↻ — الخيط ينقطع هنا</text>
  </svg>
);

const Projectiles = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <line x1="0" y1="185" x2="320" y2="185" stroke={stroke} strokeOpacity="0.4" />
    <rect x="20" y="40" width="40" height="145" fill={stroke} fillOpacity="0.08" />
    <rect x="50" y="34" width="30" height="8" rx="2" fill={stroke} fillOpacity="0.6" />
    <path d="M80 38 Q 200 45 270 185" fill="none" stroke="#f472b6" strokeWidth="2" strokeDasharray="5 5" />
    <line x1="84" y1="44" x2="84" y2="185" stroke="#38bdf8" strokeWidth="2" strokeDasharray="5 5" />
    <circle r="5" fill="#f472b6">
      <animateMotion dur="1.6s" repeatCount="indefinite" path="M80 38 Q 200 45 270 185" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.5 0 1 1" />
    </circle>
    <circle cx="84" r="5" fill="#38bdf8">
      <animate attributeName="cy" values="44;185" dur="1.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.5 0 1 1" />
    </circle>
  </svg>
);

const Bottle = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <line x1="0" y1="190" x2="320" y2="190" stroke={stroke} strokeOpacity="0.4" />
    <path d="M60 30 h50 v160 h-50z" fill="#38bdf8" fillOpacity="0.25" stroke={stroke} strokeOpacity="0.6" />
    <path d="M60 22 h50" stroke={stroke} strokeOpacity="0.6" />
    {[
      { y: 70, d: 'M110 70 Q 140 75 160 190', t: 'أ' },
      { y: 115, d: 'M110 115 Q 160 120 200 190', t: 'ب' },
      { y: 160, d: 'M110 160 Q 190 162 250 190', t: 'ج' },
    ].map((h) => (
      <g key={h.t}>
        <path d={h.d} fill="none" stroke="#38bdf8" strokeWidth="3" strokeDasharray="6 4">
          <animate attributeName="stroke-dashoffset" values="20;0" dur="0.6s" repeatCount="indefinite" />
        </path>
        <text x="40" y={h.y + 5} style={label}>{h.t}</text>
      </g>
    ))}
  </svg>
);

const Lever = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <line x1="0" y1="170" x2="320" y2="170" stroke={stroke} strokeOpacity="0.4" />
    <g>
      <animateTransform attributeName="transform" type="rotate" values="-6 100 140;4 100 140;-6 100 140" dur="3s" repeatCount="indefinite" />
      <line x1="40" y1="140" x2="300" y2="140" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" />
      <path d="M20 140 q-10 -40 20 -45 q30 -5 30 30 v15z" fill="#78716c" />
      <text x="28" y="125" fontSize="12" fill="#fff">100كغ</text>
      <line x1="300" y1="100" x2="300" y2="130" stroke="#f472b6" strokeWidth="3" markerEnd="url(#arrF)" />
    </g>
    <path d="M90 170 L100 140 L110 170z" fill={stroke} fillOpacity="0.7" />
    <text x="60" y="190" fontSize="12" fill={stroke} fillOpacity="0.7">1 م</text>
    <text x="190" y="190" fontSize="12" fill={stroke} fillOpacity="0.7">4 م</text>
    <text x="285" y="100" style={label}>F ?</text>
    <defs>
      <marker id="arrF" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8z" fill="#f472b6" />
      </marker>
    </defs>
  </svg>
);

const BalloonCar = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <line x1="0" y1="185" x2="320" y2="185" stroke={stroke} strokeOpacity="0.4" />
    <path d="M40 160 v-70 q0 -20 30 -30 h120 q40 0 60 40 h20 q10 0 10 15 v45z" fill={stroke} fillOpacity="0.08" stroke={stroke} strokeOpacity="0.5" />
    <circle cx="80" cy="168" r="16" fill={stroke} fillOpacity="0.6" />
    <circle cx="240" cy="168" r="16" fill={stroke} fillOpacity="0.6" />
    <line x1="150" y1="158" x2="150" y2="100" stroke={stroke} strokeOpacity="0.6" />
    <ellipse cx="150" cy="85" rx="16" ry="20" fill="#f472b6" />
    <line x1="200" y1="30" x2="290" y2="30" stroke="#fbbf24" strokeWidth="3" markerEnd="url(#arrA)" />
    <text x="215" y="20" style={label}>التسارع</text>
    <defs>
      <marker id="arrA" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8z" fill="#fbbf24" />
      </marker>
    </defs>
  </svg>
);

const Ramp = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <path d="M10 40 L310 180 L10 180z" fill={stroke} fillOpacity="0.08" stroke={stroke} strokeOpacity="0.5" />
    <g>
      <circle r="14" fill="#38bdf8" />
      <animateMotion dur="2.2s" repeatCount="indefinite" path="M30 30 L290 152" calcMode="spline" keyTimes="0;1" keySplines="0.5 0 1 1" />
    </g>
    <g>
      <circle r="14" fill="none" stroke="#f472b6" strokeWidth="4" />
      <animateMotion dur="2.6s" repeatCount="indefinite" path="M30 30 L290 152" calcMode="spline" keyTimes="0;1" keySplines="0.5 0 1 1" />
    </g>
    <text x="200" y="60" fontSize="12" fill="#38bdf8">مصمتة</text>
    <text x="200" y="80" fontSize="12" fill="#f472b6">حلقة</text>
  </svg>
);

const Ship = () => (
  <svg viewBox="0 0 320 200" className="w-full h-full">
    <path d="M30 40 v150 h260 v-150" fill="none" stroke={stroke} strokeOpacity="0.6" strokeWidth="2" />
    <rect x="32" y="100" width="256" height="88" fill="#38bdf8" fillOpacity="0.25">
      <animate attributeName="y" values="100;100;108;108;100" dur="4s" repeatCount="indefinite" />
      <animate attributeName="height" values="88;88;80;80;88" dur="4s" repeatCount="indefinite" />
    </rect>
    <line x1="32" y1="100" x2="288" y2="100" stroke="#38bdf8" strokeWidth="2">
      <animate attributeName="y1" values="100;100;108;108;100" dur="4s" repeatCount="indefinite" />
      <animate attributeName="y2" values="100;100;108;108;100" dur="4s" repeatCount="indefinite" />
    </line>
    <path d="M110 92 h100 l-15 22 h-70z" fill="#fbbf24" />
    <circle cx="160" r="11" fill="#78716c">
      <animate attributeName="cy" values="80;80;178;178;80" dur="4s" repeatCount="indefinite" />
    </circle>
    <text x="250" y="96" fontSize="11" fill={stroke} fillOpacity="0.7">المستوى؟</text>
  </svg>
);

const MAP: Record<Diagram, React.FC> = {
  'string-cut': StringCut,
  projectiles: Projectiles,
  bottle: Bottle,
  lever: Lever,
  'balloon-car': BalloonCar,
  ramp: Ramp,
  ship: Ship,
};

export const DiagramView: React.FC<{ type: Diagram }> = ({ type }) => {
  const C = MAP[type];
  return (
    <div dir="ltr" className="h-44 sm:h-52 w-full rounded-2xl bg-slate-900/60 border border-white/10 text-slate-200 p-2">
      <C />
    </div>
  );
};
