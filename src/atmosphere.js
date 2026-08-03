import * as THREE from 'three';

/** Soft WebGL particle field floating above the map UI. */
export function createAtmosphere(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 6;

  const count = 420;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
    speeds[i] = 0.15 + Math.random() * 0.45;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.75 },
      uColor: { value: new THREE.Color('#ffe29a') },
    },
    vertexShader: `
      uniform float uTime;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.35 + position.x * 1.4) * 0.15;
        p.x += cos(uTime * 0.22 + position.y) * 0.08;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (18.0 / -mv.z) * (1.2 + sin(uTime + position.z) * 0.3);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float alpha = smoothstep(0.5, 0.0, d) * uIntensity;
        gl_FragColor = vec4(uColor, alpha * 0.55);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let raf = 0;
  let running = true;
  function tick(t) {
    if (!running) return;
    mat.uniforms.uTime.value = t * 0.001;
    const grade = document.documentElement.dataset.grade;
    if (grade === 'night') {
      mat.uniforms.uColor.value.set('#9ec5ff');
      mat.uniforms.uIntensity.value = 1.1;
    } else if (grade === 'dusk') {
      mat.uniforms.uColor.value.set('#ffb07a');
      mat.uniforms.uIntensity.value = 0.9;
    } else {
      mat.uniforms.uColor.value.set('#ffe29a');
      mat.uniforms.uIntensity.value = 0.7;
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(tick);

  return {
    setEnabled(on) {
      running = on;
      canvas.style.opacity = on ? '1' : '0';
      if (on) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}

/** Boot screen: procedural sun + noise sky in WebGL. */
export function createBootScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uProgress;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i); float b = hash(i+vec2(1.,0.));
        float c = hash(i+vec2(0.,1.)); float d = hash(i+vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
      }

      void main() {
        vec2 uv = vUv;
        vec2 p = uv * 2. - 1.;
        p.x *= 1.4;

        vec3 sky = mix(vec3(0.45,0.72,0.90), vec3(1.0,0.90,0.62), uv.y * 0.75 + 0.1);
        sky = mix(sky, vec3(0.92,0.96,0.88), 0.15);

        float n = noise(uv * 3.0 + uTime * 0.05);
        sky += n * 0.04;

        vec2 sunPos = vec2(0.0, 0.08);
        float sun = smoothstep(0.22, 0.0, length(p - sunPos));
        vec3 sunCol = vec3(1.0, 0.86, 0.42);
        sky += sunCol * sun * 1.2;
        sky += sunCol * smoothstep(0.55, 0.0, length(p - sunPos)) * 0.35;

        // mountain silhouette
        float m1 = 0.18 + 0.08 * sin(uv.x * 18.0 + 1.2) + 0.04 * sin(uv.x * 40.0);
        float m2 = 0.12 + 0.06 * sin(uv.x * 12.0 + 3.1);
        float ridge = step(uv.y, m1) * 0.35 + step(uv.y, m2) * 0.45;
        sky = mix(sky, vec3(0.08,0.28,0.22), ridge);

        // progress wipe
        float wipe = smoothstep(uProgress - 0.08, uProgress + 0.02, uv.x + uv.y * 0.15);
        sky *= 0.55 + 0.45 * wipe;

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geo, mat));

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
  }

  let raf = 0;
  let alive = true;
  function tick(t) {
    if (!alive) return;
    mat.uniforms.uTime.value = t * 0.001;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(tick);

  return {
    setProgress(p) {
      mat.uniforms.uProgress.value = Math.max(0, Math.min(1, p));
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
