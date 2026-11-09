import React from 'react';

/** Round profile photo, falling back to the person's initials when there is no photo. */
export const Avatar: React.FC<{ src?: string; initials: string; size?: number; className?: string }> = ({
  src,
  initials,
  size = 20,
  className = '',
}) => (
  <div
    style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }}
    className={`rounded-full overflow-hidden shrink-0 bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold ${className}`}
  >
    {src ? <img src={src} alt="Profile photo" className="w-full h-full object-cover" /> : initials}
  </div>
);

/**
 * Crops an image file to a centred square and shrinks it to 256x256 JPEG,
 * so photos straight from a phone camera upload quickly.
 */
export async function prepareAvatar(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This file could not be read as an image. Use a JPG, PNG or WebP photo.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.9)
  );
}
