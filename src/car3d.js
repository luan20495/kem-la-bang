import { Marker } from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const VIEW = 200;

/** Kenney Car Kit (CC0) — hatchback-sports + wheel-dark */
const CAR_URL = '/models/hatchback-sports.glb';
const WHEEL_URL = '/models/wheel-dark.glb';

/** Brand palette (Kẹm) */
const BODY = 0xe35d2a;

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

/** Kenney hatchback axle sockets (approx., meters). */
const WHEEL_SOCKETS = [
  { x: 0.78, y: 0.28, z: 1.18, flip: false },
  { x: -0.78, y: 0.28, z: 1.18, flip: true },
  { x: 0.78, y: 0.28, z: -1.22, flip: false },
  { x: -0.78, y: 0.28, z: -1.22, flip: true },
];

/**
 * Recolor Kenney meshes toward brand orange / glass / dark.
 * Texture colormap stays; we tint via material.color.
 */
function styleKenneyCar(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((mat) => {
      const m = mat.clone();
      m.side = THREE.FrontSide;
      m.metalness = Math.min(0.45, m.metalness ?? 0.2);
      m.roughness = Math.max(0.35, m.roughness ?? 0.5);
      // Keep Kenney colormap; warm brand wash
      if (m.map) {
        m.color = new THREE.Color(0xffe4d4);
      } else {
        m.color = new THREE.Color(BODY);
      }
      m.emissive = new THREE.Color(BODY);
      m.emissiveIntensity = 0.04;
      return m;
    });
    obj.material = next.length === 1 ? next[0] : next;
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

/**
 * Fallback procedural car if GLB fails to load.
 */
function buildFallbackCar() {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BODY,
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

async function buildKenneyCar() {
  const [bodyGltf, wheelGltf] = await Promise.all([loadGltf(CAR_URL), loadGltf(WHEEL_URL)]);
  const root = new THREE.Group();
  const body = bodyGltf.scene.clone(true);
  styleKenneyCar(body);

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

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 36),
    new THREE.MeshBasicMaterial({
      color: BODY,
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

/**
 * Kenney 3D car in a MapLibre marker — game-like hatchback with spinning wheels.
 */
export function createCar3D(map, lng, lat) {
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

  scene.add(new THREE.AmbientLight(0xfff6e8, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
  sun.position.set(5, 10, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9ec8ff, 0.4);
  fill.position.set(-6, 3, -3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffc247, 0.35);
  rim.position.set(-2, 2, 6);
  scene.add(rim);

  let car = buildFallbackCar();
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

  buildKenneyCar()
    .then((built) => {
      if (!alive) return;
      yaw.remove(car.root);
      car.root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      car = built;
      // Kenney nose +Z faces camera/bottom without flip — 180° so travel heading is correct
      car.root.rotation.y = Math.PI;
      yaw.add(car.root);
      el.classList.add('is-ready');
    })
    .catch((err) => {
      console.warn('Kenney car load failed, using fallback', err);
    });

  function paint() {
    if (!alive) return;
    state.mapBearing = map.getBearing();
    state.bearing = lerpBearing(state.bearing, state.targetBearing, state.driving ? 0.08 : 0.28);
    yaw.rotation.y = -(state.bearing - state.mapBearing) * DEG;

    const z = map.getZoom();
    // Freeze marker size while driving — resizing mid-frame causes stutter
    if (!state.driving) {
      const px = Math.round(Math.min(148, Math.max(64, 18 + z * 6.2)));
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
      car.root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    },
  };
}
