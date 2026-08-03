import { stops, legs, getDefaultStops, getDefaultLegs, asset } from './journey.js';

const STORAGE_KEY = 'kem-places-v1';

const COLOR_CYCLE = ['#FF9F0A', '#248A3D', '#007AFF', '#34C759', '#FF6937', '#AF52DE', '#64D2FF', '#FFD60A'];

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function slugId(name) {
  const base = String(name || 'diem')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${base || 'diem'}-${Date.now().toString(36).slice(-4)}`;
}

/** Normalize a stop record after load / edit. */
export function normalizeStop(raw, index = 0) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const id = String(s.id || slugId(s.name)).trim() || `place-${index + 1}`;
  const photos = Array.isArray(s.photos)
    ? s.photos
        .filter((p) => p?.src)
        .map((p) => ({ src: String(p.src), caption: String(p.caption || '') }))
    : [];
  return {
    id,
    order: Number(s.order) || index + 1,
    day: String(s.day || '15/08'),
    time: String(s.time || '08:00'),
    role: String(s.role || 'Điểm dừng'),
    name: String(s.name || `Điểm ${index + 1}`),
    place: String(s.place || ''),
    blurb: String(s.blurb || ''),
    lat: Number(s.lat) || 21.0,
    lng: Number(s.lng) || 105.8,
    mapsUrl: String(s.mapsUrl || `https://www.google.com/maps?q=${Number(s.lat) || 21},${Number(s.lng) || 105.8}`),
    color: String(s.color || COLOR_CYCLE[index % COLOR_CYCLE.length]),
    category: s.category ? String(s.category) : undefined,
    rating: s.rating != null && s.rating !== '' ? Number(s.rating) : undefined,
    reviews: s.reviews != null && s.reviews !== '' ? Number(s.reviews) : undefined,
    price: s.price ? String(s.price) : undefined,
    address: s.address ? String(s.address) : undefined,
    hours: s.hours ? String(s.hours) : undefined,
    phone: s.phone ? String(s.phone) : undefined,
    photos,
  };
}

/** Sequential legs + return to first stop. */
export function legsFromStops(list) {
  const out = [];
  if (!list?.length) return out;
  for (let i = 0; i < list.length - 1; i += 1) {
    out.push({
      from: list[i].id,
      to: list[i + 1].id,
      label: `${list[i].name} → ${list[i + 1].name}`,
      longHaul: i === 0 && list.length >= 2,
    });
  }
  if (list.length >= 2) {
    const last = list[list.length - 1];
    const first = list[0];
    out.push({
      from: last.id,
      to: first.id,
      label: `Về · ${first.name}`,
      return: true,
      longHaul: true,
    });
  }
  return out;
}

function replaceArray(target, next) {
  target.splice(0, target.length, ...next);
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        stops: stops.map((s) => deepClone(s)),
      })
    );
  } catch (err) {
    console.warn('Không lưu được địa điểm', err);
  }
}

function applyList(list) {
  const normalized = list.map((s, i) => normalizeStop(s, i));
  normalized.forEach((s, i) => {
    s.order = i + 1;
  });
  replaceArray(stops, normalized);
  replaceArray(legs, legsFromStops(normalized));
  return normalized;
}

/** Load saved places into live `stops` / `legs` arrays. */
export function hydratePlaces() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fromStorage: false, count: stops.length };
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.stops) || !data.stops.length) {
      return { fromStorage: false, count: stops.length };
    }
    applyList(data.stops);
    return { fromStorage: true, count: stops.length };
  } catch {
    return { fromStorage: false, count: stops.length };
  }
}

export function savePlaces() {
  persist();
  return stops;
}

export function resetPlaces() {
  applyList(getDefaultStops());
  // restore default legs shape (overnight hop) when possible
  const defLegs = getDefaultLegs();
  if (defLegs.length && stops.length === getDefaultStops().length) {
    replaceArray(legs, deepClone(defLegs));
  }
  persist();
  return stops;
}

export function listPlaces() {
  return stops;
}

export function getPlace(id) {
  return stops.find((s) => s.id === id) || null;
}

export function upsertPlace(partial, { insertIndex } = {}) {
  const existing = partial.id ? stops.findIndex((s) => s.id === partial.id) : -1;
  if (existing >= 0) {
    const merged = normalizeStop({ ...stops[existing], ...partial }, existing);
    merged.order = existing + 1;
    stops[existing] = merged;
  } else {
    const idx = insertIndex != null ? insertIndex : stops.length;
    const created = normalizeStop(
      {
        ...partial,
        id: partial.id || slugId(partial.name),
        color: partial.color || COLOR_CYCLE[idx % COLOR_CYCLE.length],
        photos: partial.photos?.length
          ? partial.photos
          : [{ src: asset('photos/xuat-phat/1.jpg'), caption: partial.name || 'Điểm mới' }],
      },
      idx
    );
    stops.splice(idx, 0, created);
  }
  stops.forEach((s, i) => {
    s.order = i + 1;
  });
  replaceArray(legs, legsFromStops(stops));
  persist();
  return stops;
}

export function removePlace(id) {
  if (stops.length <= 1) return { ok: false, error: 'Cần ít nhất 1 điểm' };
  const idx = stops.findIndex((s) => s.id === id);
  if (idx < 0) return { ok: false, error: 'Không tìm thấy điểm' };
  stops.splice(idx, 1);
  stops.forEach((s, i) => {
    s.order = i + 1;
  });
  replaceArray(legs, legsFromStops(stops));
  persist();
  return { ok: true, stops };
}

export function movePlace(id, dir) {
  const idx = stops.findIndex((s) => s.id === id);
  if (idx < 0) return stops;
  const j = idx + dir;
  if (j < 0 || j >= stops.length) return stops;
  const tmp = stops[idx];
  stops[idx] = stops[j];
  stops[j] = tmp;
  stops.forEach((s, i) => {
    s.order = i + 1;
  });
  replaceArray(legs, legsFromStops(stops));
  persist();
  return stops;
}

export { COLOR_CYCLE, STORAGE_KEY };
