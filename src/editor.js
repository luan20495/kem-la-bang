import { isAuthed, login, logout } from './auth.js';
import {
  listPlaces,
  upsertPlace,
  removePlace,
  movePlace,
  resetPlaces,
  COLOR_CYCLE,
} from './places-store.js';

/**
 * Auth gate + free place editor.
 * @param {{
 *   onRebuild: () => Promise<void> | void,
 *   onPickMode?: (on: boolean) => void,
 *   getMap?: () => import('maplibre-gl').Map | null,
 * }} opts
 */
export function createPlacesEditor(opts) {
  const { onRebuild, onPickMode } = opts;
  let editingId = null;
  let pickMode = false;

  const loginEl = document.getElementById('auth-modal');
  const editorEl = document.getElementById('places-editor');
  const listEl = document.getElementById('places-editor-list');
  const formEl = document.getElementById('places-editor-form');
  const statusEl = document.getElementById('places-editor-status');
  const btnOpen = document.getElementById('btn-edit-places');

  function setStatus(msg, tone = '') {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.dataset.tone = tone;
  }

  function syncOpenBtn() {
    if (!btnOpen) return;
    btnOpen.classList.toggle('is-authed', isAuthed());
    const label = btnOpen.querySelector('.tb__txt, .chip__label');
    if (label) label.textContent = 'Sửa';
  }

  function openLogin() {
    loginEl?.classList.add('is-open');
    loginEl?.setAttribute('aria-hidden', 'false');
    document.getElementById('auth-user')?.focus();
  }

  function closeLogin() {
    loginEl?.classList.remove('is-open');
    loginEl?.setAttribute('aria-hidden', 'true');
    const err = document.getElementById('auth-error');
    if (err) err.textContent = '';
  }

  function openEditor() {
    if (!isAuthed()) {
      openLogin();
      return;
    }
    editorEl?.classList.add('is-open');
    editorEl?.setAttribute('aria-hidden', 'false');
    renderList();
    clearForm();
    setStatus('Đã đăng nhập · chỉnh sửa tự do, lưu ngay trên máy này');
  }

  function closeEditor() {
    editorEl?.classList.remove('is-open');
    editorEl?.setAttribute('aria-hidden', 'true');
    setPickMode(false);
  }

  function setPickMode(on) {
    pickMode = Boolean(on);
    onPickMode?.(pickMode);
    document.getElementById('places-pick-btn')?.classList.toggle('is-on', pickMode);
    document.getElementById('app')?.classList.toggle('is-picking-place', pickMode);
    setStatus(pickMode ? 'Bấm lên bản đồ để lấy tọa độ' : '');
  }

  function clearForm() {
    editingId = null;
    if (!formEl) return;
    formEl.reset();
    formEl.querySelector('[name="id"]').value = '';
    formEl.querySelector('[name="color"]').value = COLOR_CYCLE[listPlaces().length % COLOR_CYCLE.length];
    document.getElementById('places-form-title').textContent = 'Thêm điểm mới';
  }

  function fillForm(stop) {
    if (!formEl || !stop) return;
    editingId = stop.id;
    document.getElementById('places-form-title').textContent = `Sửa · ${stop.name}`;
    const set = (name, val) => {
      const el = formEl.querySelector(`[name="${name}"]`);
      if (el) el.value = val ?? '';
    };
    set('id', stop.id);
    set('name', stop.name);
    set('role', stop.role);
    set('day', stop.day);
    set('time', stop.time);
    set('place', stop.place);
    set('blurb', stop.blurb);
    set('lat', stop.lat);
    set('lng', stop.lng);
    set('mapsUrl', stop.mapsUrl);
    set('color', stop.color);
    set('address', stop.address || '');
    set('hours', stop.hours || '');
    set('phone', stop.phone || '');
    set('category', stop.category || '');
  }

  function readForm() {
    const fd = new FormData(formEl);
    const num = (k) => {
      const v = Number(fd.get(k));
      return Number.isFinite(v) ? v : undefined;
    };
    return {
      id: String(fd.get('id') || editingId || '').trim() || undefined,
      name: String(fd.get('name') || '').trim(),
      role: String(fd.get('role') || '').trim(),
      day: String(fd.get('day') || '').trim(),
      time: String(fd.get('time') || '').trim(),
      place: String(fd.get('place') || '').trim(),
      blurb: String(fd.get('blurb') || '').trim(),
      lat: num('lat'),
      lng: num('lng'),
      mapsUrl: String(fd.get('mapsUrl') || '').trim(),
      color: String(fd.get('color') || '').trim(),
      address: String(fd.get('address') || '').trim() || undefined,
      hours: String(fd.get('hours') || '').trim() || undefined,
      phone: String(fd.get('phone') || '').trim() || undefined,
      category: String(fd.get('category') || '').trim() || undefined,
    };
  }

  function renderList() {
    if (!listEl) return;
    const places = listPlaces();
    listEl.innerHTML = places
      .map(
        (s) => `
      <li class="places-item ${s.id === editingId ? 'is-on' : ''}" data-id="${s.id}">
        <button type="button" class="places-item__main" data-edit="${s.id}">
          <span class="places-item__dot" style="--c:${s.color}"></span>
          <span class="places-item__text">
            <strong>${s.order}. ${s.name}</strong>
            <small>${s.role} · ${s.day} ${s.time}</small>
          </span>
        </button>
        <div class="places-item__ops">
          <button type="button" data-up="${s.id}" title="Lên" aria-label="Đưa lên">↑</button>
          <button type="button" data-down="${s.id}" title="Xuống" aria-label="Đưa xuống">↓</button>
          <button type="button" data-del="${s.id}" title="Xóa" aria-label="Xóa điểm">×</button>
        </div>
      </li>`
      )
      .join('');
  }

  async function afterChange(msg) {
    renderList();
    setStatus(msg || 'Đã lưu');
    await onRebuild?.();
  }

  btnOpen?.addEventListener('click', () => {
    if (isAuthed()) openEditor();
    else openLogin();
  });

  document.getElementById('auth-close')?.addEventListener('click', closeLogin);
  document.getElementById('auth-cancel')?.addEventListener('click', closeLogin);
  loginEl?.addEventListener('click', (e) => {
    if (e.target === loginEl) closeLogin();
  });

  document.getElementById('auth-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('auth-user')?.value;
    const pass = document.getElementById('auth-pass')?.value;
    const res = login(user, pass);
    const err = document.getElementById('auth-error');
    if (!res.ok) {
      if (err) err.textContent = res.error;
      return;
    }
    closeLogin();
    syncOpenBtn();
    openEditor();
  });

  document.getElementById('places-editor-close')?.addEventListener('click', closeEditor);
  document.getElementById('places-logout')?.addEventListener('click', () => {
    logout();
    syncOpenBtn();
    closeEditor();
    setPickMode(false);
  });

  document.getElementById('places-add')?.addEventListener('click', () => {
    clearForm();
    renderList();
  });

  document.getElementById('places-reset')?.addEventListener('click', async () => {
    if (!confirm('Khôi phục 4 điểm mặc định của Kẹm? Bản chỉnh sửa trên máy này sẽ mất.')) return;
    resetPlaces();
    clearForm();
    await afterChange('Đã khôi phục mặc định');
  });

  document.getElementById('places-pick-btn')?.addEventListener('click', () => {
    setPickMode(!pickMode);
  });

  listEl?.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-edit],[data-up],[data-down],[data-del]');
    if (!t) return;
    if (t.dataset.edit) {
      const stop = listPlaces().find((s) => s.id === t.dataset.edit);
      fillForm(stop);
      renderList();
      return;
    }
    if (t.dataset.up) {
      movePlace(t.dataset.up, -1);
      await afterChange('Đã đổi thứ tự');
      return;
    }
    if (t.dataset.down) {
      movePlace(t.dataset.down, 1);
      await afterChange('Đã đổi thứ tự');
      return;
    }
    if (t.dataset.del) {
      const name = listPlaces().find((s) => s.id === t.dataset.del)?.name;
      if (!confirm(`Xóa điểm “${name}”?`)) return;
      const res = removePlace(t.dataset.del);
      if (!res.ok) {
        setStatus(res.error, 'bad');
        return;
      }
      if (editingId === t.dataset.del) clearForm();
      await afterChange('Đã xóa điểm');
    }
  });

  formEl?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    if (!data.name) {
      setStatus('Nhập tên địa điểm', 'bad');
      return;
    }
    if (data.lat == null || data.lng == null) {
      setStatus('Cần tọa độ lat/lng — hoặc bấm chọn trên bản đồ', 'bad');
      return;
    }
    if (!data.mapsUrl) {
      data.mapsUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
    }
    upsertPlace(data);
    editingId = data.id || listPlaces().find((s) => s.name === data.name)?.id;
    await afterChange('Đã lưu điểm');
    const stop = listPlaces().find((s) => s.id === editingId);
    if (stop) fillForm(stop);
    renderList();
  });

  syncOpenBtn();

  return {
    openEditor,
    closeEditor,
    isPickMode: () => pickMode,
    setPickMode,
    applyMapClick(lng, lat) {
      if (!pickMode || !formEl) return false;
      formEl.querySelector('[name="lng"]').value = String(Number(lng.toFixed(6)));
      formEl.querySelector('[name="lat"]').value = String(Number(lat.toFixed(6)));
      const maps = formEl.querySelector('[name="mapsUrl"]');
      if (maps && !String(maps.value || '').trim()) {
        maps.value = `https://www.google.com/maps?q=${lat},${lng}`;
      }
      setPickMode(false);
      setStatus(`Đã lấy tọa độ ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      return true;
    },
    refresh: renderList,
  };
}
