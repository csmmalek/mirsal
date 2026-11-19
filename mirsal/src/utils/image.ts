/** The largest centered square of a w x h image, or null when the image is empty. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } | null {
  if (!(w > 0) || !(h > 0)) return null;
  const side = Math.min(w, h);
  return { sx: (w - side) / 2, sy: (h - side) / 2, side };
}

/**
 * Crops a picked photo to a centered square, scales it down and encodes it as a small JPEG
 * data URL, so profile pictures stay tiny (a few tens of KB) whatever the camera produced.
 */
export function fileToAvatarDataUrl(file: File, size = 256, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('اختر ملف صورة'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const crop = centerSquare(img.naturalWidth, img.naturalHeight);
        if (!crop) throw new Error('empty');
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        reject(new Error('تعذر معالجة الصورة'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذر قراءة الصورة. جرّب صورة بصيغة JPG أو PNG.'));
    };
    img.src = url;
  });
}
