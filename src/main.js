import gsap from 'gsap';
import { Popup } from 'maplibre-gl';
import { stops, trip } from './journey.js';
import { buildAllLegs, buildCinemaPath, byId, selectLegAlternative } from './routing.js';
import {
  createMap,
  waitForMap,
  whenStyleReady,
  enableTerrain,
  addRouteLayers,
  refreshRouteGeometry,
  createStopMarkers,
  setActiveMarker,
  fitJourney,
  getPadding,
  applyDayNight,
  setTraveler,
} from './map3d.js';
import { createAtmosphere, createBootScene } from './atmosphere.js';
import { createCinemaController } from './cinema.js';
import { createCarMarker, createDriveTour } from './drive.js';
import { beatAt, SCRUB_STOPS, DRIVE_STOP_T } from './timeline.js';
import './style.css';

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
  if (blurb) blurb.textContent = stop.blurb;
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
  const t = DRIVE_STOP_T[stop.id];
  if (t != null) {
    setHud(t, {
      timeText: `${stop.day} · ${stop.time}`,
      place: stop.name,
      label: stop.role,
    });
  }
}

function corridorOptions(builtLegs) {
  const choosable = builtLegs.filter((leg) => (leg.alternatives?.length || 0) > 1);
  if (!choosable.length) return [];

  // Use the first long-haul leg as the “menu” of corridors
  const primary = choosable.find((l) => !l.return) || choosable[0];
  return primary.alternatives.map((alt, index) => {
    const short =
      alt.tag === 'Nhanh nhất'
        ? 'Nhanh nhất'
        : alt.tag === 'Qua Cầu Thanh Trì'
          ? 'Thanh Trì'
          : alt.tag === 'Qua Cầu Vĩnh Tuy'
            ? 'Vĩnh Tuy'
            : alt.tag.replace(/^Qua\s+/i, '');
    const go = choosable.find((l) => !l.return);
    const back = choosable.find((l) => l.return);
    const goAlt = go?.alternatives?.find((a) => a.tag === alt.tag) || go?.alternatives?.[index];
    const backAlt =
      back?.alternatives?.find((a) => a.tag === alt.tag) || back?.alternatives?.[index];
    const parts = [];
    if (goAlt) parts.push(`Đi ${goAlt.kmLabel}`);
    if (backAlt) parts.push(`Về ${backAlt.kmLabel}`);
    const timeParts = [];
    if (goAlt) timeParts.push(goAlt.timeLabel);
    if (backAlt) timeParts.push(backAlt.timeLabel);
    return {
      tag: alt.tag,
      short,
      index,
      summary: parts.join(' · '),
      time: timeParts.join(' → '),
      selected: choosable.every((leg) => {
        const match = leg.alternatives.findIndex((a) => a.tag === alt.tag);
        return (match >= 0 ? match : index) === leg.selected;
      }),
    };
  });
}

function applyCorridor(builtLegs, tag) {
  builtLegs.forEach((leg) => {
    if ((leg.alternatives?.length || 0) < 2) return;
    const idx = leg.alternatives.findIndex((a) => a.tag === tag);
    if (idx >= 0) selectLegAlternative(leg, idx);
  });
}

function renderRoutePicker(builtLegs, onPickCorridor) {
  const host = document.getElementById('route-legs');
  const label = document.querySelector('.routes__label');
  if (!host) return;

  const options = corridorOptions(builtLegs);
  if (!options.length) {
    if (label) label.hidden = true;
    host.innerHTML = '';
    return;
  }

  if (label) {
    label.hidden = false;
    label.textContent = 'Tuyến đường';
  }

  const active = options.find((o) => o.selected) || options[0];
  host.innerHTML = `
    <div class="route-seg" role="radiogroup" aria-label="Chọn hành lang">
      ${options
        .map(
          (o) => `
        <button type="button" class="route-seg__btn ${o.selected ? 'is-on' : ''}"
          role="radio" aria-checked="${o.selected}" data-tag="${o.tag}">
          ${o.short}
        </button>`
        )
        .join('')}
    </div>
    <p class="route-seg__meta">
      <span class="route-seg__sum">${active.summary}</span>
      <span class="route-seg__time">${active.time}</span>
    </p>
  `;

  host.querySelectorAll('.route-seg__btn').forEach((btn) => {
    btn.addEventListener('click', () => onPickCorridor(btn.dataset.tag));
  });
}

function setHud(t, overrides = {}) {
  const beat = beatAt(t);
  const scrub = document.getElementById('time-scrub');
  if (scrub && document.activeElement !== scrub) {
    scrub.value = String(Math.round(beat.t * 1000));
  }
  document.getElementById('hud-clock').textContent = overrides.timeText || beat.timeText;
  document.getElementById('hud-place').textContent = overrides.place || beat.place;
  document.getElementById('hud-phase').textContent = overrides.label || beat.label;
  document.querySelectorAll('.hud__tick').forEach((el) => {
    const tt = Number(el.dataset.t);
    el.classList.toggle('is-on', Math.abs(tt - beat.t) < 0.06);
  });
}

function renderHudTicks() {
  const host = document.getElementById('hud-ticks');
  if (!host) return;
  host.innerHTML = SCRUB_STOPS.map(
    (s) =>
      `<span class="hud__tick" data-t="${s.t}" style="left:${s.t * 100}%" title="${s.place}"></span>`
  ).join('');
}

function rebuildPathControllers(map) {
  const path = buildCinemaPath(state.builtLegs);
  state.cinema = createCinemaController({
    map,
    path,
    onStopHint: () => {},
    onTick: ({ t }) => setHud(t),
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

  if (fly) {
    state.map.flyTo({
      center: [stop.lng, stop.lat],
      zoom: 13,
      pitch: 0,
      bearing: 0,
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
  btn.querySelector('.chip__cinema-label').textContent = on ? 'Đang lái…' : 'Lái xe';
}

function initMusic() {
  const toggle = document.getElementById('music-toggle');
  const dock = document.getElementById('music-dock');
  const label = toggle.querySelector('.chip__label');
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
            label.textContent = 'Mở YouTube';
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
    label.textContent = on ? 'Nhạc nền' : 'Phát nhạc';
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
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.from('.rail', { x: -40, opacity: 0, duration: 0.95 }, 0)
    .from('.topbar__actions .chip', { y: 18, opacity: 0, duration: 0.7, stagger: 0.08 }, 0.12)
    .from('.brand--mobile', { y: 24, opacity: 0, duration: 0.8 }, 0)
    .from('.hud', { y: 30, opacity: 0, duration: 0.8 }, 0.3);
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

  rebuildPathControllers(map);

  const onPickRoute = (tag) => {
    if (state.drive?.running) {
      state.drive.stop();
      hidePhotos();
      setDriveBtn(false);
    }
    applyCorridor(state.builtLegs, tag);
    refreshRouteGeometry(map, state.builtLegs);
    rebuildPathControllers(map);
    renderRoutePicker(state.builtLegs, onPickRoute);
    document.getElementById('hud-phase').textContent = `Tuyến · ${tag}`;
  };
  renderRoutePicker(builtLegs, onPickRoute);
  renderHudTicks();
  setHud(0);

  document.getElementById('btn-overview').addEventListener('click', () => {
    state.drive?.stop();
    hidePhotos();
    setDriveBtn(false);
    state.cinema.pause();
    fitJourney(map, getPadding());
  });

  document.getElementById('btn-drive').addEventListener('click', () => {
    if (state.drive.running) {
      state.drive.stop();
      hidePhotos();
      setDriveBtn(false);
      return;
    }
    state.cinema.pause();
    setDriveBtn(true);
    state.drive.start();
  });

  document.getElementById('time-scrub').addEventListener('input', (e) => {
    if (state.drive?.running) return;
    const t = Number(e.target.value) / 1000;
    state.cinema.scrub(t);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      document.getElementById('btn-drive').click();
    }
    if (e.key === 'ArrowRight') {
      const idx = stops.findIndex((s) => s.id === state.activeId);
      if (idx < stops.length - 1) selectStop(stops[idx + 1].id);
    }
    if (e.key === 'ArrowLeft') {
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
