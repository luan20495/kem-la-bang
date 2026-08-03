/**
 * Google Maps–style route editing:
 * - Drag a route segment → insert a via → OSRM snaps to roads
 * - Drag a white via handle to reshape
 * - Double-click a via to remove
 */
import {
  nearestPointOnLine,
  insertViaOnLeg,
  moveViaOnLeg,
  removeViaOnLeg,
  MAX_VIAS,
} from './routing.js';
import { setViasData, setRouteEditInteractive } from './map3d.js';

const HIT_M = 45; // meters — generous like Google Maps grab feel
const DRAG_PX = 6;

/**
 * @param {{
 *   map: import('maplibre-gl').Map,
 *   getBuiltLegs: () => any[],
 *   getEnabled: () => boolean,
 *   onAfterEdit: () => void,
 *   onStatus?: (msg: string) => void,
 * }} opts
 */
export function createRouteEditor(opts) {
  const { map, getBuiltLegs, getEnabled, onAfterEdit, onStatus } = opts;

  let dragging = null; // { kind:'via'|'insert', legIndex, viaIndex?, startX, startY, moved }
  let busy = false;
  let bound = false;

  function viasGeoJSON() {
    const features = [];
    (getBuiltLegs() || []).forEach((leg, legIndex) => {
      (leg.waypoints || []).forEach((w, viaIndex) => {
        features.push({
          type: 'Feature',
          properties: { legIndex, viaIndex },
          geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
        });
      });
    });
    return { type: 'FeatureCollection', features };
  }

  function refreshVias() {
    setViasData(map, viasGeoJSON());
  }

  function findLegAt(lngLat) {
    const legs = getBuiltLegs() || [];
    let best = null;
    legs.forEach((leg, legIndex) => {
      const hit = nearestPointOnLine(leg.coordinates || [], lngLat);
      if (!hit) return;
      if (hit.dist > HIT_M) return;
      if (!best || hit.dist < best.hit.dist) {
        best = { leg, legIndex, hit };
      }
    });
    return best;
  }

  function viaAtPoint(point) {
    if (!map.getLayer('vias-hit')) return null;
    const feats = map.queryRenderedFeatures(point, { layers: ['vias-hit'] });
    const f = feats?.[0];
    if (!f) return null;
    return {
      legIndex: Number(f.properties.legIndex),
      viaIndex: Number(f.properties.viaIndex),
    };
  }

  async function runEdit(fn, status) {
    if (busy) return;
    busy = true;
    onStatus?.(status || 'Đang khớp đường…');
    map.getCanvas().style.cursor = 'wait';
    try {
      await fn();
      refreshVias();
      onAfterEdit?.();
    } catch (err) {
      console.warn('route edit failed', err);
      onStatus?.('Không khớp được đường — thử điểm khác');
    } finally {
      busy = false;
      map.getCanvas().style.cursor = getEnabled() ? 'grab' : '';
    }
  }

  function onMouseDown(e) {
    if (!getEnabled() || busy) return;
    if (e.originalEvent?.button != null && e.originalEvent.button !== 0) return;

    const via = viaAtPoint(e.point);
    if (via) {
      dragging = {
        kind: 'via',
        legIndex: via.legIndex,
        viaIndex: via.viaIndex,
        startX: e.point.x,
        startY: e.point.y,
        moved: false,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    // Prefer thick edit-hit layer, fall back to geometry search
    let pick = null;
    if (map.getLayer('routes-edit-hit')) {
      const feats = map.queryRenderedFeatures(e.point, { layers: ['routes-edit-hit'] });
      if (feats?.[0]) {
        const idx = Number(feats[0].properties.index);
        const legs = getBuiltLegs() || [];
        const leg = legs[idx];
        if (leg) {
          const hit = nearestPointOnLine(leg.coordinates || [], e.lngLat);
          if (hit) pick = { leg, legIndex: idx, hit };
        }
      }
    }
    if (!pick) pick = findLegAt(e.lngLat);
    if (!pick) return;

    const vias = pick.leg.waypoints || [];
    if (vias.length >= MAX_VIAS) {
      onStatus?.(`Tối đa ${MAX_VIAS} điểm uốn / đoạn`);
      return;
    }

    dragging = {
      kind: 'insert',
      legIndex: pick.legIndex,
      startX: e.point.x,
      startY: e.point.y,
      moved: false,
      previewLng: e.lngLat.lng,
      previewLat: e.lngLat.lat,
    };
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'grabbing';
    // Show temporary ghost via
    setViasData(map, {
      type: 'FeatureCollection',
      features: [
        ...viasGeoJSON().features,
        {
          type: 'Feature',
          properties: { ghost: true },
          geometry: {
            type: 'Point',
            coordinates: [e.lngLat.lng, e.lngLat.lat],
          },
        },
      ],
    });
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!getEnabled()) return;

    if (!dragging) {
      const via = viaAtPoint(e.point);
      if (via) {
        map.getCanvas().style.cursor = 'grab';
        return;
      }
      const onRoute =
        (map.getLayer('routes-edit-hit') &&
          map.queryRenderedFeatures(e.point, { layers: ['routes-edit-hit'] }).length > 0) ||
        Boolean(findLegAt(e.lngLat));
      map.getCanvas().style.cursor = onRoute ? 'grab' : '';
      return;
    }

    const dx = e.point.x - dragging.startX;
    const dy = e.point.y - dragging.startY;
    if (Math.hypot(dx, dy) > DRAG_PX) dragging.moved = true;

    if (dragging.kind === 'via') {
      const legs = getBuiltLegs() || [];
      const leg = legs[dragging.legIndex];
      if (!leg?.waypoints?.[dragging.viaIndex]) return;
      // Live visual only — full OSRM on mouseup (like Google’s commit)
      const features = viasGeoJSON().features.map((f) => {
        if (
          Number(f.properties.legIndex) === dragging.legIndex &&
          Number(f.properties.viaIndex) === dragging.viaIndex
        ) {
          return {
            ...f,
            geometry: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] },
          };
        }
        return f;
      });
      setViasData(map, { type: 'FeatureCollection', features });
    } else if (dragging.kind === 'insert') {
      dragging.previewLng = e.lngLat.lng;
      dragging.previewLat = e.lngLat.lat;
      setViasData(map, {
        type: 'FeatureCollection',
        features: [
          ...viasGeoJSON().features,
          {
            type: 'Feature',
            properties: { ghost: true },
            geometry: {
              type: 'Point',
              coordinates: [e.lngLat.lng, e.lngLat.lat],
            },
          },
        ],
      });
    }
  }

  function onMouseUp(e) {
    if (!dragging) return;
    const job = dragging;
    dragging = null;
    map.dragPan.enable();

    const legs = getBuiltLegs() || [];
    const leg = legs[job.legIndex];
    if (!leg) {
      refreshVias();
      map.getCanvas().style.cursor = getEnabled() ? 'grab' : '';
      return;
    }

    if (job.kind === 'via') {
      if (!job.moved) {
        refreshVias();
        map.getCanvas().style.cursor = 'grab';
        return;
      }
      void runEdit(
        () => moveViaOnLeg(leg, job.viaIndex, e.lngLat.lng, e.lngLat.lat),
        'Đang khớp điểm uốn…'
      );
      return;
    }

    if (job.kind === 'insert') {
      if (!job.moved) {
        // Click without drag — still insert via (Google allows click-drag; click alone is ok)
        refreshVias();
      }
      void runEdit(
        () =>
          insertViaOnLeg(
            leg,
            job.previewLng ?? e.lngLat.lng,
            job.previewLat ?? e.lngLat.lat
          ),
        'Đang uốn tuyến theo đường…'
      );
    }
  }

  function onDblClick(e) {
    if (!getEnabled() || busy) return;
    const via = viaAtPoint(e.point);
    if (!via) return;
    e.preventDefault();
    const leg = getBuiltLegs()?.[via.legIndex];
    if (!leg) return;
    void runEdit(() => removeViaOnLeg(leg, via.viaIndex), 'Đã xóa điểm uốn');
  }

  function setEnabled(on) {
    setRouteEditInteractive(map, on);
    refreshVias();
    map.getCanvas().style.cursor = on ? 'grab' : '';
    document.documentElement.classList.toggle('is-route-editing', on);
  }

  function bind() {
    if (bound) return;
    bound = true;
    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    map.on('dblclick', onDblClick);
  }

  function destroy() {
    if (!bound) return;
    bound = false;
    map.off('mousedown', onMouseDown);
    map.off('mousemove', onMouseMove);
    map.off('mouseup', onMouseUp);
    map.off('dblclick', onDblClick);
    map.dragPan.enable();
    setEnabled(false);
  }

  bind();
  refreshVias();

  return {
    refreshVias,
    setEnabled,
    destroy,
  };
}
