/* IdeaCraft – application views: pages, home, library, templates, trash, settings, drawers */
import {
  S, $, el, esc, invoke, sanitizeHtml, stripHtml, pageIcon, pageTitle,
  timeAgo, formatDate, formatDateTime, isMac, modKey, debounce, clamp,
  pageAncestors, descendantsOf, highlight, randomId,
} from './api.js';
import {
  showMenu, showPopover, openModal, confirmDialog, promptDialog, toast,
  emojiPicker, coverPicker, COVER_GRADIENTS, copyToClipboard, spinner, hasLayers,
} from './ui.js';
import { mountEditor, flushEditor, destroyEditor, insertEditorText, focusEditorBlock, getEditorBlocks } from './editor.js';
import { mountDatabase, mountRowProperties } from './database.js';

let viewSeq = 0;
let activeComments = null;
let activeAI = null;
let settingsModal = null;
let currentDetail = null;

const ICONS = {
  history: '<svg class="ic"><use href="#i-history"/></svg>',
  lock: '<svg class="ic"><use href="#i-lock"/></svg>',
  globe: '<svg class="ic"><use href="#i-globe"/></svg>',
  comment: '<svg class="ic"><use href="#i-comment"/></svg>',
  star: '<svg class="ic"><use href="#i-star"/></svg>',
  starFilled: '<svg class="ic"><use href="#i-star-filled"/></svg>',
  share: '<svg class="ic"><use href="#i-share"/></svg>',
  more: '<svg class="ic"><use href="#i-more"/></svg>',
  link: '<svg class="ic"><use href="#i-link"/></svg>',
  copy: '<svg class="ic"><use href="#i-copy"/></svg>',
  trash: '<svg class="ic"><use href="#i-trash"/></svg>',
  check: '<svg class="ic"><use href="#i-check"/></svg>',
  close: '<svg class="ic"><use href="#i-close"/></svg>',
  sparkles: '<svg class="ic"><use href="#i-sparkles"/></svg>',
  send: '<svg class="ic"><use href="#i-send"/></svg>',
  info: '<svg class="ic"><use href="#i-info"/></svg>',
  warning: '<svg class="ic"><use href="#i-warning"/></svg>',
};

function begin(container) {
  const token = ++viewSeq;
  container.dataset.viewToken = String(token);
  container.innerHTML = '';
  return token;
}
function isStale(container, token) {
  return container.dataset.viewToken !== String(token);
}
function errText(e) {
  if (typeof e === 'string') return e;
  return e?.message || String(e ?? 'Something went wrong');
}
function icon(name, cls = 'ic') {
  return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}
function initials(name) {
  const s = String(name || 'You').trim();
  return (s[0] || 'Y').toUpperCase();
}
function emptyState(emoji, title, text, actions = null) {
  const node = el('div', { class: 'empty-state' },
    el('div', { class: 'es-icon', text: emoji }),
    el('h3', { text: title }),
    el('p', { text: text })
  );
  if (actions) node.appendChild(el('div', { style: { marginTop: '14px', display: 'flex', gap: '8px', justifyContent: 'center' } }, actions));
  return node;
}

/* ---------------- Data helpers ---------------- */
export async function fetchPageDetail(id) {
  return invoke('get_page_detail', { id });
}

export function syncPageState(page) {
  if (!page || !page.id) return;
  const summary = S.pageMap.get(page.id);
  if (summary) {
    summary.title = page.title ?? summary.title;
    summary.icon = page.icon ?? null;
    summary.cover = page.cover ?? null;
    summary.coverType = page.coverType || 'none';
    summary.parentId = page.parentId ?? summary.parentId;
    summary.isFavorite = !!page.isFavorite;
    summary.updatedAt = page.updatedAt || summary.updatedAt;
    summary.databaseId = page.databaseId ?? summary.databaseId;
    if (page.type && page.type !== 'row') summary.type = page.type;
  } else if (page.type !== 'row' && !page.isTemplate && !page.trashedAt) {
    const ns = {
      id: page.id, parentId: page.parentId || null, title: page.title || '',
      icon: page.icon || null, cover: page.cover || null, coverType: page.coverType || 'none',
      type: page.type === 'database' ? 'database' : 'page', databaseId: page.databaseId || null,
      position: page.position || 0, isFavorite: !!page.isFavorite, isTemplate: false,
      updatedAt: page.updatedAt || new Date().toISOString(), trashedAt: null,
    };
    S.pages.push(ns);
    S.pageMap.set(ns.id, ns);
  }
  S.host?.syncPage?.(page);
}

async function savePagePatch(page, patch) {
  const updated = await invoke('update_page', { id: page.id, patch });
  Object.assign(page, updated);
  syncPageState(page);
  return page;
}

export async function copyPageLink(id) {
  const ok = await copyToClipboard(`ideacraft://page/${id}`);
  toast(ok ? 'Page link copied' : 'Could not copy link', ok ? 'success' : 'error');
  return ok;
}

export async function exportPage(id, format = 'md') {
  try {
    const path = await invoke(format === 'html' ? 'export_html' : 'export_markdown', { pageId: id });
    if (path) toast(`Exported to ${path}`, 'success', 4200);
  } catch (e) {
    toast(`Export failed: ${errText(e)}`, 'error', 4200);
  }
}

export async function toggleFavoriteById(id, opts = {}) {
  try {
    const current = S.pageMap.get(id);
    const next = opts.value !== undefined ? !!opts.value : !current?.isFavorite;
    const page = await invoke('update_page', { id, patch: { isFavorite: next } });
    syncPageState(page);
    if (opts.refreshTree !== false) S.host?.refreshTree?.();
    toast(next ? 'Added to Favorites' : 'Removed from Favorites', 'success');
    return page;
  } catch (e) {
    toast(`Could not update favorite: ${errText(e)}`, 'error');
    return null;
  }
}

export async function duplicatePageById(id) {
  try {
    const detail = await invoke('duplicate_page', { id });
    await S.host?.refreshTree?.();
    S.host?.openPage?.(detail.page.id);
    toast('Page duplicated', 'success');
    return detail;
  } catch (e) {
    toast(`Could not duplicate page: ${errText(e)}`, 'error');
    return null;
  }
}

export async function renamePageById(id, currentTitle = '') {
  const value = await promptDialog({ title: 'Rename page', label: 'Page title', value: currentTitle, confirmText: 'Rename' });
  if (value === null) return;
  try {
    const page = await invoke('update_page', { id, patch: { title: value } });
    syncPageState(page);
    await S.host?.refreshTree?.();
  } catch (e) {
    toast(`Could not rename page: ${errText(e)}`, 'error');
  }
}

export async function trashPageById(id, title = '') {
  const ok = await confirmDialog({
    title: 'Move to Trash?',
    message: `“${esc(title || 'Untitled')}” and its subpages will be moved to Trash. You can restore them later.`,
    confirmText: 'Move to Trash',
    danger: true,
  });
  if (!ok) return false;
  try {
    const ids = [id, ...descendantsOf(id).map(p => p.id)];
    await invoke('trash_page', { id });
    S.host?.closePageTabs?.(ids);
    await S.host?.refreshTree?.();
    toast('Moved to Trash', 'success');
    return true;
  } catch (e) {
    toast(`Could not move page to Trash: ${errText(e)}`, 'error');
    return false;
  }
}

export async function restorePageById(id) {
  try {
    await invoke('restore_page', { id });
    await S.host?.refreshTree?.();
    toast('Page restored', 'success');
    return true;
  } catch (e) {
    toast(`Could not restore page: ${errText(e)}`, 'error');
    return false;
  }
}

export function movePageDialog(id, onMoved = null) {
  const page = S.pageMap.get(id);
  if (!page) return;
  const excluded = new Set([id, ...descendantsOf(id).map(p => p.id)]);
  const body = el('div');
  const search = el('input', { type: 'text', placeholder: 'Search pages…', spellcheck: 'false' });
  const searchWrap = el('div', { class: 'modal-search' }, el('span', { html: icon('search') }), search);
  const list = el('div', { class: 'move-list' });
  body.append(searchWrap, list);

  const options = [
    { id: null, title: 'Private', icon: '🏠', depth: 0 },
    ...S.pages
      .filter(p => p.id !== id && !p.isTemplate && p.type !== 'row' && p.type !== 'database')
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(p => ({ id: p.id, title: pageTitle(p), icon: p.icon, type: p.type, depth: Math.min(pageAncestors(p.id).length, 8) })),
  ];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    for (const opt of options) {
      if (q && !opt.title.toLowerCase().includes(q)) continue;
      const disabled = opt.id && excluded.has(opt.id);
      const row = el('div', {
        class: `move-item ${disabled ? 'disabled' : ''}`,
        style: { paddingLeft: `${7 + opt.depth * 16}px` },
      });
      const ic = el('span', { class: 'mi-icon', html: opt.icon && String(opt.icon).length <= 8 ? esc(opt.icon) : icon(opt.id ? 'file' : 'home') });
      row.append(ic, el('span', { class: 'mi-title', text: opt.title }));
      if ((page.parentId || null) === opt.id) row.appendChild(el('span', { class: 'mi-check', html: ICONS.check }));
      if (disabled) row.appendChild(el('span', { style: { fontSize: '10px', color: 'var(--text-faint)' }, text: 'inside' }));
      row.addEventListener('click', async () => {
        if (disabled) return;
        try {
          await invoke('move_page', { id, parentId: opt.id });
          page.parentId = opt.id;
          await S.host?.refreshTree?.();
          modal.close();
          toast(`Moved to ${opt.id ? opt.title : 'Private'}`, 'success');
          if (onMoved) await onMoved(opt.id);
          if (S.currentPageId === id) S.host?.reloadPage?.(id);
        } catch (e) {
          toast(`Could not move page: ${errText(e)}`, 'error');
        }
      });
      list.appendChild(row);
    }
    if (!list.children.length) list.appendChild(el('div', { class: 'slash-empty', text: 'No pages found' }));
  };
  search.addEventListener('input', render);
  render();
  const modal = openModal({
    title: 'Move page', width: 480, body,
    footer: el('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
    onMount: () => search.focus(),
  });
}

export function showSidebarPageMenu(anchor, page, at = null) {
  const opts = { align: 'right', width: 230 };
  if (at) { opts.x = at.x; opts.y = at.y; } else opts.anchor = anchor;
  showMenu({
    ...opts,
    items: [
      { icon: 'expand', label: 'Open in new tab', action: () => S.host?.openPage?.(page.id, { newTab: true }) },
      { type: 'sep' },
      { icon: page.isFavorite ? 'star-filled' : 'star', label: page.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', action: () => toggleFavoriteById(page.id) },
      { icon: 'edit', label: 'Rename', action: () => renamePageById(page.id, pageTitle(page)) },
      { icon: 'duplicate', label: 'Duplicate', action: () => duplicatePageById(page.id) },
      { icon: 'link', label: 'Copy link', action: () => copyPageLink(page.id) },
      { icon: 'move', label: 'Move to…', action: () => movePageDialog(page.id) },
      { icon: 'download', label: 'Export as Markdown', action: () => exportPage(page.id, 'md') },
      { icon: 'download', label: 'Export as HTML', action: () => exportPage(page.id, 'html') },
      { type: 'sep' },
      { icon: 'trash', label: 'Move to Trash', danger: true, action: () => trashPageById(page.id, pageTitle(page)) },
    ],
  });
}

export async function useTemplate(templateId, parentId = null, templateTitle = '') {
  try {
    const detail = await invoke('create_from_template', { templateId, parentId, title: templateTitle || null });
    await S.host?.refreshTree?.();
    S.host?.openPage?.(detail.page.id);
    toast('Page created from template', 'success');
    return detail;
  } catch (e) {
    toast(`Could not use template: ${errText(e)}`, 'error');
    return null;
  }
}

async function createNewPage(parentId = null, pageType = 'page') {
  try {
    const detail = await invoke('create_page', { parentId, title: '', pageType });
    await S.host?.refreshTree?.();
    S.host?.openPage?.(detail.page.id);
    return detail;
  } catch (e) {
    toast(`Could not create page: ${errText(e)}`, 'error');
    return null;
  }
}

/* ---------------- Home ---------------- */
export async function renderHome(container) {
  const token = begin(container);
  const name = S.settings.userName || 'You';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const view = el('div', { class: 'home-view' });
  const inner = el('div', { class: 'home-inner' });
  const top = el('div', { class: 'home-top' },
    el('div', { class: 'home-greeting' },
      el('h1', { text: `${greeting}, ${name}` }),
      el('p', { text: 'What do you want to get done today?' })
    ),
    el('div', { class: 'home-date', text: now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) })
  );
  const ask = el('div', { class: 'home-ask', role: 'button', tabindex: '0' },
    el('span', { class: 'ha-icon', html: icon('search') }), el('span', { class: 'ha-text', text: 'Search or ask IdeaCraft AI…' }), el('kbd', { text: `${modKey()} K` })
  );
  const openSearch = () => S.host?.openSearch?.();
  ask.addEventListener('click', openSearch);
  ask.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSearch(); } });
  const body = el('div');
  inner.append(top, ask, body);
  view.appendChild(inner);
  container.appendChild(view);

  // Quick actions
  const quick = el('div', { class: 'quick-grid' });
  const actions = [
    { icon: 'file', label: 'New page', sub: 'Start writing', run: () => createNewPage(null, 'page') },
    { icon: 'database', label: 'New database', sub: 'Track anything', run: () => createNewPage(null, 'database') },
    { icon: 'upload', label: 'Import', sub: 'Markdown or text', run: async () => {
      try {
        const detail = await invoke('import_markdown', { parentId: null });
        if (detail) { await S.host?.refreshTree?.(); S.host?.openPage?.(detail.page.id); toast('Page imported', 'success'); }
      } catch (e) { toast(`Import failed: ${errText(e)}`, 'error'); }
    } },
    { icon: 'grid', label: 'Templates', sub: 'Ready-made pages', run: () => S.host?.openRoute?.({ type: 'templates' }) },
  ];
  for (const a of actions) {
    const card = el('button', { class: 'quick-card' },
      el('span', { class: 'qc-icon', html: icon(a.icon) }),
      el('span', { class: 'qc-label', text: a.label }),
      el('span', { class: 'qc-sub', text: a.sub })
    );
    card.addEventListener('click', a.run);
    quick.appendChild(card);
  }
  body.appendChild(el('div', { class: 'home-section' }, el('div', { class: 'home-section-head' }, el('h2', { text: 'Quick actions' })), quick));

  let data = null;
  try {
    data = await invoke('get_home');
  } catch (e) {
    if (!isStale(container, token)) body.appendChild(emptyState('⚠️', 'Could not load Home', errText(e)));
    return;
  }
  if (isStale(container, token)) return;

  const recents = data.recents || [];
  const recSection = el('div', { class: 'home-section' });
  recSection.appendChild(el('div', { class: 'home-section-head' },
    el('h2', { text: 'Recently visited' }),
    el('button', { text: 'All pages', onclick: () => S.host?.openRoute?.({ type: 'library' }) })
  ));
  if (recents.length) {
    const grid = el('div', { class: 'recent-grid' });
    for (const p of recents) {
      const item = el('div', { class: 'recent-item' },
        el('div', { class: 'recent-icon', html: pageIcon(p) }),
        el('div', { class: 'recent-text' },
          el('div', { class: 'recent-title', text: pageTitle(p) }),
          el('div', { class: 'recent-sub', text: `Edited ${timeAgo(p.updatedAt)}` })
        )
      );
      item.addEventListener('click', () => S.host?.openPage?.(p.id));
      grid.appendChild(item);
    }
    recSection.appendChild(grid);
  } else {
    recSection.appendChild(emptyState('🌱', 'No pages yet', 'Create your first page to get started.'));
  }
  body.appendChild(recSection);

  const favorites = data.favorites || [];
  if (favorites.length) {
    const favSection = el('div', { class: 'home-section' });
    favSection.appendChild(el('div', { class: 'home-section-head' }, el('h2', { text: 'Favorites' })));
    const list = el('div', { class: 'fav-list' });
    for (const p of favorites) {
      const item = el('div', { class: 'fav-item' },
        el('span', { class: 'fav-icon', html: pageIcon(p) }),
        el('span', { class: 'fav-title', text: pageTitle(p) }),
        el('span', { class: 'fav-star', html: ICONS.starFilled })
      );
      item.addEventListener('click', () => S.host?.openPage?.(p.id));
      list.appendChild(item);
    }
    favSection.appendChild(list);
    body.appendChild(favSection);
  }

  const templates = data.templates || [];
  if (templates.length) {
    const tplSection = el('div', { class: 'home-section' });
    tplSection.appendChild(el('div', { class: 'home-section-head' },
      el('h2', { text: 'Templates' }),
      el('button', { text: 'Browse all', onclick: () => S.host?.openRoute?.({ type: 'templates' }) })
    ));
    const grid = el('div', { class: 'home-templates' });
    const descs = {
      'Meeting Notes': 'Capture an agenda, decisions, and next steps.',
      'Weekly Planner': 'Plan the week ahead in one place.',
      'Habit Tracker': 'Build routines one day at a time.',
      'Journal': 'A simple space for daily reflection.',
      'Project Brief': 'Define goals, scope, and milestones.',
      'Blank Page': 'Start from a clean slate.',
    };
    for (const t of templates.slice(0, 3)) {
      const card = el('button', { class: 'template-card' },
        el('div', { class: 'tpl-icon', text: t.icon && String(t.icon).length <= 8 ? t.icon : '📄' }),
        el('div', { class: 'tpl-name', text: pageTitle(t) }),
        el('div', { class: 'tpl-desc', text: descs[pageTitle(t)] || 'Start with a ready-made structure.' })
      );
      card.addEventListener('click', () => useTemplate(t.id, null, ''));
      grid.appendChild(card);
    }
    tplSection.appendChild(grid);
    body.appendChild(tplSection);
  }

  body.appendChild(el('div', { class: 'home-footer' },
    el('span', { text: `IdeaCraft ${S.app?.version || ''}`.trim() }),
    el('span', { class: 'dot', text: '•' }),
    el('span', { text: `${data.counts?.pages ?? S.pages.length} pages` }),
    el('span', { class: 'dot', text: '•' }),
    el('span', { text: 'Local-first workspace' })
  ));
}

/* ---------------- Page ---------------- */
export async function renderPage(container, pageId) {
  const token = begin(container);
  const pageView = el('div', { class: 'page-view' });
  const topbar = el('div', { class: 'page-topbar' });
  const scroll = el('div', { class: 'page-scroll' });
  pageView.append(topbar, scroll);
  container.appendChild(pageView);
  scroll.appendChild(el('div', { class: 'page-loading' }, el('span', { html: spinner(17) }), el('span', { text: 'Loading page…' })));

  let detail;
  try {
    detail = await fetchPageDetail(pageId);
  } catch (e) {
    if (isStale(container, token)) return;
    scroll.innerHTML = '';
    scroll.appendChild(emptyState('🔍', 'Page not found', 'It may have been moved or deleted.', el('button', { class: 'btn', text: 'Go Home', onclick: () => S.host?.openRoute?.({ type: 'home' }) })));
    return;
  }
  if (isStale(container, token)) return;

  const page = detail.page;
  S.currentPageId = page.id;
  currentDetail = detail;
  syncPageState(page);

  scroll.innerHTML = '';
  const inner = el('div', { class: 'page-inner' });
  const header = el('div', { class: 'page-header' });
  const titleRow = el('div', { class: 'page-title-row' });

  const crumbs = el('div', { class: 'crumbs' });
  const ws = el('button', { class: 'crumb', title: 'Home' },
    el('span', { class: 'crumb-icon', text: S.boot?.workspace?.icon && String(S.boot.workspace.icon).length <= 8 ? S.boot.workspace.icon : 'I' }),
    el('span', { text: S.boot?.workspace?.name || 'IdeaCraft' })
  );
  ws.addEventListener('click', () => S.host?.openRoute?.({ type: 'home' }));
  crumbs.appendChild(ws);
  const chain = [...(detail.ancestors || []), page];
  let currentCrumbTitle = null;
  chain.forEach((p, i) => {
    crumbs.appendChild(el('span', { class: 'crumb-sep', text: '/' }));
    const crumb = el('button', { class: `crumb ${i === chain.length - 1 ? 'current' : ''}`, title: pageTitle(p) },
      el('span', { class: 'crumb-icon', html: pageIcon(p) }),
      el('span', { class: 'crumb-title', text: pageTitle(p) })
    );
    if (i === chain.length - 1) currentCrumbTitle = crumb.querySelector('.crumb-title');
    else crumb.addEventListener('click', () => S.host?.openPage?.(p.id));
    crumbs.appendChild(crumb);
  });

  const saveEl = el('span', { class: 'save-status' });
  const starBtn = el('button', { class: 'topbar-btn icon-only', title: page.isFavorite ? 'Remove from Favorites' : 'Add to Favorites' });
  const commentsBtn = el('button', { class: 'topbar-btn', title: 'Comments' });
  const shareBtn = el('button', { class: 'topbar-btn' }, el('span', { html: ICONS.share }), el('span', { text: 'Share' }));
  const moreBtn = el('button', { class: 'topbar-btn icon-only', title: 'More', html: ICONS.more });
  const commentCount = el('span', { class: 'comment-count', text: String((detail.comments || []).filter(c => !c.resolved).length || '') });
  commentsBtn.append(el('span', { html: ICONS.comment }), commentCount);
  const paintStar = () => {
    starBtn.innerHTML = page.isFavorite ? ICONS.starFilled : ICONS.star;
    starBtn.title = page.isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
  };
  paintStar();
  starBtn.addEventListener('click', async () => {
    const updated = await toggleFavoriteById(page.id, { value: !page.isFavorite, refreshTree: false });
    if (updated) { page.isFavorite = updated.isFavorite; paintStar(); S.host?.refreshTree?.(); }
  });
  const updateCommentCount = (n) => {
    commentCount.textContent = n ? String(n) : '';
    commentsBtn.title = n ? `${n} unresolved comment${n === 1 ? '' : 's'}` : 'Comments';
  };
  commentsBtn.addEventListener('click', () => openCommentsDrawer(page.id, null, '', { onChange: updateCommentCount }));
  shareBtn.addEventListener('click', () => openShareDialog(detail));
  moreBtn.addEventListener('click', () => openPageMenu(moreBtn));

  topbar.append(crumbs, el('div', { class: 'topbar-actions' }, saveEl, starBtn, commentsBtn, shareBtn, moreBtn));

  const meta = el('div', { class: 'page-meta' });
  function updateMeta() {
    meta.innerHTML = '';
    meta.appendChild(el('span', { html: '<svg class="ic meta-icon"><use href="#i-history"/></svg>' }));
    meta.appendChild(el('span', { text: `Edited ${timeAgo(page.updatedAt)}` }));
    if (page.lastEditedBy) {
      meta.appendChild(el('span', { class: 'page-meta-sep', text: '·' }));
      meta.appendChild(el('span', { text: page.lastEditedBy }));
    }
    if (page.locked) {
      meta.appendChild(el('span', { class: 'page-meta-sep', text: '·' }));
      meta.appendChild(el('span', { class: 'page-meta-lock', html: `${ICONS.lock}<span>Locked</span>` }));
    }
  }
  updateMeta();

  const iconWrap = el('div', { class: 'page-icon-wrap' });
  const iconBtn = el('button', { class: 'page-icon-btn', title: 'Change icon' });
  iconWrap.appendChild(iconBtn);
  function paintIcon() {
    if (page.icon) {
      iconWrap.style.display = '';
      iconBtn.innerHTML = pageIcon(page);
    } else {
      iconWrap.style.display = 'none';
      iconBtn.innerHTML = '';
    }
  }
  paintIcon();
  iconBtn.addEventListener('click', () => openIconPicker(iconBtn));

  const title = el('h1', {
    class: 'page-title', 'data-placeholder': 'Untitled', spellcheck: 'false',
    contenteditable: page.locked ? 'false' : 'true',
  });
  title.textContent = page.title || '';
  if (page.locked) title.setAttribute('aria-readonly', 'true');
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !page.locked) {
      e.preventDefault();
      const first = getEditorBlocks()[0];
      if (first) focusEditorBlock(first.id);
    }
  });

  const titleActions = el('div', { class: 'page-actions-under' });
  const underComment = el('button', { class: 'icon-btn', title: 'Add a comment', html: ICONS.comment });
  underComment.addEventListener('click', () => openCommentsDrawer(page.id, null, '', { onChange: updateCommentCount }));
  const underStar = el('button', { class: 'icon-btn', title: 'Favorite' });
  const paintUnderStar = () => { underStar.innerHTML = page.isFavorite ? ICONS.starFilled : ICONS.star; };
  paintUnderStar();
  underStar.addEventListener('click', async () => {
    const updated = await toggleFavoriteById(page.id, { value: !page.isFavorite, refreshTree: false });
    if (updated) { page.isFavorite = updated.isFavorite; paintStar(); paintUnderStar(); S.host?.refreshTree?.(); }
  });
  titleActions.append(underComment, underStar);
  titleRow.append(title, titleActions);

  const optionsRow = el('div', { class: 'page-options-row' });
  const optCover = el('button', { class: 'page-option', html: `${icon('image')}<span>${page.cover ? 'Change cover' : 'Add cover'}</span>` });
  const optIcon = el('button', { class: 'page-option', html: `${icon('smile')}<span>${page.icon ? 'Change icon' : 'Add icon'}</span>` });
  const optComment = el('button', { class: 'page-option', html: `${icon('comment')}<span>Add a comment</span>` });
  optCover.addEventListener('click', () => openCoverPicker(optCover));
  optIcon.addEventListener('click', () => openIconPicker(optIcon));
  optComment.addEventListener('click', () => openCommentsDrawer(page.id, null, '', { onChange: updateCommentCount }));
  optionsRow.append(optCover, optIcon, optComment);
  if (!page.cover) optCover.style.display = '';
  if (!page.icon) optIcon.style.display = '';

  header.append(iconWrap, titleRow, optionsRow, meta);
  inner.appendChild(header);

  const rowPropsHost = el('div', { class: 'row-props-host' });
  if (detail.row && detail.database) inner.appendChild(rowPropsHost);

  const blocksRoot = el('div', { class: `page-blocks blocks ${page.type === 'database' ? 'db-page' : ''}` });
  inner.appendChild(blocksRoot);

  const wordEl = el('span', { class: 'word-count' });
  const footerMeta = el('span', { class: 'page-footer-meta' });
  const footer = el('div', { class: 'page-footer' }, wordEl, footerMeta);
  inner.appendChild(footer);

  scroll.appendChild(inner);

  function effectiveStyle() {
    const font = page.font && page.font !== 'default' ? page.font : (S.settings.font || 'default');
    const small = !!(page.smallText || S.settings.smallText);
    const full = !!(page.fullWidth || S.settings.fullWidth);
    inner.classList.toggle('full-width', full);
    inner.classList.toggle('font-serif', font === 'serif');
    inner.classList.toggle('font-mono', font === 'mono');
    inner.classList.toggle('small-text', small);
  }
  effectiveStyle();

  function updateFooter() {
    if (page.type === 'database') {
      const n = (detail.rows || []).filter(r => !r.trashed).length;
      wordEl.textContent = `${n} ${n === 1 ? 'row' : 'rows'}`;
    }
    footerMeta.textContent = `Edited ${timeAgo(page.updatedAt)}${page.fullWidth ? ' · Full width' : ''}`;
  }
  updateFooter();

  function buildCoverNode() {
    if (!page.cover) return null;
    const cover = el('div', { class: 'page-cover' });
    const isGradient = page.coverType === 'gradient' || String(page.cover).startsWith('gradient:') || String(page.cover).startsWith('linear-gradient');
    if (isGradient) {
      let bg = String(page.cover);
      if (bg.startsWith('gradient:')) {
        const value = bg.slice('gradient:'.length);
        bg = /^\d+$/.test(value) ? COVER_GRADIENTS[Number(value) % COVER_GRADIENTS.length] : value;
      }
      cover.appendChild(el('div', { class: 'cover-gradient', style: { background: bg } }));
    } else {
      cover.appendChild(el('img', { src: page.cover, alt: '', style: { objectPosition: `50% ${page.coverPosition || 50}%` } }));
    }
    const actions = el('div', { class: 'cover-overlay-actions' });
    const change = el('button', { class: 'cover-btn', html: `${icon('image')}<span>Change cover</span>` });
    change.addEventListener('click', () => openCoverPicker(change));
    const remove = el('button', { class: 'cover-btn', html: `${icon('trash')}<span>Remove</span>` });
    remove.addEventListener('click', async () => {
      try {
        await savePagePatch(page, { cover: null, coverType: 'none' });
        paintCover();
      } catch (e) { toast(`Could not remove cover: ${errText(e)}`, 'error'); }
    });
    actions.append(change, remove);
    cover.appendChild(actions);
    return cover;
  }
  function paintCover() {
    const old = scroll.querySelector(':scope > .page-cover');
    if (old) old.remove();
    const node = buildCoverNode();
    if (node) scroll.insertBefore(node, inner);
    optCover.innerHTML = `${icon('image')}<span>${page.cover ? 'Change cover' : 'Add cover'}</span>`;
  }
  paintCover();

  async function openCoverPicker(anchor) {
    coverPicker(anchor, {
      onPick: async (gradient) => {
        try {
          const idx = COVER_GRADIENTS.indexOf(gradient);
          await savePagePatch(page, { cover: idx >= 0 ? `gradient:${idx}` : gradient, coverType: 'gradient' });
          paintCover();
        } catch (e) { toast(`Could not change cover: ${errText(e)}`, 'error'); }
      },
      onUpload: async () => {
        try {
          const img = await invoke('pick_image');
          if (!img) return;
          await savePagePatch(page, { cover: img.dataUrl, coverType: 'image' });
          paintCover();
        } catch (e) { toast(`Could not upload cover: ${errText(e)}`, 'error'); }
      },
      onRemove: async () => {
        try {
          await savePagePatch(page, { cover: null, coverType: 'none' });
          paintCover();
        } catch (e) { toast(`Could not remove cover: ${errText(e)}`, 'error'); }
      },
    });
  }

  async function openIconPicker(anchor) {
    emojiPicker(anchor, async (emoji) => {
      try {
        await savePagePatch(page, { icon: emoji || null });
        paintIcon();
        optIcon.innerHTML = `${icon('smile')}<span>${page.icon ? 'Change icon' : 'Add icon'}</span>`;
      } catch (e) { toast(`Could not change icon: ${errText(e)}`, 'error'); }
    }, {
      current: page.icon || '',
      allowRemove: true,
      onRemove: async () => {
        try {
          await savePagePatch(page, { icon: null });
          paintIcon();
          optIcon.innerHTML = `${icon('smile')}<span>Add icon</span>`;
        } catch (e) { toast(`Could not remove icon: ${errText(e)}`, 'error'); }
      },
      onUpload: async () => {
        try {
          const img = await invoke('pick_image');
          if (!img) return;
          await savePagePatch(page, { icon: img.dataUrl });
          paintIcon();
          optIcon.innerHTML = `${icon('smile')}<span>Change icon</span>`;
        } catch (e) { toast(`Could not upload icon: ${errText(e)}`, 'error'); }
      },
    });
  }

  let lastSavedTitle = page.title || '';
  let titleTimer = null;
  const showSave = (text, kind = '') => {
    saveEl.textContent = text || '';
    saveEl.className = `save-status ${text ? 'visible' : ''} ${kind === 'error' ? 'error' : ''}`;
    if (kind === 'saving') S.host?.setTabDirty?.(true, page.id);
    if (kind === 'saved' || kind === 'error') S.host?.setTabDirty?.(false, page.id);
  };
  const paintTitle = () => {
    const value = page.title || 'Untitled';
    if (currentCrumbTitle) currentCrumbTitle.textContent = value;
    S.host?.tabTitle?.(page.id, page.title || 'Untitled', page.icon);
  };
  const commitTitle = async () => {
    if (page.locked) return;
    const value = (title.innerText || '').replace(/\r?\n/g, ' ').trimEnd();
    if (value === lastSavedTitle) return;
    const prev = lastSavedTitle;
    lastSavedTitle = value;
    page.title = value;
    paintTitle();
    showSave('Saving…', 'saving');
    try {
      if (page.type === 'row' && detail.row && detail.database) {
        const tp = (detail.database.properties || []).find(p => p.type === 'title')?.id || 'title';
        const values = { ...(detail.row.values || {}), [tp]: value };
        const row = await invoke('update_row', { rowId: detail.row.id, values });
        Object.assign(detail.row, row);
        page.title = row.title || value;
        page.updatedAt = row.updatedAt || new Date().toISOString();
        const p = S.pageMap.get(page.id);
        if (p) p.title = page.title;
      } else {
        const updated = await invoke('update_page', { id: page.id, patch: { title: value } });
        Object.assign(page, updated);
        if (page.type === 'database' && detail.database) {
          detail.database.name = value;
          invoke('update_database', { id: detail.database.id, name: value }).catch(() => {});
        }
      }
      syncPageState(page);
      updateMeta();
      updateFooter();
      showSave('Saved', 'saved');
      setTimeout(() => { if (saveEl.textContent === 'Saved') showSave(''); }, 1200);
    } catch (e) {
      lastSavedTitle = prev;
      showSave('Save failed', 'error');
      toast(`Could not save title: ${errText(e)}`, 'error');
    }
  };
  if (!page.locked) {
    title.addEventListener('input', () => {
      page.title = (title.innerText || '').replace(/\r?\n/g, ' ');
      paintTitle();
      clearTimeout(titleTimer);
      titleTimer = setTimeout(commitTitle, 500);
    });
    title.addEventListener('blur', () => { clearTimeout(titleTimer); commitTitle(); });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        title.textContent = lastSavedTitle || '';
        page.title = lastSavedTitle || '';
        paintTitle();
        title.blur();
      }
    });
    title.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });
  }

  let scrollRaf = 0;
  scroll.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      topbar.classList.toggle('bordered', scroll.scrollTop > 2);
    });
  }, { passive: true });

  function updateOptions() {
    optCover.innerHTML = `${icon('image')}<span>${page.cover ? 'Change cover' : 'Add cover'}</span>`;
    optIcon.innerHTML = `${icon('smile')}<span>${page.icon ? 'Change icon' : 'Add icon'}</span>`;
    paintIcon();
    paintStar();
    paintUnderStar();
  }

  function openPageMenu(anchor) {
    const font = page.font || 'default';
    showMenu({
      anchor, align: 'right', width: 258,
      items: [
        { icon: 'link', label: 'Copy link', action: () => copyPageLink(page.id) },
        { icon: 'duplicate', label: 'Duplicate', action: () => duplicatePageById(page.id) },
        { icon: 'move', label: 'Move to…', action: () => movePageDialog(page.id) },
        { icon: 'download', label: 'Export as Markdown', action: () => exportPage(page.id, 'md') },
        { icon: 'download', label: 'Export as HTML', action: () => exportPage(page.id, 'html') },
        { type: 'sep' },
        { icon: page.isFavorite ? 'star-filled' : 'star', label: page.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', action: async () => {
          const updated = await toggleFavoriteById(page.id, { value: !page.isFavorite, refreshTree: false });
          if (updated) { page.isFavorite = updated.isFavorite; updateOptions(); S.host?.refreshTree?.(); }
        } },
        { icon: 'lock', label: page.locked ? 'Unlock page' : 'Lock page', action: async () => {
          if (!page.locked) {
            const ok = await confirmDialog({ title: 'Lock this page?', message: 'Locked pages are read-only until you unlock them.', confirmText: 'Lock page' });
            if (!ok) return;
          }
          try {
            await savePagePatch(page, { locked: !page.locked });
            S.host?.reloadPage?.(page.id);
            toast(page.locked ? 'Page locked' : 'Page unlocked', 'success');
          } catch (e) { toast(`Could not update page: ${errText(e)}`, 'error'); }
        } },
        { type: 'label', label: 'Page font' },
        { checked: font === 'default', label: 'Default', action: async () => { await savePagePatch(page, { font: 'default' }); effectiveStyle(); } },
        { checked: font === 'serif', label: 'Serif', action: async () => { await savePagePatch(page, { font: 'serif' }); effectiveStyle(); } },
        { checked: font === 'mono', label: 'Mono', action: async () => { await savePagePatch(page, { font: 'mono' }); effectiveStyle(); } },
        { checked: !!page.smallText, label: 'Small text', action: async () => { await savePagePatch(page, { smallText: !page.smallText }); effectiveStyle(); } },
        { checked: !!page.fullWidth, label: 'Full width', action: async () => { await savePagePatch(page, { fullWidth: !page.fullWidth }); effectiveStyle(); updateFooter(); } },
        { type: 'sep' },
        { icon: 'history', label: 'Version history', action: () => openVersionHistory(detail) },
        { type: 'sep' },
        { icon: 'trash', label: 'Move to Trash', danger: true, action: () => trashPageById(page.id, page.title) },
      ],
    });
  }

  // Mount editor or database
  if (page.type === 'database' && detail.database) {
    mountDatabase(blocksRoot, detail, {
      openPage: (id) => S.host?.openPage?.(id),
      onChange: () => {
        updateFooter();
        showSave('Saved', 'saved');
        if (saveEl.textContent === 'Saved') setTimeout(() => { if (saveEl.textContent === 'Saved') showSave(''); }, 1200);
      },
      onDatabaseChange: (db) => { detail.database = db; },
      onTitleChange: (row) => {
        if (detail.row && detail.row.id === row.id) {
          page.title = row.title || page.title;
          title.textContent = page.title;
          paintTitle();
          updateMeta();
        }
        S.host?.refreshTree?.();
      },
    });
  } else {
    mountEditor(blocksRoot, detail, {
      onStatus: (text, kind) => showSave(text, kind),
      onPageUpdate: (p) => {
        Object.assign(page, p);
        updateMeta();
        updateFooter();
        syncPageState(page);
      },
      onWords: (n) => { wordEl.textContent = `${n} ${n === 1 ? 'word' : 'words'}`; },
      openPage: (id) => S.host?.openPage?.(id),
      openComments: (blockId, quote) => openCommentsDrawer(page.id, blockId, quote || '', { onChange: updateCommentCount }),
    });
    if (detail.row && detail.database) {
      mountRowProperties(rowPropsHost, detail, {
        openPage: (id) => S.host?.openPage?.(id),
        onChange: () => { updateMeta(); updateFooter(); },
        onTitleChange: (row) => {
          if (detail.row && detail.row.id === row.id) {
            page.title = row.title || page.title;
            title.textContent = page.title;
            paintTitle();
            updateMeta();
            S.host?.refreshTree?.();
          }
        },
      });
    }
  }

  if (!page.title && !page.locked) {
    setTimeout(() => {
      if (isStale(container, token)) return;
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, 120);
  }

  S.host?.onPageShown?.(detail);
}

/* ---------------- Shared plain view shell ---------------- */
function plainShell(container, { emoji, title, sub, actions = [] }) {
  const view = el('div', { class: 'plain-view' });
  const inner = el('div', { class: 'plain-inner' });
  const head = el('div', { class: 'plain-header' },
    el('span', { class: 'plain-icon', text: emoji }),
    el('h1', { text: title })
  );
  inner.appendChild(head);
  if (sub) inner.appendChild(el('p', { class: 'plain-sub', text: sub }));
  if (actions.length) {
    const bar = el('div', { class: 'plain-actions' });
    actions.forEach(a => bar.appendChild(a));
    inner.appendChild(bar);
  }
  const body = el('div');
  inner.appendChild(body);
  view.appendChild(inner);
  container.appendChild(view);
  return { view, inner, body, head };
}

function pagePathLabel(p) {
  const parents = pageAncestors(p.id).map(pageTitle);
  return parents.length ? parents.join(' / ') : 'Private';
}

function favButton(p, onChange = null) {
  const btn = el('button', {
    class: 'icon-btn tiny fav-toggle',
    title: p.isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
    'aria-label': p.isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
    html: p.isFavorite ? ICONS.starFilled : ICONS.star,
  });
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const updated = await toggleFavoriteById(p.id, { refreshTree: false });
    if (!updated) return;
    p.isFavorite = updated.isFavorite;
    btn.innerHTML = p.isFavorite ? ICONS.starFilled : ICONS.star;
    btn.title = p.isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
    S.host?.refreshTree?.();
    onChange?.(p);
  });
  return btn;
}

/* ---------------- Library ---------------- */
export function renderLibrary(container) {
  begin(container);
  const { body } = plainShell(container, {
    emoji: '📚',
    title: 'Library',
    sub: 'Every page in your workspace, all in one place.',
    actions: [
      el('button', { class: 'btn primary', html: `${icon('plus')}<span>New page</span>`, onclick: () => createNewPage(null, 'page') }),
      el('button', { class: 'btn', html: `${icon('database')}<span>New database</span>`, onclick: () => createNewPage(null, 'database') }),
    ],
  });

  let query = '';
  let filter = 'all';
  let layout = 'list';
  let sort = 'edited';

  const search = el('input', { type: 'text', placeholder: 'Search pages…', spellcheck: 'false', 'aria-label': 'Search pages' });
  const searchWrap = el('div', { class: 'lib-filter' }, el('span', { html: icon('search') }), search);
  const filterSeg = el('div', { class: 'segmented' });
  const filters = [
    ['all', 'All'],
    ['favorites', 'Favorites'],
    ['databases', 'Databases'],
  ];
  filters.forEach(([key, label]) => {
    const b = el('button', { text: label, class: key === filter ? 'active' : '' });
    b.addEventListener('click', () => {
      filter = key;
      filterSeg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      paint();
    });
    filterSeg.appendChild(b);
  });
  const sortSel = el('select', { class: 'lib-sort', 'aria-label': 'Sort pages' },
    el('option', { value: 'edited', text: 'Last edited' }),
    el('option', { value: 'created', text: 'Last created' }),
    el('option', { value: 'alpha', text: 'Alphabetical' })
  );
  sortSel.addEventListener('change', () => { sort = sortSel.value; paint(); });
  const layoutSeg = el('div', { class: 'segmented layout-toggle' });
  const listBtn = el('button', { class: 'active', title: 'List view', 'aria-label': 'List view', html: icon('list') });
  const gridBtn = el('button', { title: 'Gallery view', 'aria-label': 'Gallery view', html: icon('gallery') });
  listBtn.addEventListener('click', () => { layout = 'list'; listBtn.classList.add('active'); gridBtn.classList.remove('active'); paint(); });
  gridBtn.addEventListener('click', () => { layout = 'grid'; gridBtn.classList.add('active'); listBtn.classList.remove('active'); paint(); });
  layoutSeg.append(listBtn, gridBtn);

  const count = el('span', { class: 'lib-count' });
  const toolbar = el('div', { class: 'lib-toolbar' },
    searchWrap, filterSeg, el('span', { class: 'lib-spacer' }), count, sortSel, layoutSeg
  );
  body.appendChild(toolbar);
  const host = el('div', { class: 'lib-host' });
  body.appendChild(host);

  search.addEventListener('input', () => { query = search.value.trim(); paint(); });

  function visiblePages() {
    let list = (S.pages || []).filter(p => !p.isTemplate && p.type !== 'row' && !p.trashedAt);
    if (filter === 'favorites') list = list.filter(p => p.isFavorite);
    if (filter === 'databases') list = list.filter(p => p.type === 'database');
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(p => pageTitle(p).toLowerCase().includes(q) || pagePathLabel(p).toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sort === 'alpha') return pageTitle(a).localeCompare(pageTitle(b));
      if (sort === 'created') return String(b.id).localeCompare(String(a.id));
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
    return list;
  }

  function paint() {
    const list = visiblePages();
    count.textContent = `${list.length} ${list.length === 1 ? 'page' : 'pages'}`;
    host.innerHTML = '';
    if (!list.length) {
      host.appendChild(emptyState(query ? '🔎' : '📄',
        query ? 'No matching pages' : 'Nothing here yet',
        query ? `No pages match “${query}”.` : 'Create a page to start filling your library.',
        !query ? el('button', { class: 'btn primary', text: 'New page', onclick: () => createNewPage(null, 'page') }) : null));
      return;
    }
    if (layout === 'grid') {
      const grid = el('div', { class: 'lib-grid' });
      for (const p of list) {
        const card = el('div', { class: 'lib-card', tabindex: '0', role: 'button' });
        const top = el('div', { class: 'lc-top' },
          el('span', { class: 'lc-icon', html: pageIcon(p) }),
          el('span', { class: 'lc-top-actions' }, favButton(p))
        );
        const desc = p.type === 'database'
          ? `Database · Edited ${timeAgo(p.updatedAt)}`
          : `${pagePathLabel(p)} · Edited ${timeAgo(p.updatedAt)}`;
        card.append(top,
          el('div', { class: 'lc-name', html: highlight(pageTitle(p), query) }),
          el('div', { class: 'lc-desc', text: desc }));
        card.addEventListener('click', () => S.host?.openPage?.(p.id));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.host?.openPage?.(p.id); } });
        card.addEventListener('contextmenu', e => { e.preventDefault(); showSidebarPageMenu(null, p, { x: e.clientX, y: e.clientY }); });
        grid.appendChild(card);
      }
      host.appendChild(grid);
    } else {
      const wrap = el('div', { class: 'list-view' });
      for (const p of list) {
        const row = el('div', { class: 'list-row', tabindex: '0', role: 'button' });
        const main = el('div', { class: 'lr-main' },
          el('div', { class: 'lr-title', html: highlight(pageTitle(p), query) }),
          el('div', { class: 'lr-sub', text: `${p.type === 'database' ? 'Database' : pagePathLabel(p)} · Edited ${timeAgo(p.updatedAt)}` })
        );
        const actions = el('div', { class: 'lr-actions' }, favButton(p),
          el('button', { class: 'icon-btn tiny', title: 'More', 'aria-label': 'More', html: ICONS.more, onclick: (e) => { e.stopPropagation(); showSidebarPageMenu(e.currentTarget, p); } })
        );
        row.append(el('div', { class: 'lr-icon', html: pageIcon(p) }), main, actions);
        row.addEventListener('click', () => S.host?.openPage?.(p.id));
        row.addEventListener('keydown', e => { if (e.key === 'Enter') S.host?.openPage?.(p.id); });
        row.addEventListener('contextmenu', e => { e.preventDefault(); showSidebarPageMenu(null, p, { x: e.clientX, y: e.clientY }); });
        wrap.appendChild(row);
      }
      host.appendChild(wrap);
    }
  }
  paint();
}

/* ---------------- Templates ---------------- */
export async function renderTemplates(container) {
  const token = begin(container);
  const { body } = plainShell(container, {
    emoji: '🗂️',
    title: 'Templates',
    sub: 'Start with a structure that is already set up. Every template can be edited like any other page.',
    actions: [
      el('button', { class: 'btn primary', html: `${icon('plus')}<span>Blank page</span>`, onclick: () => createNewPage(null, 'page') }),
      el('button', { class: 'btn', html: `${icon('database')}<span>New database</span>`, onclick: () => createNewPage(null, 'database') }),
    ],
  });
  body.appendChild(el('div', { class: 'page-loading' }, el('span', { html: spinner(16) }), el('span', { text: 'Loading templates…' })));
  let list = [];
  try {
    list = await invoke('get_templates');
  } catch (e) {
    if (isStale(container, token)) return;
    body.innerHTML = '';
    body.appendChild(emptyState('⚠️', 'Could not load templates', errText(e)));
    return;
  }
  if (isStale(container, token)) return;
  body.innerHTML = '';

  const gallery = el('div', { class: 'template-gallery' });
  const blank = el('button', { class: 'tpl-card blank' },
    el('div', { class: 'tc-icon', html: icon('plus', 'ic blank-plus') }),
    el('div', { class: 'tc-name', text: 'Blank page' }),
    el('div', { class: 'tc-desc', text: 'Start from an empty page.' })
  );
  blank.addEventListener('click', () => createNewPage(null, 'page'));
  gallery.appendChild(blank);

  for (const entry of list) {
    const t = entry.page || entry;
    if (pageTitle(t) === 'Blank Page') continue;
    const card = el('button', { class: 'tpl-card' },
      el('div', { class: 'tc-icon', text: t.icon && String(t.icon).length <= 8 ? t.icon : '📄' }),
      el('div', { class: 'tc-name', text: pageTitle(t) }),
      el('div', { class: 'tc-desc', text: entry.description || 'Ready-made structure for your next page.' })
    );
    card.addEventListener('click', async () => {
      const created = await useTemplate(t.id, null, pageTitle(t));
      if (created) S.host?.refreshTree?.();
    });
    gallery.appendChild(card);
  }
  body.appendChild(gallery);
  body.appendChild(el('p', { class: 'settings-footer-note', text: 'Templates live inside your workspace. Duplicate a template page from its ••• menu for a customized starting point.' }));
}

/* ---------------- Trash ---------------- */
export async function renderTrash(container) {
  const token = begin(container);
  const { body } = plainShell(container, {
    emoji: '🗑️',
    title: 'Trash',
    sub: 'Deleted pages stay here until you remove them permanently.',
  });
  body.appendChild(el('div', { class: 'page-loading' }, el('span', { html: spinner(16) }), el('span', { text: 'Loading Trash…' })));
  let items = [];
  try {
    items = await invoke('get_trash');
  } catch (e) {
    if (isStale(container, token)) return;
    body.innerHTML = '';
    body.appendChild(emptyState('⚠️', 'Could not load Trash', errText(e)));
    return;
  }
  if (isStale(container, token)) return;
  body.innerHTML = '';

  let query = '';
  const search = el('input', { type: 'text', placeholder: 'Search Trash…', spellcheck: 'false' });
  const searchWrap = el('div', { class: 'lib-filter' }, el('span', { html: icon('search') }), search);
  const emptyBtn = el('button', { class: 'btn danger', html: `${icon('trash')}<span>Empty Trash</span>`, disabled: !items.length });
  emptyBtn.addEventListener('click', async () => {
    if (!items.length) return;
    const ok = await confirmDialog({
      title: 'Empty Trash?',
      message: `Permanently delete ${items.length} ${items.length === 1 ? 'page' : 'pages'} and everything inside them? This cannot be undone.`,
      confirmText: 'Empty Trash', danger: true,
    });
    if (!ok) return;
    emptyBtn.disabled = true;
    try {
      for (const item of items) await invoke('delete_page_forever', { id: item.page.id });
      items = [];
      paint();
      S.host?.refreshTree?.();
      toast('Trash emptied', 'success');
    } catch (e) {
      toast(`Could not empty Trash: ${errText(e)}`, 'error');
      emptyBtn.disabled = false;
    }
  });
  body.appendChild(el('div', { class: 'lib-toolbar' }, searchWrap, el('span', { class: 'lib-spacer' }), emptyBtn));
  const host = el('div', { class: 'trash-host' });
  body.appendChild(host);

  search.addEventListener('input', () => { query = search.value.trim(); paint(); });

  function paint() {
    const filtered = items.filter(it => !query || pageTitle(it.page).toLowerCase().includes(query.toLowerCase()));
    host.innerHTML = '';
    if (!filtered.length) {
      host.appendChild(emptyState('🌿', query ? 'No matching pages' : 'Trash is empty',
        query ? `Nothing in Trash matches “${query}”.` : 'Pages you move to Trash will appear here.'));
      emptyBtn.disabled = !items.length;
      return;
    }
    const list = el('div', { class: 'list-view' });
    for (const it of filtered) {
      const p = it.page;
      const row = el('div', { class: 'list-row trash-row' });
      const main = el('div', { class: 'lr-main' },
        el('div', { class: 'lr-title', html: highlight(pageTitle(p), query) }),
        el('div', { class: 'lr-sub', text: `${it.parentTitle ? `In ${it.parentTitle} · ` : ''}Deleted ${timeAgo(it.deletedAt)}` })
      );
      const restore = el('button', { class: 'btn small-btn', text: 'Restore' });
      restore.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await restorePageById(p.id);
        if (!ok) return;
        items = items.filter(x => x.page.id !== p.id);
        paint();
      });
      const del = el('button', { class: 'icon-btn tiny danger-icon', title: 'Delete forever', 'aria-label': 'Delete forever', html: ICONS.trash });
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({
          title: 'Delete forever?',
          message: `“${esc(pageTitle(p))}” and its subpages will be permanently deleted. This cannot be undone.`,
          confirmText: 'Delete forever', danger: true,
        });
        if (!ok) return;
        try {
          await invoke('delete_page_forever', { id: p.id });
          items = items.filter(x => x.page.id !== p.id);
          paint();
          toast('Deleted permanently', 'success');
        } catch (err) {
          toast(`Could not delete page: ${errText(err)}`, 'error');
        }
      });
      row.append(el('div', { class: 'lr-icon', html: pageIcon(p) }), main, el('div', { class: 'trash-actions' }, restore, del));
      list.appendChild(row);
    }
    host.appendChild(list);
    emptyBtn.disabled = !items.length;
  }
  paint();
}

/* ---------------- Settings ---------------- */
function settingRow(title, desc, control) {
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-label' },
      el('div', { class: 'sl-title', text: title }),
      desc ? el('div', { class: 'sl-desc', text: desc }) : null
    ),
    el('div', { class: 'setting-control' }, control)
  );
}

function switchControl(on, onToggle) {
  const btn = el('button', { class: `switch ${on ? 'on' : ''}`, role: 'switch', title: on ? 'On' : 'Off' });
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  btn.addEventListener('click', async () => {
    const next = !btn.classList.contains('on');
    btn.classList.toggle('on', next);
    btn.setAttribute('aria-checked', next ? 'true' : 'false');
    btn.title = next ? 'On' : 'Off';
    await onToggle(next);
  });
  return btn;
}

function segmentedControl(options, value, onPick) {
  const seg = el('div', { class: 'segmented' });
  options.forEach(opt => {
    const btn = el('button', { class: opt.value === value ? 'active' : '', html: opt.icon ? `${icon(opt.icon)}<span>${esc(opt.label)}</span>` : esc(opt.label) });
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      onPick(opt.value);
    });
    seg.appendChild(btn);
  });
  return seg;
}

function avatarContent(value, name) {
  const v = String(value || '');
  if (v.startsWith('data:') || /^https?:/.test(v)) {
    return `<img src="${esc(v)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  return esc(v && v.length <= 8 ? v : initials(name));
}

async function saveSetting(key, value, opts = {}) {
  S.settings[key] = value;
  try {
    await invoke('set_setting', { key, value });
    S.host?.applySettings?.();
    return true;
  } catch (e) {
    if (!opts.silent) toast(`Could not save setting: ${errText(e)}`, 'error');
    return false;
  }
}

export function openSettings(initial = 'account') {
  closeAuxDrawers('');
  if (settingsModal) { settingsModal.close(); settingsModal = null; }
  const tabs = [
    { id: 'account', label: 'Account', icon: 'user' },
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'ai', label: 'IdeaCraft AI', icon: 'sparkles' },
    { id: 'sync', label: 'Sync', icon: 'cloud' },
    { id: 'data', label: 'Data', icon: 'database' },
    { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
    { id: 'about', label: 'About', icon: 'info' },
  ];
  const tabBar = el('div', { class: 'settings-tabs', role: 'tablist' });
  const pane = el('div', { class: 'settings-pane' });
  const body = el('div', { class: 'settings-body' }, tabBar, pane);
  const tabBtns = new Map();
  for (const t of tabs) {
    const btn = el('button', { class: 'settings-tab', role: 'tab', html: `${icon(t.icon)}<span>${t.label}</span>` });
    btn.addEventListener('click', () => show(t.id));
    tabBar.appendChild(btn);
    tabBtns.set(t.id, btn);
  }

  const renderers = {
    account: renderAccountPane,
    appearance: renderAppearancePane,
    notifications: renderNotificationsPane,
    ai: renderAIPane,
    sync: renderSyncPane,
    data: renderDataPane,
    shortcuts: renderShortcutsPane,
    about: renderAboutPane,
  };

  function show(id) {
    if (!renderers[id]) id = 'account';
    tabBtns.forEach((btn, key) => {
      btn.classList.toggle('active', key === id);
      btn.setAttribute('aria-selected', key === id ? 'true' : 'false');
    });
    pane.innerHTML = '';
    pane.scrollTop = 0;
    pane.dataset.section = id;
    renderers[id](pane);
  }

  settingsModal = openModal({
    title: 'Settings', width: 910, className: 'settings-modal', bodyClass: 'no-pad',
    body, closeOnBackdrop: true,
  });
  settingsModal.switchTo = show;
  show(initial);

  function hostApplyChrome() {
    S.host?.applySettings?.();
    S.host?.applyBranding?.();
  }

  function renderAccountPane(root) {
    root.appendChild(el('h2', { text: 'Account' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Your profile lives on this device. IdeaCraft never sends it to a server.' }));

    const avatar = el('button', { class: 'avatar-big', title: 'Change avatar', 'aria-label': 'Change avatar', html: avatarContent(S.settings.userAvatar, S.settings.userName) });
    const avatarName = el('div', { class: 'ai-name', text: S.settings.userName || 'You' });
    const avatarMail = el('div', { class: 'ai-mail', text: S.settings.userEmail || 'Local account' });
    const paintAvatar = () => {
      avatar.innerHTML = avatarContent(S.settings.userAvatar, S.settings.userName);
      avatarName.textContent = S.settings.userName || 'You';
      avatarMail.textContent = S.settings.userEmail || 'Local account';
    };
    const refreshAvatar = () => {
      paintAvatar();
      S.host?.applyBranding?.();
    };
    avatar.addEventListener('click', () => {
      emojiPicker(avatar, async (emoji) => {
        await saveSetting('userAvatar', emoji || '');
        refreshAvatar();
      }, {
        current: S.settings.userAvatar || '',
        allowRemove: true,
        onRemove: async () => { await saveSetting('userAvatar', ''); refreshAvatar(); },
        onUpload: async () => {
          try {
            const img = await invoke('pick_image');
            if (!img) return;
            const readable = await new Promise((resolve) => {
              const probe = new Image();
              probe.onload = () => resolve(probe.naturalWidth > 0 && probe.naturalHeight > 0);
              probe.onerror = () => resolve(false);
              probe.src = img.dataUrl;
            });
            if (!readable) {
              toast('That file could not be read as an image.', 'error');
              return;
            }
            await saveSetting('userAvatar', img.dataUrl);
            refreshAvatar();
          } catch (e) { toast(`Could not upload avatar: ${errText(e)}`, 'error'); }
        },
      });
    });
    root.appendChild(el('div', { class: 'avatar-row' }, avatar,
      el('div', { class: 'avatar-info' }, avatarName, avatarMail,
        el('button', { class: 'btn', style: { marginTop: '9px' }, text: 'Change photo or emoji', onclick: () => avatar.click() })
      )
    ));

    const group = el('div', { class: 'setting-group' });
    group.appendChild(el('div', { class: 'setting-group-title', text: 'Profile' }));
    const nameInput = el('input', { type: 'text', value: S.settings.userName || 'You', 'aria-label': 'Display name' });
    nameInput.addEventListener('change', async () => {
      const name = nameInput.value.trim() || 'You';
      await saveSetting('userName', name);
      paintAvatar();
      hostApplyChrome();
    });
    const emailInput = el('input', { type: 'text', value: S.settings.userEmail || '', placeholder: 'you@example.com', 'aria-label': 'Email' });
    emailInput.addEventListener('change', async () => {
      await saveSetting('userEmail', emailInput.value.trim());
      paintAvatar();
    });
    group.appendChild(settingRow('Display name', 'Shown next to comments and recent edits.', nameInput));
    group.appendChild(settingRow('Email', 'Optional. Used only for display in this local workspace.', emailInput));

    const wsGroup = el('div', { class: 'setting-group' });
    wsGroup.appendChild(el('div', { class: 'setting-group-title', text: 'Workspace' }));
    const wsName = el('input', { type: 'text', value: S.boot?.workspace?.name || 'IdeaCraft' });
    wsName.addEventListener('change', async () => {
      const name = wsName.value.trim() || 'IdeaCraft';
      try {
        const ws = await invoke('save_workspace', { name, icon: S.boot?.workspace?.icon || null });
        S.boot.workspace = ws;
        hostApplyChrome();
        toast('Workspace updated', 'success');
      } catch (e) { toast(`Could not update workspace: ${errText(e)}`, 'error'); }
    });
    wsGroup.appendChild(settingRow('Workspace name', 'The name shown at the top of your sidebar.', wsName));
    const wsAvatar = el('button', { class: 'ws-avatar', title: 'Change workspace icon', html: (S.boot?.workspace?.icon && String(S.boot.workspace.icon).length <= 8) ? esc(S.boot.workspace.icon) : 'I' });
    wsAvatar.addEventListener('click', () => {
      emojiPicker(wsAvatar, async (emoji) => {
        if (!emoji) return;
        try {
          const ws = await invoke('save_workspace', { name: S.boot?.workspace?.name || 'IdeaCraft', icon: emoji });
          S.boot.workspace = ws;
          wsAvatar.innerHTML = esc(emoji);
          hostApplyChrome();
        } catch (e) { toast(`Could not update icon: ${errText(e)}`, 'error'); }
      }, { allowRemove: false });
    });
    wsGroup.appendChild(settingRow('Workspace icon', 'An emoji that represents this workspace.', wsAvatar));
    root.append(group, wsGroup);
    root.appendChild(el('p', { class: 'settings-footer-note', text: 'IdeaCraft is local-first. Profile details are stored only in your workspace database.' }));
  }

  function renderAppearancePane(root) {
    root.appendChild(el('h2', { text: 'Appearance' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Make IdeaCraft comfortable for the way you read and write.' }));

    const group = el('div', { class: 'setting-group' });
    group.appendChild(el('div', { class: 'setting-group-title', text: 'Theme' }));
    const themePreview = el('p', { class: 'settings-footer-note', style: { marginTop: '8px' }, text: (S.settings.theme || 'system') === 'system' ? 'Follows your operating system.' : (S.settings.theme === 'dark' ? 'A dark workspace for low light.' : 'A bright, paper-like workspace.') });
    group.append(segmentedControl([
      { value: 'light', label: 'Light', icon: 'sun' },
      { value: 'dark', label: 'Dark', icon: 'moon' },
      { value: 'system', label: 'System', icon: 'monitor' },
    ], S.settings.theme || 'system', async (value) => {
      await saveSetting('theme', value);
      themePreview.textContent = value === 'system' ? 'Follows your operating system.' : value === 'dark' ? 'A dark workspace for low light.' : 'A bright, paper-like workspace.';
    }), themePreview);

    const fontGroup = el('div', { class: 'setting-group' });
    fontGroup.appendChild(el('div', { class: 'setting-group-title', text: 'Page typography' }));
    fontGroup.appendChild(settingRow('Default font', 'Choose a base font for pages that do not set their own.',
      segmentedControl([
        { value: 'default', label: 'Sans' },
        { value: 'serif', label: 'Serif' },
        { value: 'mono', label: 'Mono' },
      ], S.settings.font || 'default', (v) => saveSetting('font', v))));
    fontGroup.appendChild(settingRow('Small text', 'Fit a little more writing on every page.', switchControl(!!S.settings.smallText, v => saveSetting('smallText', v))));
    fontGroup.appendChild(settingRow('Full width', 'Use the full window instead of a centered column.', switchControl(!!S.settings.fullWidth, v => saveSetting('fullWidth', v))));

    root.append(group, fontGroup);
    root.appendChild(el('p', { class: 'settings-footer-note', text: 'Page-specific font and width options live in the ••• menu of each page.' }));
  }

  function renderNotificationsPane(root) {
    root.appendChild(el('h2', { text: 'Notifications' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Control how IdeaCraft behaves when it is not in front of you.' }));
    const group = el('div', { class: 'setting-group' });
    group.appendChild(el('div', { class: 'setting-group-title', text: 'Window' }));
    group.appendChild(settingRow('Keep running in the background',
      'Closing the window hides IdeaCraft to the system tray so you can return quickly. Quit from the tray menu.',
      switchControl(!!S.settings.keepInBackground, v => saveSetting('keepInBackground', v))));
    group.appendChild(settingRow('Auto-sync when a sync folder is set',
      'Push changes to your selected folder on a regular interval while IdeaCraft is open.',
      switchControl(!!S.settings.syncAuto, v => saveSetting('syncAuto', v))));
    root.appendChild(group);
    root.appendChild(el('p', { class: 'settings-footer-note', text: 'IdeaCraft does not send push notifications or email. Everything stays on this device.' }));
  }

  function renderAIPane(root) {
    root.appendChild(el('h2', { text: 'IdeaCraft AI' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Optional writing help powered by a local Ollama model. Your notes never leave this computer.' }));

    const dot = el('span', { class: 'status-dot' });
    const statusText = el('span', { text: 'Checking local AI…' });
    const status = el('div', { class: 'ai-status' }, dot, statusText);
    const modelList = el('datalist', { id: 'ai-model-options' });
    const baseInput = el('input', { type: 'url', value: S.settings.aiBaseUrl || 'http://127.0.0.1:11434', placeholder: 'http://127.0.0.1:11434' });
    const modelInput = el('input', { type: 'text', value: S.settings.aiModel || 'llama3.2', placeholder: 'llama3.2', list: 'ai-model-options' });
    const refreshBtn = el('button', { class: 'btn', html: `${icon('refresh')}<span>Refresh</span>` });

    async function check(showToast = false) {
      dot.className = 'status-dot';
      statusText.textContent = 'Checking Ollama…';
      try {
        const st = await invoke('ai_status');
        if (!st.enabled) {
          dot.className = 'status-dot off';
          statusText.textContent = 'AI is turned off';
        } else if (st.running) {
          dot.className = 'status-dot on';
          const n = (st.models || []).length;
          statusText.textContent = `Ollama connected${n ? ` · ${n} model${n === 1 ? '' : 's'} found` : ''}`;
          modelList.innerHTML = '';
          (st.models || []).forEach(m => modelList.appendChild(el('option', { value: m })));
          if (showToast) toast('Local AI is ready', 'success');
        } else {
          dot.className = 'status-dot off';
          statusText.textContent = 'Ollama is not running';
          if (showToast) toast('Could not reach Ollama', 'error');
        }
      } catch (e) {
        dot.className = 'status-dot off';
        statusText.textContent = 'Could not check Ollama';
        if (showToast) toast(`AI check failed: ${errText(e)}`, 'error');
      }
    }
    refreshBtn.addEventListener('click', () => check(true));

    const group = el('div', { class: 'setting-group' });
    group.appendChild(el('div', { class: 'setting-group-title', text: 'Local AI' }));
    group.appendChild(settingRow('Enable IdeaCraft AI', 'Adds the AI drawer, page context, and writing shortcuts.', switchControl(S.settings.aiEnabled !== false, async v => { await saveSetting('aiEnabled', v); check(); })));
    group.appendChild(settingRow('Ollama address', 'The local endpoint IdeaCraft talks to. Default is port 11434.', baseInput));
    group.appendChild(settingRow('Model', 'Any model you have pulled in Ollama.', modelInput));
    const statusRow = el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Connection' }), el('div', { class: 'sl-desc', text: 'Checks whether Ollama is reachable on this machine.' })), el('div', { class: 'setting-control' }, status, refreshBtn));
    group.appendChild(statusRow);
    root.appendChild(modelList);
    root.appendChild(group);

    baseInput.addEventListener('change', async () => { await saveSetting('aiBaseUrl', baseInput.value.trim() || 'http://127.0.0.1:11434'); check(); });
    modelInput.addEventListener('change', () => saveSetting('aiModel', modelInput.value.trim() || 'llama3.2'));

    const setup = el('div', { class: 'setup-card' },
      el('div', { class: 'setup-title', html: `${icon('wand')}<span>Set up local AI</span>` }),
      el('p', { text: 'Install Ollama, then pull a model such as llama3.2. IdeaCraft talks to it directly on your machine.' }),
      el('div', { style: { display: 'flex', gap: '7px' } },
        el('button', { class: 'btn', text: 'Download Ollama', onclick: () => invoke('open_url', { url: 'https://ollama.com/download' }).catch(() => toast('Could not open browser', 'error')) }),
        el('button', { class: 'btn', text: 'Copy install command', onclick: async () => {
          const ok = await copyToClipboard('ollama pull llama3.2');
          toast(ok ? 'Command copied' : 'Could not copy', ok ? 'success' : 'error');
        } })
      )
    );
    root.appendChild(setup);
    root.appendChild(el('p', { class: 'settings-footer-note', text: 'AI requests go only to the Ollama address above. No IdeaCraft account, cloud service, or telemetry is involved.' }));
    check();
  }

  function renderSyncPane(root) {
    root.appendChild(el('h2', { text: 'Sync' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Keep a copy of this workspace in a folder you already sync, such as OneDrive, Dropbox, iCloud Drive, or Google Drive.' }));
    const pathText = el('span', { class: 'sync-path', text: S.settings.syncFolder || 'No folder selected' });
    const pick = el('button', { class: 'btn', text: S.settings.syncFolder ? 'Change folder…' : 'Choose folder…' });
    const clear = el('button', { class: 'btn danger', text: 'Remove', disabled: !S.settings.syncFolder });
    pick.addEventListener('click', async () => {
      try {
        const path = await invoke('pick_sync_folder');
        if (!path) return;
        S.settings.syncFolder = path;
        pathText.textContent = path;
        clear.disabled = false;
        pick.textContent = 'Change folder…';
        S.host?.applySettings?.();
        toast('Sync folder set', 'success');
      } catch (e) { toast(`Could not choose folder: ${errText(e)}`, 'error'); }
    });
    clear.addEventListener('click', async () => {
      await saveSetting('syncFolder', '');
      pathText.textContent = 'No folder selected';
      clear.disabled = true;
      pick.textContent = 'Choose folder…';
    });
    const group = el('div', { class: 'setting-group' });
    group.appendChild(el('div', { class: 'setting-group-title', text: 'Sync folder' }));
    group.appendChild(el('div', { class: 'setting-row sync-row' },
      el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Folder' }), el('div', { class: 'sl-desc', text: 'A device-specific file is written inside an “IdeaCraft” subfolder.' }), pathText),
      el('div', { class: 'setting-control' }, clear, pick)
    ));
    group.appendChild(settingRow('Sync automatically', 'Runs a sync every few minutes while IdeaCraft is open.', switchControl(!!S.settings.syncAuto, v => saveSetting('syncAuto', v))));

    const last = S.settings.lastSync ? formatDateTime(S.settings.lastSync) : 'Never synced';
    const lastEl = el('span', { class: 'sl-desc', text: last });
    const nowBtn = el('button', { class: 'btn primary', html: `${icon('refresh')}<span>Sync now</span>` });
    const syncRow = el('div', { class: 'setting-row' },
      el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Sync status' }), lastEl),
      el('div', { class: 'setting-control' }, nowBtn)
    );
    nowBtn.addEventListener('click', async () => {
      nowBtn.disabled = true;
      const original = nowBtn.innerHTML;
      nowBtn.innerHTML = `${spinner(13)}<span>Syncing…</span>`;
      try {
        const res = await invoke('sync_now');
        S.settings.lastSync = res?.time || new Date().toISOString();
        lastEl.textContent = formatDateTime(S.settings.lastSync);
        toast(`Sync complete${res?.imported ? ` · ${res.imported} merged` : ''}`, 'success', 3600);
        S.host?.refreshTree?.();
      } catch (e) {
        toast(`Sync failed: ${errText(e)}`, 'error', 4200);
      } finally {
        nowBtn.disabled = false;
        nowBtn.innerHTML = original;
      }
    });
    group.appendChild(syncRow);
    root.appendChild(group);
    root.appendChild(el('p', { class: 'settings-footer-note', text: 'Sync is file-based and merges changes by page and block. It is designed for one person using several devices, not for real-time collaboration.' }));
  }

  function renderDataPane(root) {
    root.appendChild(el('h2', { text: 'Data' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Your workspace is a SQLite database on this computer. Back it up, move it, or take it with you.' }));
    const counts = S.boot?.counts || {};
    const group = el('div', { class: 'setting-group' });
    group.appendChild(el('div', { class: 'setting-group-title', text: 'Workspace contents' }));
    const stat = (label, value) => el('div', { class: 'data-stat' }, el('span', { class: 'ds-value', text: String(value ?? 0) }), el('span', { class: 'ds-label', text: label }));
    group.appendChild(el('div', { class: 'data-stats' },
      stat('Pages', counts.pages), stat('Blocks', counts.blocks), stat('Databases', counts.databases)
    ));
    group.appendChild(settingRow('Data folder', 'The database and attachments live here.', el('span', { class: 'sync-path', text: S.app?.dataPath || S.boot?.app?.dataPath || 'Local app data' })));
    group.appendChild(settingRow('Open data folder', 'Reveal the workspace files in File Explorer.', el('button', { class: 'btn', html: `${icon('folder-open')}<span>Open folder</span>`, onclick: () => invoke('open_data_folder').catch(e => toast(`Could not open folder: ${errText(e)}`, 'error')) })));

    const backup = el('div', { class: 'setting-group' });
    backup.appendChild(el('div', { class: 'setting-group-title', text: 'Backup' }));
    const exportBtn = el('button', { class: 'btn', html: `${icon('download-cloud')}<span>Export backup…</span>` });
    exportBtn.addEventListener('click', async () => {
      try {
        const path = await invoke('export_backup');
        if (path) toast(`Backup saved to ${path}`, 'success', 4200);
      } catch (e) { toast(`Export failed: ${errText(e)}`, 'error'); }
    });
    const importBtn = el('button', { class: 'btn', html: `${icon('upload')}<span>Import backup…</span>` });
    importBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Import a backup?',
        message: 'Pages from the backup will be merged into this workspace. Existing pages are kept.',
        confirmText: 'Choose backup',
      });
      if (!ok) return;
      importBtn.disabled = true;
      try {
        const res = await invoke('import_backup', { replace: false });
        if (res) {
          toast('Backup imported', 'success');
          await S.host?.reloadWorkspace?.();
          show('data');
        }
      } catch (e) {
        toast(`Import failed: ${errText(e)}`, 'error');
      } finally { importBtn.disabled = false; }
    });
    backup.append(
      settingRow('Export backup', 'Create a portable JSON file containing every page, block, comment, and database.', exportBtn),
      settingRow('Import backup', 'Merge pages from an IdeaCraft backup file.', importBtn)
    );
    root.append(group, backup);
    root.appendChild(el('div', { class: 'danger-zone' },
      el('div', { class: 'dz-title', text: 'Local-first reminder' }),
      el('p', { text: 'Deleting pages from Trash or removing the data folder is permanent. Keep a backup if this workspace matters to you.' })
    ));
  }

  function renderShortcutsPane(root) {
    root.appendChild(el('h2', { text: 'Keyboard shortcuts' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'Move around IdeaCraft without reaching for the mouse.' }));
    const groups = [
      ['Navigation', [
        ['Search or ask', `${modKey()} K`],
        ['New page', `${modKey()} N`],
        ['New tab', `${modKey()} T`],
        ['Close tab', `${modKey()} W`],
        ['Toggle sidebar', `${modKey()} \\`],
        ['Back', 'Alt ←'],
        ['Forward', 'Alt →'],
        ['Open settings', `${modKey()} ,`],
        ['Open IdeaCraft AI', `${modKey()} J`],
      ]],
      ['Writing', [
        ['Command menu', '/'],
        ['Link a page', '@'],
        ['Bold', `${modKey()} B`],
        ['Italic', `${modKey()} I`],
        ['Underline', `${modKey()} U`],
        ['Strikethrough', `${modKey()} Shift S`],
        ['Inline code', `${modKey()} E`],
        ['Undo', `${modKey()} Z`],
        ['Redo', `${modKey()} Shift Z`],
        ['Save now', `${modKey()} S`],
      ]],
    ];
    for (const [title, rows] of groups) {
      const group = el('div', { class: 'setting-group' });
      group.appendChild(el('div', { class: 'setting-group-title', text: title }));
      for (const [label, keys] of rows) {
        group.appendChild(el('div', { class: 'shortcut-row' },
          el('span', { text: label }),
          el('kbd', { text: keys })
        ));
      }
      root.appendChild(group);
    }
    root.appendChild(el('p', { class: 'settings-footer-note', text: 'Shortcuts use Control on Windows and Linux, and Command on macOS.' }));
  }

  function renderAboutPane(root) {
    root.appendChild(el('h2', { text: 'About' }));
    root.appendChild(el('p', { class: 'pane-sub', text: 'A calm, local-first place for notes, docs, and projects.' }));
    const app = S.app || S.boot?.app || {};
    root.appendChild(el('div', { class: 'about-hero' },
      el('div', { class: 'about-logo', text: 'I' }),
      el('div', { class: 'about-title', text: 'IdeaCraft' }),
      el('div', { class: 'about-version', text: `Version ${app.version || '1.0.0'}` }),
      el('div', { class: 'about-tagline', text: 'Write it down. Shape it. Make it real.' })
    ));
    const rows = el('div', { class: 'setting-group about-rows' });
    rows.appendChild(el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Version' })), el('div', { class: 'setting-control' }, el('span', { class: 'sl-desc', text: app.version || '1.0.0' }))));
    rows.appendChild(el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Platform' })), el('div', { class: 'setting-control' }, el('span', { class: 'sl-desc', text: `${app.platform || 'windows'} · ${app.arch || 'x64'}` }))));
    rows.appendChild(el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Storage' }), el('div', { class: 'sl-desc', text: 'SQLite database and local attachments' })), el('div', { class: 'setting-control' }, el('button', { class: 'btn', text: 'Open data folder', onclick: () => invoke('open_data_folder').catch(() => {}) }))));
    rows.appendChild(el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Privacy' }), el('div', { class: 'sl-desc', text: 'No account, no telemetry, no cloud dependency.' })), el('div', { class: 'setting-control' }, el('span', { class: 'badge-soft', text: 'Local-first' }))));
    rows.appendChild(el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('div', { class: 'sl-title', text: 'Updates' }), el('div', { class: 'sl-desc', text: 'Automatic update checks from the release feed you configure.' })), el('div', { class: 'setting-control' }, (() => {
      const btn = el('button', { class: 'btn', text: 'Check for updates' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await invoke('check_updates');
          if (res?.available) {
            const go = await confirmDialog({
              title: `Update to ${res.version}?`,
              message: res.notes ? `What's new:\n${res.notes}\n\nThe app will download the update and restart.` : `The app will download the update and restart. Current version: ${res.currentVersion}`,
              confirmText: 'Download & restart'
            });
            if (go) await invoke('install_update');
          } else {
            toast(`IdeaCraft ${app.version || ''} is up to date`, 'success');
          }
        } catch (e) {
          toast(`Could not check for updates: ${errText(e)}`, 'error');
        } finally {
          btn.disabled = false;
        }
      });
      return btn;
    })())));
    root.appendChild(rows);
    root.appendChild(el('div', { class: 'about-links' },
      el('button', { class: 'btn', text: 'Keyboard shortcuts', onclick: () => show('shortcuts') }),
      el('button', { class: 'btn', text: 'Data & backups', onclick: () => show('data') })
    ));
    root.appendChild(el('p', { class: 'settings-footer-note', text: `© ${new Date().getFullYear()} IdeaCraft. Built with Rust and Tauri. Your words belong to you.` }));
  }

  return settingsModal;
}

export function closeSettings() {
  if (settingsModal) { settingsModal.close(); settingsModal = null; }
}

/* ---------------- Drawers ---------------- */
function closeAuxDrawers(except = '') {
  if (except !== 'comments') activeComments?.close?.();
  if (except !== 'ai') activeAI?.close?.();
}

function drawerShell(title, opts = {}) {
  const root = el('div', { class: `drawer ${opts.className || ''}`, role: 'dialog', 'aria-label': title });
  const closeBtn = el('button', { class: 'icon-btn tiny', title: 'Close', 'aria-label': 'Close', html: ICONS.close });
  const head = el('div', { class: 'drawer-head' },
    opts.icon ? el('span', { class: 'drawer-icon', html: opts.icon }) : null,
    el('h3', { text: title }),
    opts.headExtra || null,
    opts.headActions || null,
    closeBtn
  );
  const body = el('div', { class: 'drawer-body' });
  root.append(head, body);
  document.body.appendChild(root);
  return { root, head, body, closeBtn };
}

/* ---------------- Comments ---------------- */
export async function openCommentsDrawer(pageId, blockId = null, quote = '', opts = {}) {
  closeAuxDrawers('comments');
  activeComments?.close?.();
  const page = S.pageMap.get(pageId);
  let closed = false;
  const { root, body, closeBtn } = drawerShell('Comments', {
    icon: ICONS.comment,
    headExtra: el('span', { class: 'drawer-count' }),
    className: 'comments-drawer',
  });
  closeBtn.title = 'Close comments';
  root.tabIndex = -1;
  const countEl = root.querySelector('.drawer-count');
  let comments = [];
  let showResolved = false;

  const footer = el('div', { class: 'comment-composer' });
  root.appendChild(footer);

  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    S.commentsOpen = false;
    if (activeComments?.root === root) activeComments = null;
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !hasLayers()) { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  activeComments = { root, close };
  S.commentsOpen = true;
  closeBtn.addEventListener('click', close);

  body.innerHTML = '';
  body.appendChild(el('div', { class: 'page-loading' }, el('span', { html: spinner(16) }), el('span', { text: 'Loading comments…' })));

  let detail;
  try {
    detail = await invoke('get_page_detail', { id: pageId });
  } catch (e) {
    if (closed) return;
    body.innerHTML = '';
    body.appendChild(emptyState('💬', 'Comments unavailable', errText(e)));
    return;
  }
  if (closed) return;
  comments = detail.comments || [];

  const notify = () => {
    const open = comments.filter(c => !c.resolved).length;
    countEl.textContent = open ? String(open) : '';
    opts.onChange?.(open);
  };
  notify();

  const filterBar = el('div', { class: 'comment-filter' });
  const openBtn = el('button', { class: 'active', text: 'Open' });
  const resolvedBtn = el('button', { text: 'Resolved' });
  openBtn.addEventListener('click', () => { showResolved = false; openBtn.classList.add('active'); resolvedBtn.classList.remove('active'); renderList(); });
  resolvedBtn.addEventListener('click', () => { showResolved = true; resolvedBtn.classList.add('active'); openBtn.classList.remove('active'); renderList(); });
  filterBar.append(openBtn, resolvedBtn);
  body.innerHTML = '';
  body.appendChild(filterBar);

  const listHost = el('div', { class: 'comment-list' });
  body.appendChild(listHost);

  function commentNode(c) {
    const avatar = initials(c.author);
    const node = el('div', { class: `comment-item ${c.resolved ? 'resolved' : ''}` },
      el('div', { class: 'comment-avatar', text: avatar }),
      el('div', { class: 'comment-main' },
        el('div', { class: 'comment-meta' },
          el('span', { class: 'comment-author', text: c.author || 'You' }),
          el('span', { class: 'comment-time', text: timeAgo(c.createdAt) }),
          c.resolved ? el('span', { class: 'comment-resolved-badge', text: 'Resolved' }) : null
        ),
        blockId ? el('div', { class: 'comment-block-ref', html: `${icon('comment')}<span>On a block</span>` }) : null,
        el('div', { class: 'comment-body', html: sanitizeHtml(c.html || '') })
      )
    );
    const actions = el('div', { class: 'comment-actions' });
    if (c.resolved) {
      actions.appendChild(el('button', { class: 'comment-action', text: 'Reopen', onclick: () => setResolved(c, false) }));
    } else {
      actions.appendChild(el('button', { class: 'comment-action', text: 'Resolve', onclick: () => setResolved(c, true) }));
    }
    actions.appendChild(el('button', {
      class: 'comment-action', text: 'Delete', onclick: async () => {
        const ok = await confirmDialog({ title: 'Delete comment?', message: 'This comment will be removed permanently.', confirmText: 'Delete', danger: true });
        if (!ok) return;
        try {
          await invoke('delete_comment', { id: c.id });
          comments = comments.filter(x => x.id !== c.id);
          renderList();
          notify();
        } catch (e) { toast(`Could not delete comment: ${errText(e)}`, 'error'); }
      }
    }));
    node.querySelector('.comment-main').appendChild(actions);
    return node;
  }

  async function setResolved(c, resolved) {
    try {
      await invoke('resolve_comment', { id: c.id, resolved });
      c.resolved = resolved;
      renderList();
      notify();
    } catch (e) { toast(`Could not update comment: ${errText(e)}`, 'error'); }
  }

  function renderList() {
    listHost.innerHTML = '';
    const shown = comments.filter(c => showResolved ? c.resolved : !c.resolved);
    if (!shown.length) {
      listHost.appendChild(el('div', { class: 'comments-empty' },
        el('div', { html: ICONS.comment }),
        el('div', { text: showResolved ? 'No resolved comments yet.' : 'No open comments yet.' }),
        el('div', { style: { marginTop: '4px', opacity: '.8' }, text: showResolved ? 'Resolve a thread to keep it here.' : 'Start a conversation below.' })
      ));
      return;
    }
    shown.forEach(c => listHost.appendChild(commentNode(c)));
  }
  renderList();

  if (page && page.locked) {
    footer.appendChild(el('div', { class: 'comments-locked', html: `${ICONS.lock}<span>This page is locked. Unlock it to add comments.</span>` }));
    return;
  }

  if (blockId) {
    footer.appendChild(el('div', { class: 'comment-block-ref' },
      el('span', { html: ICONS.comment }),
      el('span', { text: quote ? `“${quote.length > 90 ? quote.slice(0, 90) + '…' : quote}”` : 'Commenting on a block' })
    ));
  }
  const input = el('textarea', { class: 'comment-input', placeholder: 'Add a comment…  (Ctrl+Enter to send)', rows: '3' });
  const sendBtn = el('button', { class: 'btn primary', text: 'Comment', disabled: true });
  const sendRow = el('div', { class: 'comment-send-row' }, sendBtn);
  footer.append(input, sendRow);

  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, Math.max(64, input.scrollHeight))}px`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      const html = text.split(/\n{2,}/).map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('');
      const c = await invoke('create_comment', { pageId, blockId, html });
      comments.push(c);
      input.value = '';
      input.style.height = '';
      sendBtn.textContent = 'Comment';
      renderList();
      notify();
      body.scrollTop = body.scrollHeight;
    } catch (e) {
      toast(`Could not add comment: ${errText(e)}`, 'error');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Comment';
    }
  }
  sendBtn.addEventListener('click', send);
  setTimeout(() => input.focus(), 60);
}

/* ---------------- Version history ---------------- */
export async function openVersionHistory(detail) {
  const page = detail?.page;
  if (!page) return;
  const body = el('div', { class: 'version-body' });
  const listHost = el('div', { class: 'version-list' });
  const preview = el('div', { class: 'version-preview' });
  body.append(listHost, preview);
  let versions = detail.versions || [];
  let selected = null;
  const modal = openModal({
    title: 'Version history',
    subtitle: pageTitle(page),
    width: 800,
    body,
    footer: el('div', { style: { display: 'flex', gap: '8px', width: '100%', alignItems: 'center' } },
      el('span', { class: 'foot-left', text: 'Up to 30 snapshots are kept per page.' }),
      el('button', { class: 'btn', text: 'Done', onclick: () => modal.close() })
    ),
  });

  function currentItem() {
    const node = el('button', { class: 'version-item active' },
      el('span', { class: 'vi-dot current' }),
      el('span', { class: 'vi-main' },
        el('span', { class: 'vi-title', text: 'Current version' }),
        el('span', { class: 'vi-time', text: `Edited ${timeAgo(page.updatedAt)}` })
      )
    );
    node.addEventListener('click', () => select(null));
    return node;
  }

  function render() {
    listHost.innerHTML = '';
    listHost.appendChild(currentItem());
    for (const v of versions) {
      const node = el('button', { class: 'version-item' },
        el('span', { class: 'vi-dot' }),
        el('span', { class: 'vi-main' },
          el('span', { class: 'vi-title', text: formatDateTime(v.createdAt) }),
          el('span', { class: 'vi-time', text: `${v.blockCount} ${v.blockCount === 1 ? 'block' : 'blocks'}` })
        )
      );
      node.addEventListener('click', () => select(v, node));
      listHost.appendChild(node);
    }
    if (!versions.length) listHost.appendChild(el('div', { class: 'version-empty', text: 'Snapshots appear after you edit this page. Nothing to restore yet.' }));
    select(selected);
  }

  function select(v, node = null) {
    selected = v;
    listHost.querySelectorAll('.version-item').forEach(n => n.classList.remove('active'));
    if (node) node.classList.add('active');
    else listHost.querySelector('.version-item')?.classList.add('active');
    preview.innerHTML = '';
    if (!v) {
      preview.append(
        el('div', { class: 'vp-icon', html: pageIcon(page) }),
        el('div', { class: 'vp-title', text: pageTitle(page) }),
        el('div', { class: 'vp-meta', text: `Current version · edited ${timeAgo(page.updatedAt)}` }),
        el('div', { class: 'vp-note', text: 'This is the latest saved state of the page. Choose an earlier snapshot to restore it.' })
      );
      return;
    }
    preview.append(
      el('div', { class: 'vp-icon', html: '<svg class="ic"><use href="#i-history"/></svg>' }),
      el('div', { class: 'vp-title', text: formatDateTime(v.createdAt) }),
      el('div', { class: 'vp-meta', text: `${v.blockCount} ${v.blockCount === 1 ? 'block' : 'blocks'} in this snapshot` }),
      el('div', { class: 'vp-note', text: 'Restoring this version replaces the page title, icon, cover, and content with the snapshot. A copy of the current state is kept in history.' }),
      el('button', { class: 'btn primary', html: `${icon('history')}<span>Restore this version</span>`, onclick: async () => {
        const ok = await confirmDialog({
          title: 'Restore this version?',
          message: `The page will be replaced with the snapshot from ${esc(formatDateTime(v.createdAt))}.`,
          confirmText: 'Restore',
        });
        if (!ok) return;
        try {
          const restored = await invoke('restore_version', { pageId: page.id, versionId: v.id });
          modal.close();
          await S.host?.refreshTree?.();
          S.host?.reloadPage?.(restored.page?.id || page.id);
          toast('Version restored', 'success');
        } catch (e) {
          toast(`Could not restore version: ${errText(e)}`, 'error');
        }
      } })
    );
  }

  render();
  try {
    const fresh = await invoke('get_versions_cmd', { pageId: page.id });
    versions = fresh || versions;
    render();
  } catch { /* keep the versions that came with the page */ }
}

/* ---------------- Share ---------------- */
export function openShareDialog(detail) {
  const page = detail?.page || S.pageMap.get(S.currentPageId);
  if (!page) return;
  const link = `ideacraft://page/${page.id}`;
  const body = el('div', { class: 'share-dialog' });
  body.appendChild(el('div', { class: 'share-hero' },
    el('div', { class: 'share-icon', html: pageIcon(page) }),
    el('div', { class: 'share-heading' },
      el('div', { class: 'share-title', text: pageTitle(page) }),
      el('div', { class: 'share-sub', html: `${ICONS.lock}<span>Private · only you can access this page</span>` })
    )
  ));
  const linkRow = el('div', { class: 'share-link-row' },
    el('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Page link' })
  );
  const copyBtn = el('button', { class: 'btn primary', html: `${ICONS.link}<span>Copy link</span>` });
  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(link);
    toast(ok ? 'Link copied to clipboard' : 'Could not copy link', ok ? 'success' : 'error');
  });
  linkRow.appendChild(copyBtn);
  body.appendChild(el('div', { class: 'share-section' },
    el('div', { class: 'share-label', text: 'Page link' }),
    linkRow,
    el('div', { class: 'share-hint', text: 'Links open inside IdeaCraft on this device. To share outside this computer, export a copy.' })
  ));

  const options = el('div', { class: 'share-options' });
  const option = (iconName, title, desc, action) => {
    const btn = el('button', { class: 'share-option' },
      el('span', { class: 'so-icon', html: `<svg class="ic"><use href="#i-${iconName}"/></svg>` }),
      el('span', { class: 'so-main' }, el('span', { class: 'so-title', text: title }), el('span', { class: 'so-desc', text: desc })),
      el('span', { class: 'so-arrow', html: '<svg class="ic"><use href="#i-chevron-right"/></svg>' })
    );
    btn.addEventListener('click', action);
    return btn;
  };
  options.append(
    option('download', 'Export as Markdown', 'A portable text file with the page content.', () => exportPage(page.id, 'md')),
    option('download', 'Export as HTML', 'A styled web page you can open in any browser.', () => exportPage(page.id, 'html')),
    option('copy', 'Duplicate page', 'Make a private copy inside this workspace.', () => duplicatePageById(page.id)),
    option('download-cloud', 'Backup the whole workspace', 'Use Settings → Data to export every page at once.', () => { modal.close(); setTimeout(() => openSettings('data'), 0); })
  );
  body.appendChild(el('div', { class: 'share-section' },
    el('div', { class: 'share-label', text: 'Share a copy' }),
    options
  ));
  body.appendChild(el('div', { class: 'share-note', html: `${ICONS.info}<span>IdeaCraft is local-first. There is no cloud server, so sharing means exporting a copy or syncing your workspace folder.</span>` }));
  const modal = openModal({
    title: 'Share',
    width: 520,
    body,
    footer: el('button', { class: 'btn', text: 'Done', onclick: () => modal.close() }),
  });
  return modal;
}

/* ---------------- AI drawer ---------------- */
function inlineMarkdown(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s;
}

function aiMarkdown(text) {
  const parts = String(text || '').split(/(```[\s\S]*?```)/g);
  let html = '';
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```')) {
      const inner = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
      html += `<pre><code>${esc(inner.replace(/\n$/, ''))}</code></pre>`;
      continue;
    }
    const blocks = part.split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n');
      let list = null;
      for (const line of lines) {
        if (/^[-*]\s+/.test(line)) {
          if (!list) { list = 'ul'; html += '<ul>'; }
          html += `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`;
        } else {
          if (list) { html += `</${list}>`; list = null; }
          if (!line.trim()) continue;
          const h = /^(#{1,3})\s+(.+)$/.exec(line);
          if (h) html += `<p class="ai-h"><strong>${inlineMarkdown(h[2])}</strong></p>`;
          else html += `<p>${inlineMarkdown(line)}</p>`;
        }
      }
      if (list) html += `</${list}>`;
    }
  }
  return html || '<p></p>';
}

function aiContextText() {
  if (!currentDetail || currentDetail.page.id !== S.currentPageId) return '';
  const page = currentDetail.page;
  const lines = [`# ${pageTitle(page)}`];
  if (page.type === 'database' && currentDetail.database) {
    lines.push('', `Database: ${pageTitle(page)}`);
    for (const row of (currentDetail.rows || []).slice(0, 80)) lines.push(`- ${row.title}`);
  } else {
    for (const b of currentDetail.blocks || []) {
      const text = (b.text || '').trim();
      if (!text) continue;
      if (b.type === 'heading1') lines.push(`# ${text}`);
      else if (b.type === 'heading2') lines.push(`## ${text}`);
      else if (b.type === 'heading3') lines.push(`### ${text}`);
      else if (b.type === 'to_do') lines.push(`- [${b.props?.checked ? 'x' : ' '}] ${text}`);
      else if (b.type === 'bulleted_list_item') lines.push(`- ${text}`);
      else if (b.type === 'numbered_list_item') lines.push(`1. ${text}`);
      else lines.push(text);
    }
  }
  return lines.join('\n').slice(0, 12000);
}

export function openAIDrawer(opts = {}) {
  if (typeof opts === 'string') opts = { prompt: opts };
  closeAuxDrawers('ai');
  activeAI?.close?.();
  let closed = false;
  const page = currentDetail && currentDetail.page.id === S.currentPageId ? currentDetail.page : null;
  let useContext = !!page;
  let aiInfo = null;
  let busy = S.aiBusy;

  const clearBtn = el('button', { class: 'icon-btn tiny', title: 'New conversation', 'aria-label': 'New conversation', html: ICONS.trash });
  const settingsBtn = el('button', { class: 'icon-btn tiny', title: 'AI settings', 'aria-label': 'AI settings', html: '<svg class="ic"><use href="#i-settings"/></svg>' });
  const { root, body, closeBtn } = drawerShell('IdeaCraft AI', {
    icon: ICONS.sparkles, className: 'ai-drawer', headActions: el('div', { class: 'drawer-head-actions' }, clearBtn, settingsBtn),
  });

  const contextBar = el('div', { class: 'ai-context' });
  const messages = el('div', { class: 'ai-messages' });
  const composer = el('div', { class: 'ai-composer' });
  const inputWrap = el('div', { class: 'ai-input-wrap' });
  const input = el('textarea', { class: 'ai-input', placeholder: 'Ask about this page, brainstorm, or rewrite…', rows: '2' });
  const modelLabel = el('span', { class: 'ai-model', text: 'Local AI' });
  const sendBtn = el('button', { class: 'ai-send', title: 'Send', 'aria-label': 'Send', html: ICONS.send });
  const statusArea = el('div', { class: 'ai-setup' });

  inputWrap.append(input, el('div', { class: 'ai-input-row' }, modelLabel, sendBtn));
  composer.appendChild(inputWrap);
  root.insertBefore(contextBar, body);
  root.appendChild(composer);

  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    S.aiOpen = false;
    if (activeAI?.root === root) activeAI = null;
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !hasLayers()) { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  activeAI = { root, close };
  S.aiOpen = true;
  closeBtn.addEventListener('click', close);
  closeBtn.title = 'Close AI';

  clearBtn.addEventListener('click', () => {
    S.aiMessages = [];
    renderMessages();
    input.focus();
    toast('Started a new conversation', 'success');
  });
  settingsBtn.addEventListener('click', () => { close(); openSettings('ai'); });

  function paintContext() {
    contextBar.innerHTML = '';
    if (page && useContext) {
      contextBar.append(
        el('span', { html: pageIcon(page, 'file') }),
        el('span', { html: `Using <b>${esc(pageTitle(page))}</b> as context` }),
        el('button', { class: 'ai-context-remove', title: 'Remove context', 'aria-label': 'Remove context', html: ICONS.close })
      );
      contextBar.querySelector('button').addEventListener('click', () => { useContext = false; paintContext(); });
    } else if (page) {
      contextBar.append(el('span', { html: ICONS.info }), el('span', { text: `Page context off · ${pageTitle(page)} not included` }), el('button', { class: 'ai-context-remove', title: 'Use page context', text: 'Use' }));
      contextBar.querySelector('button').addEventListener('click', () => { useContext = true; paintContext(); });
    } else {
      contextBar.append(el('span', { html: ICONS.info }), el('span', { text: 'Open a page to ask about its contents.' }));
    }
  }
  paintContext();

  function renderMessages() {
    messages.innerHTML = '';
    if (!S.aiMessages.length) {
      const suggestions = page
        ? ['Summarize this page', 'Improve the writing', 'Find the key action items', 'Turn this into a checklist']
        : ['Help me plan a project', 'Draft a weekly review', 'Brainstorm ideas', 'Rewrite this sentence'];
      const empty = el('div', { class: 'ai-empty' },
        el('div', { class: 'ai-logo', html: '<svg class="ic"><use href="#i-sparkles"/></svg>' }),
        el('h4', { text: page ? `Ask about “${pageTitle(page)}”` : 'How can I help?' }),
        el('p', { text: page ? 'I can read this page and help you think it through. Nothing leaves your computer.' : 'A local writing and thinking partner, powered by Ollama.' }),
        el('div', { class: 'ai-suggestions' })
      );
      suggestions.forEach(s => {
        const b = el('button', { class: 'ai-suggestion', text: s });
        b.addEventListener('click', () => send(s));
        empty.querySelector('.ai-suggestions').appendChild(b);
      });
      messages.appendChild(empty);
      return;
    }
    for (const m of S.aiMessages) {
      const isUser = m.role === 'user';
      const bubble = el('div', { class: 'ai-bubble' });
      if (isUser) bubble.textContent = m.content;
      else bubble.innerHTML = aiMarkdown(m.content);
      const msg = el('div', { class: `ai-msg ${isUser ? 'user' : 'assistant'}` },
        el('div', { class: 'ai-avatar', html: isUser ? esc(initials(S.settings.userName)) : '<svg class="ic"><use href="#i-sparkles"/></svg>' }),
        bubble
      );
      if (!isUser) {
        const actions = el('div', { class: 'ai-actions' });
        actions.appendChild(el('button', { text: 'Copy', onclick: async () => {
          const ok = await copyToClipboard(m.content);
          toast(ok ? 'Response copied' : 'Could not copy', ok ? 'success' : 'error');
        } }));
        if (page && page.type !== 'database') {
          actions.appendChild(el('button', { text: 'Insert into page', onclick: () => {
            const ok = insertEditorText(m.content);
            toast(ok ? 'Inserted into page' : 'Open a page first', ok ? 'success' : 'error');
          } }));
        }
        bubble.appendChild(actions);
      }
      messages.appendChild(msg);
    }
    if (busy) {
      messages.appendChild(el('div', { class: 'ai-msg assistant' },
        el('div', { class: 'ai-avatar', html: '<svg class="ic"><use href="#i-sparkles"/></svg>' }),
        el('div', { class: 'ai-bubble' }, el('div', { class: 'ai-typing' }, el('span'), el('span'), el('span')))
      ));
    }
    messages.scrollTop = messages.scrollHeight;
  }

  async function send(text) {
    const value = String(text ?? input.value).trim();
    if (!value || busy) return;
    input.value = '';
    input.style.height = '';
    busy = true; S.aiBusy = true;
    S.aiMessages.push({ role: 'user', content: value });
    renderMessages();
    sendBtn.disabled = true;
    try {
      const res = await invoke('ai_complete', {
        messages: S.aiMessages.slice(-20).map(m => ({ role: m.role, content: m.content })),
        context: useContext ? aiContextText() : '',
        model: S.settings.aiModel || 'llama3.2',
      });
      S.aiMessages.push({ role: 'assistant', content: String(res || '') });
    } catch (e) {
      S.aiMessages.push({
        role: 'assistant',
        content: `I could not reach the local AI.\n\n${errText(e)}\n\nMake sure Ollama is running, then check the model in Settings → IdeaCraft AI.`,
        error: true,
      });
      if (aiInfo && !aiInfo.running) updateSetup(true);
    } finally {
      busy = false; S.aiBusy = false;
      sendBtn.disabled = false;
      renderMessages();
      input.focus();
    }
  }

  function updateSetup(show) {
    statusArea.innerHTML = '';
    if (!show) return;
    if (aiInfo && aiInfo.enabled === false) {
      statusArea.append(
        el('div', { class: 'ai-setup-title', html: `${ICONS.info}<span>IdeaCraft AI is turned off</span>` }),
        el('button', { class: 'btn', text: 'Turn on local AI', onclick: () => { close(); openSettings('ai'); } })
      );
    } else {
      statusArea.append(
        el('div', { class: 'ai-setup-title', html: `${ICONS.warning}<span>Ollama is not running</span>` }),
        el('p', { text: 'Install Ollama and start it to use AI. Your notes stay on this device.' }),
        el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
          el('button', { class: 'btn', text: 'Setup guide', onclick: () => { close(); openSettings('ai'); } }),
          el('button', { class: 'btn', text: 'Download', onclick: () => invoke('open_url', { url: 'https://ollama.com/download' }).catch(() => {}) })
        )
      );
    }
    statusArea.style.display = '';
  }

  async function checkStatus() {
    modelLabel.textContent = `Model · ${S.settings.aiModel || 'llama3.2'}`;
    try {
      aiInfo = await invoke('ai_status');
      if (!aiInfo.enabled) { updateSetup(true); return; }
      if (!aiInfo.running) { updateSetup(true); return; }
      statusArea.style.display = 'none';
      const found = (aiInfo.models || []);
      if (!found.includes(S.settings.aiModel) && found.length) modelLabel.title = `Available: ${found.join(', ')}`;
      modelLabel.textContent = `Model · ${S.settings.aiModel || aiInfo.model || 'llama3.2'}`;
    } catch {
      aiInfo = { running: false, enabled: true };
      updateSetup(true);
    }
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(150, Math.max(54, input.scrollHeight))}px`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', () => send());

  body.append(statusArea, messages);
  statusArea.style.display = 'none';
  renderMessages();
  checkStatus();
  if (opts.prompt) send(opts.prompt);
  setTimeout(() => input.focus(), 80);
  return activeAI;
}
