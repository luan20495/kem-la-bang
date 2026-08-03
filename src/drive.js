import gsap from 'gsap';
import { stops } from './journey.js';
import { byId, bearingAlongPath, bearingBetween } from './routing.js';
import { applyDayNight, MAP_2D } from './map3d.js';
import { DRIVE_STOP_T } from './timeline.js';

export { createCar3D as createCarMarker, CAR_MODELS } from './car3d.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lerpBearing(from, to, t) {
  const d = ((to - from + 540) % 360) - 180;
  return (from + d * t + 360) % 360;
}

/** Cumulative meters along a polyline — animate by distance, not point index. */
function buildLengthTable(coordinates) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const dLat = (b[1] - a[1]) * 110540;
    const dLng = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
    total += Math.hypot(dLat, dLng);
    lengths.push(total);
  }
  return { lengths, total: total || 1 };
}

function pointAtDistance(coordinates, lengths, dist) {
  const last = coordinates.length - 1;
  const target = Math.max(0, Math.min(lengths[last], dist));
  let i = 1;
  while (i < lengths.length && lengths[i] < target) i += 1;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(last, i);
  const span = lengths[i1] - lengths[i0] || 1;
  const u = (target - lengths[i0]) / span;
  const a = coordinates[i0];
  const b = coordinates[i1];
  return {
    lng: a[0] + (b[0] - a[0]) * u,
    lat: a[1] + (b[1] - a[1]) * u,
    index: i0,
  };
}

/**
 * Drive car along stops. Constant-speed along path + soft camera = no stutter.
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
  let camFrame = 0;
  const chase = {
    lng: 0,
    lat: 0,
    bearing: 0,
    carBrg: 0,
    primed: false,
  };

  const driveLegs = builtLegs.filter((l) => !l.return);
  const returnLeg = builtLegs.find((l) => l.return);

  function stopT(id, fallback = 0) {
    return DRIVE_STOP_T[id] ?? fallback;
  }

  function abort() {
    const wasRunning = running;
    aborted = true;
    running = false;
    tween?.kill();
    tween = null;
    car.setDriving(false);
    chase.primed = false;
    if (wasRunning) {
      map.easeTo({ pitch: MAP_2D.pitch, bearing: MAP_2D.bearing, duration: 700, essential: true });
    }
  }

  function primeChase(lng, lat) {
    chase.lng = lng;
    chase.lat = lat;
    chase.bearing = MAP_2D.bearing;
    chase.primed = true;
  }

  /**
   * Soft pan, throttled (~20fps) so MapLibre doesn’t thrash tiles every GSAP tick.
   * Bearing locked. Center tracks car closely — no “swim” lag.
   */
  function chaseCam(lng, lat) {
    if (!chase.primed) {
      primeChase(lng, lat);
      map.jumpTo({ center: [lng, lat], bearing: chase.bearing });
      return;
    }
    chase.lng += (lng - chase.lng) * 0.35;
    chase.lat += (lat - chase.lat) * 0.35;
    camFrame += 1;
    if (camFrame % 3 !== 0) return;
    map.setCenter([chase.lng, chase.lat]);
  }

  function animateAlong(coordinates, durationSec, tFrom, tTo) {
    return new Promise((resolve) => {
      if (!coordinates || coordinates.length < 2) {
        resolve();
        return;
      }
      const { lengths, total } = buildLengthTable(coordinates);
      const pathLike = { coordinates };
      const proxy = { d: 0 };
      const startBrg = bearingBetween(coordinates[0], coordinates[Math.min(coordinates.length - 1, 12)]);
      chase.carBrg = startBrg;
      camFrame = 0;
      primeChase(coordinates[0][0], coordinates[0][1]);
      car.setBearing(startBrg);
      car.setLngLat(coordinates[0][0], coordinates[0][1]);
      map.jumpTo({ center: [coordinates[0][0], coordinates[0][1]], bearing: chase.bearing });

      tween = gsap.to(proxy, {
        d: total,
        duration: durationSec,
        ease: 'none',
        onUpdate: () => {
          const pt = pointAtDistance(coordinates, lengths, proxy.d);
          // Long lookahead + lerp → no zig-zag snap
          const rawBrg = bearingAlongPath(pathLike, pt.index, 90);
          chase.carBrg = lerpBearing(chase.carBrg, rawBrg, 0.08);
          car.setLngLat(pt.lng, pt.lat);
          car.setBearing(chase.carBrg);
          chaseCam(pt.lng, pt.lat);
          const progress = proxy.d / total;
          const t = tFrom + (tTo - tFrom) * progress;
          onProgress?.(t);
          onTick?.({ lng: pt.lng, lat: pt.lat, bearing: chase.carBrg, t });
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
    chase.primed = false;
    map.easeTo({
      center: [stop.lng, stop.lat],
      zoom: Math.max(map.getZoom(), 13.2),
      pitch: MAP_2D.pitch,
      bearing: MAP_2D.bearing,
      duration: 750,
      essential: true,
    });
    const dayT = finale ? 1 : stopT(stopId, (stop.order - 1) / Math.max(1, stops.length - 1));
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
    chase.primed = false;

    const first = stops[0];
    car.setLngLat(first.lng, first.lat);
    car.setBearing(0);
    map.jumpTo({
      center: [first.lng, first.lat],
      zoom: Math.max(map.getZoom(), 12.5),
      pitch: MAP_2D.pitch,
      bearing: MAP_2D.bearing,
    });
    await visitStop(first.id, { showPhotos: true });
    if (aborted) return;

    for (const leg of driveLegs) {
      if (aborted) return;
      const fromStop = byId[leg.from];
      if (fromStop) car.setLngLat(fromStop.lng, fromStop.lat);
      const fromT = stopT(leg.from, 0);
      const toT = stopT(leg.to, Math.min(0.9, fromT + 0.2));
      onDepart?.(byId[leg.to], { t: fromT + 0.02 });
      car.setDriving(true);
      const km = Math.max(3, (leg.distance || 15000) / 1000);
      const durationSec = Math.min(24, Math.max(8, km * 0.4));
      map.easeTo({
        zoom: km > 40 ? 10.8 : 11.8,
        pitch: MAP_2D.pitch,
        bearing: MAP_2D.bearing,
        duration: 600,
        essential: true,
      });
      await wait(650);
      if (aborted) return;
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
      const fromT = stopT(returnLeg.from, 0.84);
      onDepart?.(byId[returnLeg.to], { t: fromT });
      car.setDriving(true);
      const km = Math.max(8, (returnLeg.distance || 80000) / 1000);
      const durationSec = Math.min(26, Math.max(12, km * 0.26));
      map.easeTo({
        zoom: 10.6,
        pitch: MAP_2D.pitch,
        bearing: MAP_2D.bearing,
        duration: 600,
        essential: true,
      });
      await wait(650);
      if (aborted) return;
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
