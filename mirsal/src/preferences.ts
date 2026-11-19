/** تفضيلات الواجهة المحفوظة على الجهاز (الإعدادات): نمط الأزرار وحجم الخط. */

export type ButtonStyle = 'glass' | 'solid' | 'outline';
export type FontScale = 'sm' | 'md' | 'lg';
export type ThemeMode = 'dark' | 'light' | 'auto';

export const PREF_KEYS = { button: 'mirsal_btn_style', font: 'mirsal_font_scale' } as const;

export const BUTTON_STYLES: { id: ButtonStyle; name: string }[] = [
  { id: 'glass', name: 'زجاجي' },
  { id: 'solid', name: 'ممتلئ' },
  { id: 'outline', name: 'محدّد' },
];

export const FONT_SCALES: { id: FontScale; name: string }[] = [
  { id: 'sm', name: 'صغير' },
  { id: 'md', name: 'متوسط' },
  { id: 'lg', name: 'كبير' },
];

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getButtonStyle(): ButtonStyle {
  return read(PREF_KEYS.button, ['glass', 'solid', 'outline'] as const, 'glass');
}

export function getFontScale(): FontScale {
  return read(PREF_KEYS.font, ['sm', 'md', 'lg'] as const, 'md');
}

export function applyButtonStyle(v: ButtonStyle): void {
  document.documentElement.dataset.btn = v;
  try {
    localStorage.setItem(PREF_KEYS.button, v);
  } catch {
    /* storage unavailable */
  }
}

export function applyFontScale(v: FontScale): void {
  document.documentElement.dataset.font = v;
  try {
    localStorage.setItem(PREF_KEYS.font, v);
  } catch {
    /* storage unavailable */
  }
}

/** يُستدعى عند الإقلاع لتطبيق التفضيلات المحفوظة قبل أول رسم. */
export function initPreferences(): void {
  document.documentElement.dataset.btn = getButtonStyle();
  document.documentElement.dataset.font = getFontScale();
}
