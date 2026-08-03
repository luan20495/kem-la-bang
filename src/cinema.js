import gsap from 'gsap';
import { pointAlongPath } from './routing.js';
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
  };

  function apply(t, { animateCam = true, duration = 0, hintStops = true } = {}) {
    state.t = Math.max(0, Math.min(1, t));
    const pt = pointAlongPath(path, state.t);
    setTraveler(map, pt.lng, pt.lat);
    applyDayNight(map, state.t);

    const phase = phaseAt(state.t);
    const beat = beatAt(state.t);
    onTick?.({ t: state.t, phase, beat, pt });

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

    const cam = {
      center: [pt.lng, pt.lat],
      bearing: 0,
      pitch: 0,
      zoom: 11.4,
      duration,
      easing: (x) => x,
      essential: true,
    };

    if (duration > 0) map.easeTo(cam);
    else map.jumpTo(cam);
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    const start = state.t >= 0.995 ? 0 : state.t;
    state.tween = gsap.fromTo(
      state,
      { t: start },
      {
        t: 1,
        duration: (1 - start) * 48,
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
    apply(t, { animateCam: true, duration: 500 });
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
