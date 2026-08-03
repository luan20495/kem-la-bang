import gsap from 'gsap';
import { Popup } from 'maplibre-gl';
import { stops, trip } from './journey.js';
import { buildAllLegs, buildCinemaPath, byId, selectLegAlternative, CORRIDOR_BLURB, rebuildById, attachNarrativeMap, resetAllRouteEdits, CUSTOM_TAG, loadRouteEdits, saveRouteEdits, legKeyOf } from './routing.js';
import {
  createMap,
  waitForMap,
  whenStyleReady,
  enableTerrain,
  addRouteLayers,
  refreshRouteGeometry,
  setRouteDirection,
  createStopMarkers,
  setActiveMarker,
  fitJourney,
  getPadding,
  applyDayNight,
  setTraveler,
  MAP_2D,
} from './map3d.js';
import { createAtmosphere, createBootScene } from './atmosphere.js';
import { createCinemaController } from './cinema.js';
import { createCarMarker, createDriveTour } from './drive.js';
import { initCarPicker } from './car-picker.js';
import { beatAt, SCRUB_STOPS, DRIVE_STOP_T, rebuildTimeline, TIMELINE } from './timeline.js';
import { hydratePlaces } from './places-store.js';
import { createPlacesEditor } from './editor.js';
import { createRouteEditor } from './route-edit.js';
import './style.css';

hydratePlaces();
rebuildById();
rebuildTimeline(stops);

const bootScene = createBootScene(document.getElementById('boot-canvas'));
const bootBar = document.getElementById('boot-bar');
const bootStatus = document.getElementById('boot-status');

function setBoot(progress, status) {
  bootScene.setProgress(progress);
  if (bootBar) bootBar.style.width = `${Math.round(progress * 100)}%`;
  if (status) bootStatus.textContent = status;
}

const state = {
  activeId: stops[0].id,
  markers: [],
  map: null,
  cinema: null,
  drive: null,
  car: null,
  builtLegs: null,
  routeDir: 'all', // 'all' | 'out' | 'back' — mặc định vẽ đủ từng đoạn
  routeDirPinned: false, // true after manual toggle until scrub/drive moves t
  routeEditing: false,
  routeEditor: null,
  photoTimer: null,
  photoPopup: null,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

function renderTimeline(onSelect) {
  const list = document.getElementById('timeline');
  list.innerHTML = stops
    .map(
      (s) => `
    <li class="tl" data-id="${s.id}" style="--stop:${s.color}">
      <span class="tl__dot" aria-hidden="true"></span>
      <button type="button" class="tl__btn">
        <span class="tl__when">${s.day} · ${s.time}</span>
        <span class="tl__role">${s.role}</span>
        <span class="tl__name">${s.name}</span>
      </button>
    </li>`
    )
    .join('');
  list.querySelectorAll('.tl').forEach((el) => {
    el.querySelector('.tl__btn').addEventListener('click', () => onSelect(el.dataset.id));
  });
}

function updateSheet(stop) {
  document.querySelectorAll('.tl').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.id === stop.id);
  });
  setActiveMarker(state.markers, stop.id);
  const blurb = document.getElementById('rail-blurb');
  const maps = document.getElementById('rail-maps');
  const mapsImg = document.getElementById('rail-maps-img');
  const mapsTitle = document.getElementById('rail-maps-title');
  const mapsPlace = document.getElementById('rail-maps-place');
  if (blurb) {
    const text = (stop.blurb || '').trim();
    blurb.textContent = text || '';
    blurb.hidden = !text || text === '—';
  }
  if (maps) {
    maps.href = stop.mapsUrl;
    maps.style.setProperty('--cta', stop.color);
    maps.setAttribute('aria-label', `Mở Google Maps · ${stop.name}`);
  }
  if (mapsImg) {
    const photo = stop.photos?.[0]?.src || '';
    mapsImg.src = photo;
    mapsImg.alt = '';
  }
  if (mapsTitle) mapsTitle.textContent = stop.name;
  if (mapsPlace) mapsPlace.textContent = stop.place;
}

function corridorOptions(builtLegs) {
  const choosable = builtLegs.filter(
    (leg) => (leg.longHaul || leg.return) && (leg.alternatives?.length || 0) > 1
  );
  if (!choosable.length) return [];

  const removed = getRemovedCorridors();
  const primary = choosable.find((l) => !l.return) || choosable[0];
  return primary.alternatives
    .filter((alt) => !removed.has(alt.tag) && alt.tag !== CUSTOM_TAG)
    .map((alt, index) => {
    const short = alt.tag;
    const go = choosable.find((l) => !l.return);
    const back = choosable.find((l) => l.return);
    const goAlt = go?.alternatives?.find((a) => a.tag === alt.tag);
    const backAlt = back?.alternatives?.find((a) => a.tag === alt.tag);
    const parts = [];
    if (goAlt) parts.push(`Đi ${goAlt.kmLabel}`);
    if (backAlt) parts.push(`Về ${backAlt.kmLabel}`);
    const timeParts = [];
    if (goAlt) timeParts.push(goAlt.timeLabel);
    if (backAlt) timeParts.push(backAlt.timeLabel);
    return {
      tag: alt.tag,
      short,
      blurb: CORRIDOR_BLURB[alt.tag] || '',
      index,
      summary: parts.join(' · '),
      time: timeParts.join(' → '),
      selected: choosable.every((leg) => {
        const match = leg.alternatives.findIndex((a) => a.tag === alt.tag);
        return match >= 0 && match === leg.selected;
      }),
    };
  });
}

const REMOVED_KEY = 'kem-removed-corridors';

function getRemovedCorridors() {
  try {
    const raw = JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]');
    const valid = new Set(Object.keys(CORRIDOR_BLURB));
    return new Set((Array.isArray(raw) ? raw : []).filter((t) => valid.has(t)));
  } catch {
    return new Set();
  }
}

function setRemovedCorridors(tags) {
  localStorage.setItem(REMOVED_KEY, JSON.stringify([...tags]));
}

function applyCorridor(builtLegs, tag) {
  const all = loadRouteEdits();
  let changed = false;
  builtLegs.forEach((leg) => {
    // Only long-haul HN↔Kẹm hops follow the 3 corridor styles
    if (!leg.longHaul && !leg.return) return;
    if ((leg.alternatives?.length || 0) < 2) return;
    if (leg.waypoints?.length) {
      leg.waypoints = [];
      leg.alternatives = (leg.alternatives || []).filter((a) => a.tag !== CUSTOM_TAG);
      leg.alternatives.forEach((a, i) => {
        a.id = i;
      });
    }
    const key = legKeyOf(leg);
    if (all[key]) {
      delete all[key];
      changed = true;
    }
    const idx = leg.alternatives.findIndex((a) => a.tag === tag);
    if (idx >= 0) selectLegAlternative(leg, idx);
  });
  if (changed) saveRouteEdits(all);
}

function ensureSelectedVisible(builtLegs) {
  const options = corridorOptions(builtLegs);
  if (!options.length) return null;
  const selected = options.find((o) => o.selected);
  if (selected) return selected.tag;
  const fallback = options[0].tag;
  applyCorridor(builtLegs, fallback);
  return fallback;
}

function renderRoutePicker(builtLegs, handlers = {}) {
  const { onPickCorridor, onRemoveCorridor, onRestoreCorridors } = handlers;
  const host = document.getElementById('route-legs');
  const label = document.querySelector('.routes-fold__sum > span:first-child');
  const fold = document.getElementById('routes-fold');
  if (!host) return;

  const removed = getRemovedCorridors();
  const options = corridorOptions(builtLegs);
  if (!options.length && !removed.size) {
    if (fold) fold.hidden = true;
    if (label) label.textContent = 'Tuyến đường';
    host.innerHTML = '';
    return;
  }

  if (fold) fold.hidden = false;
  if (label) {
    label.textContent = `Tuyến lên Kẹm · ${options.length} lựa chọn`;
  }

  const active = options.find((o) => o.selected) || options[0];
  const gmaps =
    'https://www.google.com/maps/dir/?api=1&origin=20.9794135,105.8415574&destination=21.6227277,105.534959&travelmode=driving';
  const canDelete = options.length > 1;

  host.innerHTML = `
    <div class="route-seg" role="radiogroup" aria-label="Chọn tuyến lên Kẹm">
      ${options
        .map(
          (o) => `
        <div class="route-seg__item ${o.selected ? 'is-on' : ''}">
          <button type="button" class="route-seg__btn ${o.selected ? 'is-on' : ''}"
            role="radio" aria-checked="${o.selected}" data-tag="${o.tag}" title="${o.tag}">
            ${o.short}
          </button>
          ${
            canDelete
              ? `<button type="button" class="route-seg__del" data-del="${o.tag}" aria-label="Xóa tuyến ${o.short}" title="Xóa tuyến">×</button>`
              : ''
          }
        </div>`
        )
        .join('')}
    </div>
    ${
      active
        ? `<p class="route-seg__meta">
            <span class="route-seg__sum">${active.blurb || active.summary}</span>
            <span class="route-seg__time">${active.time || active.summary}</span>
          </p>
          <p class="route-seg__km">${active.summary}</p>`
        : ''
    }
    <div class="route-seg__tools">
      <a class="route-seg__gmaps" href="${gmaps}" target="_blank" rel="noopener noreferrer">
        So với Google Maps
      </a>
      ${
        removed.size
          ? `<button type="button" class="route-seg__restore" id="route-restore">
              Khôi phục ${removed.size} tuyến đã xóa
            </button>`
          : ''
      }
    </div>
  `;

  host.querySelectorAll('.route-seg__btn').forEach((btn) => {
    btn.addEventListener('click', () => onPickCorridor?.(btn.dataset.tag));
  });
  host.querySelectorAll('.route-seg__del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemoveCorridor?.(btn.dataset.del);
    });
  });
  document.getElementById('route-restore')?.addEventListener('click', () => {
    onRestoreCorridors?.();
  });
}

function syncRouteDirUi(dir) {
  document.querySelectorAll('#route-dir .route-dir__btn').forEach((btn) => {
    const on = btn.dataset.dir === dir;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const hint = document.getElementById('route-dir-hint');
  if (hint) {
    hint.textContent =
      dir === 'all'
        ? 'Đang hiện đủ từng đoạn · màu theo chặng'
        : dir === 'out'
          ? 'Chỉ chặng đi / nội vùng · ẩn đường về'
          : 'Chỉ đường về Hà Nội · cam nét đứt';
  }
}

function applyRouteDir(dir, { pin = false } = {}) {
  if (dir !== 'all' && dir !== 'out' && dir !== 'back') return;
  if (pin) state.routeDirPinned = true;
  const changed = state.routeDir !== dir;
  state.routeDir = dir;
  syncRouteDirUi(dir);
  if (!changed || !state.map) return;
  if (state.builtLegs) {
    refreshRouteGeometry(state.map, state.builtLegs, getRemovedCorridors(), dir);
  } else {
    setRouteDirection(state.map, dir);
  }
}

/** Keep all segments visible while scrubbing unless user filtered manually. */
function routeDirFromT(_t) {
  return 'all';
}

function updateRailMeta() {
  const n = stops.length;
  const el = document.getElementById('rail-meta');
  if (el) el.textContent = `${n} điểm · chỉnh tự do · về điểm đầu`;
  const fab = document.getElementById('rail-fab-meta');
  if (fab) fab.textContent = `${n} điểm`;
}

function setHud(t, overrides = {}) {
  const beat = beatAt(t);
  const hud = document.getElementById('hud');
  const scrub = document.getElementById('time-scrub');
  const driving = Boolean(state.drive?.running);
  if (scrub) {
    if (document.activeElement !== scrub) {
      scrub.value = String(Math.round(beat.t * 1000));
    }
    scrub.disabled = driving;
  }
  if (hud) {
    hud.style.setProperty('--hud-t', String(beat.t));
    hud.classList.toggle('is-live', driving);
  }
  document.getElementById('hud-clock').textContent = overrides.timeText || beat.timeText;
  document.getElementById('hud-place').textContent = overrides.place || beat.place;
  document.getElementById('hud-phase').textContent = overrides.label || beat.label;
  const pct = document.getElementById('hud-pct');
  if (pct) pct.textContent = `${Math.round(beat.t * 100)}%`;
  document.querySelectorAll('.hud__tick').forEach((el) => {
    const tt = Number(el.dataset.t);
    el.classList.toggle('is-on', Math.abs(tt - beat.t) < 0.055);
    el.classList.toggle('is-passed', tt < beat.t - 0.04);
  });

  if (driving) state.routeDirPinned = false;
  if (!state.routeDirPinned) {
    applyRouteDir(routeDirFromT(beat.t));
  }
}

function jumpHud(t) {
  if (state.drive?.running) {
    state.drive.stop();
    hidePhotos();
    setDriveBtn(false);
  }
  state.routeDirPinned = false;
  state.cinema?.pause();
  state.cinema?.scrub(t);
  setHud(t);
  const stop = SCRUB_STOPS.find((s) => Math.abs(s.t - t) < 0.01);
  if (stop?.stopId && byId[stop.stopId]) {
    state.activeId = stop.stopId;
    updateSheet(byId[stop.stopId]);
  }
}

function snapHud(dir) {
  const scrub = document.getElementById('time-scrub');
  const t = Number(scrub?.value || 0) / 1000;
  let i;
  if (dir > 0) {
    i = SCRUB_STOPS.findIndex((s) => s.t > t + 0.02);
    if (i < 0) i = SCRUB_STOPS.length - 1;
  } else {
    i = 0;
    for (let k = SCRUB_STOPS.length - 1; k >= 0; k -= 1) {
      if (SCRUB_STOPS[k].t < t - 0.02) {
        i = k;
        break;
      }
    }
  }
  jumpHud(SCRUB_STOPS[i].t);
}

function renderHudTicks() {
  const host = document.getElementById('hud-ticks');
  if (!host) return;
  host.innerHTML = SCRUB_STOPS.map(
    (s) =>
      `<button type="button" class="hud__tick" data-t="${s.t}" data-stop="${s.stopId || ''}" style="left:${s.t * 100}%" aria-label="${s.place} · ${s.label}">
        <span class="hud__tick-tip">${s.clock} · ${s.place}</span>
        <i aria-hidden="true"></i>
      </button>`
  ).join('');
  host.querySelectorAll('.hud__tick').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      jumpHud(Number(btn.dataset.t));
    });
  });
}

function rebuildPathControllers(map) {
  const path = attachNarrativeMap(buildCinemaPath(state.builtLegs), TIMELINE);
  state.cinema = createCinemaController({
    map,
    path,
    onStopHint: () => {},
    onTick: ({ t, pt }) => {
      setHud(t);
      if (state.drive?.running) return;
      if (pt) {
        state.car?.setLngLat(pt.lng, pt.lat);
        state.car?.setBearing(pt.bearing);
      }
    },
  });

  state.drive = createDriveTour({
    map,
    builtLegs: state.builtLegs,
    car: state.car,
    pauseMs: 4800,
    onDepart: (stop, meta = {}) => {
      hidePhotos();
      if (meta.t != null) setHud(meta.t);
      if (stop) {
        document.getElementById('hud-place').textContent = stop.name;
        document.getElementById('hud-phase').textContent = `Đang tới · ${stop.role}`;
      }
    },
    onArrive: async (stop, opts = {}) => {
      state.activeId = stop.id;
      updateSheet(stop);
      setTraveler(map, stop.lng, stop.lat);
      const key = opts.finale ? 'home' : stop.id;
      const t = DRIVE_STOP_T[key] ?? DRIVE_STOP_T[stop.id] ?? 0;
      setHud(t, {
        timeText: `${stop.day} · ${stop.time}`,
        place: opts.finale ? 'Hà Nội' : stop.name,
        label: opts.finale ? 'Về nhà trước trưa' : stop.role,
      });
      await showPhotos(stop, opts);
    },
    onProgress: (t) => setHud(t),
    onTick: ({ lng, lat }) => {
      setTraveler(map, lng, lat);
    },
    onComplete: () => {
      hidePhotos();
      setDriveBtn(false);
      fitJourney(map, getPadding());
      setHud(1, { place: 'Hà Nội', label: 'Hành trình xong' });
    },
  });
}

function hidePhotos() {
  clearInterval(state.photoTimer);
  state.photoTimer = null;
  state.photoPopup?.remove();
  state.photoPopup = null;
}

function starsHtml(rating) {
  if (rating == null) return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.4;
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    if (i < full) out += '<span class="place-card__star is-on">★</span>';
    else if (i === full && half) out += '<span class="place-card__star is-half">★</span>';
    else out += '<span class="place-card__star">★</span>';
  }
  return out;
}

function showPhotos(stop, { finale = false } = {}) {
  return new Promise((resolve) => {
    if (!state.map) {
      resolve();
      return;
    }

    hidePhotos();

    const photos = stop.photos || [];
    const metaBits = [
      stop.category,
      stop.price,
      finale ? 'Về tới nhà' : `${stop.day} · ${stop.time}`,
    ].filter(Boolean);

    const root = document.createElement('div');
    root.className = 'place-card';
    root.style.setProperty('--cta', stop.color);
    root.innerHTML = `
      <div class="place-card__hero">
        <img class="place-card__img" alt="" />
        <span class="place-card__badge">${stop.role}</span>
        ${
          photos.length > 1
            ? `<div class="place-card__dots" role="tablist" aria-label="Ảnh">
                ${photos
                  .map(
                    (_, i) =>
                      `<button type="button" class="place-card__dot ${i === 0 ? 'is-on' : ''}" data-i="${i}" aria-label="Ảnh ${i + 1}"></button>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>
      <div class="place-card__body">
        <h3 class="place-card__title">${stop.name}</h3>
        ${
          stop.rating != null
            ? `<p class="place-card__rating">
                <span class="place-card__score">${stop.rating.toFixed(1)}</span>
                <span class="place-card__stars" aria-hidden="true">${starsHtml(stop.rating)}</span>
                <span class="place-card__reviews">(${stop.reviews ?? 0})</span>
              </p>`
            : ''
        }
        <p class="place-card__meta">${metaBits.join(' · ')}</p>
        <p class="place-card__blurb">${stop.blurb}</p>
        <ul class="place-card__facts">
          ${
            stop.address
              ? `<li>
                  <span class="place-card__ico" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/></svg>
                  </span>
                  <span>${stop.address}</span>
                </li>`
              : ''
          }
          ${
            stop.hours
              ? `<li>
                  <span class="place-card__ico" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.5l3 1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </span>
                  <span>${stop.hours}</span>
                </li>`
              : ''
          }
          ${
            stop.phone
              ? `<li>
                  <span class="place-card__ico" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M8.2 4.8c.4-.4 1-.5 1.5-.3l2 1c.5.2.8.7.8 1.2v1.7c0 .4-.2.8-.5 1-.7.6-1 1.5-.8 2.4.5 2 2.1 3.6 4.1 4.1.9.2 1.8-.1 2.4-.8.2-.3.6-.5 1-.5h1.7c.5 0 1 .3 1.2.8l1 2c.2.5.1 1.1-.3 1.5-1.7 1.7-4.2 2.3-6.5 1.5-3.7-1.3-6.7-4.3-8-8-.8-2.3-.2-4.8 1.5-6.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                  </span>
                  <a href="tel:${stop.phone.replace(/\s/g, '')}">${stop.phone}</a>
                </li>`
              : ''
          }
        </ul>
        <div class="place-card__actions">
          <a class="place-card__dir" href="${stop.mapsUrl}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <circle cx="12" cy="10" r="2.2" fill="currentColor"/>
            </svg>
            Chỉ đường
          </a>
          <a class="place-card__open" href="${stop.mapsUrl}" target="_blank" rel="noopener noreferrer">
            Google Maps
          </a>
        </div>
      </div>
    `;

    const img = root.querySelector('.place-card__img');
    const dots = [...root.querySelectorAll('.place-card__dot')];

    let i = 0;
    function paint(idx) {
      if (!photos.length) return;
      const p = photos[idx % photos.length];
      img.src = p.src;
      img.alt = p.caption || stop.name;
      dots.forEach((d, di) => d.classList.toggle('is-on', di === idx % photos.length));
    }

    dots.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        i = Number(btn.dataset.i);
        paint(i);
      });
    });

    if (photos.length) paint(0);

    state.photoPopup = new Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '320px',
      offset: 28,
      anchor: 'bottom',
      className: 'place-card-wrap',
      focusAfterOpen: false,
    })
      .setLngLat([stop.lng, stop.lat])
      .setDOMContent(root)
      .addTo(state.map);

    state.photoPopup.on('close', () => {
      clearInterval(state.photoTimer);
      state.photoTimer = null;
      state.photoPopup = null;
    });

    if (photos.length > 1) {
      state.photoTimer = setInterval(() => {
        i = (i + 1) % photos.length;
        paint(i);
      }, 2200);
    }

    resolve();
  });
}

function selectStop(id, { fly = true, photos = true } = {}) {
  const stop = byId[id];
  if (!stop || !state.map) return;
  state.activeId = id;
  updateSheet(stop);

  if (state.drive?.running) {
    state.drive.stop();
    hidePhotos();
    setDriveBtn(false);
  }
  if (state.cinema?.playing) state.cinema.pause();

  const t = DRIVE_STOP_T[stop.id];
  if (t != null) {
    state.cinema?.apply?.(t, { animateCam: false });
    setHud(t, {
      timeText: `${stop.day} · ${stop.time}`,
      place: stop.name,
      label: stop.role,
    });
  }

  if (fly) {
    state.map.flyTo({
      center: [stop.lng, stop.lat],
      zoom: 13.4,
      pitch: MAP_2D.pitch,
      bearing: MAP_2D.bearing,
      duration: state.reducedMotion ? 0 : 1400,
      essential: true,
    });
  }
  state.car?.setLngLat(stop.lng, stop.lat);
  setTraveler(state.map, stop.lng, stop.lat);
  if (photos) showPhotos(stop);
}

function setDriveBtn(on) {
  const btn = document.getElementById('btn-drive');
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  const label = document.getElementById('btn-drive-label');
  if (label) label.textContent = on ? 'Dừng' : 'Lái';
  btn.title = on ? 'Dừng tour lái xe' : 'Lái tour theo lộ trình';
}

function initMusic() {
  const toggle = document.getElementById('music-toggle');
  const dock = document.getElementById('music-dock');
  const label = document.getElementById('music-toggle-label') || toggle.querySelector('.tb__txt');
  let playing = false;
  let player = null;
  let apiReady = null;

  function loadApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiReady) return apiReady;
    apiReady = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
    return apiReady;
  }

  async function ensurePlayer() {
    dock.classList.add('is-ready');
    await loadApi();
    if (player) return player;
    player = await new Promise((resolve) => {
      const p = new window.YT.Player('yt-player', {
        width: '200',
        height: '200',
        videoId: trip.youtubeId,
        playerVars: {
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
          loop: 1,
          playlist: trip.youtubeId,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(70);
            resolve(p);
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) e.target.playVideo();
            setPlaying(e.data === window.YT.PlayerState.PLAYING);
          },
          onError: () => {
            label.textContent = 'Nhạc';
            toggle.title = 'Mở YouTube';
            window.open(trip.youtubeUrl, '_blank', 'noopener,noreferrer');
          },
        },
      });
    });
    return player;
  }

  function setPlaying(on) {
    playing = on;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.classList.toggle('is-playing', on);
    label.textContent = on ? 'Nhạc' : 'Nhạc';
    toggle.title = on ? 'Tắt nhạc nền' : 'Bật nhạc nền';
    document.body.classList.toggle('music-on', on);
  }

  toggle.addEventListener('click', async () => {
    try {
      const p = await ensurePlayer();
      if (playing) p.pauseVideo();
      else p.playVideo();
    } catch (err) {
      console.error(err);
      window.open(trip.youtubeUrl, '_blank', 'noopener,noreferrer');
    }
  });
}

function choreographUI() {
  // Clear any leftover per-button transforms from prior intros / HMR.
  gsap.set('.tb .tb__btn', { clearProps: 'transform,opacity,translate' });
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.from('.rail', { x: -40, opacity: 0, duration: 0.95, clearProps: 'transform' }, 0)
    // Animate the whole toolbar — per-button y transforms spill outside the glass
    // (backdrop-filter clips to border-radius) and can leave "Sửa" cut off if interrupted.
    .from('.tb', { y: 14, opacity: 0, duration: 0.55, clearProps: 'transform' }, 0.12)
    .from('.brand--mobile', { y: 24, opacity: 0, duration: 0.8, clearProps: 'transform' }, 0)
    .from('.hud', { y: 30, opacity: 0, duration: 0.8, clearProps: 'transform' }, 0.3);
}

function finishBoot() {
  document.getElementById('boot')?.classList.add('is-done');
  setTimeout(() => bootScene.destroy(), 700);
  choreographUI();
}

async function main() {
  setBoot(0.08, 'Đang mở…');
  createAtmosphere(document.getElementById('atmosphere'));

  setBoot(0.18, 'Tải bản đồ…');
  const map = createMap('map');
  state.map = map;

  const loadState = await waitForMap(map, 12000);
  void loadState;
  await whenStyleReady(map);
  setBoot(0.4, 'Chuẩn bị lộ trình…');
  enableTerrain(map);
  applyDayNight(map, 0);

  setBoot(0.55, 'Nối các điểm dừng…');
  const builtLegs = await buildAllLegs();
  state.builtLegs = builtLegs;

  setBoot(0.72, 'Sắp xếp hành trình…');
  addRouteLayers(map, builtLegs);

  renderTimeline((id) => selectStop(id));
  state.markers = createStopMarkers(map, (id) => selectStop(id));
  state.car = createCarMarker(map, stops[0].lng, stops[0].lat);
  if (import.meta.env.DEV) {
    window.__kem = {
      map,
      car: state.car,
      get builtLegs() {
        return state.builtLegs;
      },
      get routeEditing() {
        return state.routeEditing;
      },
    };
  }

  rebuildPathControllers(map);

  const onPickRoute = (tag) => {
    if (state.drive?.running) {
      state.drive.stop();
      hidePhotos();
      setDriveBtn(false);
    }
    applyCorridor(state.builtLegs, tag);
    refreshRouteGeometry(map, state.builtLegs, getRemovedCorridors(), state.routeDir);
    rebuildPathControllers(map);
    renderRoutePicker(state.builtLegs, routePickerHandlers);
    document.getElementById('hud-phase').textContent = `Tuyến · ${tag}`;
  };

  const onRemoveCorridor = (tag) => {
    const options = corridorOptions(state.builtLegs);
    if (options.length <= 1) return;
    const removed = getRemovedCorridors();
    removed.add(tag);
    setRemovedCorridors(removed);
    const next = ensureSelectedVisible(state.builtLegs);
    refreshRouteGeometry(map, state.builtLegs, removed, state.routeDir);
    rebuildPathControllers(map);
    renderRoutePicker(state.builtLegs, routePickerHandlers);
    if (next) {
      document.getElementById('hud-phase').textContent = `Đã xóa tuyến · còn ${next}`;
    }
  };

  const onRestoreCorridors = () => {
    setRemovedCorridors(new Set());
    refreshRouteGeometry(map, state.builtLegs, new Set(), state.routeDir);
    rebuildPathControllers(map);
    renderRoutePicker(state.builtLegs, routePickerHandlers);
    document.getElementById('hud-phase').textContent = 'Đã khôi phục mọi tuyến';
  };

  const routePickerHandlers = { onPickCorridor: onPickRoute, onRemoveCorridor, onRestoreCorridors };

  ensureSelectedVisible(builtLegs);
  refreshRouteGeometry(map, builtLegs, getRemovedCorridors(), state.routeDir);
  renderRoutePicker(builtLegs, routePickerHandlers);
  applyRouteDir('all');
  updateRailMeta();
  renderHudTicks();
  setHud(0);

  document.querySelectorAll('#route-dir .route-dir__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyRouteDir(btn.dataset.dir, { pin: true });
    });
  });

  function syncRouteEditUi() {
    const btn = document.getElementById('btn-route-edit');
    const reset = document.getElementById('btn-route-reset');
    const hint = document.getElementById('route-edit-hint');
    const on = state.routeEditing;
    if (btn) {
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'Xong chỉnh' : 'Chỉnh tuyến';
    }
    if (reset) reset.hidden = !on;
    if (hint) hint.hidden = !on;
    const dirHint = document.getElementById('route-dir-hint');
    if (dirHint && on) {
      dirHint.textContent = 'Chế độ chỉnh · kéo đường để khớp Google Maps–style';
    } else if (dirHint && !on) {
      syncRouteDirUi(state.routeDir);
    }
  }

  function setRouteEditing(on) {
    state.routeEditing = Boolean(on);
    state.routeEditor?.setEnabled(state.routeEditing);
    if (state.routeEditing) {
      map.doubleClickZoom.disable();
      const fold = document.getElementById('routes-fold');
      if (fold) fold.open = true;
      if (state.drive?.running) {
        state.drive.stop();
        hidePhotos();
        setDriveBtn(false);
      }
      document.getElementById('hud-phase').textContent = 'Chỉnh tuyến · kéo đường';
    } else {
      map.doubleClickZoom.enable();
    }
    syncRouteEditUi();
  }

  state.routeEditor = createRouteEditor({
    map,
    getBuiltLegs: () => state.builtLegs,
    getEnabled: () => state.routeEditing,
    onAfterEdit: () => {
      refreshRouteGeometry(map, state.builtLegs, getRemovedCorridors(), state.routeDir);
      rebuildPathControllers(map);
      renderRoutePicker(state.builtLegs, routePickerHandlers);
      state.routeEditor?.refreshVias();
      const custom = (state.builtLegs || []).some((l) => (l.waypoints || []).length);
      document.getElementById('hud-phase').textContent = custom
        ? 'Đã uốn tuyến · khớp đường'
        : 'Đã khôi phục tuyến gốc';
    },
    onStatus: (msg) => {
      const el = document.getElementById('hud-phase');
      if (el && msg) el.textContent = msg;
    },
  });

  document.getElementById('btn-route-edit')?.addEventListener('click', () => {
    setRouteEditing(!state.routeEditing);
  });

  document.getElementById('btn-route-reset')?.addEventListener('click', async () => {
    if (!state.builtLegs) return;
    document.getElementById('hud-phase').textContent = 'Đang xóa điểm uốn…';
    await resetAllRouteEdits(state.builtLegs);
    refreshRouteGeometry(map, state.builtLegs, getRemovedCorridors(), state.routeDir);
    rebuildPathControllers(map);
    renderRoutePicker(state.builtLegs, routePickerHandlers);
    state.routeEditor?.refreshVias();
    document.getElementById('hud-phase').textContent = 'Đã xóa mọi điểm uốn';
  });

  async function rebuildPlacesJourney() {
    rebuildById();
    rebuildTimeline(stops);
    updateRailMeta();

    if (state.drive?.running) {
      state.drive.stop();
      hidePhotos();
      setDriveBtn(false);
    }
    state.cinema?.pause();

    state.markers?.forEach((m) => m.marker.remove());
    state.markers = createStopMarkers(map, (id) => selectStop(id));

    if (!stops.length) return;
    if (!stops.some((s) => s.id === state.activeId)) {
      state.activeId = stops[0].id;
    }

    state.car?.setLngLat(stops[0].lng, stops[0].lat);

    const built = await buildAllLegs();
    state.builtLegs = built;
    ensureSelectedVisible(built);
    refreshRouteGeometry(map, built, getRemovedCorridors(), state.routeDir);
    state.routeEditor?.refreshVias();
    rebuildPathControllers(map);
    renderRoutePicker(built, routePickerHandlers);
    renderTimeline((id) => selectStop(id));
    renderHudTicks();
    selectStop(state.activeId, { fly: true, photos: false });
    fitJourney(map, getPadding());
    applyRouteDir(routeDirFromT(Number(document.getElementById('time-scrub')?.value || 0) / 1000));
  }

  const placesEditor = createPlacesEditor({
    onRebuild: rebuildPlacesJourney,
    onPickMode: () => {},
  });

  map.on('click', (e) => {
    if (placesEditor.applyMapClick(e.lngLat.lng, e.lngLat.lat)) {
      e.preventDefault();
    }
  });

  document.getElementById('btn-overview')?.addEventListener('click', () => {
    state.drive?.stop();
    hidePhotos();
    setDriveBtn(false);
    state.cinema.pause();
    fitJourney(map, getPadding());
  });

  document.getElementById('btn-drive')?.addEventListener('click', () => {
    if (state.drive?.running) {
      state.drive.stop();
      hidePhotos();
      setDriveBtn(false);
      return;
    }
    state.cinema.pause();
    setDriveBtn(true);
    state.drive.start();
  });

  const carModelBtn = document.getElementById('btn-car-model');
  const carModelLabel = document.getElementById('btn-car-model-label');
  const syncCarLabel = () => {
    if (!carModelLabel || !state.car) return;
    // Keep toolbar short — model name lives in title / garage
    carModelLabel.textContent = 'Xe';
    const name = state.car.modelLabel || 'Xe';
    const blurb = state.car.modelBlurb || 'Chọn xe trong garage';
    carModelBtn?.setAttribute('title', `${name} · ${blurb}`);
  };
  const carPicker = initCarPicker({
    getSelectedId: () => state.car?.modelId,
    onSelect: async (id) => {
      if (!state.car?.setModel) return;
      carModelBtn.disabled = true;
      await state.car.setModel(id);
      syncCarLabel();
      carModelBtn.disabled = false;
    },
  });
  syncCarLabel();
  carModelBtn?.addEventListener('click', () => carPicker.open());

  const hudEl = document.getElementById('hud');
  const scrubEl = document.getElementById('time-scrub');
  const endScrub = () => hudEl?.classList.remove('is-scrubbing');
  scrubEl?.addEventListener('pointerdown', () => hudEl?.classList.add('is-scrubbing'));
  scrubEl?.addEventListener('pointerup', endScrub);
  scrubEl?.addEventListener('pointercancel', endScrub);
  scrubEl?.addEventListener('blur', endScrub);
  scrubEl?.addEventListener('input', (e) => {
    if (state.drive?.running) return;
    state.routeDirPinned = false;
    const t = Number(e.target.value) / 1000;
    state.cinema.pause();
    state.cinema.apply(t, { animateCam: true, duration: 0 });
  });
  document.getElementById('hud-prev')?.addEventListener('click', () => snapHud(-1));
  document.getElementById('hud-next')?.addEventListener('click', () => snapHud(1));

  const KEY_HUD = 'kem-hud-expanded';
  const KEY_RAIL = 'kem-rail-collapsed';
  const KEY_ROUTES = 'kem-routes-open';

  function syncHudExpandUi() {
    const hud = document.getElementById('hud');
    const btn = document.getElementById('hud-expand');
    if (!hud || !btn) return;
    const compact = hud.classList.contains('is-compact');
    btn.setAttribute('aria-expanded', compact ? 'false' : 'true');
    btn.setAttribute('aria-label', compact ? 'Mở rộng thanh hành trình' : 'Thu gọn thanh hành trình');
    btn.title = compact ? 'Mở rộng' : 'Thu gọn';
  }

  function setHudCompact(compact, { persist = true, refit = false } = {}) {
    const hud = document.getElementById('hud');
    if (!hud) return;
    hud.classList.toggle('is-compact', compact);
    if (persist) {
      try {
        sessionStorage.setItem(KEY_HUD, compact ? '0' : '1');
      } catch {
        /* ignore */
      }
    }
    syncHudExpandUi();
    if (refit && state.map) fitJourney(state.map, getPadding());
  }

  function setRailCollapsed(collapsed, { persist = true, refit = false } = {}) {
    const rail = document.getElementById('rail');
    const fab = document.getElementById('rail-fab');
    if (!rail || !fab) return;
    rail.classList.toggle('is-collapsed', collapsed);
    rail.hidden = collapsed;
    fab.hidden = !collapsed;
    fab.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (!collapsed) {
      gsap.set(rail, { clearProps: 'opacity,transform,x' });
    }
    if (persist) {
      try {
        sessionStorage.setItem(KEY_RAIL, collapsed ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
    if (refit && state.map) fitJourney(state.map, getPadding());
  }

  try {
    setHudCompact(sessionStorage.getItem(KEY_HUD) !== '1', { persist: false, refit: false });
    setRailCollapsed(sessionStorage.getItem(KEY_RAIL) === '1', { persist: false, refit: false });
    const routesFold = document.getElementById('routes-fold');
    if (routesFold && sessionStorage.getItem(KEY_ROUTES) === '1') routesFold.open = true;
  } catch {
    syncHudExpandUi();
  }

  document.getElementById('hud-expand')?.addEventListener('click', () => {
    const hud = document.getElementById('hud');
    setHudCompact(!hud?.classList.contains('is-compact'));
  });
  document.getElementById('rail-collapse')?.addEventListener('click', () => setRailCollapsed(true));
  document.getElementById('rail-fab')?.addEventListener('click', () => setRailCollapsed(false));
  document.getElementById('routes-fold')?.addEventListener('toggle', (e) => {
    try {
      sessionStorage.setItem(KEY_ROUTES, e.currentTarget.open ? '1' : '0');
    } catch {
      /* ignore */
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, button')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      document.getElementById('btn-drive').click();
    }
    if (e.key === 'ArrowRight') {
      if (e.shiftKey) {
        e.preventDefault();
        snapHud(1);
        return;
      }
      const idx = stops.findIndex((s) => s.id === state.activeId);
      if (idx < stops.length - 1) selectStop(stops[idx + 1].id);
    }
    if (e.key === 'ArrowLeft') {
      if (e.shiftKey) {
        e.preventDefault();
        snapHud(-1);
        return;
      }
      const idx = stops.findIndex((s) => s.id === state.activeId);
      if (idx > 0) selectStop(stops[idx - 1].id);
    }
  });

  setBoot(0.9, 'Gần xong…');
  state.activeId = stops[0].id;
  updateSheet(stops[0]);
  state.cinema.apply(0, { animateCam: false, hintStops: false });
  fitJourney(map, getPadding());

  setBoot(1, 'Xong');
  await new Promise((r) => setTimeout(r, 350));
  finishBoot();
  requestAnimationFrame(() => {
    map.resize();
    selectStop(stops[0].id, { fly: false, photos: false });
    fitJourney(map, getPadding());
  });

  window.addEventListener('resize', () => map.resize());
}

initMusic();
main().catch((err) => {
  console.error(err);
  setBoot(1, 'Sẵn sàng');
  finishBoot();
});
