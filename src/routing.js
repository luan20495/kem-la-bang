import { stops, legs } from './journey.js';

const byId = Object.fromEntries(stops.map((s) => [s.id, s]));

/** Live via probes when baked corridors are unavailable. */
const LEG_VIAS = {
  'xuat-phat>nghi-duong': [
    {
      tag: 'Thông thoáng',
      points: [
        { lng: 105.8835, lat: 20.9678 }, // Thanh Trì — tránh nội đô
        { lng: 105.92, lat: 21.08 },
      ],
    },
    {
      tag: 'Cao tốc',
      points: [
        { lng: 105.8698, lat: 21.002 }, // Vĩnh Tuy
        { lng: 105.895, lat: 21.02 },
        { lng: 105.938, lat: 21.118 }, // CT07
      ],
    },
  ],
  'mua-qua>xuat-phat': [
    {
      tag: 'Thông thoáng',
      points: [
        { lng: 105.92, lat: 21.08 },
        { lng: 105.8835, lat: 20.9678 },
      ],
    },
    {
      tag: 'Cao tốc',
      points: [
        { lng: 105.938, lat: 21.118 },
        { lng: 105.895, lat: 21.02 },
        { lng: 105.8698, lat: 21.002 },
      ],
    },
  ],
};

/** Soft default — thông thoáng matches the trip vibe; user can switch. */
const DEFAULT_CORRIDOR = 'Thông thoáng';

const CORRIDOR_BLURB = {
  'Nhanh nhất': 'Ngắn nhất · tới nơi sớm nhất',
  'Thông thoáng': 'Ít kẹt · đường rộng, chạy êm',
  'Cao tốc': 'Bám CT07 · ưu tiên cao tốc',
};

function formatKm(meters) {
  return `${(meters / 1000).toFixed(0)} km`;
}

function formatMins(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}g ${r}p` : `${h} giờ`;
}

async function fetchOsrmOnce(coords) {
  const path = coords.map((c) => `${c.lng},${c.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&alternatives=true&steps=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('OSRM failed');
    const data = await res.json();
    if (!data.routes?.length) throw new Error('No route');
    return data.routes.map((route) => ({
      coordinates: route.geometry.coordinates,
      distance: route.distance,
      duration: route.duration,
    }));
  } finally {
    clearTimeout(timer);
  }
}

/** Pin exact stop points onto the polyline so access spurs are always drawn. */
function pinStops(coordinates, from, to) {
  if (!coordinates?.length) return coordinates;
  const start = [from.lng, from.lat];
  const end = [to.lng, to.lat];
  const out = coordinates.map((c) => [c[0], c[1]]);
  if (haversine(start, out[0]) > 12) out.unshift(start);
  else out[0] = start;
  if (haversine(end, out[out.length - 1]) > 12) out.push(end);
  else out[out.length - 1] = end;
  return out;
}

function fallbackCurve(from, to, steps = 80) {
  const coordinates = [];
  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const bend = 0.14;
  const cx = midLng - dy * bend;
  const cy = midLat + dx * bend;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const lat = u * u * from.lat + 2 * u * t * cy + t * t * to.lat;
    const lng = u * u * from.lng + 2 * u * t * cx + t * t * to.lng;
    coordinates.push([lng, lat]);
  }
  const distance = haversine([from.lng, from.lat], [to.lng, to.lat]);
  return {
    coordinates,
    distance,
    duration: distance / 16,
  };
}

function routeKey(r) {
  return `${Math.round(r.distance / 800)}-${Math.round(r.duration / 120)}`;
}

function dedupeRoutes(list) {
  const seenTag = new Set();
  const seenGeom = new Set();
  const out = [];
  for (const r of list) {
    if (r.tag) {
      if (seenTag.has(r.tag)) continue;
      seenTag.add(r.tag);
    } else {
      const k = routeKey(r);
      if (seenGeom.has(k)) continue;
      seenGeom.add(k);
    }
    out.push(r);
  }
  return out;
}

function labelAlternatives(routes) {
  const byDuration = [...routes].sort((a, b) => a.duration - b.duration);
  const fastest = byDuration[0];

  return routes.map((r, i) => {
    let tag = r.tag || `Tuyến ${i + 1}`;
    if (r.preserveTag && r.tag) tag = r.tag;
    else if (!r.tag && r === fastest) tag = 'Nhanh nhất';
    else if (r.tag) tag = r.tag;
    return {
      ...r,
      id: i,
      tag,
      label: `${tag} · ${formatKm(r.distance)} · ${formatMins(r.duration)}`,
      kmLabel: formatKm(r.distance),
      timeLabel: formatMins(r.duration),
    };
  });
}

function assetUrl(path) {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${String(path).replace(/^\//, '')}`;
}

async function loadBakedIndex() {
  try {
    const res = await fetch(assetUrl('routes/index.json'));
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function loadBakedFile(path) {
  try {
    const res = await fetch(assetUrl(path));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.coordinates?.length) return null;
    return {
      coordinates: data.coordinates,
      distance: data.distance,
      duration: data.duration,
      tag: data.tag,
      preserveTag: true,
      source: data.source || 'baked-corridor',
    };
  } catch {
    return null;
  }
}

/** Load every named corridor for a leg (go or back). */
async function loadAllBakedCorridors(legKey) {
  const index = await loadBakedIndex();
  if (!index?.corridors?.length) return [];
  const isReturn = legKey.startsWith('mua-qua>');
  const out = [];
  for (const item of index.corridors) {
    const path = isReturn ? item.back : item.go;
    const baked = await loadBakedFile(path);
    if (baked) out.push(baked);
  }
  return out;
}

export async function fetchLegAlternatives(from, to, legKey) {
  const collected = [];

  // 1) All precomputed corridors (user picks later)
  const baked = await loadAllBakedCorridors(legKey);
  collected.push(...baked);

  // 2) Live OSRM direct as Nhanh nhất (if not already baked)
  if (!collected.some((r) => r.tag === 'Nhanh nhất')) {
    try {
      const direct = await fetchOsrmOnce([from, to]);
      if (direct[0]) {
        collected.push({
          ...direct[0],
          tag: 'Nhanh nhất',
          preserveTag: true,
          source: 'osrm-direct',
        });
      }
    } catch {
      /* continue */
    }
  }

  const vias = LEG_VIAS[legKey] || [];
  for (const via of vias) {
    if (collected.some((r) => r.tag === via.tag)) continue;
    try {
      const mids = via.points || [{ lng: via.lng, lat: via.lat }];
      const viaRoutes = await fetchOsrmOnce([from, ...mids, to]);
      if (viaRoutes[0]) {
        collected.push({
          ...viaRoutes[0],
          tag: via.tag,
          preserveTag: true,
          source: 'osrm-via',
        });
      }
    } catch {
      /* skip */
    }
  }

  let unique = dedupeRoutes(collected);
  if (!unique.length) {
    unique = [fallbackCurve(from, to)];
  }

  // Fixed menu order: Nhanh nhất → Thông thoáng → Cao tốc
  const order = ['Nhanh nhất', 'Thông thoáng', 'Cao tốc'];
  unique.sort((a, b) => {
    const ia = order.indexOf(a.tag);
    const ib = order.indexOf(b.tag);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.duration - b.duration;
  });
  // Keep only the three named styles (+ any leftover only if missing)
  unique = unique.filter((r) => order.includes(r.tag)).slice(0, 3);
  if (!unique.length) {
    unique = [fallbackCurve(from, to)];
  }

  unique = unique.map((r) => ({
    ...r,
    coordinates: pinStops(r.coordinates, from, to),
  }));
  return labelAlternatives(unique);
}

export async function buildAllLegs() {
  const built = [];
  for (const leg of legs) {
    const from = byId[leg.from];
    const to = byId[leg.to];
    const legKey = `${leg.from}>${leg.to}`;
    try {
      const alternatives = await fetchLegAlternatives(from, to, legKey);
      const preferIdx = alternatives.findIndex((a) => a.tag === DEFAULT_CORRIDOR);
      const selected = preferIdx >= 0 ? preferIdx : 0;
      const chosen = alternatives[selected];
      built.push({
        ...leg,
        alternatives,
        selected,
        coordinates: chosen.coordinates,
        distance: chosen.distance,
        duration: chosen.duration,
      });
    } catch {
      const fb = fallbackCurve(from, to);
      fb.coordinates = pinStops(fb.coordinates, from, to);
      const alternatives = labelAlternatives([{ ...fb, preserveTag: true, tag: 'Dự phòng' }]);
      built.push({
        ...leg,
        alternatives,
        selected: 0,
        ...fb,
      });
    }
  }
  return built;
}

/** Apply selected alternative index onto a leg (mutates). */
export function selectLegAlternative(leg, index) {
  const alt = leg.alternatives?.[index];
  if (!alt) return leg;
  leg.selected = index;
  leg.coordinates = alt.coordinates;
  leg.distance = alt.distance;
  leg.duration = alt.duration;
  return leg;
}

/** Flatten legs into one cinema path + cumulative distances. */
export function buildCinemaPath(builtLegs) {
  const coordinates = [];
  const stopHits = [];

  builtLegs.forEach((leg, legIndex) => {
    const coords = leg.coordinates;
    coords.forEach((c, i) => {
      if (legIndex > 0 && i === 0) return;
      coordinates.push(c);
    });
    stopHits.push({
      id: leg.to,
      index: coordinates.length - 1,
      return: !!leg.return,
    });
  });

  stopHits.unshift({ id: builtLegs[0].from, index: 0, return: false });

  const lengths = [0];
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversine(coordinates[i - 1], coordinates[i]);
    lengths.push(total);
  }

  return { coordinates, lengths, total, stopHits };
}

export function pointAlongPath(path, t) {
  const target = Math.max(0, Math.min(1, t)) * path.total;
  let i = 1;
  while (i < path.lengths.length && path.lengths[i] < target) i++;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(path.coordinates.length - 1, i);
  const seg = path.lengths[i1] - path.lengths[i0] || 1;
  const local = (target - path.lengths[i0]) / seg;
  const a = path.coordinates[i0];
  const b = path.coordinates[i1];
  const lng = a[0] + (b[0] - a[0]) * local;
  const lat = a[1] + (b[1] - a[1]) * local;
  const bearing = computeBearing(a, b);
  return { lng, lat, bearing, index: i0 };
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function computeBearing(a, b) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * toDeg) + 360) % 360;
}

export { byId, formatKm, formatMins, DEFAULT_CORRIDOR, CORRIDOR_BLURB };
