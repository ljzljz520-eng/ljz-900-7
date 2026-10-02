// 全局状态
const store = {
  get token() { return localStorage.getItem('patrol_jwt'); },
  set token(v) { v ? localStorage.setItem('patrol_jwt', v) : localStorage.removeItem('patrol_jwt'); }
};
const workerToken = location.pathname.match(/^\/w\/(.+)$/)?.[1] || sessionStorage.getItem('patrol_wtoken') || '';
if (workerToken) sessionStorage.setItem('patrol_wtoken', workerToken);

const LOCATIONS = {
  elevator_hall: { label: '电梯厅', icon: '🛗' },
  corridor: { label: '楼道', icon: '🚪' },
  garbage_room: { label: '垃圾房', icon: '🗑️' }
};
const STATUS = {
  pending: { label: '待整改', cls: 'status-pending' },
  submitted: { label: '待审核', cls: 'status-submitted' },
  approved: { label: '已通过', cls: 'status-approved' },
  rejected: { label: '已驳回', cls: 'status-rejected' }
};

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const isWorker = url.startsWith('/api/w/');
  if (isWorker) {
    const tk = url.includes('/photos/') ? workerToken : (workerToken || sessionStorage.getItem('patrol_wtoken'));
    if (!opts.raw) headers['X-Worker-Token'] = tk;
  } else if (store.token) {
    headers['Authorization'] = 'Bearer ' + store.token;
  }
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 204) return {};
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || '请求失败 (' + res.status + ')');
    err.status = res.status; err.code = data.code; err.data = data;
    throw err;
  }
  return data;
}

function guardLogin() {
  if (!store.token) { location.href = '/'; return false; }
  return true;
}
async function loadMe() {
  const me = await api('/api/auth/me');
  document.querySelectorAll('[data-me-name]').forEach(el => el.textContent = me.name);
  document.querySelectorAll('[data-me-role]').forEach(el => el.textContent = me.role === 'manager' ? '经理' : '巡查员');
  return me;
}
async function requireRole(role) {
  try { const me = await loadMe(); if (role && me.role !== role) { location.href = me.role === 'manager' ? '/manager' : '/inspector'; } return me; }
  catch { location.href = '/'; }
}
function logout() {
  api('/api/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => {
    store.token = null; location.href = '/';
  });
}

// ---------- Toast ----------
function toast(msg, type = 'info', ms = 2600) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Modal / Lightbox ----------
function openModal(html, { wide = false } = {}) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
  return mask;
}
function closeModal() { document.querySelector('.modal-mask')?.remove(); }
function lightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${src}" alt="预览">`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

// ---------- helpers ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(t) { return t ? String(t).replace('T', ' ').slice(5, 16) : '—'; }
function isOverdue(issue) {
  return issue.status === 'pending' && issue.due_at && issue.due_at < nowSql();
}
function nowSql() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}
// 后端按服务器本地时间返回 "YYYY-MM-DD HH:MM:SS"，直接字符串比较即可
function photoUrl(p) {
  if (!p.url) return '';
  if (p.url.startsWith('/api/w/')) return p.url;
  return p.url + (p.url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(store.token || '');
}
function badgesHtml(badges) {
  if (!badges || !badges.length) return '';
  return `<span class="badges">${badges.map(b =>
    `<span class="badge-chip" style="background:${b.color}" title="${esc(b.name)}">${b.emoji} ${esc(b.name)}</span>`).join('')}</span>`;
}
function statusPill(status) {
  const s = STATUS[status] || { label: status, cls: '' };
  return `<span class="status-pill ${s.cls}">${s.label}</span>`;
}
function locTag(key) {
  const l = LOCATIONS[key] || { label: key, icon: '' };
  return `<span class="loc-tag">${l.icon} ${esc(l.label)}</span>`;
}

// ---------- 前后对比图（拖动滑块）----------
function compareBlock(beforeUrl, afterUrl) {
  const id = 'cmp' + Math.random().toString(36).slice(2, 9);
  setTimeout(() => {
    const box = document.getElementById(id);
    if (!box) return;
    const setPos = clientX => {
      const r = box.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
      box.style.setProperty('--pos', pct + '%');
    };
    box.addEventListener('pointerdown', e => { box.setPointerCapture?.(e.pointerId); setPos(e.clientX); });
    box.addEventListener('pointermove', e => { if (e.buttons) setPos(e.clientX); });
  }, 0);
  return `<div class="compare" id="${id}" style="--pos:50%">
    <img src="${afterUrl}" alt="整改后">
    <span class="cap a">整改后</span>
    <img class="top" src="${beforeUrl}" alt="整改前">
    <span class="cap b">整改前</span>
    <div class="handle"></div>
  </div>`;
}

// 缩略图条
function thumbsHtml(photos, kind) {
  if (!photos || !photos.length) return '';
  return `<div class="photo-strip">${photos.map(p =>
    `<img class="photo-thumb ${kind}" loading="lazy" src="${esc(photoUrl(p))}" data-full="${esc(photoUrl(p))}">`).join('')}</div>`;
}
document.addEventListener('click', e => {
  const img = e.target.closest?.('.photo-thumb');
  if (img) lightbox(img.dataset.full || img.src);
});
