export interface Wallpaper {
  id: string;
  name: string;
  css: string;
}

/** Used until the server list loads, or if it is empty or unreachable. */
export const FALLBACK_WALLPAPERS: Wallpaper[] = [
  {
    id: 'aurora',
    name: 'الشفق',
    css: 'radial-gradient(circle at 20% 20%, rgba(94,234,212,.45), transparent 45%), radial-gradient(circle at 80% 70%, rgba(168,85,247,.5), transparent 50%), linear-gradient(160deg,#0f172a,#1e1b4b)',
  },
  {
    id: 'sunset',
    name: 'الغروب',
    css: 'radial-gradient(circle at 50% 110%, rgba(251,146,60,.6), transparent 55%), linear-gradient(180deg,#312e81 0%,#9d174d 70%,#7c2d12 100%)',
  },
  {
    id: 'mist',
    name: 'الضباب',
    css: 'radial-gradient(ellipse at 30% 0%, rgba(255,255,255,.18), transparent 60%), linear-gradient(180deg,#334155,#0b1120)',
  },
];

const WALLPAPER_KEY = 'mirsal.wallpaper';
let wallpapers: Wallpaper[] = FALLBACK_WALLPAPERS;

export function getWallpapers(): Wallpaper[] {
  return wallpapers;
}

export function currentWallpaper(): string {
  try {
    return localStorage.getItem(WALLPAPER_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Applies a wallpaper by id ('' means the theme's default). Saved per device. */
export function applyWallpaper(id: string): void {
  const value = id && wallpapers.some((w) => w.id === id) ? id : '';
  document.documentElement.dataset.wallpaper = value;
  try {
    if (value) localStorage.setItem(WALLPAPER_KEY, value);
    else localStorage.removeItem(WALLPAPER_KEY);
  } catch {
    /* storage blocked: the choice lasts for this session only */
  }
}

function render(list: Wallpaper[]): void {
  let el = document.getElementById('mirsal-wallpapers') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'mirsal-wallpapers';
    document.head.appendChild(el);
  }
  // Ids are validated by the server (a-z, 0-9, dash), so they are safe inside a selector.
  el.textContent = list
    .map((w) => `html.dark[data-wallpaper="${w.id}"] .chat-wallpaper { background-image: ${w.css} !important; }`)
    .join('\n');
}

/** Loads the wallpapers managed from the developer panel. Never blocks the app. */
export async function initAppearance(): Promise<void> {
  render(wallpapers);
  applyWallpaper(currentWallpaper());
  try {
    const res = await fetch('/api/appearance');
    if (!res.ok) return;
    const data = (await res.json()) as { wallpapers?: Wallpaper[] };
    if (Array.isArray(data.wallpapers) && data.wallpapers.length > 0) {
      wallpapers = data.wallpapers;
      render(wallpapers);
      applyWallpaper(currentWallpaper());
    }
  } catch {
    /* offline: keep the fallback list */
  }
}
