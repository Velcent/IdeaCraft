/* IdeaCraft – databases: table, board, gallery, list, calendar */
import {
  S, $, $$, el, esc, uid, debounce, invoke, pageIcon, pageTitle, formatDate, timeAgo, stripHtml,
} from './api.js';
import {
  showMenu, showPopover, toast, openModal, confirmDialog, promptDialog, dateLabel,
} from './ui.js';

const DB = {
  root: null,
  page: null,
  database: null,
  rows: [],
  viewId: null,
  search: '',
  opts: {},
  calMonth: new Date(),
  pending: new Map(),
};

const VIEW_ICONS = { table: 'table', board: 'board', gallery: 'gallery', list: 'list', calendar: 'calendar' };
const PROP_ICONS = {
  title: 'text', text: 'text', number: 'hash', select: 'chevron-down', status: 'chevron-down',
  date: 'calendar', person: 'user', url: 'link', checkbox: 'todo', email: 'inbox', phone: 'inbox',
  files: 'file', relation: 'link', formula: 'hash', created_time: 'calendar', last_edited_time: 'calendar',
};
const PROP_TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['select', 'Select'], ['status', 'Status'], ['date', 'Date'],
  ['person', 'Person'], ['url', 'URL'], ['checkbox', 'Checkbox'], ['email', 'Email'], ['phone', 'Phone'], ['files', 'Files'],
];
const OPTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function mountDatabase(root, detail, opts = {}) {
  DB.root = root;
  DB.page = detail.page;
  DB.database = detail.database;
  DB.rows = (detail.rows || []).slice();
  if (Array.isArray(detail.rows)) detail.rows = DB.rows;
  DB.opts = opts;
  DB.search = '';
  DB.pending.clear();
  const stored = localStorage.getItem(`ideacraft:dbview:${DB.database.id}`);
  const views = getViews();
  DB.viewId = views.find(v => v.id === stored)?.id || views[0]?.id;
  DB.calMonth = new Date();
  renderDatabase();
}

export function getActiveDatabaseView() {
  return getViews().find(v => v.id === DB.viewId) || getViews()[0];
}

function getViews() {
  const v = DB.database?.views;
  return Array.isArray(v) && v.length ? v : [{ id: 'table', name: 'Table', type: 'table', groupBy: null, dateProperty: null, filters: [], sorts: [] }];
}

function getProps() {
  const p = DB.database?.properties;
  return Array.isArray(p) ? p : [];
}

function propOf(id) { return getProps().find(p => p.id === id); }
function titleProp() { return getProps().find(p => p.type === 'title') || getProps()[0] || { id: 'title', name: 'Name', type: 'title' }; }
function optionOf(prop, value) {
  if (!prop?.options) return null;
  return prop.options.find(o => o.id === value || o.name === value) || null;
}
function optionColor(prop, value) {
  const opt = optionOf(prop, value);
  return opt?.color || 'default';
}
function optionName(prop, value) {
  const opt = optionOf(prop, value);
  return opt?.name || (value || '');
}
function rowTitle(row) { return row.title || row.values?.[titleProp().id] || 'Untitled'; }

function renderDatabase() {
  if (!DB.root) return;
  DB.root.innerHTML = '';
  const views = getViews();
  const view = getActiveDatabaseView();
  if (!view) return;
  const tabs = el('div', { class: 'db-tabs' });
  views.forEach(v => {
    const tab = el('button', { class: `db-tab ${v.id === view.id ? 'active' : ''}` },
      el('span', { class: 'db-tab-icon', html: `<svg class="ic"><use href="#i-${VIEW_ICONS[v.type] || 'table'}"/></svg>` }),
      el('span', { text: v.name || v.type })
    );
    tab.addEventListener('click', () => {
      DB.viewId = v.id;
      localStorage.setItem(`ideacraft:dbview:${DB.database.id}`, v.id);
      renderDatabase();
    });
    tab.addEventListener('contextmenu', (e) => { e.preventDefault(); openViewMenu(tab, v.id); });
    tabs.appendChild(tab);
  });
  tabs.appendChild(el('button', { class: 'db-tab-add', title: 'Add a view', html: '<svg class="ic"><use href="#i-plus"/></svg>', onclick: (e) => openAddView(e.currentTarget) }));
  const activeTab = tabs.querySelector('.db-tab.active');
  if (activeTab) {
    const chev = el('button', { class: 'db-tab-add', title: 'View options', html: '<svg class="ic"><use href="#i-chevron-down"/></svg>', style: { width: '20px' } });
    chev.addEventListener('click', (e) => { e.stopPropagation(); openViewMenu(chev, view.id); });
    activeTab.appendChild(chev);
  }
  DB.root.appendChild(tabs);

  const toolbar = el('div', { class: 'db-toolbar' });
  const newBtn = el('button', { class: 'tb-text accent', html: '<svg class="ic"><use href="#i-plus"/></svg><span>New</span>', onclick: () => createRowForView(view) });
  toolbar.appendChild(newBtn);
  toolbar.appendChild(el('button', { class: `tb-text ${(view.filters || []).length ? 'accent' : ''}`, onclick: (e) => openFilterModal(e.currentTarget, view), html: `<svg class="ic"><use href="#i-filter"/></svg><span>Filter${(view.filters || []).length ? ` (${view.filters.length})` : ''}</span>` }));
  toolbar.appendChild(el('button', { class: `tb-text ${(view.sorts || []).length ? 'accent' : ''}`, onclick: (e) => openSortModal(e.currentTarget, view), html: `<svg class="ic"><use href="#i-sort"/></svg><span>Sort${(view.sorts || []).length ? ` (${view.sorts.length})` : ''}</span>` }));
  toolbar.appendChild(el('button', { class: 'tb-text', onclick: (e) => openPropertiesModal(e.currentTarget), html: '<svg class="ic"><use href="#i-settings"/></svg><span>Properties</span>' }));
  toolbar.appendChild(el('div', { class: 'spacer' }));
  const searchWrap = el('div', { class: 'db-search', html: '<svg class="ic"><use href="#i-search"/></svg>' }, el('input', { placeholder: 'Search…', value: DB.search }));
  const inp = searchWrap.querySelector('input');
  inp.addEventListener('input', debounce(() => { DB.search = inp.value; renderBody(); const f = DB.root.querySelector('.db-search input'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 180));
  toolbar.appendChild(searchWrap);
  const rows = filteredRows(view);
  DB.countEl = el('div', { class: 'db-count', text: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` });
  toolbar.appendChild(DB.countEl);
  toolbar.appendChild(el('button', { class: 'icon-btn', title: 'Database options', html: '<svg class="ic"><use href="#i-more"/></svg>', onclick: (e) => openViewMenu(e.currentTarget, view.id) }));
  DB.root.appendChild(toolbar);

  const body = el('div', { class: 'db-body' });
  DB.root.appendChild(body);
  renderBodyIntoTarget = () => {
    body.innerHTML = '';
    renderBody(body, view);
  };
  renderBodyIntoTarget();
}

let renderBodyIntoTarget = null;
function renderBody(target = null, view = null) {
  const body = target || DB.root?.querySelector('.db-body');
  if (!body) return;
  view = view || getActiveDatabaseView();
  body.innerHTML = '';
  const rows = filteredRows(view);
  if (DB.countEl) DB.countEl.textContent = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  if (view.type === 'table') renderTable(body, view, rows);
  else if (view.type === 'board') renderBoard(body, view, rows);
  else if (view.type === 'gallery') renderGallery(body, view, rows);
  else if (view.type === 'list') renderList(body, view, rows);
  else if (view.type === 'calendar') renderCalendar(body, view, rows);
  else renderTable(body, view, rows);
}

function renderTable(target, view, rows) {
  const props = getProps();
  const wrap = el('div', { class: 'db-table-wrap' });
  const table = el('table', { class: 'db-table' });
  const thead = el('thead');
  const htr = el('tr');
  htr.appendChild(el('th', { class: 'db-row-num' }));
  props.forEach(prop => {
    const th = el('th');
    const inner = el('div', { class: 'db-th-inner' });
    inner.appendChild(el('span', { class: 'db-th-icon', html: `<svg class="ic"><use href="#i-${PROP_ICONS[prop.type] || 'text'}"/></svg>` }));
    inner.appendChild(el('span', { class: 'db-th-name', text: prop.name }));
    inner.appendChild(el('span', { class: 'db-th-actions', html: '<svg class="ic"><use href="#i-more"/></svg>' }));
    inner.addEventListener('click', (e) => openPropertyMenu(e, prop));
    th.appendChild(inner);
    htr.appendChild(th);
  });
  const addTh = el('th', { style: { width: '34px', textAlign: 'center' } });
  addTh.appendChild(el('button', { class: 'icon-btn tiny', title: 'Add a property', html: '<svg class="ic"><use href="#i-plus"/></svg>', onclick: (e) => openPropertiesModal(e.currentTarget) }));
  htr.appendChild(addTh);
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el('tbody');
  const sorted = sortRows(rows, view);
  sorted.forEach((row, i) => {
    const tr = el('tr', { dataset: { row: row.id } });
    const num = el('td', { class: 'db-row-num' });
    num.innerHTML = `<span class="row-num">${i + 1}</span>`;
    const grip = el('button', { class: 'row-grip', title: 'Row options', html: '<svg class="ic"><use href="#i-grip"/></svg>' });
    grip.addEventListener('click', (e) => openRowMenu(e.currentTarget, row));
    num.appendChild(grip);
    tr.appendChild(num);
    props.forEach(prop => {
      const td = el('td', { class: `db-cell ${prop.type === 'title' ? 'title-cell' : ''}` });
      td.appendChild(buildCell(prop, row, { table: true }));
      tr.appendChild(td);
    });
    tr.appendChild(el('td'));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  const addRow = el('button', { class: 'db-add-row', html: '<svg class="ic"><use href="#i-plus"/></svg><span>New row</span>', onclick: async () => { await createRow(); } });
  wrap.appendChild(addRow);
  target.appendChild(wrap);
  if (!rows.length && !DB.search && !(view.filters || []).length) {
    target.appendChild(el('div', { class: 'empty-state', style: { padding: '26px 20px' } },
      el('div', { class: 'es-icon', text: '🌱' }),
      el('h3', { text: 'No rows yet' }),
      el('p', { text: 'Click “New row” to add your first item.' })
    ));
  }
}

/* ---------------- Cell builders ---------------- */
export function buildCell(prop, row, opts = {}) {
  const wrap = el('div', { class: 'cell-value' });
  const value = prop.type === 'title' ? (row.values?.[prop.id] ?? row.title ?? '') : row.values?.[prop.id];
  const save = (v, immediate = false) => {
    if (prop.type === 'title') {
      row.values = row.values || {};
      row.values[prop.id] = v;
      row.title = v || 'Untitled';
      const p = S.pageMap.get(row.pageId);
      if (p) { p.title = row.title; p.updatedAt = new Date().toISOString(); }
      DB.opts.onTitleChange?.(row);
    }
    saveCell(row, prop, v, immediate);
  };
  if (prop.type === 'title') {
    const input = el('input', { class: 'cell-input', value, placeholder: 'Untitled', spellcheck: 'false' });
    input.addEventListener('input', () => { row.title = input.value; save(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = row.title; input.blur(); }
    });
    input.addEventListener('focus', () => { input.select(); });
    wrap.appendChild(input);
    if (opts.table) {
      const open = el('button', { class: 'cell-open', title: 'Open page', html: '<svg class="ic"><use href="#i-expand"/></svg>' });
      open.addEventListener('mousedown', e => e.preventDefault());
      open.addEventListener('click', (e) => { e.stopPropagation(); DB.opts.openPage?.(row.pageId); });
      wrap.appendChild(open);
    }
    return wrap;
  }
  if (prop.type === 'text' || prop.type === 'url' || prop.type === 'email' || prop.type === 'phone') {
    const input = el('input', { class: 'cell-input', value: value ?? '', placeholder: opts.table ? '' : 'Empty', spellcheck: 'false' });
    input.addEventListener('input', () => save(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    if (prop.type === 'url' && value) {
      input.style.color = 'var(--accent)';
      input.title = value;
    }
    wrap.appendChild(input);
    return wrap;
  }
  if (prop.type === 'number') {
    const input = el('input', { class: 'cell-input num-val', type: 'number', value: value ?? '', placeholder: opts.table ? '' : 'Empty', step: 'any' });
    input.addEventListener('input', () => save(input.value === '' ? '' : Number(input.value)));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    wrap.appendChild(input);
    return wrap;
  }
  if (prop.type === 'date') {
    const input = el('input', { class: 'cell-input date-chip', type: 'date', value: value ? String(value).slice(0, 10) : '' });
    input.addEventListener('change', () => save(input.value));
    wrap.appendChild(input);
    return wrap;
  }
  if (prop.type === 'checkbox') {
    const checked = !!value;
    const btn = el('button', { class: `cell-check ${checked ? 'checked' : ''}`, 'aria-label': 'Toggle', html: checked ? '<svg class="ic"><use href="#i-check"/></svg>' : '' });
    btn.addEventListener('click', () => { const v = !row.values?.[prop.id]; btn.classList.toggle('checked', v); btn.innerHTML = v ? '<svg class="ic"><use href="#i-check"/></svg>' : ''; save(v); });
    wrap.appendChild(btn);
    return wrap;
  }
  if (prop.type === 'select' || prop.type === 'status') {
    const btn = el('button', { class: `pill pill-${optionColor(prop, value)} cell-pill` });
    btn.textContent = value ? optionName(prop, value) : '';
    if (!value) { btn.classList.add('cell-empty-pill'); btn.innerHTML = '<span class="cell-empty">Empty</span>'; }
    btn.addEventListener('click', (e) => { e.stopPropagation(); openOptionPicker(btn, prop, row, save); });
    wrap.appendChild(btn);
    return wrap;
  }
  if (prop.type === 'person') {
    if (value) {
      const chip = el('span', { class: 'person-chip' }, el('span', { class: 'person-mini', text: String(value).charAt(0).toUpperCase() }), el('span', { text: String(value) }));
      chip.addEventListener('click', () => promptPerson(row, prop, save));
      wrap.appendChild(chip);
    } else {
      const btn = el('button', { class: 'cell-empty', text: 'Empty', onclick: () => promptPerson(row, prop, save) });
      wrap.appendChild(btn);
    }
    return wrap;
  }
  if (prop.type === 'files') {
    const val = Array.isArray(value) ? value.join(', ') : value || '';
    const input = el('input', { class: 'cell-input', value: val, placeholder: opts.table ? '' : 'Empty' });
    input.addEventListener('input', () => save(input.value));
    wrap.appendChild(input);
    return wrap;
  }
  const input = el('input', { class: 'cell-input', value: value ?? '', placeholder: opts.table ? '' : 'Empty' });
  input.addEventListener('input', () => save(input.value));
  wrap.appendChild(input);
  return wrap;
}

async function promptPerson(row, prop, save) {
  const name = await promptDialog({ title: `Set ${prop.name}`, label: 'Person', value: row.values?.[prop.id] || '' });
  if (name !== null) save(name);
}

function openOptionPicker(anchor, prop, row, save) {
  const node = el('div', { class: 'menu opt-menu', style: { width: '230px' } });
  const search = el('div', { class: 'menu-search', html: '<svg class="ic"><use href="#i-search"/></svg>' }, el('input', { placeholder: 'Search options…' }));
  const list = el('div', { class: 'menu-scroll', style: { maxHeight: '230px' } });
  let query = '';
  const render = () => {
    list.innerHTML = '';
    const opts = (prop.options || []).filter(o => o.name.toLowerCase().includes(query.toLowerCase()));
    for (const opt of opts) {
      const item = el('div', { class: 'opt-item' },
        el('span', { class: `opt-swatch pill-${opt.color || 'default'}`, style: { background: 'currentColor', opacity: .5 } }),
        el('span', { text: opt.name, class: `pill pill-${opt.color || 'default'}`, style: { padding: '0 5px' } }),
        row.values?.[prop.id] === opt.id ? el('span', { class: 'opt-check', html: '<svg class="ic"><use href="#i-check"/></svg>' }) : null
      );
      item.addEventListener('click', () => { save(opt.id, true); pop.close(); });
      list.appendChild(item);
    }
    if (!opts.length) list.appendChild(el('div', { class: 'slash-empty', text: 'No options' }));
    if (query && !(prop.options || []).some(o => o.name.toLowerCase() === query.toLowerCase())) {
      const create = el('div', { class: 'opt-create', html: `<svg class="ic" style="width:13px;height:13px"><use href="#i-plus"/></svg><span>Create “${esc(query)}”</span>` });
      create.addEventListener('click', async () => {
        const opt = { id: uid(), name: query, color: OPTION_COLORS[(prop.options?.length || 0) % OPTION_COLORS.length] };
        prop.options = [...(prop.options || []), opt];
        await saveDatabaseMeta();
        save(opt.id, true);
        pop.close();
      });
      list.appendChild(create);
    }
    const clear = el('div', { class: 'opt-item', style: { color: 'var(--text-faint)' } }, 'Clear value');
    clear.addEventListener('click', () => { save('', true); pop.close(); });
    list.appendChild(el('div', { class: 'menu-sep' }));
    list.appendChild(clear);
  };
  node.appendChild(search);
  node.appendChild(list);
  const pop = showPopover({ node, anchor, width: 230, onMount: () => {
    const input = search.querySelector('input');
    input.addEventListener('input', () => { query = input.value; render(); });
    input.focus();
    render();
  }});
}

function saveCell(row, prop, value, immediate = false) {
  row.values = row.values || {};
  row.values[prop.id] = value;
  const key = row.id;
  const prev = DB.pending.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => flushRow(row), immediate ? 0 : 450);
  DB.pending.set(key, { timer });
  DB.opts.onChange?.();
}

async function flushRow(row) {
  DB.pending.delete(row.id);
  try {
    const updated = await invoke('update_row', { rowId: row.id, values: row.values });
    Object.assign(row, updated);
    if (updated.title) {
      const p = S.pageMap.get(row.pageId);
      if (p) p.title = updated.title;
    }
    DB.opts.onChange?.();
  } catch (e) { toast(`Could not update row: ${e}`, 'error'); }
}

/* ---------------- Data helpers ---------------- */
function filteredRows(view) {
  let rows = DB.rows.filter(r => !r.trashed);
  const q = DB.search.trim().toLowerCase();
  if (q) {
    rows = rows.filter(r => rowTitle(r).toLowerCase().includes(q) || Object.values(r.values || {}).some(v => String(v).toLowerCase().includes(q)));
  }
  for (const f of view.filters || []) rows = rows.filter(r => matchesFilter(r, f));
  return rows;
}

function matchesFilter(row, f) {
  const prop = propOf(f.property);
  if (!prop) return true;
  const raw = row.values?.[f.property] ?? '';
  const val = String(raw ?? '').toLowerCase();
  const q = String(f.value ?? '').toLowerCase();
  switch (f.operator) {
    case 'is': return prop.type === 'title' ? rowTitle(row).toLowerCase() === q : val === q;
    case 'is_not': return val !== q;
    case 'contains': return val.includes(q);
    case 'not_contains': return !val.includes(q);
    case 'starts_with': return val.startsWith(q);
    case 'ends_with': return val.endsWith(q);
    case 'is_empty': return raw === '' || raw === null || raw === undefined;
    case 'is_not_empty': return raw !== '' && raw !== null && raw !== undefined;
    case 'gt': return Number(raw) > Number(f.value);
    case 'lt': return Number(raw) < Number(f.value);
    case 'gte': return Number(raw) >= Number(f.value);
    case 'lte': return Number(raw) <= Number(f.value);
    case 'before': return raw && new Date(raw) < new Date(f.value);
    case 'after': return raw && new Date(raw) > new Date(f.value);
    case 'is_checked': return !!raw;
    case 'is_not_checked': return !raw;
    default: return true;
  }
}

function sortRows(rows, view) {
  const sorts = view.sorts || [];
  if (!sorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const prop = propOf(s.property);
      if (!prop) continue;
      let va = prop.type === 'title' ? rowTitle(a) : a.values?.[s.property];
      let vb = prop.type === 'title' ? rowTitle(b) : b.values?.[s.property];
      const dir = s.direction === 'desc' ? -1 : 1;
      if (prop.type === 'number') { va = Number(va) || 0; vb = Number(vb) || 0; }
      else if (prop.type === 'checkbox') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
      else if (prop.type === 'select' || prop.type === 'status') {
        // Sort by the option order shown in the property editor, not alphabetically.
        const order = prop.options || [];
        const ra = order.findIndex(o => o.id === va);
        const rb = order.findIndex(o => o.id === vb);
        if (ra === -1 && rb !== -1) return 1;
        if (rb === -1 && ra !== -1) return -1;
        if (ra !== rb) return (ra - rb) * dir;
        continue;
      }
      else { va = optionName(prop, va).toLowerCase(); vb = optionName(prop, vb).toLowerCase(); }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });
}

async function createRow(initialValues = {}, options = {}) {
  const db = DB.database;
  if (!db) return;
  const tp = titleProp();
  const values = { ...initialValues };
  if (values[tp.id] === undefined) values[tp.id] = options.title ?? 'Untitled';
  try {
    const res = await invoke('create_row', { databaseId: db.id, values });
    DB.rows.push(res.row);
    const p = S.pageMap.get(res.row.pageId);
    if (!p && res.page) S.pageMap.set(res.page.id, res.page);
    DB.opts.onChange?.();
    renderBody();
    if (options.open) DB.opts.openPage?.(res.row.pageId);
    else if ((getActiveDatabaseView()?.type === 'table')) {
      setTimeout(() => {
        const input = DB.root?.querySelector(`tr[data-row="${res.row.id}"] .title-cell input`);
        input?.focus(); input?.select();
      }, 30);
    }
    return res.row;
  } catch (e) { toast(`Could not create row: ${e}`, 'error'); }
}

async function createRowForView(view) {
  if (view.type === 'board') {
    const prop = propOf(view.groupBy) || getProps().find(p => p.type === 'status' || p.type === 'select');
    return createRow();
  }
  if (view.type === 'calendar') {
    const today = new Date().toISOString().slice(0, 10);
    const dateProp = view.dateProperty || getProps().find(p => p.type === 'date')?.id;
    return createRow(dateProp ? { [dateProp]: today } : {});
  }
  return createRow();
}
/* ---------------- Board view ---------------- */
function renderBoard(target, view, rows) {
  const prop = propOf(view.groupBy) || getProps().find(p => p.type === 'status' || p.type === 'select');
  if (!prop) {
    target.appendChild(el('div', { class: 'empty-state' }, el('div', { class: 'es-icon', text: '🗂️' }), el('h3', { text: 'Add a select or status property' }), el('p', { text: 'Board views group rows by a select property.' })));
    return;
  }
  const board = el('div', { class: 'board-view' });
  const groups = [...(prop.options || [])];
  const hasNone = rows.some(r => !r.values?.[prop.id]);
  if (hasNone || !groups.length) groups.push({ id: '__none__', name: `No ${prop.name.toLowerCase()}`, color: 'gray' });
  for (const group of groups) {
    const col = el('div', { class: 'board-col', dataset: { option: group.id } });
    const groupRows = rows.filter(r => group.id === '__none__' ? !r.values?.[prop.id] : r.values?.[prop.id] === group.id);
    const head = el('div', { class: 'board-col-head' },
      el('span', { class: 'bc-dot', style: { background: colorHex(group.color) } }),
      el('span', { text: group.name }),
      el('span', { class: 'bc-count', text: String(groupRows.length) }),
      el('button', { class: 'bc-add', title: 'New item', html: '<svg class="ic"><use href="#i-plus"/></svg>' })
    );
    head.querySelector('.bc-add').addEventListener('click', () => createRow(group.id === '__none__' ? {} : { [prop.id]: group.id }));
    col.appendChild(head);
    for (const row of groupRows) {
      const card = el('div', { class: 'board-card', draggable: 'true', dataset: { row: row.id } });
      const icon = row.icon ? pageIcon({ icon: row.icon, type: 'page' }) : '';
      if (icon) card.appendChild(el('span', { class: 'bc-icon', html: icon }));
      card.appendChild(el('div', { class: 'bc-title', text: rowTitle(row) }));
      const propsWrap = el('div', { class: 'bc-props' });
      for (const p of getProps()) {
        if (p.id === titleProp().id || p.id === prop.id) continue;
        const v = row.values?.[p.id];
        if (!v) continue;
        if (p.type === 'select' || p.type === 'status') {
          propsWrap.appendChild(el('span', { class: `pill pill-${optionColor(p, v)}`, style: { padding: '1px 6px', fontSize: '11px' }, text: optionName(p, v) }));
        } else if (p.type === 'date') {
          propsWrap.appendChild(el('span', { class: 'bc-date', html: `<svg class="ic"><use href="#i-calendar"/></svg>${formatDate(v)}` }));
        } else if (p.type === 'number') {
          propsWrap.appendChild(el('span', { class: 'bc-date', text: String(v) }));
        }
        if (propsWrap.children.length >= 3) break;
      }
      card.appendChild(propsWrap);
      card.addEventListener('click', (e) => { if (!e.target.closest('.board-card-menu')) DB.opts.openPage?.(row.pageId); });
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); openRowMenu(card, row); });
      card.addEventListener('dragstart', (e) => {
        DB.dragRow = row.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => { DB.dragRow = null; card.classList.remove('dragging'); });
      col.appendChild(card);
    }
    col.appendChild(el('button', { class: 'board-add', onclick: () => createRow(group.id === '__none__' ? {} : { [prop.id]: group.id }), html: '<svg class="ic"><use href="#i-plus"/></svg><span>New</span>' }));
    col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      const rowId = DB.dragRow || e.dataTransfer.getData('text/plain');
      const row = DB.rows.find(r => r.id === rowId);
      if (!row) return;
      row.values = row.values || {};
      row.values[prop.id] = group.id === '__none__' ? '' : group.id;
      await flushRow(row);
      DB.dragRow = null;
      renderBody();
    });
    board.appendChild(col);
  }
  target.appendChild(board);
}

function colorHex(color) {
  return ({ gray: '#787774', brown: '#9f6b53', orange: '#d9730d', yellow: '#dfab01', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#e03e3e' })[color] || '#787774';
}

/* ---------------- Gallery / List ---------------- */
function galleryGradient(id) {
  const grads = [
    'linear-gradient(135deg, #c6e4ff, #a5c8f0)',
    'linear-gradient(135deg, #ffe0c2, #ffc7a8)',
    'linear-gradient(135deg, #d8f0e2, #b3e3cd)',
    'linear-gradient(135deg, #f1defa, #dcc2ef)',
    'linear-gradient(135deg, #ffe1e6, #ffc9d4)',
    'linear-gradient(135deg, #fdf3c8, #f5df9d)',
    'linear-gradient(135deg, #d5e6f7, #b0cfea)',
    'linear-gradient(135deg, #e3e3e3, #cccccc)',
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return grads[h % grads.length];
}

function renderGallery(target, view, rows) {
  const grid = el('div', { class: 'gallery-view' });
  const sorted = sortRows(rows, view);
  for (const row of sorted) {
    const card = el('div', { class: 'gallery-card' });
    const cover = el('div', { class: 'gallery-cover' });
    if (row.icon) cover.innerHTML = pageIcon({ icon: row.icon, type: 'page' });
    else cover.appendChild(el('div', { class: 'gc-gradient', style: { background: galleryGradient(row.id) } }));
    card.appendChild(cover);
    const body = el('div', { class: 'gallery-body' });
    body.appendChild(el('div', { class: 'gallery-title', text: rowTitle(row) }));
    const props = el('div', { class: 'gallery-props' });
    for (const p of getProps()) {
      if (p.id === titleProp().id) continue;
      const v = row.values?.[p.id];
      if (!v) continue;
      const pr = el('div', { class: 'gallery-prop' }, el('span', { class: 'gp-name', text: p.name }));
      if (p.type === 'select' || p.type === 'status') pr.appendChild(el('span', { class: `pill pill-${optionColor(p, v)}`, style: { fontSize: '10.5px', padding: '0 5px' }, text: optionName(p, v) }));
      else if (p.type === 'date') pr.appendChild(el('span', { class: 'gp-val', text: formatDate(v) }));
      else if (p.type === 'checkbox') pr.appendChild(el('span', { class: 'gp-val', text: v ? 'Yes' : 'No' }));
      else pr.appendChild(el('span', { class: 'gp-val', text: String(v) }));
      props.appendChild(pr);
      if (props.children.length >= 3) break;
    }
    body.appendChild(props);
    card.appendChild(body);
    card.addEventListener('click', () => DB.opts.openPage?.(row.pageId));
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); openRowMenu(card, row); });
    grid.appendChild(card);
  }
  const add = el('button', { class: 'gallery-add', onclick: () => createRow(), html: '<svg class="ic"><use href="#i-plus"/></svg><span>New</span>' });
  grid.appendChild(add);
  target.appendChild(grid);
}

function renderList(target, view, rows) {
  const list = el('div', { class: 'db-list' });
  const sorted = sortRows(rows, view);
  for (const row of sorted) {
    const line = el('div', { class: 'db-list-row' });
    line.appendChild(el('span', { class: 'db-list-icon', html: row.icon ? pageIcon({ icon: row.icon, type: 'page' }) : '<svg class="ic"><use href="#i-file"/></svg>' }));
    line.appendChild(el('span', { class: 'db-list-title', text: rowTitle(row) }));
    const pr = el('div', { class: 'db-list-props' });
    for (const p of getProps()) {
      if (p.id === titleProp().id) continue;
      const v = row.values?.[p.id];
      if (!v) continue;
      if (p.type === 'select' || p.type === 'status') pr.appendChild(el('span', { class: `pill pill-${optionColor(p, v)}`, text: optionName(p, v) }));
      else if (p.type === 'date') pr.appendChild(el('span', { class: 'db-list-date', text: formatDate(v) }));
      if (pr.children.length >= 3) break;
    }
    line.appendChild(pr);
    line.addEventListener('click', () => DB.opts.openPage?.(row.pageId));
    line.addEventListener('contextmenu', (e) => { e.preventDefault(); openRowMenu(line, row); });
    list.appendChild(line);
  }
  target.appendChild(list);
  target.appendChild(el('button', { class: 'db-add-row', onclick: () => createRow(), html: '<svg class="ic"><use href="#i-plus"/></svg><span>New row</span>' }));
}

/* ---------------- Calendar view ---------------- */
function renderCalendar(target, view, rows) {
  const datePropId = view.dateProperty || getProps().find(p => p.type === 'date')?.id;
  const dateProp = propOf(datePropId);
  if (!dateProp) {
    target.appendChild(el('div', { class: 'empty-state' }, el('div', { class: 'es-icon', text: '📅' }), el('h3', { text: 'Add a date property' }), el('p', { text: 'Calendar views need a date property to place rows.' })));
    return;
  }
  const month = DB.calMonth || new Date();
  const year = month.getFullYear(), mon = month.getMonth();
  const first = new Date(year, mon, 1);
  const startDay = first.getDay();
  const gridStart = new Date(year, mon, 1 - startDay);
  const todayKey = new Date().toDateString();

  const wrap = el('div', { class: 'calendar-view' });
  const head = el('div', { class: 'cal-head' });
  head.appendChild(el('div', { class: 'cal-title', text: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }));
  head.appendChild(el('button', { class: 'cal-nav', html: '<svg class="ic"><use href="#i-chevron-left"/></svg>', onclick: () => { DB.calMonth = new Date(year, mon - 1, 1); renderBody(); } }));
  head.appendChild(el('button', { class: 'cal-nav', html: '<svg class="ic"><use href="#i-chevron-right"/></svg>', onclick: () => { DB.calMonth = new Date(year, mon + 1, 1); renderBody(); } }));
  const todayBtn = el('button', { class: 'tb-text', text: 'Today', style: { marginLeft: '6px', fontSize: '12px' }, onclick: () => { DB.calMonth = new Date(); renderBody(); } });
  head.appendChild(todayBtn);
  head.appendChild(el('div', { class: 'spacer' }));
  head.appendChild(el('div', { class: 'db-count', text: `${rows.length} ${rows.length === 1 ? 'item' : 'items'}` }));
  wrap.appendChild(head);

  const grid = el('div', { class: 'cal-grid' });
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => grid.appendChild(el('div', { class: 'cal-dow', text: d })));
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const cell = el('div', { class: `cal-cell ${d.getMonth() !== mon ? 'other' : ''} ${d.toDateString() === todayKey ? 'today' : ''}` });
    cell.appendChild(el('div', { class: 'cal-day', text: String(d.getDate()) }));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayRows = rows.filter(r => {
      const v = r.values?.[datePropId];
      if (!v) return false;
      return String(v).slice(0, 10) === key;
    }).slice(0, 4);
    for (const row of dayRows) {
      const item = el('div', { class: 'cal-item', title: rowTitle(row) },
        el('span', { class: 'cal-dot' }),
        el('span', { text: rowTitle(row), style: { overflow: 'hidden', textOverflow: 'ellipsis' } })
      );
      item.addEventListener('click', (e) => { e.stopPropagation(); DB.opts.openPage?.(row.pageId); });
      cell.appendChild(item);
    }
    const add = el('button', { class: 'cal-add', title: 'New page', html: '<svg class="ic"><use href="#i-plus"/></svg>' });
    add.addEventListener('click', (e) => { e.stopPropagation(); createRow({ [datePropId]: key }, { open: true }); });
    cell.appendChild(add);
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  target.appendChild(wrap);
}

/* ---------------- View & property menus ---------------- */
async function saveDatabaseMeta() {
  try {
    const updated = await invoke('update_database', {
      id: DB.database.id,
      name: DB.database.name,
      properties: DB.database.properties,
      views: DB.database.views,
    });
    DB.database = { ...DB.database, ...updated };
    DB.opts.onDatabaseChange?.(DB.database);
    return true;
  } catch (e) {
    toast(`Could not save database: ${e}`, 'error');
    return false;
  }
}

function openAddView(anchor) {
  const make = (type, name) => {
    const props = getProps();
    const view = {
      id: uid(), name, type,
      groupBy: type === 'board' ? (props.find(p => p.type === 'status' || p.type === 'select')?.id || null) : null,
      dateProperty: type === 'calendar' ? (props.find(p => p.type === 'date')?.id || null) : null,
      filters: [], sorts: [],
    };
    DB.database.views = [...getViews(), view];
    DB.viewId = view.id;
    localStorage.setItem(`ideacraft:dbview:${DB.database.id}`, view.id);
    saveDatabaseMeta();
    renderDatabase();
  };
  showMenu({
    anchor, width: 230, items: [
      { icon: 'table', label: 'Table', action: () => make('table', 'Table') },
      { icon: 'board', label: 'Board', action: () => make('board', 'Board') },
      { icon: 'gallery', label: 'Gallery', action: () => make('gallery', 'Gallery') },
      { icon: 'list', label: 'List', action: () => make('list', 'List') },
      { icon: 'calendar', label: 'Calendar', action: () => make('calendar', 'Calendar') },
    ]
  });
}

function openViewMenu(anchor, viewId) {
  const view = getViews().find(v => v.id === viewId);
  if (!view) return;
  const items = [
    { icon: 'edit', label: 'Rename view', action: async () => {
      const name = await promptDialog({ title: 'Rename view', value: view.name, confirmText: 'Rename' });
      if (name) { view.name = name; await saveDatabaseMeta(); renderDatabase(); }
    }},
    { icon: 'duplicate', label: 'Duplicate view', action: () => {
      const copy = JSON.parse(JSON.stringify(view));
      copy.id = uid(); copy.name = `${view.name} copy`;
      DB.database.views = [...getViews(), copy];
      DB.viewId = copy.id;
      saveDatabaseMeta(); renderDatabase();
    }},
    { icon: 'settings', label: 'View settings', action: () => openViewSettings(view) },
    { type: 'sep' },
    { icon: 'filter', label: 'Filter', action: () => openFilterModal(anchor, view) },
    { icon: 'sort', label: 'Sort', action: () => openSortModal(anchor, view) },
    { icon: 'settings', label: 'Properties', action: () => openPropertiesModal(anchor) },
    { type: 'sep' },
    { icon: 'trash', label: 'Delete view', danger: true, disabled: getViews().length <= 1, action: async () => {
      if (getViews().length <= 1) return;
      if (!(await confirmDialog({ title: 'Delete view?', message: `“${view.name}” will be removed. Your data stays in the database.`, confirmText: 'Delete view', danger: true }))) return;
      DB.database.views = getViews().filter(v => v.id !== view.id);
      DB.viewId = DB.database.views[0]?.id;
      saveDatabaseMeta(); renderDatabase();
    }},
  ];
  showMenu({ items, anchor, width: 235 });
}

function openViewSettings(view) {
  const body = el('div');
  const name = el('input', { type: 'text', value: view.name });
  const type = el('select');
  for (const [v, label] of [['table', 'Table'], ['board', 'Board'], ['gallery', 'Gallery'], ['list', 'List'], ['calendar', 'Calendar']]) {
    const o = el('option', { value: v, text: label }); if (view.type === v) o.selected = true; type.appendChild(o);
  }
  const groupBy = el('select');
  groupBy.appendChild(el('option', { value: '', text: 'None' }));
  for (const p of getProps()) if (p.type === 'select' || p.type === 'status') {
    const o = el('option', { value: p.id, text: p.name }); if (view.groupBy === p.id) o.selected = true; groupBy.appendChild(o);
  }
  const dateProp = el('select');
  dateProp.appendChild(el('option', { value: '', text: 'None' }));
  for (const p of getProps()) if (p.type === 'date') {
    const o = el('option', { value: p.id, text: p.name }); if (view.dateProperty === p.id) o.selected = true; dateProp.appendChild(o);
  }
  const groupField = el('div', { class: 'field' }, el('label', { text: 'Group by' }), groupBy);
  const dateField = el('div', { class: 'field' }, el('label', { text: 'Date property' }), dateProp);
  const updateFields = () => {
    groupField.style.display = type.value === 'board' ? '' : 'none';
    dateField.style.display = type.value === 'calendar' ? '' : 'none';
  };
  type.addEventListener('change', updateFields);
  body.append(
    el('div', { class: 'field' }, el('label', { text: 'View name' }), name),
    el('div', { class: 'field' }, el('label', { text: 'View type' }), type),
    groupField, dateField
  );
  updateFields();
  let modal;
  modal = openModal({
    title: 'View settings', width: 460, body,
    footer: el('div', { style: { display: 'flex', gap: '8px' } },
      el('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn primary', text: 'Save', onclick: async () => {
        view.name = name.value.trim() || view.name;
        view.type = type.value;
        view.groupBy = groupBy.value || null;
        view.dateProperty = dateProp.value || null;
        await saveDatabaseMeta();
        modal.close(); renderDatabase();
      }})
    ),
    onMount: () => name.focus(),
  });
}

function openPropertyMenu(e, prop) {
  e.stopPropagation();
  const view = getActiveDatabaseView();
  const anchor = e.currentTarget;
  showMenu({
    anchor, width: 240, items: [
      { type: 'label', label: prop.name },
      { icon: 'sort', label: 'Sort ascending', action: () => { addSort(view, prop.id, 'asc'); } },
      { icon: 'sort', label: 'Sort descending', action: () => { addSort(view, prop.id, 'desc'); } },
      { icon: 'filter', label: 'Filter by this property', action: () => { addFilter(view, prop.id); openFilterModal(anchor, view); } },
      { type: 'sep' },
      { icon: 'edit', label: 'Rename property', disabled: prop.type === 'title', action: async () => {
        const n = await promptDialog({ title: 'Rename property', value: prop.name, confirmText: 'Rename' });
        if (n) { prop.name = n; await saveDatabaseMeta(); renderBody(); }
      }},
      { icon: 'settings', label: 'Edit properties', action: () => openPropertiesModal(anchor) },
      { icon: 'trash', label: 'Delete property', danger: true, disabled: prop.type === 'title', action: async () => {
        if (prop.type === 'title') return;
        if (!(await confirmDialog({ title: `Delete “${prop.name}”?`, message: 'The property will be removed from this database. Values in existing rows may be kept but will no longer be shown.', confirmText: 'Delete', danger: true }))) return;
        DB.database.properties = getProps().filter(p => p.id !== prop.id);
        await saveDatabaseMeta(); renderDatabase();
      }},
    ]
  });
}

function addSort(view, propId, direction = 'asc') {
  view.sorts = [...(view.sorts || []), { property: propId, direction }];
  saveDatabaseMeta(); renderBody();
}
function addFilter(view, propId) {
  const prop = propOf(propId);
  const operator = prop?.type === 'select' || prop?.type === 'status' ? 'is' : prop?.type === 'checkbox' ? 'is_checked' : 'contains';
  view.filters = [...(view.filters || []), { property: propId, operator, value: '' }];
  saveDatabaseMeta();
}

/* ---------------- Filters & sorts ---------------- */
const OPERATORS = {
  text: [['contains', 'contains'], ['not_contains', 'does not contain'], ['is', 'is'], ['is_not', 'is not'], ['starts_with', 'starts with'], ['ends_with', 'ends with'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  title: [['contains', 'contains'], ['is', 'is'], ['is_not', 'is not'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  select: [['is', 'is'], ['is_not', 'is not'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  status: [['is', 'is'], ['is_not', 'is not'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  date: [['is', 'is'], ['before', 'is before'], ['after', 'is after'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  number: [['is', '='], ['is_not', '≠'], ['gt', '>'], ['lt', '<'], ['gte', '≥'], ['lte', '≤'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  checkbox: [['is_checked', 'is checked'], ['is_not_checked', 'is not checked']],
  person: [['contains', 'contains'], ['is', 'is'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
};
function opsFor(prop) { return OPERATORS[prop?.type] || OPERATORS.text; }
function needsValue(op) { return !['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'].includes(op); }

function openFilterModal(anchor, view) {
  const draft = JSON.parse(JSON.stringify(view.filters || []));
  const body = el('div');
  const render = () => {
    body.innerHTML = '';
    if (!draft.length) body.appendChild(el('div', { class: 'dialog-text', text: 'No filters yet. Add one to narrow down this view.' }));
    draft.forEach((f, i) => {
      const prop = propOf(f.property) || getProps()[0];
      if (!prop) return;
      f.property = prop.id;
      const row = el('div', { class: 'filter-row' });
      const psel = el('select');
      for (const p of getProps()) { const o = el('option', { value: p.id, text: p.name }); if (p.id === f.property) o.selected = true; psel.appendChild(o); }
      psel.addEventListener('change', () => {
        f.property = psel.value; const np = propOf(f.property);
        f.operator = opsFor(np)[0][0]; f.value = ''; render();
      });
      const ops = opsFor(prop);
      const osel = el('select');
      for (const [v, label] of ops) { const o = el('option', { value: v, text: label }); if (v === f.operator) o.selected = true; osel.appendChild(o); }
      osel.addEventListener('change', () => { f.operator = osel.value; render(); });
      row.appendChild(psel); row.appendChild(osel);
      if (needsValue(f.operator)) {
        if (prop.type === 'select' || prop.type === 'status') {
          const vsel = el('select');
          vsel.appendChild(el('option', { value: '', text: 'Select…' }));
          for (const opt of prop.options || []) { const o = el('option', { value: opt.id, text: opt.name }); if (opt.id === f.value) o.selected = true; vsel.appendChild(o); }
          vsel.addEventListener('change', () => f.value = vsel.value);
          row.appendChild(vsel);
        } else {
          const inp = el('input', { type: prop.type === 'date' ? 'date' : prop.type === 'number' ? 'number' : 'text', value: f.value || '', placeholder: 'Value' });
          inp.addEventListener('input', () => f.value = inp.value);
          row.appendChild(inp);
        }
      }
      const rm = el('button', { class: 'filter-remove', title: 'Remove filter', html: '<svg class="ic"><use href="#i-close"/></svg>' });
      rm.addEventListener('click', () => { draft.splice(i, 1); render(); });
      row.appendChild(rm);
      body.appendChild(row);
    });
    const add = el('button', { class: 'filter-add', html: '<svg class="ic"><use href="#i-plus"/></svg><span>Add a filter</span>' });
    add.addEventListener('click', () => {
      const first = getProps()[0];
      draft.push({ property: first?.id, operator: opsFor(first)[0][0], value: '' });
      render();
    });
    body.appendChild(add);
  };
  render();
  let modal;
  modal = openModal({
    title: 'Filters', width: 580, body,
    footer: el('div', { style: { display: 'flex', gap: '8px', width: '100%' } },
      el('button', { class: 'btn', text: 'Clear filters', style: { marginRight: 'auto' }, onclick: async () => { view.filters = []; await saveDatabaseMeta(); modal.close(); renderDatabase(); } }),
      el('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn primary', text: 'Apply', onclick: async () => {
        view.filters = draft.filter(f => f.property && f.operator);
        await saveDatabaseMeta(); modal.close(); renderDatabase();
      }})
    )
  });
}

function openSortModal(anchor, view) {
  const draft = JSON.parse(JSON.stringify(view.sorts || []));
  const body = el('div');
  const render = () => {
    body.innerHTML = '';
    if (!draft.length) body.appendChild(el('div', { class: 'dialog-text', text: 'No sorts yet. Add one to order this view.' }));
    draft.forEach((s, i) => {
      const row = el('div', { class: 'filter-row' });
      const psel = el('select');
      for (const p of getProps()) { const o = el('option', { value: p.id, text: p.name }); if (p.id === s.property) o.selected = true; psel.appendChild(o); }
      psel.addEventListener('change', () => { s.property = psel.value; });
      const dir = el('select');
      const a = el('option', { value: 'asc', text: 'Ascending' }); if (s.direction === 'asc') a.selected = true;
      const d = el('option', { value: 'desc', text: 'Descending' }); if (s.direction === 'desc') d.selected = true;
      dir.appendChild(a); dir.appendChild(d);
      dir.addEventListener('change', () => s.direction = dir.value);
      const rm = el('button', { class: 'filter-remove', html: '<svg class="ic"><use href="#i-close"/></svg>' });
      rm.addEventListener('click', () => { draft.splice(i, 1); render(); });
      row.append(psel, dir, rm);
      body.appendChild(row);
    });
    const add = el('button', { class: 'filter-add', html: '<svg class="ic"><use href="#i-plus"/></svg><span>Add a sort</span>' });
    add.addEventListener('click', () => { draft.push({ property: getProps()[0]?.id, direction: 'asc' }); render(); });
    body.appendChild(add);
  };
  render();
  let modal;
  modal = openModal({
    title: 'Sort', width: 500, body,
    footer: el('div', { style: { display: 'flex', gap: '8px', width: '100%' } },
      el('button', { class: 'btn', text: 'Clear sorts', style: { marginRight: 'auto' }, onclick: async () => { view.sorts = []; await saveDatabaseMeta(); modal.close(); renderDatabase(); } }),
      el('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn primary', text: 'Apply', onclick: async () => {
        view.sorts = draft.filter(s => s.property); await saveDatabaseMeta(); modal.close(); renderDatabase();
      }})
    )
  });
}

/* ---------------- Properties management ---------------- */
function openPropertiesModal(anchor) {
  const draft = JSON.parse(JSON.stringify(getProps()));
  const body = el('div');
  const render = () => {
    body.innerHTML = '';
    const list = el('div', { class: 'prop-manage' });
    draft.forEach((p, i) => {
      const row = el('div', { class: 'prop-manage-row' });
      row.appendChild(el('span', { class: 'prop-manage-icon', html: `<svg class="ic"><use href="#i-${PROP_ICONS[p.type] || 'text'}"/></svg>` }));
      const name = el('input', { type: 'text', class: 'prop-name-input', value: p.name, disabled: p.type === 'title' });
      name.addEventListener('input', () => p.name = name.value);
      row.appendChild(name);
      const type = el('select', { class: 'prop-type-select', disabled: p.type === 'title' });
      for (const [v, label] of PROP_TYPES) { const o = el('option', { value: v, text: label }); if (v === p.type) o.selected = true; type.appendChild(o); }
      type.addEventListener('change', () => {
        p.type = type.value;
        if ((p.type === 'select' || p.type === 'status') && !Array.isArray(p.options)) p.options = [];
        render();
      });
      row.appendChild(type);
      if (p.type === 'select' || p.type === 'status') {
        const optsBtn = el('button', { class: 'btn small', text: 'Options', style: { height: '27px', fontSize: '11.5px' } });
        optsBtn.addEventListener('click', () => openOptionsEditor(p));
        row.appendChild(optsBtn);
      }
      const del = el('button', { class: 'icon-btn', title: p.type === 'title' ? 'Title cannot be deleted' : 'Delete property', disabled: p.type === 'title', html: '<svg class="ic"><use href="#i-trash"/></svg>' });
      del.addEventListener('click', () => { if (p.type === 'title') return; draft.splice(i, 1); render(); });
      row.appendChild(del);
      list.appendChild(row);
    });
    body.appendChild(list);
    const add = el('button', { class: 'btn', style: { marginTop: '10px' }, html: '<svg class="ic"><use href="#i-plus"/></svg><span>Add a property</span>' });
    add.addEventListener('click', () => { draft.push({ id: uid(), name: 'Property', type: 'text', options: [] }); render(); });
    body.appendChild(add);
  };
  render();
  let modal;
  modal = openModal({
    title: 'Properties', width: 620, body,
    footer: el('div', { style: { display: 'flex', gap: '8px' } },
      el('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn primary', text: 'Save', onclick: async () => {
        const cleaned = draft.filter(p => p.name.trim());
        if (!cleaned.some(p => p.type === 'title')) {
          cleaned.unshift({ id: 'title', name: 'Name', type: 'title' });
        }
        for (const p of cleaned) { p.name = p.name.trim() || 'Property'; if (p.type === 'select' || p.type === 'status') p.options = p.options || []; }
        DB.database.properties = cleaned;
        await saveDatabaseMeta(); modal.close(); renderDatabase();
      }})
    )
  });
}

function openOptionsEditor(prop) {
  const opts = JSON.parse(JSON.stringify(prop.options || []));
  const body = el('div');
  const render = () => {
    body.innerHTML = '';
    opts.forEach((o, i) => {
      const row = el('div', { class: 'filter-row' });
      const color = el('select', { style: { width: '100px' } });
      for (const c of OPTION_COLORS) { const op = el('option', { value: c, text: c }); if (c === o.color) op.selected = true; color.appendChild(op); }
      const name = el('input', { type: 'text', value: o.name, placeholder: 'Option name' });
      name.addEventListener('input', () => o.name = name.value);
      color.addEventListener('change', () => o.color = color.value);
      const rm = el('button', { class: 'filter-remove', html: '<svg class="ic"><use href="#i-close"/></svg>' });
      rm.addEventListener('click', () => { opts.splice(i, 1); render(); });
      row.append(color, name, rm);
      body.appendChild(row);
    });
    const add = el('button', { class: 'filter-add', html: '<svg class="ic"><use href="#i-plus"/></svg><span>Add an option</span>' });
    add.addEventListener('click', () => { opts.push({ id: uid(), name: 'Option', color: OPTION_COLORS[opts.length % OPTION_COLORS.length] }); render(); });
    body.appendChild(add);
  };
  render();
  let modal;
  modal = openModal({
    title: `Options for ${prop.name}`, width: 460, body,
    footer: el('div', { style: { display: 'flex', gap: '8px' } },
      el('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      el('button', { class: 'btn primary', text: 'Done', onclick: () => {
        prop.options = opts.filter(o => o.name.trim()).map(o => ({ ...o, name: o.name.trim() }));
        modal.close();
      }})
    )
  });
}

function openRowMenu(anchor, row) {
  showMenu({
    anchor, width: 225, items: [
      { icon: 'expand', label: 'Open page', action: () => DB.opts.openPage?.(row.pageId) },
      { icon: 'duplicate', label: 'Duplicate', action: () => createRow({ ...(row.values || {}), [titleProp().id]: `${rowTitle(row)} copy` }) },
      { icon: 'copy', label: 'Copy link', action: () => navigator.clipboard.writeText(`ideacraft://page/${row.pageId}`).then(() => toast('Page link copied', 'success')) },
      { type: 'sep' },
      { icon: 'trash', label: 'Move to trash', danger: true, action: async () => {
        if (!(await confirmDialog({ title: 'Move to trash?', message: `“${esc(rowTitle(row))}” will be moved to Trash.`, confirmText: 'Move to trash', danger: true }))) return;
        await invoke('delete_row', { rowId: row.id });
        row.trashed = true;
        DB.opts.onChange?.();
        renderBody();
      }},
    ]
  });
}

/* ---------------- Row page properties ---------------- */
export function mountRowProperties(root, detail, opts = {}) {
  if (!detail.row || !detail.database) return;
  const props = Array.isArray(detail.database.properties) ? detail.database.properties : [];
  const extra = props.filter(p => p.type !== 'title');
  if (!extra.length) return;
  const prevOpts = DB.opts;
  DB.opts = { ...prevOpts, ...opts };
  const panel = el('div', { class: 'row-props' });
  for (const prop of extra) {
    const rowEl = el('div', { class: 'row-prop' });
    rowEl.appendChild(el('div', { class: 'rp-name' },
      el('span', { class: 'rp-icon', html: `<svg class="ic"><use href="#i-${PROP_ICONS[prop.type] || 'text'}"/></svg>` }),
      el('span', { text: prop.name })
    ));
    const val = el('div', { class: 'rp-val' });
    val.appendChild(buildCell(prop, detail.row, { table: false }));
    rowEl.appendChild(val);
    panel.appendChild(rowEl);
  }
  root.appendChild(panel);
  setTimeout(() => { DB.opts = prevOpts; }, 0);
}

