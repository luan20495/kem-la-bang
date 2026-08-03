/**
 * Timeline 0→1 mapped to trip clock + place.
 * Rebuilt when places are edited.
 */

import { stops } from './journey.js';

/** @typedef {{ t: number, day: string, clock: string, place: string, label: string, stopId?: string }} TimelineBeat */

function parseClock(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function replaceArray(target, next) {
  target.splice(0, target.length, ...next);
}

/** Classic default beats for the original Kẹm itinerary. */
const DEFAULT_TIMELINE = [
  {
    t: 0,
    day: '15/08',
    clock: '08:30',
    place: 'Southern Star',
    label: 'Tập trung & xuất phát',
    stopId: 'xuat-phat',
  },
  {
    t: 0.2,
    day: '15/08',
    clock: '10:40',
    place: 'Trên đường',
    label: 'Leo đèo · trời sáng rõ',
  },
  {
    t: 0.36,
    day: '15/08',
    clock: '12:30',
    place: 'Suối Kẹm Homestay',
    label: 'Nghỉ dưỡng · cá tầm',
    stopId: 'nghi-duong',
  },
  {
    t: 0.54,
    day: '15/08',
    clock: '16:00',
    place: 'Đợi Coffee',
    label: 'Trà chiều trên đồi',
    stopId: 'tra-chieu',
  },
  {
    t: 0.68,
    day: '15/08',
    clock: '21:00',
    place: 'Suối Kẹm Homestay',
    label: 'Đêm núi · nghỉ lại',
    stopId: 'nghi-duong',
  },
  {
    t: 0.84,
    day: '16/08',
    clock: '08:00',
    place: 'Matcha Lạc Yên',
    label: 'Mua quả khi ra về',
    stopId: 'mua-qua',
  },
  {
    t: 1,
    day: '16/08',
    clock: '11:30',
    place: 'Hà Nội',
    label: 'Về nhà trước trưa',
    stopId: 'xuat-phat',
  },
];

/** @type {TimelineBeat[]} */
export const TIMELINE = DEFAULT_TIMELINE.map((b) => ({ ...b }));

/** @type {TimelineBeat[]} */
export const SCRUB_STOPS = [];

/** Progress anchors when arriving at each stop during drive tour */
export const DRIVE_STOP_T = Object.create(null);

function isClassicKemTrip(list) {
  const ids = list.map((s) => s.id).join(',');
  return ids === 'xuat-phat,nghi-duong,tra-chieu,mua-qua';
}

function buildGenericTimeline(list) {
  const n = list.length;
  if (!n) {
    return [
      {
        t: 0,
        day: '15/08',
        clock: '08:00',
        place: 'Bắt đầu',
        label: 'Chưa có điểm',
      },
      {
        t: 1,
        day: '15/08',
        clock: '18:00',
        place: 'Kết thúc',
        label: 'Thêm điểm để đi',
      },
    ];
  }

  /** @type {TimelineBeat[]} */
  const beats = [];
  list.forEach((s, i) => {
    const t = n === 1 ? 0 : i / n;
    beats.push({
      t,
      day: s.day || '15/08',
      clock: parseClock(s.time) || '09:00',
      place: s.name,
      label: s.role || 'Điểm dừng',
      stopId: s.id,
    });
    if (i < n - 1) {
      const mid = n === 1 ? 0.5 : (i + 0.5) / n;
      beats.push({
        t: mid,
        day: s.day || '15/08',
        clock: parseClock(s.time) || '12:00',
        place: 'Trên đường',
        label: `Tới · ${list[i + 1].name}`,
      });
    }
  });
  const last = list[n - 1];
  const first = list[0];
  beats.push({
    t: 1,
    day: last.day || '16/08',
    clock: '12:00',
    place: first.name,
    label: `Về · ${first.name}`,
    stopId: first.id,
  });
  beats.sort((a, b) => a.t - b.t);
  return beats;
}

export function rebuildTimeline(list = stops) {
  const classic = isClassicKemTrip(list);
  const next = classic
    ? DEFAULT_TIMELINE.map((b) => ({ ...b }))
    : buildGenericTimeline(list);

  replaceArray(TIMELINE, next);

  const scrub = next.filter((b) => b.stopId);
  // unique by t
  const seen = new Set();
  const uniqueScrub = [];
  for (const b of scrub) {
    const key = `${b.t}:${b.stopId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueScrub.push(b);
  }
  replaceArray(SCRUB_STOPS, uniqueScrub);

  for (const k of Object.keys(DRIVE_STOP_T)) delete DRIVE_STOP_T[k];
  if (classic) {
    DRIVE_STOP_T['xuat-phat'] = 0;
    DRIVE_STOP_T['nghi-duong'] = 0.36;
    DRIVE_STOP_T['tra-chieu'] = 0.54;
    DRIVE_STOP_T['mua-qua'] = 0.84;
    DRIVE_STOP_T.home = 1;
  } else {
    list.forEach((s, i) => {
      const n = Math.max(1, list.length);
      DRIVE_STOP_T[s.id] = n === 1 ? 0 : i / n;
    });
    DRIVE_STOP_T.home = 1;
  }
  return { TIMELINE, SCRUB_STOPS, DRIVE_STOP_T };
}

rebuildTimeline(stops);

/**
 * Interpolate between two clocks "HH:MM" within same day for display.
 */
function lerpClock(a, b, u) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  if ([ah, am, bh, bm].some((n) => Number.isNaN(n))) return u < 0.5 ? a : b;
  const aMin = ah * 60 + am;
  const bMin = bh * 60 + bm;
  let m = Math.round(aMin + (bMin - aMin) * u);
  if (m < 0) m += 24 * 60;
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * @param {number} t 0..1
 */
export function beatAt(t) {
  const x = Math.max(0, Math.min(1, t));
  let i = 0;
  for (let k = 0; k < TIMELINE.length; k += 1) {
    if (x >= TIMELINE[k].t) i = k;
  }
  const cur = TIMELINE[i];
  const next = TIMELINE[Math.min(TIMELINE.length - 1, i + 1)];
  const span = Math.max(1e-6, next.t - cur.t);
  const u = (x - cur.t) / span;

  let clock = cur.clock;
  let day = cur.day;
  if (cur.day === next.day && u > 0 && u < 1 && parseClock(cur.clock) && parseClock(next.clock)) {
    clock = lerpClock(cur.clock, next.clock, u);
  } else if (u >= 0.5) {
    clock = next.clock;
    day = next.day;
  }

  const place = u < 0.55 ? cur.place : next.place;
  const label = u < 0.55 ? cur.label : next.label;
  const stopId = u < 0.55 ? cur.stopId : next.stopId;

  const enRoute =
    !stopId || place === 'Trên đường' || (u > 0.15 && u < 0.85 && cur.place !== next.place);
  const status =
    place === 'Trên đường'
      ? `Đang đi · ${label}`
      : enRoute && cur.place !== next.place && u > 0.2 && u < 0.8
        ? `Đang tới · ${next.place}`
        : `${place} · ${label}`;

  return {
    t: x,
    day,
    clock,
    timeText: `${day} · ${clock}`,
    place,
    label,
    stopId,
    status,
  };
}
