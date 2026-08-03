import gsap from 'gsap';
import { Marker } from 'maplibre-gl';
import { stops } from './journey.js';
import { byId } from './routing.js';
import { applyDayNight } from './map3d.js';

const CAR_SVG = `
<svg class="car__svg" viewBox="0 0 64 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="32" cy="34" rx="22" ry="4" fill="rgba(0,0,0,0.2)"/>
  <path d="M12 26c1-8 8-14 20-14s19 6 20 14H12z" fill="#E35D2A"/>
  <path d="M18 26c1.2-5.5 6-9.5 14-9.5S44.8 20.5 46 26H18z" fill="#FFC247"/>
  <rect x="20" y="18" width="10" height="7" rx="1.5" fill="#7EB8D8" opacity="0.9"/>
  <rect x="34" y="18" width="10" height="7" rx="1.5" fill="#7EB8D8" opacity="0.9"/>
  <circle cx="18" cy="28" r="5" fill="#1a1a1a"/>
  <circle cx="18" cy="28" r="2.2" fill="#bbb"/>
  <circle cx="46" cy="28" r="5" fill="#1a1a1a"/>
  <circle cx="46" cy="28" r="2.2" fill="#bbb"/>
  <rect x="10" y="24" width="4" height="3" rx="1" fill="#ffe08a"/>
  <rect x="50" y="24" width="4" height="3" rx="1" fill="#ff6b4a"/>
</svg>`;

function bearingBetween(a, b) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * toDeg) + 360) % 360;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCarMarker(map, lng, lat) {
  const el = document.createElement('div');
  el.className = 'car';
  el.innerHTML = CAR_SVG;
  el.setAttribute('aria-label', 'Xe đang chạy hành trình');

  const marker = new Marker({
    element: el,
    anchor: 'center',
    pitchAlignment: 'map',
    rotationAlignment: 'map',
  })
    .setLngLat([lng, lat])
    .addTo(map);

  return {
    marker,
    el,
    setLngLat(lng2, lat2) {
      marker.setLngLat([lng2, lat2]);
    },
    setBearing(deg) {
      el.style.setProperty('--rot', `${deg - 90}deg`);
    },
    setDriving(on) {
      el.classList.toggle('is-driving', on);
    },
    remove() {
      marker.remove();
    },
  };
}

/**
 * Drive car along stops in order: 1 → 2 → 3 → 4, pause + photos at each,
 * then return home.
 */
export function createDriveTour({
  map,
  builtLegs,
  car,
  onArrive,
  onDepart,
  onTick,
  onProgress,
  onComplete,
  pauseMs = 4500,
}) {
  let aborted = false;
  let running = false;
  let tween = null;

  const driveLegs = builtLegs.filter((l) => !l.return);
  const returnLeg = builtLegs.find((l) => l.return);

  const STOP_T = {
    'xuat-phat': 0,
    'nghi-duong': 0.36,
    'tra-chieu': 0.54,
    'mua-qua': 0.84,
  };

  function abort() {
    aborted = true;
    running = false;
    tween?.kill();
    tween = null;
    car.setDriving(false);
  }

  function animateAlong(coordinates, durationSec, tFrom, tTo) {
    return new Promise((resolve) => {
      if (!coordinates || coordinates.length < 2) {
        resolve();
        return;
      }
      const proxy = { i: 0 };
      const last = coordinates.length - 1;
      tween = gsap.to(proxy, {
        i: last,
        duration: durationSec,
        ease: 'none',
        onUpdate: () => {
          const idx = Math.min(last, Math.floor(proxy.i));
          const next = Math.min(last, idx + 1);
          const u = proxy.i - idx;
          const a = coordinates[idx];
          const b = coordinates[next];
          const lng = a[0] + (b[0] - a[0]) * u;
          const lat = a[1] + (b[1] - a[1]) * u;
          const brg = bearingBetween(a, b);
          car.setLngLat(lng, lat);
          car.setBearing(brg);
          map.setCenter([lng, lat]);
          const progress = last > 0 ? proxy.i / last : 1;
          const t = tFrom + (tTo - tFrom) * progress;
          onProgress?.(t);
          onTick?.({ lng, lat, bearing: brg, t });
        },
        onComplete: resolve,
      });
    });
  }

  async function visitStop(stopId, { showPhotos = true, finale = false } = {}) {
    const stop = byId[stopId];
    if (!stop) return;
    car.setLngLat(stop.lng, stop.lat);
    car.setDriving(false);
    map.easeTo({
      center: [stop.lng, stop.lat],
      zoom: Math.max(map.getZoom(), 12.8),
      duration: 650,
      essential: true,
    });
    const dayT = finale ? 1 : STOP_T[stopId] ?? (stop.order - 1) / Math.max(1, stops.length - 1);
    applyDayNight(map, dayT);
    onProgress?.(dayT);
    if (showPhotos) {
      await onArrive?.(stop, { finale });
      if (aborted) return;
      await wait(finale ? 2800 : pauseMs);
    }
  }

  async function run() {
    if (running) return;
    running = true;
    aborted = false;

    const first = stops[0];
    car.setLngLat(first.lng, first.lat);
    car.setBearing(0);
    map.jumpTo({ center: [first.lng, first.lat], zoom: Math.max(map.getZoom(), 12.5) });
    await visitStop(first.id, { showPhotos: true });
    if (aborted) return;

    for (const leg of driveLegs) {
      if (aborted) return;
      // Always leave from the leg's true origin (fixes restart / wrong hop)
      const fromStop = byId[leg.from];
      if (fromStop) {
        car.setLngLat(fromStop.lng, fromStop.lat);
      }
      const fromT = STOP_T[leg.from] ?? 0;
      const toT = STOP_T[leg.to] ?? Math.min(0.9, fromT + 0.2);
      onDepart?.(byId[leg.to], { t: fromT + 0.02 });
      car.setDriving(true);
      const km = Math.max(3, (leg.distance || 15000) / 1000);
      const durationSec = Math.min(14, Math.max(4, km * 0.22));
      map.easeTo({ zoom: km > 40 ? 10.8 : 12.2, duration: 400, essential: true });
      await animateAlong(leg.coordinates, durationSec, fromT, toT);
      if (aborted) return;
      await visitStop(leg.to, {
        showPhotos: !leg.overnight,
        finale: false,
      });
    }

    if (returnLeg && !aborted) {
      const fromStop = byId[returnLeg.from];
      if (fromStop) car.setLngLat(fromStop.lng, fromStop.lat);
      const fromT = STOP_T[returnLeg.from] ?? 0.84;
      onDepart?.(byId[returnLeg.to], { t: fromT });
      car.setDriving(true);
      const km = Math.max(8, (returnLeg.distance || 80000) / 1000);
      const durationSec = Math.min(14, Math.max(6, km * 0.14));
      map.easeTo({ zoom: 10.6, duration: 450, essential: true });
      await animateAlong(returnLeg.coordinates, durationSec, fromT, 1);
      if (!aborted) {
        await visitStop(stops[0].id, { showPhotos: true, finale: true });
      }
    }

    running = false;
    car.setDriving(false);
    onComplete?.();
  }

  return {
    start() {
      abort();
      aborted = false;
      running = false;
      return run();
    },
    stop: abort,
    get running() {
      return running;
    },
  };
}
