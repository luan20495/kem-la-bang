import { CAR_MODELS, getCarModel, paintToHex, renderCarPreviewDataUrl } from './car3d.js';

/**
 * Apple-style car garage sheet — preview = ảnh render 3D thật (cùng xe trên map).
 */
export function initCarPicker({ getSelectedId, onSelect }) {
  const root = document.getElementById('car-picker');
  const grid = document.getElementById('car-picker-grid');
  const closeBtn = document.getElementById('car-picker-close');
  if (!root || !grid) return { open() {}, close() {}, sync() {} };

  let renderToken = 0;

  async function fillPreviews(token) {
    // Render lần lượt — tránh tạo nhiều WebGL context, card hiện dần
    for (const m of CAR_MODELS) {
      if (token !== renderToken) return;
      try {
        const url = await renderCarPreviewDataUrl(m.id);
        if (token !== renderToken) return;
        const img = grid.querySelector(`img[data-preview="${m.id}"]`);
        if (img) {
          img.src = url;
          img.classList.add('is-ready');
        }
      } catch (err) {
        console.warn('Car preview render failed', m.id, err);
      }
    }
  }

  function render() {
    const selected = getSelectedId?.() || CAR_MODELS[0].id;
    const token = ++renderToken;
    grid.innerHTML = CAR_MODELS.map((m) => {
      const hex = paintToHex(m.paint.body);
      const on = m.id === selected ? ' is-on' : '';
      return `
        <button type="button" class="car-card${on}" role="option" aria-selected="${m.id === selected}" data-id="${m.id}" style="--car-paint:${hex}">
          <span class="car-card__swatch" aria-hidden="true"></span>
          <span class="car-card__media">
            <span class="car-card__skel" aria-hidden="true"></span>
            <img class="car-card__img" data-preview="${m.id}" alt="" width="180" height="110" />
          </span>
          <span class="car-card__body">
            <span class="car-card__name">${m.label}</span>
            <span class="car-card__blurb">${m.blurb}</span>
          </span>
          <span class="car-card__check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m6.5 12.5 3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </button>
      `;
    }).join('');

    void fillPreviews(token);
  }

  function open() {
    render();
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
  }

  function close() {
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
  }

  function sync() {
    if (root.classList.contains('is-open')) render();
  }

  grid.addEventListener('click', async (e) => {
    const card = e.target.closest('.car-card');
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;
    grid.querySelectorAll('.car-card').forEach((el) => {
      const on = el.dataset.id === id;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    await onSelect?.(id, getCarModel(id));
    close();
  });

  closeBtn?.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) close();
  });

  return { open, close, sync, render };
}
