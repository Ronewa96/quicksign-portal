// Optional location for the signing record. The browser always asks the person first.

/** Where someone was when they opened, signed or declined (as stored by the server). */
export type LocationRecord =
  | { shared: true; latitude: number; longitude: number; accuracy: number; place?: string; source?: 'device' | 'network' }
  | { shared: false; reason: 'declined' | 'unavailable' | 'skipped' };

/** What the browser sends: coordinates, or why there are none. The server adds the place name. */
export type LocationAnswer =
  | { latitude: number; longitude: number; accuracy: number }
  | { shared: false; reason: 'declined' | 'unavailable' | 'skipped' }
  /** The person agreed, but the device couldn't find its position: the server estimates it from the internet address */
  | { approximate: true };

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

const supported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;

/** Whether the browser will give a location without asking ('granted'), refuse it, or needs to ask. */
export async function locationPermission(): Promise<PermissionStatus> {
  if (!supported()) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state as PermissionStatus;
  } catch {
    return 'prompt'; // Some browsers can't report it; asking still works
  }
}

/**
 * Asks for the current position. Resolves to "skipped" if the person neither allows nor blocks it
 * within `waitMs`, so nothing is ever held up by an unanswered browser prompt.
 */
export function requestLocation(waitMs = 20000): Promise<LocationAnswer> {
  if (!supported()) return Promise.resolve({ shared: false, reason: 'unavailable' });
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: LocationAnswer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(answer);
    };
    const timer = setTimeout(() => finish({ shared: false, reason: 'skipped' }), waitMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => finish({ shared: false, reason: err.code === err.PERMISSION_DENIED ? 'declined' : 'unavailable' }),
      // Wi-Fi level accuracy is enough for the record and much faster than waiting for GPS
      { enableHighAccuracy: false, timeout: Math.max(1000, waitMs - 500), maximumAge: 5 * 60_000 }
    );
  });
}

/** After someone agreed to share: if their device couldn't find its position, ask for an approximate one. */
export function withApproximate(answer: LocationAnswer): LocationAnswer {
  return 'shared' in answer && answer.shared === false && answer.reason === 'unavailable' ? { approximate: true } : answer;
}

/**
 * Location to attach when signing or declining. `consented` means the person already chose to share
 * (for example on opening the document). Otherwise nothing is looked up, and the reason is sent instead.
 */
export async function locationForAction(
  consented: boolean,
  fallback: 'declined' | 'unavailable' | 'skipped' = 'skipped'
): Promise<LocationAnswer> {
  const permission = await locationPermission();
  if (permission === 'granted') return withApproximate(await requestLocation(10000));
  if (consented) return { approximate: true };
  if (permission === 'unsupported') return { shared: false, reason: 'unavailable' };
  return { shared: false, reason: permission === 'denied' ? 'declined' : fallback };
}

export function formatLocation(location?: LocationRecord): string {
  if (!location) return 'Not recorded';
  if (!location.shared) {
    if (location.reason === 'unavailable') return 'Not available on this device';
    if (location.reason === 'declined') return 'Not shared (declined)';
    return 'Not shared';
  }
  if (location.source === 'network') {
    return `${location.place || `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`} · approximate (from internet address)`;
  }
  const coords = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (±${location.accuracy} m)`;
  return location.place ? `${location.place} · ${coords}` : coords;
}

/** OpenStreetMap link for a shared location. */
export function mapUrl(location?: LocationRecord): string | undefined {
  if (!location || !location.shared) return undefined;
  const { latitude: lat, longitude: lon } = location;
  const zoom = location.source === 'network' ? 11 : 16;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}
