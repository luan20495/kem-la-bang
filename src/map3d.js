import {
  Map as MapLibreMap,
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

/** Flat 2D map — tip marker khớp đúng lat/lng (không lệch vì pitch 3D). */
export const MAP_2D = {
  pitch: 0,
  bearing: 0,
  maxPitch: 0,
};

export function createMap(container) {
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
            'raster-saturation': 0.12,
            'raster-contrast': 0.08,
            'raster-brightness-min': 0.02,
          },
        },
      ],
    },
    center: [105.7, 21.3],
    zoom: 8.2,
    pitch: MAP_2D.pitch,
    bearing: MAP_2D.bearing,
    maxPitch: MAP_2D.maxPitch,
    minPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    canvasContextAttributes: { antialias: true },
    attributionControl: true,
  });

  map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right');
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

/** Keep map flat 2D so pin tips land on exact coordinates. */
export function enableTerrain(map) {
  map.easeTo({ pitch: MAP_2D.pitch, bearing: MAP_2D.bearing, duration: 0 });
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
  if (map.getSource('routes')) {
    refreshRouteGeometry(map, builtLegs, new Set(), 'all');
    setRouteDirection(map, 'all');
    return;
  }

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
        '#aeaeb2',
        1,
        '#8e8e93',
        2,
        '#636366',
        '#aeaeb2',
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        2,
        12,
        3,
        15,
        4,
      ],
      'line-opacity': 0.38,
      'line-dasharray': [1.4, 1.8],
    },
  });

  // One Feature per journey leg — Apple Maps–thin casing + core
  map.addSource('routes', {
    type: 'geojson',
    data: legsToRouteFeatures(builtLegs),
  });

  map.addLayer({
    id: 'routes-aura',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['match', ['get', 'kind'], 'local', 6, 'overnight', 6, 8],
        12,
        ['match', ['get', 'kind'], 'local', 10, 'overnight', 10, 14],
        15,
        ['match', ['get', 'kind'], 'local', 14, 'overnight', 14, 18],
      ],
      'line-opacity': 0.1,
      'line-blur': 1.4,
    },
  });
  map.addLayer({
    id: 'routes-glow',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        4,
        12,
        7,
        15,
        9,
      ],
      'line-opacity': 0.14,
      'line-blur': 0.6,
    },
  });
  map.addLayer({
    id: 'routes-casing',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['match', ['get', 'kind'], 'local', 4.5, 'overnight', 4.2, 5.5],
        12,
        ['match', ['get', 'kind'], 'local', 6.5, 'overnight', 6, 8],
        15,
        ['match', ['get', 'kind'], 'local', 8, 'overnight', 7.5, 10],
      ],
      'line-opacity': 0.92,
    },
  });
  map.addLayer({
    id: 'routes-core',
    type: 'line',
    source: 'routes',
    filter: ['!', ['in', ['get', 'kind'], ['literal', ['return', 'overnight']]]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['match', ['get', 'kind'], 'long', 2.5, 2.2],
        12,
        ['match', ['get', 'kind'], 'long', 3.8, 3.2],
        15,
        ['match', ['get', 'kind'], 'long', 5, 4.2],
      ],
      'line-opacity': 1,
    },
  });
  map.addLayer({
    id: 'routes-core-overnight',
    type: 'line',
    source: 'routes',
    filter: ['==', ['get', 'kind'], 'overnight'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        2,
        12,
        2.8,
        15,
        3.6,
      ],
      'line-opacity': 0.92,
      'line-dasharray': [1.6, 2],
    },
  });
  map.addLayer({
    id: 'routes-core-return',
    type: 'line',
    source: 'routes',
    filter: ['==', ['get', 'kind'], 'return'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        2.4,
        12,
        3.6,
        15,
        4.8,
      ],
      'line-opacity': 1,
      'line-dasharray': [2.2, 1.6],
    },
  });

  // Fat invisible hit target for Google Maps–style route grab
  map.addLayer({
    id: 'routes-edit-hit',
    type: 'line',
    source: 'routes',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'none',
    },
    paint: {
      'line-color': '#000',
      'line-width': 28,
      'line-opacity': 0,
    },
  });

  map.addSource('vias', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'vias-halo',
    type: 'circle',
    source: 'vias',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 14,
      'circle-color': '#007AFF',
      'circle-opacity': 0.16,
      'circle-blur': 0.4,
    },
  });
  map.addLayer({
    id: 'vias-core',
    type: 'circle',
    source: 'vias',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['get', 'ghost'], false],
        7,
        8,
      ],
      'circle-color': '#ffffff',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': [
        'case',
        ['boolean', ['get', 'ghost'], false],
        '#8E8E93',
        '#007AFF',
      ],
      'circle-opacity': 0.98,
    },
  });
  map.addLayer({
    id: 'vias-hit',
    type: 'circle',
    source: 'vias',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 18,
      'circle-opacity': 0,
      'circle-stroke-opacity': 0,
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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 20],
      'circle-color': '#FF9F0A',
      'circle-opacity': 0.14,
      'circle-blur': 0.7,
    },
  });
  map.addLayer({
    id: 'traveler-ring',
    type: 'circle',
    source: 'traveler',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 10],
      'circle-color': 'transparent',
      'circle-opacity': 0,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#FF6937',
      'circle-stroke-opacity': 0.4,
    },
  });
  map.addLayer({
    id: 'traveler-core',
    type: 'circle',
    source: 'traveler',
    paint: {
      'circle-radius': 3,
      'circle-color': '#fffef8',
      'circle-opacity': 0,
      'circle-stroke-width': 0,
      'circle-stroke-color': '#FF6937',
    },
  });

  refreshRouteGeometry(map, builtLegs, new Set(), 'all');
  setRouteDirection(map, 'all');
}

/** Color + kind for each journey segment (own polyline). Apple system-adjacent. */
function legStyle(leg) {
  if (leg.return) return { color: '#FF6937', kind: 'return' };
  if (leg.overnight) return { color: '#64D2FF', kind: 'overnight' };
  if (leg.from === 'nghi-duong' && leg.to === 'tra-chieu') {
    return { color: '#007AFF', kind: 'local' };
  }
  if (leg.from === 'nghi-duong' && leg.to === 'mua-qua') {
    return { color: '#34C759', kind: 'local' };
  }
  if (leg.longHaul) return { color: '#248A3D', kind: 'long' };
  return { color: '#248A3D', kind: 'local' };
}

function legsToRouteFeatures(builtLegs = []) {
  return {
    type: 'FeatureCollection',
    features: builtLegs
      .filter((l) => l?.coordinates?.length > 1)
      .map((leg, index) => {
        const { color, kind } = legStyle(leg);
        return {
          type: 'Feature',
          properties: {
            index,
            from: leg.from,
            to: leg.to,
            label: leg.label || `${leg.from} → ${leg.to}`,
            return: Boolean(leg.return),
            overnight: Boolean(leg.overnight),
            longHaul: Boolean(leg.longHaul),
            kind,
            color,
          },
          geometry: {
            type: 'LineString',
            coordinates: leg.coordinates,
          },
        };
      }),
  };
}

/** Redraw each leg polyline + alternative corridors. */
export function refreshRouteGeometry(map, builtLegs, hiddenTags = new Set(), dir = 'all') {
  const altFeatures = [];
  builtLegs.forEach((leg, legIndex) => {
    const isReturn = Boolean(leg.return);
    if (dir === 'out' && isReturn) return;
    if (dir === 'back' && !isReturn) return;
    (leg.alternatives || []).forEach((alt, ai) => {
      if (ai === leg.selected) return;
      if (hiddenTags.has(alt.tag)) return;
      if (!leg.longHaul && !leg.return) return;
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

  const routes = map.getSource('routes');
  if (routes) {
    routes.setData(legsToRouteFeatures(builtLegs));
  }

  setRouteDirection(map, dir);
}

/**
 * Filter which journey segments are visible.
 * @param {import('maplibre-gl').Map} map
 * @param {'all' | 'out' | 'back'} dir
 */
export function setRouteDirection(map, dir) {
  if (!map) return;
  const mode = dir === 'back' || dir === 'out' ? dir : 'all';

  const dirFilter =
    mode === 'out'
      ? ['!=', ['get', 'kind'], 'return']
      : mode === 'back'
        ? ['==', ['get', 'kind'], 'return']
        : null;

  const combine = (base) => {
    if (!dirFilter) return base;
    if (!base) return dirFilter;
    return ['all', base, dirFilter];
  };

  const layerFilters = {
    'routes-aura': combine(null),
    'routes-glow': combine(null),
    'routes-casing': combine(null),
    'routes-core': combine([
      '!',
      ['in', ['get', 'kind'], ['literal', ['return', 'overnight']]],
    ]),
    'routes-core-overnight': combine(['==', ['get', 'kind'], 'overnight']),
    'routes-core-return': combine(['==', ['get', 'kind'], 'return']),
    'routes-edit-hit': combine(null),
  };

  for (const [id, filter] of Object.entries(layerFilters)) {
    if (!map.getLayer(id)) continue;
    if (id !== 'routes-edit-hit') {
      map.setLayoutProperty(id, 'visibility', 'visible');
    }
    map.setFilter(id, filter);
  }

  if (map.getLayer('route-alts-line')) {
    map.setLayoutProperty(
      'route-alts-line',
      'visibility',
      mode === 'back' ? 'none' : 'visible'
    );
  }

  // Hide legacy stacked layers if an old session still has them
  for (const id of [
    'route-out-aura',
    'route-out-glow',
    'route-out-casing',
    'route-out-core',
    'route-out-highlight',
    'route-in-aura',
    'route-in-glow',
    'route-in-core',
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
}

export function setTraveler(map, lng, lat) {
  const src = map.getSource('traveler');
  if (src) src.setData(pointFeature(lng, lat));
}

/** Via / ghost handles for route editing. */
export function setViasData(map, geojson) {
  const src = map.getSource('vias');
  if (src) src.setData(geojson || { type: 'FeatureCollection', features: [] });
}

/** Show fat hit target + via handles when editing. */
export function setRouteEditInteractive(map, on) {
  if (!map) return;
  if (map.getLayer('routes-edit-hit')) {
    map.setLayoutProperty('routes-edit-hit', 'visibility', on ? 'visible' : 'none');
  }
  for (const id of ['vias-halo', 'vias-core', 'vias-hit']) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }
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

function stopsGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: stops.map((s) => ({
      type: 'Feature',
      id: s.id,
      properties: {
        id: s.id,
        name: s.name,
        order: String(s.order),
        color: s.color,
        icon: `stop-pin-${s.id}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [s.lng, s.lat],
      },
    })),
  };
}

/**
 * Apple Maps–scale teardrop pin (24×31 logical).
 * Tip = bottom-center pixel for icon-anchor: bottom.
 */
function makePinImage(color, order, pixelRatio = 3) {
  const lw = 24;
  const lh = 31;
  const w = lw * pixelRatio;
  const h = lh * pixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = 1;

  const pin = new Path2D(
    'M12 31C12 31 2 20.2 2 11.25a10 10 0 1 1 20 0C22 20.2 12 31 12 31Z'
  );
  ctx.fillStyle = color;
  ctx.fill(pin);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke(pin);

  ctx.beginPath();
  ctx.arc(12, 29.6, 0.95, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  const ink = pinInk(color);
  ctx.fillStyle = ink;
  ctx.font =
    '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (ink === '#ffffff') {
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 1;
    ctx.shadowOffsetY = 0.35;
  }
  ctx.fillText(String(order), 12, 11.15);
  ctx.restore();

  return {
    width: w,
    height: h,
    data: ctx.getImageData(0, 0, w, h).data,
    pixelRatio,
  };
}

/** White on saturated pins; near-black on yellows / light fills. */
function pinInk(hex) {
  const n = String(hex).replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const v = parseInt(full, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#1c1c1e' : '#ffffff';
}

let stopMarkersBound = false;
let stopMarkersMap = null;
let stopSelectHandler = null;

function destroyStopMarkerLayers(map) {
  if (!map) return;
  try {
    if (map.getLayer('stops-label')) map.removeLayer('stops-label');
    if (map.getLayer('stops-pin')) map.removeLayer('stops-pin');
    if (map.getLayer('stops-hit')) map.removeLayer('stops-hit');
    if (map.getSource('stops')) map.removeSource('stops');
    for (const s of stops) {
      const id = `stop-pin-${s.id}`;
      if (map.hasImage(id)) map.removeImage(id);
    }
  } catch {
    /* style may be mid-reload */
  }
}

/**
 * Geographic symbol pins — projected by MapLibre every frame.
 * Tip stays on exact lng/lat at any zoom (unlike HTML Marker + CSS fights).
 */
export function createStopMarkers(map, onSelect) {
  destroyStopMarkerLayers(map);
  stopMarkersMap = map;
  stopSelectHandler = onSelect;

  const add = () => {
    if (!map.isStyleLoaded()) return false;
    try {
      destroyStopMarkerLayers(map);

      for (const stop of stops) {
        const imgId = `stop-pin-${stop.id}`;
        const img = makePinImage(stop.color || '#248A3D', stop.order, 3);
        if (map.hasImage(imgId)) map.removeImage(imgId);
        map.addImage(
          imgId,
          {
            width: img.width,
            height: img.height,
            data: new Uint8Array(img.data),
          },
          { pixelRatio: img.pixelRatio }
        );
      }

      map.addSource('stops', {
        type: 'geojson',
        data: stopsGeoJSON(),
        promoteId: 'id',
      });

      map.addLayer({
        id: 'stops-hit',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            12,
            14,
            16,
          ],
          'circle-opacity': 0,
          'circle-stroke-opacity': 0,
        },
      });

      map.addLayer({
        id: 'stops-pin',
        type: 'symbol',
        source: 'stops',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-anchor': 'bottom',
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            7,
            0.78,
            10,
            0.9,
            13,
            1,
            16,
            1.06,
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-padding': 2,
        },
      });

      try {
        map.addLayer({
          id: 'stops-label',
          type: 'symbol',
          source: 'stops',
          layout: {
            'text-field': ['get', 'name'],
            'text-anchor': 'bottom',
            'text-offset': [0, -2.85],
            'text-size': 11,
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-optional': true,
          },
          paint: {
            'text-color': '#1c1c1e',
            'text-halo-color': 'rgba(255,255,255,0.92)',
            'text-halo-width': 1.25,
            'text-opacity': [
              'case',
              ['boolean', ['feature-state', 'active'], false],
              1,
              0,
            ],
          },
        });
      } catch (labelErr) {
        console.warn('Stop labels unavailable', labelErr);
      }

      if (!stopMarkersBound) {
        stopMarkersBound = true;
        const pick = (e) => {
          const f = e.features?.[0];
          const id = f?.properties?.id;
          if (id) stopSelectHandler?.(id);
        };
        map.on('click', 'stops-hit', pick);
        map.on('click', 'stops-pin', pick);
        map.on('mouseenter', 'stops-hit', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'stops-hit', () => {
          map.getCanvas().style.cursor = '';
        });
        map.on('mouseenter', 'stops-pin', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'stops-pin', () => {
          map.getCanvas().style.cursor = '';
        });
      }
      return true;
    } catch (err) {
      console.error('createStopMarkers failed', err);
      return false;
    }
  };

  if (!add()) {
    map.once('load', add);
    map.once('idle', () => {
      if (!map.getSource('stops')) add();
    });
  }

  return stops.map((s) => ({
    id: s.id,
    el: null,
    marker: {
      remove() {
        destroyStopMarkerLayers(map);
      },
    },
  }));
}

export function setActiveMarker(markers, id) {
  const map = stopMarkersMap;
  if (!map?.getSource?.('stops')) return;
  for (const m of markers || []) {
    try {
      map.setFeatureState({ source: 'stops', id: m.id }, { active: m.id === id });
    } catch {
      /* ignore */
    }
  }
  // Emphasize active pin — subtle Apple Maps lift
  if (map.getLayer('stops-pin')) {
    map.setLayoutProperty('stops-pin', 'icon-size', [
      'interpolate',
      ['linear'],
      ['zoom'],
      7,
      ['case', ['==', ['get', 'id'], id], 0.86, 0.78],
      10,
      ['case', ['==', ['get', 'id'], id], 0.98, 0.9],
      13,
      ['case', ['==', ['get', 'id'], id], 1.08, 1],
      16,
      ['case', ['==', ['get', 'id'], id], 1.14, 1.06],
    ]);
  }
}

export function refreshStopMarkers(map) {
  if (!map?.getSource?.('stops')) {
    createStopMarkers(map, stopSelectHandler || (() => {}));
    return;
  }
  for (const stop of stops) {
    const imgId = `stop-pin-${stop.id}`;
    const img = makePinImage(stop.color || '#248A3D', stop.order, 3);
    if (map.hasImage(imgId)) map.removeImage(imgId);
    map.addImage(
      imgId,
      {
        width: img.width,
        height: img.height,
        data: new Uint8Array(img.data),
      },
      { pixelRatio: img.pixelRatio }
    );
  }
  map.getSource('stops').setData(stopsGeoJSON());
}

export function fitJourney(map, padding) {
  const bounds = new LngLatBounds();
  stops.forEach((s) => bounds.extend([s.lng, s.lat]));
  map.fitBounds(bounds, {
    padding,
    pitch: MAP_2D.pitch,
    bearing: MAP_2D.bearing,
    duration: 1200,
    essential: true,
  });
}

export function getPadding() {
  const hudCompact = document.getElementById('hud')?.classList.contains('is-compact');
  const railCollapsed = document.getElementById('rail')?.classList.contains('is-collapsed');
  if (window.innerWidth < 900) {
    return { top: 110, bottom: hudCompact ? 200 : 300, left: 20, right: 20 };
  }
  return {
    top: 100,
    bottom: hudCompact ? 108 : 148,
    left: railCollapsed ? 88 : 360,
    right: 40,
  };
}
