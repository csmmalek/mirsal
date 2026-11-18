export interface AppTheme {
  id: string;
  name: string;
  /** CSS used for the small preview card in the theme picker. */
  preview: string;
  accent: string;
}

export const THEMES: AppTheme[] = [
  { id: 'neon', name: 'نيون', accent: '#5d14db', preview: 'radial-gradient(circle at 80% 20%, #c4b5fd 0, #7c3aed 8%, transparent 10%), linear-gradient(180deg,#2a1a6b,#0F0B1F)' },
  { id: 'sky', name: 'السماء', accent: '#1267de', preview: 'radial-gradient(circle at 20% 20%, #bfdbfe 0, #3b82f6 8%, transparent 10%), linear-gradient(180deg,#1d4ed8,#08101F)' },
  { id: 'nature', name: 'الطبيعة', accent: '#30c07d', preview: 'radial-gradient(ellipse at 50% 0, #4ade80, transparent 60%), linear-gradient(180deg,#166534,#07140F)' },
  { id: 'night', name: 'الليلي', accent: '#3648ba', preview: 'radial-gradient(circle at 75% 25%, #e2e8f0 0, #6366f1 8%, transparent 10%), linear-gradient(180deg,#1e2a66,#070912)' },
  { id: 'pink', name: 'الوردي', accent: '#d51a78', preview: 'radial-gradient(ellipse at 50% 0, #f9a8d4, transparent 60%), linear-gradient(180deg,#be185d,#1A0B15)' },
  { id: 'gold', name: 'الذهبي', accent: '#e1a20e', preview: 'radial-gradient(ellipse at 50% 0, #fde047, transparent 60%), linear-gradient(180deg,#b45309,#14100A)' },
];

export const DEFAULT_THEME = 'neon';

export function applyTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.accent);
}
