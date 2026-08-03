import gsap from 'gsap';
import { pointAlongPath, narrativeToPathT } from './routing.js';
import { applyDayNight, setTraveler } from './map3d.js';
import { beatAt } from './timeline.js';

export function phaseAt(t) {
  const b = beatAt(t);
  return {
    at: b.t,
    label: b.status,
    clock: b.timeText,
    place: b.place,
    stopId: b.stopId,
  };
}

export function createCinemaController({ map, path, onStopHint, onTick }) {
  const state = {
    t: 0,
    playing: false,
    tween: null,
    camBearing: null,
    camLng: null,
    camLat: null,
  };

  function softCam(lng, lat, bearing, { duration = 0, hard = false } = {}) {
    if (hard || state.camBearing == null) {
      state.camBearing = map.getBearing();
      state.camLng = lng;
      state.camLat = lat;
    } else if (duration > 0) {
      // Scrub: pan to place, keep current map bearing (no spin)
      state.camLng = lng;
      state.camLat = lat;
      state.camBearing = map.getBearing();
      map.easeTo({
        center: [lng, lat],
        bearing: state.camBearing,
        pitch: Math.min(42, Math.max(map.getPitch(), 28)),
        zoom: map.getZoom() < 10 ? 11.4 : map.getZoom(),
        duration,
        essential: true,
      });
      return;
    } else {
      // Continuous play: soft pan only — bearing locked
      state.camLng += (lng - state.camLng) * 0.1;
      state.camLat += (lat - state.camLat) * 0.1;
    }

    map.jumpTo({
      center: [state.camLng, state.camLat],
      bearing: state.camBearing,
    });
  }

  function apply(t, { animateCam = true, duration = 0, hintStops = true } = {}) {
    state.t = Math.max(0, Math.min(1, t));
    // HUD/timeline t is narrative; map position follows distance between stop anchors
    const pathT = narrativeToPathT(path, state.t);
    const pt = pointAlongPath(path, pathT);
    setTraveler(map, pt.lng, pt.lat);
    applyDayNight(map, state.t);

    const phase = phaseAt(state.t);
    const beat = beatAt(state.t);
    onTick?.({ t: state.t, pathT, phase, beat, pt });

    if (hintStops) {
      let nearest = path.stopHits[0];
      let best = Infinity;
      for (const hit of path.stopHits) {
        const d = Math.abs(hit.index - pt.index);
        if (d < best) {
          best = d;
          nearest = hit;
        }
      }
      if (best < 48) onStopHint?.(nearest.id);
    }

    if (!animateCam) return;

    softCam(pt.lng, pt.lat, pt.bearing, { duration, hard: duration > 0 });
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    const start = state.t >= 0.995 ? 0 : state.t;
    // Seed chase from current map so play doesn't snap
    state.camBearing = map.getBearing();
    const c = map.getCenter();
    state.camLng = c.lng;
    state.camLat = c.lat;
    state.tween = gsap.fromTo(
      state,
      { t: start },
      {
        t: 1,
        duration: (1 - start) * 72,
        ease: 'none',
        onUpdate: () => apply(state.t, { animateCam: true, duration: 0 }),
        onComplete: () => {
          state.playing = false;
          onTick?.({ t: 1, phase: phaseAt(1), beat: beatAt(1), playing: false });
        },
      }
    );
  }

  function pause() {
    state.playing = false;
    state.tween?.kill();
    state.tween = null;
  }

  function toggle() {
    if (state.playing) pause();
    else play();
    return state.playing;
  }

  function scrub(t) {
    pause();
    apply(t, { animateCam: true, duration: 550 });
  }

  return {
    play,
    pause,
    toggle,
    scrub,
    apply,
    get t() {
      return state.t;
    },
    get playing() {
      return state.playing;
    },
  };
}
