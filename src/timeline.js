/**
 * Timeline 0→1 mapped to real trip clock + place.
 * Used by HUD scrubber, cinema, and drive sync.
 */

/** @typedef {{ t: number, day: string, clock: string, place: string, label: string, stopId?: string }} TimelineBeat */

/** @type {TimelineBeat[]} */
export const TIMELINE = [
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

/** Stop markers shown on the scrubber track */
export const SCRUB_STOPS = TIMELINE.filter((b) => b.stopId && [0, 0.36, 0.54, 0.84, 1].includes(b.t));

/**
 * Interpolate between two clocks "HH:MM" within same day for display.
 * Falls back to nearest beat clock if days differ.
 */
function lerpClock(a, b, u) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
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
 * @returns {{ t: number, day: string, clock: string, timeText: string, place: string, label: string, stopId?: string, status: string }}
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
  if (cur.day === next.day && u > 0 && u < 1) {
    clock = lerpClock(cur.clock, next.clock, u);
  } else if (u >= 0.5) {
    clock = next.clock;
    day = next.day;
  }

  const place = u < 0.55 ? cur.place : next.place;
  const label = u < 0.55 ? cur.label : next.label;
  const stopId = u < 0.55 ? cur.stopId : next.stopId;

  const enRoute = !stopId || place === 'Trên đường' || (u > 0.15 && u < 0.85 && cur.place !== next.place);
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

/** Progress anchors when arriving at each stop during drive tour */
export const DRIVE_STOP_T = {
  'xuat-phat': 0,
  'nghi-duong': 0.36,
  'tra-chieu': 0.54,
  'mua-qua': 0.84,
  home: 1,
};
