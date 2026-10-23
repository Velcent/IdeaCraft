/* IdeaCraft – core utilities and backend bridge */
const TAURI = window.__TAURI__;
export const hasTauri = !!(TAURI && TAURI.core && TAURI.core.invoke);

export const S = {
  boot: null,
  pages: [],
  pageMap: new Map(),
  settings: {},
  tabs: [],
  activeTab: 0,
  app: null,
  sidebarWidth: 275,
  sidebarCollapsed: false,
  view: { type: 'home' },
  pageCache: new Map(),
  commentsOpen: false,
  aiOpen: false,
  aiMessages: [],
  aiBusy: false,
  currentPageId: null,
  searchOpen: false,
  dirtyCount: 0,
  booted: false,
};

export async function invoke(cmd, args = {}) {
  if (!hasTauri) {
    if (window.__IDEA_MOCK__) return window.__IDEA_MOCK__(cmd, args);
    throw new Error('IdeaCraft backend is not available.');
  }
  return TAURI.core.invoke(cmd, args);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || '';
}

export function sanitizeHtml(html) {
  const allowed = new Set(['B','STRONG','I','EM','U','S','STRIKE','DEL','CODE','A','BR','SPAN','MARK','SUP','SUB']);
  const doc = document.createElement('div');
  doc.innerHTML = html || '';
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        if (!allowed.has(child.tagName)) {
          if (child.tagName === 'DIV' || child.tagName === 'P') {
            const frag = document.createDocumentFragment();
            while (child.firstChild) frag.appendChild(child.firstChild);
            child.replaceWith(frag);
            continue;
          }
          child.replaceWith(document.createTextNode(child.textContent || ''));
          continue;
        }
        for (const attr of Array.from(child.attributes)) {
          if (child.tagName === 'A' && attr.name === 'href') {
            const v = child.getAttribute('href') || '';
            if (!/^(https?:|mailto:|ideacraft:)/i.test(v)) child.removeAttribute('href');
            else { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noreferrer'); }
          } else if (attr.name !== 'class') child.removeAttribute(attr.name);
        }
        walk(child);
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    }
  };
  walk(doc);
  return doc.innerHTML;
}

export function uid() {
  return 'b-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function debounce(fn, ms = 300) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function formatDate(iso, opts) {
  if (!iso) return '';
  let d;
  try { d = new Date(iso); } catch { return ''; }
  if (isNaN(d)) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  return formatDate(iso);
}

export function relativeDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start - target) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return formatDate(iso);
}

export function pageIcon(page, fallbackSvg = 'file') {
  if (!page) return `<svg class="ic"><use href="#i-${fallbackSvg}"/></svg>`;
  const icon = page.icon;
  if (icon && (icon.startsWith('data:') || icon.startsWith('http'))) {
    return `<img src="${esc(icon)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:3px">`;
  }
  if (icon && icon.length <= 8) return esc(icon);
  if (page.type === 'database' || page.pageType === 'database') return `<svg class="ic"><use href="#i-database"/></svg>`;
  return `<svg class="ic"><use href="#i-file"/></svg>`;
}

export function pageTitle(page) {
  return page?.title || 'Untitled';
}

export function isMac() {
  return (S.app?.platform || navigator.platform || '').toLowerCase().includes('mac');
}

export function modKey() {
  return isMac() ? '⌘' : 'Ctrl';
}

export function flatPages() {
  return S.pages || [];
}

export function childrenOf(parentId) {
  return (S.pages || []).filter(p => (p.parentId || null) === (parentId || null));
}

export function pageAncestors(id) {
  const out = [];
  let p = S.pageMap.get(id);
  const seen = new Set();
  while (p && p.parentId && !seen.has(p.parentId)) {
    seen.add(p.parentId);
    p = S.pageMap.get(p.parentId);
    if (p) out.unshift(p);
  }
  return out;
}

export function descendantsOf(id) {
  const out = [];
  const walk = (pid) => {
    for (const p of S.pages) {
      if ((p.parentId || null) === pid) { out.push(p); walk(p.id); }
    }
  };
  walk(id);
  return out;
}

export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function randomId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlight(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<b>' + esc(text.slice(i, i + q.length)) + '</b>' + esc(text.slice(i + q.length));
}

export function wordCount(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export const EMOJIS = [
  '📄','📝','📚','📖','🗂️','📁','📌','📎','🔖','📊','📈','📉','🧠','💡','✨','🔥','⭐','🌟','✅','☑️','🎯','🚀','⚡','🌈','☀️','🌙','☁️','🌱','🌿','🍀','🌸','🌊','🏔️','🌍','🗺️','🧭','🏠','🏡','🏢','💼','🛠️','⚙️','🔧','🔨','🧪','🔬','🎨','🖌️','🎭','🎬','🎵','🎧','📷','📸','💻','🖥️','⌨️','🖱️','📱','☎️','📞','✉️','📧','💬','🗣️','👥','👤','🧑‍💻','🦄','🐱','🐶','🐢','🦊','🐻','🐼','🦋','🐝','🌻','🍎','🍋','🍇','🍓','🍒','🥑','🍕','🍩','☕','🍵','🍺','🎉','🎁','🏆','🥇','🎓','🔑','🗝️','🔒','🔓','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💯','♾️','🔮','🧩','🪄','🧵','🪴','🕯️','⏰','⏳','📅','📆','🗓️','🛒','💰','💳','🧾','📍','🚩','🏁','🏷️','🧷','🔗','🖇️','📏','📐','✂️','🖊️','🖋️','✏️','🖍️','📘','📙','📗','📕','📓','📔','📒','📃','📋','🗒️','🗃️','🗄️','📦','🎒','🧳','🪁','🛸'
];
