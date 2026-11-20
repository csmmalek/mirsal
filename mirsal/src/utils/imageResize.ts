/** تصغير صورة إلى JPEG بعد قراءتها في المتصفح. يرمي Error('bad') إن تعذّرت القراءة و Error('too large') إن لم يمكن بلوغ الحجم المطلوب. */
export function resizeImage(file: File, opts: { maxSide: number; maxChars: number; square?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return reject(new Error('bad'));
      const side = opts.square ? Math.min(w, h) : 0;
      const srcW = opts.square ? side : w;
      const srcH = opts.square ? side : h;
      const sx = opts.square ? (w - side) / 2 : 0;
      const sy = opts.square ? (h - side) / 2 : 0;
      for (const scale of [1, 0.8, 0.65, 0.5]) {
        const ratio = Math.min(1, (opts.maxSide * scale) / Math.max(srcW, srcH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(srcW * ratio));
        canvas.height = Math.max(1, Math.round(srcH * ratio));
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('bad'));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, canvas.width, canvas.height);
        for (const q of [0.85, 0.7, 0.55]) {
          const out = canvas.toDataURL('image/jpeg', q);
          if (out.length <= opts.maxChars) return resolve(out);
        }
      }
      reject(new Error('too large'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad'));
    };
    img.src = url;
  });
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
