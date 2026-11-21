import type { LocationRecord } from './db';

// Signer location for the audit trail. The browser asks the person first; sharing is always optional.
// Place names come from OpenStreetMap's free Nominatim service. When someone agrees to share but their
// device can't find its position, an approximate location is looked up from their internet address
// (ipwho.is, with geojs.io as a backup). Set LOCATION_LOOKUP="off" to send nothing to these services.

const LOOKUP_URL = 'https://nominatim.openstreetmap.org/reverse';
const LOOKUP_TIMEOUT_MS = 6000;
const MIN_GAP_MS = 1100; // Nominatim allows at most one request per second
const USER_AGENT = 'QuickSign-Portal/2.4 (document signing prototype)';

const placeCache = new Map<string, string | null>();
let queue: Promise<unknown> = Promise.resolve();
let lastLookup = 0;

const lookupEnabled = () => (process.env.LOCATION_LOOKUP || '').toLowerCase() !== 'off';

/** "Town, Province, Country" for a point, or undefined if the lookup is off, slow or fails. */
async function placeName(latitude: number, longitude: number): Promise<string | undefined> {
  if (!lookupEnabled()) return undefined;
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  if (placeCache.has(key)) return placeCache.get(key) ?? undefined;

  // One request at a time, spaced out, to respect the service's usage policy
  const run = queue.then(async () => {
    const wait = lastLookup + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastLookup = Date.now();
    const url = `${LOOKUP_URL}?format=jsonv2&zoom=12&addressdetails=1&lat=${latitude}&lon=${longitude}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Place lookup failed with status ${res.status}`);
    const data: any = await res.json();
    const a = data?.address || {};
    const parts = [a.city || a.town || a.village || a.suburb || a.municipality || a.county, a.state || a.region, a.country]
      .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      .filter((p, i, all) => all.indexOf(p) === i);
    const name = (parts.length ? parts.join(', ') : String(data?.display_name || '')).slice(0, 160);
    return name || null;
  });
  queue = run.catch(() => undefined);

  try {
    const name = await run;
    placeCache.set(key, name);
    return name ?? undefined;
  } catch (err: any) {
    console.warn('[QuickSign Location] Place name not available:', err?.message || err);
    return undefined; // Not cached, so a later request can try again
  }
}

// ---------- Approximate location from the internet address ----------

const networkCache = new Map<string, { at: number; value: LocationRecord | null }>();
const NETWORK_CACHE_MS = 60 * 60 * 1000;

/** Loopback and private addresses mean the person is on the same network as this server. */
function isPrivateAddress(ip: string) {
  const v = ip.replace(/^::ffff:/, '');
  return (
    v === '::1' || v === 'localhost' || /^127\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v) || /^169\.254\./.test(v) || /^f[cd]/i.test(v) || /^fe80/i.test(v)
  );
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json() as Promise<any>;
}

/**
 * Approximate (city-level) location for an internet address. For a private address the person is on
 * this server's own network, so the network's public address is used.
 */
async function networkLocation(ip: string): Promise<LocationRecord | null> {
  if (!lookupEnabled()) return null;
  const target = isPrivateAddress(ip) ? '' : ip.replace(/^::ffff:/, '');
  const key = target || 'this-network';
  const hit = networkCache.get(key);
  if (hit && Date.now() - hit.at < NETWORK_CACHE_MS) return hit.value;

  const sources = [
    async () => {
      const j = await fetchJson(`https://ipwho.is/${encodeURIComponent(target)}?fields=success,city,region,country,latitude,longitude`);
      if (j.success === false) throw new Error(j.message || 'not found');
      return { lat: j.latitude, lon: j.longitude, parts: [j.city, j.region, j.country] };
    },
    async () => {
      const j = await fetchJson(target ? `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(target)}.json` : 'https://get.geojs.io/v1/ip/geo.json');
      return { lat: j.latitude, lon: j.longitude, parts: [j.city, j.region, j.country] };
    },
  ];
  for (const source of sources) {
    try {
      const { lat, lon, parts } = await source();
      const latitude = Number(lat);
      const longitude = Number(lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const place = parts.filter((p: unknown): p is string => typeof p === 'string' && p.trim() !== '').join(', ');
      const value: LocationRecord = {
        shared: true,
        latitude: Math.round(latitude * 100) / 100,
        longitude: Math.round(longitude * 100) / 100,
        accuracy: 0,
        ...(place ? { place } : {}),
        source: 'network',
      };
      networkCache.set(key, { at: Date.now(), value });
      return value;
    } catch (err: any) {
      console.warn('[QuickSign Location] Approximate location lookup failed:', err?.message || err);
    }
  }
  return null;
}

const NOT_SHARED_REASONS = ['declined', 'unavailable', 'skipped'] as const;

/**
 * Checks location details sent by a browser and adds a place name.
 * Accepts { latitude, longitude, accuracy } or { shared: false, reason }.
 * Returns undefined when nothing usable was sent.
 */
export async function readLocation(input: unknown, clientIp = ''): Promise<LocationRecord | undefined> {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;

  // The person agreed to share, but their device couldn't find its position
  if (value.approximate === true) {
    return (await networkLocation(clientIp)) || { shared: false, reason: 'unavailable' };
  }

  if (value.shared === false) {
    const reason = NOT_SHARED_REASONS.find((r) => r === value.reason) || 'skipped';
    return { shared: false, reason };
  }

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }
  const accuracy = Number(value.accuracy);
  const point = {
    shared: true as const,
    latitude: Math.round(latitude * 1e5) / 1e5,
    longitude: Math.round(longitude * 1e5) / 1e5,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(Math.round(accuracy), 1_000_000) : 0,
    source: 'device' as const,
  };
  const place = await placeName(point.latitude, point.longitude);
  return place ? { ...point, place } : point;
}

/** Plain-text description for logs and audit details. */
export function describeLocation(location: LocationRecord | undefined): string {
  if (!location) return 'not recorded';
  if (!location.shared) {
    return location.reason === 'unavailable' ? 'not available on this device' : location.reason === 'declined' ? 'not shared (declined)' : 'not shared';
  }
  if (location.source === 'network') {
    return `${location.place || `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`} · approximate, from internet address`;
  }
  const coords = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (±${location.accuracy} m)`;
  return location.place ? `${location.place} · ${coords}` : coords;
}
