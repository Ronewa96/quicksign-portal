// Signatures are stored as SVG (vector) data URLs so they stay sharp at any size

export const SIGNATURE_INK = '#1e3a8a';

export const SIGNATURE_COLORS = [
  { name: 'Dark blue', value: SIGNATURE_INK },
  { name: 'Black', value: '#111827' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Red', value: '#b91c1c' },
  { name: 'Green', value: '#15803d' },
];

const COLOR_STORAGE_KEY = 'quicksign_signature_color';

/** The ink colour last chosen on this device. */
export function loadSignatureColor(): string {
  try {
    const saved = localStorage.getItem(COLOR_STORAGE_KEY);
    if (saved && /^#[0-9a-f]{6}$/i.test(saved)) return saved;
  } catch {}
  return SIGNATURE_INK;
}

export function saveSignatureColor(color: string) {
  try {
    localStorage.setItem(COLOR_STORAGE_KEY, color);
  } catch {}
}

export interface Point {
  x: number;
  y: number;
}

export interface TypedFont {
  family: string;
  size: number;
  style: 'normal' | 'italic';
  weight: number;
  uppercase?: boolean;
}

const escapeXml = (text: string) =>
  text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

const toDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const round = (n: number) => Math.round(n * 10) / 10;

/** Converts hand-drawn strokes to a smooth SVG path, cropped tightly around the ink. */
export function strokesToSignatureSvg(strokes: Point[][], color = SIGNATURE_INK, strokeWidth = 2.5): string | null {
  const points = strokes.flat();
  if (points.length === 0) return null;

  const pad = strokeWidth * 2;
  const minX = Math.min(...points.map((p) => p.x)) - pad;
  const minY = Math.min(...points.map((p) => p.y)) - pad;
  const width = Math.max(...points.map((p) => p.x)) - minX + pad;
  const height = Math.max(...points.map((p) => p.y)) - minY + pad;

  const paths = strokes
    .filter((s) => s.length > 0)
    .map((stroke) => {
      const pts = stroke.map((p) => ({ x: round(p.x - minX), y: round(p.y - minY) }));
      if (pts.length === 1) {
        // A single tap becomes a dot
        return `M${pts[0].x} ${pts[0].y}l0.1 0`;
      }
      // Quadratic curves through midpoints give a smooth line
      let d = `M${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = round((pts[i].x + pts[i + 1].x) / 2);
        const my = round((pts[i].y + pts[i + 1].y) / 2);
        d += `Q${pts[i].x} ${pts[i].y} ${mx} ${my}`;
      }
      const last = pts[pts.length - 1];
      return `${d}L${last.x} ${last.y}`;
    });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">` +
    `<path d="${paths.join('')}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return toDataUrl(svg);
}

/** Renders a typed name as an SVG signature with a thin baseline underneath. */
export function typedSignatureSvg(name: string, font: TypedFont, color = SIGNATURE_INK): string {
  const text = font.uppercase ? name.toUpperCase() : name;

  // Measure with the same font so the image is cropped to the text
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${font.style} ${font.weight} ${font.size}px ${font.family}`;
  const textWidth = Math.ceil(ctx.measureText(text).width);

  const padX = font.size * 0.6;
  const width = textWidth + padX * 2;
  const baseline = font.size * 1.15;
  const height = baseline + font.size * 0.7;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${round(height)}" viewBox="0 0 ${width} ${round(height)}">` +
    `<text x="${padX}" y="${round(baseline)}" font-family="${escapeXml(font.family)}" font-size="${font.size}" ` +
    `font-style="${font.style}" font-weight="${font.weight}" fill="${color}">${escapeXml(text)}</text>` +
    `<line x1="${padX * 0.6}" y1="${round(baseline + font.size * 0.35)}" x2="${width - padX * 0.6}" y2="${round(baseline + font.size * 0.35)}" ` +
    `stroke="${color}" stroke-opacity="0.35" stroke-width="1"/>` +
    `</svg>`;
  return toDataUrl(svg);
}
