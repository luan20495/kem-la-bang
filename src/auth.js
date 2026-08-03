/**
 * Client-side gate for the free place editor.
 * Session lasts until the tab closes.
 */

const AUTH_KEY = 'kem-auth-session';
const USER = 'luannth';
const PASS = 'abc123';

export function isAuthed() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data?.user === USER && data?.ok === true;
  } catch {
    return false;
  }
}

export function login(username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (u === USER && p === PASS) {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify({ user: USER, ok: true, at: Date.now() }));
    return { ok: true };
  }
  return { ok: false, error: 'Sai tài khoản hoặc mật khẩu' };
}

export function logout() {
  sessionStorage.removeItem(AUTH_KEY);
}
