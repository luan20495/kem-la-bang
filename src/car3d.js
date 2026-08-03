import { Marker } from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const VIEW = 200;

/**
 * 10 Kenney cars (CC0) — paint codes theo chuẩn màu xe quốc tế (FIA / OEM phổ biến).
 * Previews: /models/previews/{id}.png — recolor cùng thuật toán với xe trên map.
 */
export const CAR_MODELS = [
  {
    id: 'sedan-sports',
    label: 'Sedan Sports',
    blurb: 'Porsche Orange · #F77F00',
    url: '/models/sedan-sports.glb',
    preview: '/models/previews/sedan-sports.png',
    wheels: 'dark',
    paint: { body: 0xf77f00, accent: 0x1c1c1e, metal: 0.52, rough: 0.28, clearcoat: 1 },
  },
  {
    id: 'hatchback-sports',
    label: 'Hatchback',
    blurb: 'Giallo Modena · #FFCC00',
    url: '/models/hatchback-sports.glb',
    preview: '/models/previews/hatchback-sports.png',
    wheels: 'dark',
    paint: { body: 0xffcc00, accent: 0x1c1c1e, metal: 0.42, rough: 0.34, clearcoat: 0.85 },
  },
  {
    id: 'suv',
    label: 'SUV',
    blurb: 'British Racing Green · #004225',
    url: '/models/suv.glb',
    preview: '/models/previews/suv.png',
    wheels: 'dark',
    paint: { body: 0x004225, accent: 0xc9a227, metal: 0.48, rough: 0.36, clearcoat: 0.9 },
  },
  {
    id: 'suv-luxury',
    label: 'SUV Luxury',
    blurb: 'Graphite Metallic · #2C2C2E',
    url: '/models/suv-luxury.glb',
    preview: '/models/previews/suv-luxury.png',
    wheels: 'dark',
    paint: { body: 0x2c2c2e, accent: 0xc0c0c0, metal: 0.78, rough: 0.22, clearcoat: 1 },
  },
  {
    id: 'sedan',
    label: 'Sedan',
    blurb: 'Alpine White · #F2F3F4',
    url: '/models/sedan.glb',
    preview: '/models/previews/sedan.png',
    wheels: 'dark',
    paint: { body: 0xf2f3f4, accent: 0x0f5c4a, metal: 0.4, rough: 0.32, clearcoat: 0.95 },
  },
  {
    id: 'race',
    label: 'Race',
    blurb: 'Rosso Corsa · #D40000',
    url: '/models/race.glb',
    preview: '/models/previews/race.png',
    wheels: 'racing',
    paint: { body: 0xd40000, accent: 0xffffff, metal: 0.5, rough: 0.26, clearcoat: 1 },
  },
  {
    id: 'race-future',
    label: 'Race Future',
    blurb: 'Bleu de France · #0055A4',
    url: '/models/race-future.glb',
    preview: '/models/previews/race-future.png',
    wheels: 'racing',
    paint: { body: 0x0055a4, accent: 0xe8e8ed, metal: 0.58, rough: 0.24, clearcoat: 1 },
  },
  {
    id: 'taxi',
    label: 'Taxi',
    blurb: 'NYC Taxi Yellow · #F7B500',
    url: '/models/taxi.glb',
    preview: '/models/previews/taxi.png',
    wheels: 'dark',
    paint: { body: 0xf7b500, accent: 0x1c1c1e, metal: 0.32, rough: 0.42, clearcoat: 0.7 },
  },
  {
    id: 'van',
    label: 'Van',
    blurb: 'VW California Mint · #7DBA8A',
    url: '/models/van.glb',
    preview: '/models/previews/van.png',
    wheels: 'dark',
    paint: { body: 0x7dba8a, accent: 0xf5f5f7, metal: 0.35, rough: 0.4, clearcoat: 0.75 },
  },
  {
    id: 'police',
    label: 'Patrol',
    blurb: 'Police Blue · #003366',
    url: '/models/police.glb',
    preview: '/models/previews/police.png',
    wheels: 'dark',
    paint: { body: 0x003366, accent: 0xffffff, metal: 0.45, rough: 0.34, clearcoat: 0.85 },
  },
];

export function paintToHex(n) {
  return `#${((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

const WHEEL_URLS = {
  dark: '/models/wheel-dark.glb',
  racing: '/models/wheel-racing.glb',
};
const STORAGE_KEY = 'kem-car-model';

export function getCarModel(id) {
  return CAR_MODELS.find((m) => m.id === id) || CAR_MODELS[0];
}

function resolveModelId(id) {
  if (CAR_MODELS.some((m) => m.id === id)) return id;
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (CAR_MODELS.some((m) => m.id === saved)) return saved;
  return CAR_MODELS[0].id;
}

function modelUrl(id) {
  return getCarModel(id).url;
}

function lerpBearing(from, to, t) {
  const d = ((to - from + 540) % 360) - 180;
  return (from + d * t + 360) % 360;
}

function loadGltf(url) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

const COLORMAP_URL = '/models/colormap.png';
let colormapBasePromise = null;

function loadColormapBase() {
  if (!colormapBasePromise) {
    colormapBasePromise = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        COLORMAP_URL,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false; // glTF UV convention
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        reject
      );
    });
  }
  return colormapBasePromise;
}

/** Kenney hatchback axle sockets (approx., meters). */
const WHEEL_SOCKETS = [
  { x: 0.78, y: 0.28, z: 1.18, flip: false },
  { x: -0.78, y: 0.28, z: 1.18, flip: true },
  { x: 0.78, y: 0.28, z: -1.22, flip: false },
  { x: -0.78, y: 0.28, z: -1.22, flip: true },
];

/**
 * Phân loại pixel Kenney colormap — giữ kính / đèn / lốp / trim, chỉ sơn lại thân.
 */
export function classifyKenneyPixel(r, g, b, a = 255) {
  if (a < 10) return 'empty';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  if (lum < 30) return 'black';
  if (sat < 0.14 && lum < 115) return 'trim';
  if (sat < 0.1 && lum > 225) return 'white';
  if (sat < 0.16 && lum > 155 && lum <= 225) return 'metal';
  // Kính Kenney: xanh nhạt / cyan sáng — xanh đậm coi là sơn thân
  if (r > 175 && g > 205 && b > 235 && sat < 0.35) return 'glass';
  if (b > r + 18 && b >= g - 5 && sat > 0.18 && lum > 165 && lum < 240) return 'glass';
  // Đèn pha ấm
  if (r > 195 && g > 135 && b < 130 && lum > 150) return 'light';
  return 'body';
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s <= 0.0001) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function paintBodyPixel(r, g, b, bodyRgb, accentRgb = null) {
  const [, , srcL] = rgbToHsl(r, g, b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const useAccent = accentRgb && sat > 0.55 && (lum < 95 || Math.abs(r - g) > 80);
  const [tr, tg, tb] = useAccent ? accentRgb : bodyRgb;
  const [ph, ps, pl] = rgbToHsl(tr, tg, tb);

  // Giữ shading isometric; ưu tiên độ sáng của mã sơn chuẩn (FIA / OEM)
  if (ps < 0.12) {
    // Trắng / graphite: bám màu sơn, chỉ dịu theo bóng nguồn
    const shade = Math.min(1.2, Math.max(0.55, 0.65 + (srcL - 0.42) * 0.85));
    return [
      Math.round(Math.min(255, tr * shade)),
      Math.round(Math.min(255, tg * shade)),
      Math.round(Math.min(255, tb * shade)),
    ];
  }

  const outL = Math.min(0.86, Math.max(0.07, srcL * 0.32 + pl * 0.68));
  return hslToRgb(ph, Math.min(1, ps * 1.06), outL);
}

/** Recolor RGBA buffer in-place — dùng chung garage preview + texture 3D trên map. */
export function recolorKenneyImageData(data, bodyHex, accentHex = null) {
  const body = typeof bodyHex === 'number' ? bodyHex : parseInt(String(bodyHex).replace('#', ''), 16);
  const accent =
    accentHex == null
      ? null
      : typeof accentHex === 'number'
        ? accentHex
        : parseInt(String(accentHex).replace('#', ''), 16);
  const bodyRgb = [(body >> 16) & 255, (body >> 8) & 255, body & 255];
  const accentRgb =
    accent == null ? null : [(accent >> 16) & 255, (accent >> 8) & 255, accent & 255];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (classifyKenneyPixel(r, g, b, a) !== 'body') continue;
    const [nr, ng, nb] = paintBodyPixel(r, g, b, bodyRgb, accentRgb);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  return data;
}

function recolorMapTexture(tex, paint) {
  try {
    const img = tex?.image;
    if (!img) return null;
    const w = img.width || img.naturalWidth || img.videoWidth;
    const h = img.height || img.naturalHeight || img.videoHeight;
    if (!w || !h) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    recolorKenneyImageData(imageData.data, paint?.body ?? 0xd40000, paint?.accent ?? null);
    ctx.putImageData(imageData, 0, 0);

    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    out.flipY = tex.flipY;
    out.wrapS = tex.wrapS ?? THREE.RepeatWrapping;
    out.wrapT = tex.wrapT ?? THREE.RepeatWrapping;
    out.magFilter = THREE.NearestFilter;
    out.minFilter = THREE.NearestFilter;
    out.needsUpdate = true;
    return out;
  } catch (err) {
    console.warn('Kenney colormap recolor failed', err);
    return null;
  }
}

/**
 * Giữ colormap Kenney (kính, đèn, trim) — chỉ đổi màu thân theo mã sơn chuẩn.
 */
async function styleKenneyCar(root, paint) {
  const metal = Math.min(0.45, paint?.metal ?? 0.35);
  const rough = paint?.rough ?? 0.32;
  const clearcoat = paint?.clearcoat ?? 0.9;

  let paintedMap = null;
  try {
    const base = await loadColormapBase();
    paintedMap = recolorMapTexture(base, paint);
  } catch (err) {
    console.warn('Kenney colormap load failed', err);
  }

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const name = `${obj.name}`.toLowerCase();
    // Bỏ bánh xe gốc trong GLB — ta gắn wheel riêng
    if (/wheel/.test(name)) {
      obj.visible = false;
      return;
    }

    if (paintedMap) {
      obj.material = new THREE.MeshPhysicalMaterial({
        map: paintedMap,
        color: 0xffffff,
        metalness: metal,
        roughness: rough,
        clearcoat,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.35,
      });
      obj.castShadow = false;
      obj.receiveShadow = false;
      return;
    }

    // Fallback khi texture không load — vẫn tách kính/đèn theo tên
    const matName = Array.isArray(obj.material)
      ? obj.material.map((m) => m?.name || '').join(' ')
      : obj.material?.name || '';
    const tag = `${name} ${matName}`.toLowerCase();
    let mat;
    if (/glass|window|wind/.test(tag)) {
      mat = new THREE.MeshPhysicalMaterial({
        color: 0x8ec5e0,
        metalness: 0.1,
        roughness: 0.08,
        transparent: true,
        opacity: 0.75,
      });
    } else if (/light|lamp|head|tail/.test(tag)) {
      mat = new THREE.MeshStandardMaterial({
        color: 0xfff4d0,
        emissive: 0xffe29a,
        emissiveIntensity: 0.7,
        metalness: 0.15,
        roughness: 0.35,
      });
    } else if (/grill|grille|bumper|chrome|plastic|black/.test(tag)) {
      mat = new THREE.MeshStandardMaterial({
        color: 0x222226,
        metalness: 0.6,
        roughness: 0.38,
      });
    } else {
      mat = new THREE.MeshPhysicalMaterial({
        color: paint?.body ?? 0xd40000,
        metalness: metal,
        roughness: rough,
        clearcoat,
        clearcoatRoughness: 0.14,
      });
    }
    obj.material = mat;
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
}

function makeShadow() {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  shadow.scale.set(1, 0.55, 1);
  return shadow;
}

function buildFallbackCar(paint) {
  const body = paint?.body ?? 0xe35d2a;
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: body,
    metalness: 0.3,
    roughness: 0.4,
  });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 3.8), bodyMat);
  chassis.position.y = 0.45;
  root.add(chassis);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.8), bodyMat);
  cabin.position.set(0, 0.9, -0.2);
  root.add(cabin);
  const wheels = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  for (const s of WHEEL_SOCKETS) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 14), tireMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(s.x, s.y, s.z);
    root.add(w);
    wheels.push(w);
  }
  root.add(makeShadow());
  return { root, wheels };
}

async function buildKenneyCar(modelId) {
  const model = getCarModel(modelId);
  const wheelUrl = WHEEL_URLS[model.wheels] || WHEEL_URLS.dark;
  const [bodyGltf, wheelGltf] = await Promise.all([loadGltf(model.url), loadGltf(wheelUrl)]);
  const root = new THREE.Group();
  const body = bodyGltf.scene.clone(true);
  await styleKenneyCar(body, model.paint);

  const fitted = new THREE.Group();
  fitted.add(body);
  fitted.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(fitted);
  const size = box.getSize(new THREE.Vector3());
  const s = 4.2 / (Math.max(size.x, size.y, size.z) || 1);
  fitted.scale.setScalar(s);
  fitted.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(fitted);
  const center = box.getCenter(new THREE.Vector3());
  fitted.position.set(-center.x, -box.min.y, -center.z);
  root.add(fitted);

  const wheelProto = wheelGltf.scene;
  const wheels = [];
  for (const sock of WHEEL_SOCKETS) {
    const wheel = new THREE.Group();
    const mesh = wheelProto.clone(true);
    mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color = new THREE.Color(0x1a1a1a);
        o.material.roughness = 0.7;
      }
    });
    mesh.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(mesh);
    const ws = wb.getSize(new THREE.Vector3());
    mesh.scale.setScalar(0.68 / (Math.max(ws.x, ws.y, ws.z) || 1));
    if (sock.flip) mesh.scale.x *= -1;
    wheel.add(mesh);
    wheel.position.set(sock.x > 0 ? 0.82 : -0.82, 0.34, sock.z > 0 ? 1.15 : -1.2);
    root.add(wheel);
    wheels.push(wheel);
  }

  root.add(makeShadow());

  const glowColor = model.paint?.body ?? 0xe35d2a;
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 36),
    new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.005;
  root.add(glow);

  return { root, wheels, glow };
}

const previewCache3d = new Map();
let previewRenderer = null;

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of list) {
        if (!m) continue;
        if (m.map && m.map.isCanvasTexture) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/**
 * Offscreen WebGL thumbnail — cùng model 3D trên map, không dùng PNG 64px bị vỡ.
 */
export async function renderCarPreviewDataUrl(modelId, opts = {}) {
  const model = getCarModel(modelId);
  const width = opts.width ?? 480;
  const height = opts.height ?? 300;
  const key = `${model.id}:${model.paint.body}:${width}x${height}:v3`;
  if (previewCache3d.has(key)) return previewCache3d.get(key);

  const built = await buildKenneyCar(model.id);
  if (built.glow) built.glow.visible = false;
  // Góc ¾ studio — nhìn rõ thân + bánh
  built.root.rotation.y = Math.PI * 0.78;

  if (!previewRenderer) {
    previewRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure = 1.2;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  previewRenderer.setPixelRatio(dpr);
  previewRenderer.setSize(width, height, false);
  previewRenderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xfff6ea, 1.55);
  sun.position.set(4, 9, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd8e8ff, 0.7);
  fill.position.set(-5, 3, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(-1, 4, 6);
  scene.add(rim);
  scene.add(built.root);

  const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 40);
  camera.position.set(3.4, 2.6, 5.8);
  camera.lookAt(0, 0.65, 0);

  previewRenderer.render(scene, camera);
  const url = previewRenderer.domElement.toDataURL('image/png');
  previewCache3d.set(key, url);

  scene.remove(built.root);
  disposeObject3D(built.root);

  return url;
}

/**
 * Kenney 3D car in a MapLibre marker — swap between sedan / SUV / hatchback.
 */
export function createCar3D(map, lng, lat, preferredModel) {
  const state = {
    lng,
    lat,
    bearing: 0,
    targetBearing: 0,
    driving: false,
    wheelSpin: 0,
    lastLng: lng,
    lastLat: lat,
    bob: 0,
    mapBearing: map.getBearing(),
    modelId: resolveModelId(preferredModel),
    loading: false,
  };

  const el = document.createElement('div');
  el.className = 'car car--3d car--kenney';
  el.setAttribute('aria-label', 'Xe Kenney trên hành trình');
  const canvas = document.createElement('canvas');
  canvas.width = VIEW * 2;
  canvas.height = VIEW * 2;
  canvas.className = 'car__canvas';
  el.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(VIEW, VIEW, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  // High ¾ game cam — nose points −Z after 180° flip
  camera.position.set(2.8, 4.2, 6.8);
  camera.lookAt(0, 0.55, 0);

  // Bright stage lighting so paint colors read clearly on the map marker
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.45);
  sun.position.set(5, 10, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd6e8ff, 0.65);
  fill.position.set(-6, 4, -3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.45);
  rim.position.set(-2, 3, 7);
  scene.add(rim);

  let car = buildFallbackCar(getCarModel(state.modelId).paint);
  // Kenney / fallback nose +Z — flip 180° so headlights lead along the route
  car.root.rotation.y = Math.PI;
  const yaw = new THREE.Group();
  yaw.add(car.root);
  scene.add(yaw);

  const marker = new Marker({
    element: el,
    anchor: 'center',
    pitchAlignment: 'viewport',
    rotationAlignment: 'viewport',
  })
    .setLngLat([lng, lat])
    .addTo(map);

  let raf = 0;
  let alive = true;
  let loadToken = 0;

  function disposeCarMesh(meshRoot) {
    meshRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  function mountBuilt(built) {
    yaw.remove(car.root);
    disposeCarMesh(car.root);
    car = built;
    car.root.rotation.y = Math.PI;
    yaw.add(car.root);
    el.classList.add('is-ready');
    el.dataset.model = state.modelId;
  }

  function loadModel(modelId) {
    const id = resolveModelId(modelId);
    state.modelId = id;
    state.loading = true;
    el.classList.remove('is-ready');
    el.classList.add('is-loading');
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    const token = ++loadToken;
    return buildKenneyCar(id)
      .then((built) => {
        if (!alive || token !== loadToken) {
          disposeCarMesh(built.root);
          return state.modelId;
        }
        mountBuilt(built);
        el.classList.remove('is-loading');
        state.loading = false;
        return state.modelId;
      })
      .catch((err) => {
        console.warn('Kenney car load failed', id, err);
        el.classList.remove('is-loading');
        state.loading = false;
        return state.modelId;
      });
  }

  loadModel(state.modelId);

  function paint() {
    if (!alive) return;
    state.mapBearing = map.getBearing();
    state.bearing = lerpBearing(state.bearing, state.targetBearing, state.driving ? 0.08 : 0.28);
    yaw.rotation.y = -(state.bearing - state.mapBearing) * DEG;

    const z = map.getZoom();
    // Freeze marker size while driving — resizing mid-frame causes stutter
    if (!state.driving) {
      const px = Math.round(Math.min(92, Math.max(48, 10 + z * 4.4)));
      if (el.dataset.px !== String(px)) {
        el.dataset.px = String(px);
        el.style.width = `${px}px`;
        el.style.height = `${px}px`;
        canvas.style.width = `${px}px`;
        canvas.style.height = `${px}px`;
      }
    }

    if (state.driving) {
      state.bob += 0.1;
      car.root.position.y = Math.sin(state.bob) * 0.015;
      const dx = (state.lng - state.lastLng) * 111320 * Math.cos(state.lat * DEG);
      const dy = (state.lat - state.lastLat) * 110540;
      const dist = Math.hypot(dx, dy);
      state.wheelSpin += 0.28 + dist * 1.2;
      for (const w of car.wheels) w.rotation.x = state.wheelSpin;
      if (car.glow) car.glow.material.opacity = 0.28;
      el.classList.add('is-driving');
    } else {
      car.root.position.y = 0;
      if (car.glow) car.glow.material.opacity = 0.18;
      el.classList.remove('is-driving');
    }
    state.lastLng = state.lng;
    state.lastLat = state.lat;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(paint);
  }
  paint();

  const onMove = () => {
    state.mapBearing = map.getBearing();
  };
  map.on('move', onMove);
  map.on('rotate', onMove);

  return {
    marker,
    el,
    setLngLat(lng2, lat2) {
      state.lng = lng2;
      state.lat = lat2;
      marker.setLngLat([lng2, lat2]);
    },
    setBearing(deg) {
      state.targetBearing = ((deg % 360) + 360) % 360;
    },
    setDriving(on) {
      state.driving = Boolean(on);
    },
    setModel(id) {
      return loadModel(id);
    },
    cycleModel() {
      const i = CAR_MODELS.findIndex((m) => m.id === state.modelId);
      const next = CAR_MODELS[(i + 1) % CAR_MODELS.length];
      return loadModel(next.id);
    },
    get modelId() {
      return state.modelId;
    },
    get modelLabel() {
      return getCarModel(state.modelId).label;
    },
    get modelBlurb() {
      return getCarModel(state.modelId).blurb;
    },
    get lng() {
      return state.lng;
    },
    get lat() {
      return state.lat;
    },
    get bearing() {
      return state.bearing;
    },
    remove() {
      alive = false;
      cancelAnimationFrame(raf);
      map.off('move', onMove);
      map.off('rotate', onMove);
      marker.remove();
      renderer.dispose();
      disposeCarMesh(car.root);
    },
  };
}
