import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  LngLatBounds,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { stops } from './journey.js';

setWorkerUrl(workerUrl);

const BASE_TILES = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png';

export function createMap(container) {
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {
        carto: {
          type: 'raster',
          tiles: [BASE_TILES],
          tileSize: 512,
          attribution: '© OSM · © CARTO',
        },
      },
      layers: [
        {
          id: 'carto',
          type: 'raster',
          source: 'carto',
          paint: {
            'raster-saturation': -0.08,
            'raster-contrast': 0.04,
          },
        },
      ],
    },
    center: [105.7, 21.3],
    zoom: 8.2,
    pitch: 0,
    bearing: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    antialias: true,
    attributionControl: true,
  });

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new ScaleControl({ maxWidth: 120 }), 'bottom-left');

  return map;
}

export function waitForMap(map, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const ready = () => map.loaded() && map.isStyleLoaded();
    if (ready()) {
      resolve('loaded');
      return;
    }
    const onLoad = () => {
      if (!ready()) return;
      cleanup();
      resolve('loaded');
    };
    const onError = (e) => {
      console.warn('MapLibre error', e?.error || e);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(ready() ? 'loaded' : 'timeout');
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      map.off('load', onLoad);
      map.off('idle', onLoad);
      map.off('error', onError);
    }
    map.on('load', onLoad);
    map.on('idle', onLoad);
    map.on('error', onError);
  });
}

/** Wait until style can accept sources/layers. */
export function whenStyleReady(map, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      map.off('load', onReady);
      map.off('idle', onReady);
      // Proceed anyway — addRouteLayers may still work after tiles arrive
      resolve();
    }, timeoutMs);
    function onReady() {
      if (!map.isStyleLoaded()) return;
      clearTimeout(timer);
      map.off('load', onReady);
      map.off('idle', onReady);
      resolve();
    }
    map.on('load', onReady);
    map.on('idle', onReady);
  });
}

/** Map stays 2D — day/night only drives CSS atmosphere overlays. */
export function enableTerrain() {
  /* no-op: flat 2D map by design */
}

export function applyDayNight(_map, t) {
  const cycle = (t * 1.6) % 1;
  const night = cycle > 0.55 && cycle < 0.85;
  const dusk = cycle > 0.42 && cycle <= 0.55;
  const dawn = cycle >= 0.85 || cycle < 0.12;

  let grade = 'day';
  if (dusk) grade = 'dusk';
  else if (night) grade = 'night';
  else if (dawn) grade = 'dawn';

  document.documentElement.dataset.grade = grade;
}

export function addRouteLayers(map, builtLegs) {
  if (!map.isStyleLoaded()) {
    map.once('load', () => addRouteLayers(map, builtLegs));
    return;
  }
  if (map.getSource('route-out')) return;

  // Alternative polylines (all options, dim)
  map.addSource('route-alts', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'route-alts-line',
    type: 'line',
    source: 'route-alts',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'match',
        ['get', 'tone'],
        0,
        '#94a3b8',
        1,
        '#64748b',
        2,
        '#475569',
        '#94a3b8',
      ],
      'line-width': 4,
      'line-opacity': 0.45,
      'line-dasharray': [1.2, 1.6],
    },
  });

  const outbound = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: builtLegs.filter((l) => !l.return).map((l) => l.coordinates),
    },
  };
  const ret = builtLegs.find((l) => l.return);
  const inbound = ret
    ? {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: ret.coordinates },
      }
    : null;

  map.addSource('route-out', { type: 'geojson', data: outbound });
  if (inbound) map.addSource('route-in', { type: 'geojson', data: inbound });

  // Return under outbound so shared roads stay green; return-only spurs still show.
  if (inbound) {
    map.addLayer({
      id: 'route-in-glow',
      type: 'line',
      source: 'route-in',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FF8A4C',
        'line-width': 12,
        'line-opacity': 0.32,
        'line-blur': 1.1,
      },
    });
    map.addLayer({
      id: 'route-in-core',
      type: 'line',
      source: 'route-in',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#E35D2A',
        'line-width': 5,
        'line-opacity': 0.92,
        'line-dasharray': [2.4, 1.4],
      },
    });
  }

  map.addLayer({
    id: 'route-out-glow',
    type: 'line',
    source: 'route-out',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FFC247',
      'line-width': 14,
      'line-opacity': 0.28,
      'line-blur': 1.2,
    },
  });

  map.addLayer({
    id: 'route-out-core',
    type: 'line',
    source: 'route-out',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0F5C4A',
      'line-width': 5,
      'line-opacity': 0.95,
    },
  });

  map.addSource('traveler', {
    type: 'geojson',
    data: pointFeature(stops[0].lng, stops[0].lat),
  });
  map.addLayer({
    id: 'traveler-halo',
    type: 'circle',
    source: 'traveler',
    paint: {
      'circle-radius': 18,
      'circle-color': '#FFC247',
      'circle-opacity': 0.25,
      'circle-blur': 0.6,
    },
  });
  map.addLayer({
    id: 'traveler-core',
    type: 'circle',
    source: 'traveler',
    paint: {
      'circle-radius': 7,
      'circle-color': '#fff8e8',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#E35D2A',
    },
  });

  refreshRouteGeometry(map, builtLegs);
}

/** Redraw selected + alternative geometries after user picks a tuyến. */
export function refreshRouteGeometry(map, builtLegs, hiddenTags = new Set()) {
  const altFeatures = [];
  builtLegs.forEach((leg, legIndex) => {
    (leg.alternatives || []).forEach((alt, ai) => {
      if (ai === leg.selected) return;
      if (hiddenTags.has(alt.tag)) return;
      altFeatures.push({
        type: 'Feature',
        properties: { legIndex, altIndex: ai, tone: ai },
        geometry: { type: 'LineString', coordinates: alt.coordinates },
      });
    });
  });

  const alts = map.getSource('route-alts');
  if (alts) {
    alts.setData({ type: 'FeatureCollection', features: altFeatures });
  }

  const outbound = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: builtLegs.filter((l) => !l.return).map((l) => l.coordinates),
    },
  };
  const outSrc = map.getSource('route-out');
  if (outSrc) outSrc.setData(outbound);

  const ret = builtLegs.find((l) => l.return);
  const inSrc = map.getSource('route-in');
  if (inSrc && ret) {
    inSrc.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: ret.coordinates },
    });
  }
}

export function setTraveler(map, lng, lat) {
  const src = map.getSource('traveler');
  if (src) src.setData(pointFeature(lng, lat));
}

function pointFeature(lng, lat) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [lng, lat] },
      },
    ],
  };
}

export function createStopMarkers(map, onSelect) {
  return stops.map((stop) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'm-pin';
    el.style.setProperty('--pin', stop.color);
    el.innerHTML = `<span class="m-pin__num">${stop.order}</span><span class="m-pin__ring"></span><span class="m-pin__label">${stop.name}</span>`;
    el.setAttribute('aria-label', `${stop.role}: ${stop.name}`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(stop.id);
    });

    const marker = new Marker({ element: el, anchor: 'center' })
      .setLngLat([stop.lng, stop.lat])
      .addTo(map);

    return { id: stop.id, marker, el };
  });
}

export function setActiveMarker(markers, id) {
  markers.forEach(({ id: mid, el }) => {
    el.classList.toggle('is-active', mid === id);
  });
}

export function fitJourney(map, padding) {
  const bounds = new LngLatBounds();
  stops.forEach((s) => bounds.extend([s.lng, s.lat]));
  map.fitBounds(bounds, {
    padding,
    pitch: 0,
    bearing: 0,
    duration: 1200,
    essential: true,
  });
}

export function getPadding() {
  if (window.innerWidth < 900) {
    return { top: 110, bottom: 300, left: 20, right: 20 };
  }
  return { top: 100, bottom: 130, left: 360, right: 40 };
}
