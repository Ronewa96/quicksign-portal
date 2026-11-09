import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks an element's content width so layouts can scale to fit any screen.
 * Returns a callback ref (works even when the element mounts later) and the current width.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [(el: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const ref = useCallback((el: T | null) => setElement(el), []);
  return [ref, width];
}

/**
 * Scale that fits a fixed-width page into the available width (never larger than 100%),
 * multiplied by the user's zoom level.
 */
export function fitScale(availableWidth: number, pageWidth: number, zoom = 1): number {
  if (availableWidth <= 0) return zoom;
  return Math.min(1, availableWidth / pageWidth) * zoom;
}
