import React from 'react';
import { Bell, BellOff, LogOut, Moon, Sun, SunMoon, UserRound, Volume2, VolumeX } from 'lucide-react';
import { ModalShell } from './SideModals';
import { THEMES } from '../themes';
import {
  BUTTON_STYLES,
  FONT_SCALES,
  ButtonStyle,
  FontScale,
  ThemeMode,
  applyButtonStyle,
  applyFontScale,
  getButtonStyle,
  getFontScale,
} from '../preferences';

interface SettingsModalProps {
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  colorTheme: string;
  onColorTheme: (id: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  browserPermission: NotificationPermission | 'unsupported';
  onRequestBrowserPermission: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  onClose: () => void;
}

const MODES: { id: ThemeMode; name: string; icon: React.ReactNode }[] = [
  { id: 'light', name: 'فاتح', icon: <Sun className="w-4 h-4" /> },
  { id: 'dark', name: 'داكن', icon: <Moon className="w-4 h-4" /> },
  { id: 'auto', name: 'تلقائي', icon: <SunMoon className="w-4 h-4" /> },
];

/** مجموعة أزرار اختيار: يُظهر الخيار المحدد بشريط الثيم نفسه. */
const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; name: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) => (
  <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
    {options.map((o) => {
      const active = o.id === value;
      return (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(o.id)}
          className={`btn-glass ${active ? '' : 'btn-ghost'} min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 px-2`}
        >
          {o.icon}
          <span>{o.name}</span>
        </button>
      );
    })}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="glass-panel p-4 space-y-3">
    <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300">{title}</h3>
    {children}
  </section>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  themeMode,
  onThemeMode,
  colorTheme,
  onColorTheme,
  soundEnabled,
  onToggleSound,
  browserPermission,
  onRequestBrowserPermission,
  onOpenProfile,
  onLogout,
  onClose,
}) => {
  const [btnStyle, setBtnStyle] = React.useState<ButtonStyle>(getButtonStyle);
  const [fontScale, setFontScale] = React.useState<FontScale>(getFontScale);

  return (
    <ModalShell title="الإعدادات" onClose={onClose} wide>
      <div className="space-y-4">
        <Section title="المظهر">
          <Segmented<ThemeMode> label="وضع العرض" value={themeMode} options={MODES} onChange={onThemeMode} />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            «تلقائي» يتبع إعداد الجهاز. ثيم «لؤلؤ» يعمل بالوضع الفاتح.
          </p>
        </Section>

        <Section title="الثيم">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {THEMES.map((t) => {
              const active = t.id === colorTheme;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onColorTheme(t.id)}
                  aria-pressed={active}
                  className={`btn-glass ${active ? '' : 'btn-ghost'} min-h-[56px] rounded-xl p-2 flex flex-col items-center justify-center gap-1 text-xs font-semibold`}
                >
                  <span className="w-6 h-6 rounded-full border border-white/60" style={{ background: t.accent }} />
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="نمط الأزرار">
          <Segmented<ButtonStyle>
            label="نمط الأزرار"
            value={btnStyle}
            options={BUTTON_STYLES}
            onChange={(v) => {
              setBtnStyle(v);
              applyButtonStyle(v);
            }}
          />
        </Section>

        <Section title="حجم الخط">
          <Segmented<FontScale>
            label="حجم الخط"
            value={fontScale}
            options={FONT_SCALES}
            onChange={(v) => {
              setFontScale(v);
              applyFontScale(v);
            }}
          />
        </Section>

        <Section title="الإشعارات والصوت">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onToggleSound} className={`btn-glass ${soundEnabled ? '' : 'btn-ghost'} min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5`}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span>{soundEnabled ? 'الصوت مفعّل' : 'الصوت متوقف'}</span>
            </button>
            {browserPermission === 'unsupported' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 self-center">المتصفح لا يدعم الإشعارات</p>
            ) : (
              <button
                type="button"
                onClick={onRequestBrowserPermission}
                disabled={browserPermission === 'granted'}
                className="btn-glass btn-ghost min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
              >
                {browserPermission === 'granted' ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                <span>{browserPermission === 'granted' ? 'الإشعارات مفعّلة' : 'تفعيل الإشعارات'}</span>
              </button>
            )}
          </div>
        </Section>

        <Section title="الحساب">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onOpenProfile} className="btn-glass btn-ghost min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
              <UserRound className="w-4 h-4" />
              <span>الملف الشخصي</span>
            </button>
            <button type="button" onClick={onLogout} className="btn-glass btn-danger min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </Section>
      </div>
    </ModalShell>
  );
};

