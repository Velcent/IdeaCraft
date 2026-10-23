/* IdeaCraft – block editor */
import {
  S, $, $$, el, esc, sanitizeHtml, stripHtml, uid, debounce, invoke,
  pageIcon, pageTitle, EMOJIS,
} from './api.js';
import {
  showMenu, showPopover, toast, promptDialog, emojiPicker, colorPicker,
} from './ui.js';

export const BLOCK_TYPES = {
  paragraph: { name: 'Text', desc: 'Just start writing with plain text.', icon: 'text', placeholder: "Write something, or press '/' for commands…", group: 'Basic blocks' },
  heading1: { name: 'Heading 1', desc: 'Big section heading.', icon: 'heading', placeholder: 'Heading 1', group: 'Basic blocks' },
  heading2: { name: 'Heading 2', desc: 'Medium section heading.', icon: 'heading', placeholder: 'Heading 2', group: 'Basic blocks' },
  heading3: { name: 'Heading 3', desc: 'Small section heading.', icon: 'heading', placeholder: 'Heading 3', group: 'Basic blocks' },
  bulleted_list_item: { name: 'Bulleted list', desc: 'Create a simple bulleted list.', icon: 'bullet', placeholder: 'List item', group: 'Basic blocks' },
  numbered_list_item: { name: 'Numbered list', desc: 'Create a list with numbering.', icon: 'number', placeholder: 'List item', group: 'Basic blocks' },
  to_do: { name: 'To-do list', desc: 'Track tasks with a checkbox.', icon: 'todo', placeholder: 'To-do', group: 'Basic blocks' },
  toggle: { name: 'Toggle list', desc: 'Hide and show nested content.', icon: 'toggle', placeholder: 'Toggle', group: 'Basic blocks' },
  quote: { name: 'Quote', desc: 'Capture a quote.', icon: 'quote', placeholder: 'Empty quote', group: 'Basic blocks' },
  callout: { name: 'Callout', desc: 'Make writing stand out.', icon: 'callout', placeholder: 'Callout', group: 'Basic blocks' },
  divider: { name: 'Divider', desc: 'Visually divide blocks.', icon: 'divider', group: 'Basic blocks' },
  page_link: { name: 'Link to page', desc: 'Link to an existing page.', icon: 'page', group: 'Basic blocks' },
  image: { name: 'Image', desc: 'Upload or embed an image.', icon: 'image', group: 'Media' },
  bookmark: { name: 'Bookmark', desc: 'Save a link as a visual bookmark.', icon: 'bookmark', group: 'Media' },
  video: { name: 'Video', desc: 'Embed a video.', icon: 'video', group: 'Media' },
  code: { name: 'Code', desc: 'Capture a code snippet.', icon: 'code', group: 'Media' },
  table: { name: 'Table', desc: 'Add a simple table.', icon: 'table', group: 'Advanced' },
  equation: { name: 'Equation', desc: 'Write a math equation.', icon: 'hash', group: 'Advanced' },
};

const TEXT_TYPES = new Set(['paragraph', 'heading1', 'heading2', 'heading3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code', 'equation']);
const LIST_TYPES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);
const CODE_LANGS = ['javascript', 'typescript', 'python', 'rust', 'json', 'html', 'css', 'sql', 'bash', 'shell', 'powershell', 'markdown', 'plain text'];

export const ED = {
  root: null,
  page: null,
  blocks: [],
  opts: {},
  saveTimer: null,
  dirty: false,
  saving: false,
  slash: null,
  inlineToolbar: null,
  dragId: null,
  readOnly: false,
  lastRange: null,
  mounted: false,
  bound: false,
  lastSelectedBlock: null,
};

function normalizeBlock(b) {
  return {
    id: b.id || uid(),
    type: b.type || b.blockType || 'paragraph',
    html: b.html || '',
    text: b.text ?? stripHtml(b.html || ''),
    props: b.props && typeof b.props === 'object' ? { ...b.props } : {},
    parentId: b.parentId || null,
    position: b.position || 0,
  };
}

function blocksToInput() {
  return ED.blocks.map((b, i) => ({
    id: b.id,
    parentId: b.parentId || null,
    type: b.type,
    html: b.html || '',
    text: b.text || '',
    props: b.props || {},
    position: i + 1,
  }));
}

export function mountEditor(root, detail, opts = {}) {
  ED.root = root;
  ED.page = detail.page;
  ED.opts = opts;
  ED.readOnly = !!detail.page.locked;
  ED.blocks = (detail.blocks || []).map(normalizeBlock);
  ED.mounted = true;
  ED.dirty = false;
  if (!ED.blocks.length) {
    ED.blocks.push({ id: uid(), type: 'paragraph', html: '', text: '', props: {}, parentId: null, position: 1 });
  }
  bindEditorEvents();
  bindRootEvents(root);
  const scroll = root.closest('.page-scroll');
  if (scroll && !scroll.dataset.boundEditorScroll) {
    scroll.dataset.boundEditorScroll = '1';
    scroll.addEventListener('scroll', () => { hideInlineToolbar(); closeSlash(); }, { passive: true });
  }
  renderAll();
}

export function getEditorBlocks() { return ED.blocks; }
export function isEditorDirty() { return ED.dirty; }

export async function flushEditor(force = false) {
  if (!ED.page || !ED.mounted) return;
  if (!ED.dirty && !force) return;
  const pageId = ED.page.id;
  const blocks = blocksToInput();
  ED.dirty = false;
  ED.saving = true;
  ED.opts.onStatus?.('Saving…', 'saving');
  try {
    const page = await invoke('save_blocks', { pageId, blocks });
    ED.saving = false;
    ED.opts.onStatus?.('Saved', 'saved');
    ED.opts.onPageUpdate?.(page);
    setTimeout(() => { if (!ED.dirty) ED.opts.onStatus?.('', 'idle'); }, 1200);
  } catch (e) {
    ED.saving = false;
    ED.dirty = true;
    ED.opts.onStatus?.('Save failed', 'error');
    toast(`Could not save page: ${e}`, 'error', 4000);
  }
}

let saveDebounce = null;
function queueSave(immediate = false) {
  ED.dirty = true;
  ED.opts.onStatus?.('Saving…', 'saving');
  clearTimeout(saveDebounce);
  if (immediate) { flushEditor(true); return; }
  saveDebounce = setTimeout(() => flushEditor(true), 600);
}

export function destroyEditor() {
  if (!ED.mounted) return;
  clearTimeout(saveDebounce);
  if (ED.dirty) flushEditor(true);
  hideInlineToolbar();
  closeSlash();
  ED.mounted = false;
  ED.root = null;
  ED.page = null;
  ED.blocks = [];
  ED.dragId = null;
}

function childrenOfLocal(parentId, list = ED.blocks) {
  return list.filter(b => (b.parentId || null) === (parentId || null));
}

function rootBlocks() {
  const ids = new Set(ED.blocks.map(b => b.id));
  return ED.blocks.filter(b => !b.parentId || !ids.has(b.parentId));
}

function blockById(id) { return ED.blocks.find(b => b.id === id); }

function renderAll(focus = null, caret = 'end') {
  if (!ED.root) return;
  const scroll = ED.root.closest('.page-scroll');
  const scrollTop = scroll?.scrollTop;
  ED.root.innerHTML = '';
  const roots = rootBlocks();
  const childMap = new Map();
  for (const b of ED.blocks) {
    const key = b.parentId || '__root__';
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key).push(b);
  }
  const renderList = (list, parentEl, depth) => {
    let num = 0;
    let prevType = null;
    for (const b of list) {
      if (b.type === 'numbered_list_item') {
        if (prevType !== 'numbered_list_item') num = 1; else num += 1;
      } else { num = 0; }
      prevType = b.type;
      const node = renderBlock(b, depth, b.type === 'numbered_list_item' ? num : null);
      parentEl.appendChild(node);
      const kids = childMap.get(b.id) || [];
      const kidsWrap = node.querySelector(':scope > .block-content > .block-children');
      if (kidsWrap && kids.length) renderList(kids, kidsWrap, depth + 1);
    }
  };
  renderList(roots, ED.root, 0);
  const end = el('div', { class: 'blocks-end', style: { minHeight: '68px', cursor: 'text' } });
  ED.root.appendChild(end);
  const hasText = ED.blocks.some(b => (b.text || '').trim() || ['image','table','bookmark','video','divider'].includes(b.type));
  if (!hasText) {
    ED.root.appendChild(el('div', { class: 'empty-hint' },
      el('span', { html: 'Type <kbd>/</kbd> for commands · <kbd>@</kbd> to link a page' })
    ));
  }
  if (scroll && scrollTop !== undefined) scroll.scrollTop = scrollTop;
  if (focus) focusBlock(focus, caret);
  updateWordCount();
}

function updateWordCount() {
  if (!ED.opts.onWords) return;
  const words = ED.blocks.reduce((n, b) => n + (b.type === 'divider' || b.type === 'table' || b.type === 'image' ? 0 : (b.text || '').trim().split(/\s+/).filter(Boolean).length), 0);
  ED.opts.onWords(words);
}

function markerFor(block, number) {
  if (block.type === 'bulleted_list_item') {
    return `<div class="list-marker"><span class="bullet"></span></div>`;
  }
  if (block.type === 'numbered_list_item') {
    return `<div class="list-marker"><span class="num">${number || 1}.</span></div>`;
  }
  if (block.type === 'to_do') {
    return `<div class="list-marker"><button class="checkbox" data-check="${block.id}" aria-label="Toggle to-do">${block.props.checked ? '<svg class="ic"><use href="#i-check"/></svg>' : ''}</button></div>`;
  }
  return '';
}

function contentEditableAttrs(block) {
  if (ED.readOnly) return { contenteditable: 'false' };
  return { contenteditable: 'true', spellcheck: 'true' };
}

function renderBlock(block, depth, number) {
  const meta = BLOCK_TYPES[block.type] || BLOCK_TYPES.paragraph;
  const wrap = el('div', {
    class: `block ${block.type} ${block.props.collapsed ? 'collapsed' : ''} ${block.props.checked ? 'checked' : ''} ${block.props.color && !['default', undefined].includes(block.props.color) ? `tx-${block.props.color}` : ''}`,
    dataset: { id: block.id, type: block.type },
  });
  if (block.type !== 'toggle' && block.type !== 'page_link') {
    // handles are inserted for every block
  }
  if (!ED.readOnly) {
    const handles = el('div', { class: 'block-handles', contenteditable: 'false' },
      el('button', { class: 'block-handle-btn add', title: 'Click to add below', html: '<svg class="ic"><use href="#i-plus"/></svg>' }),
      el('button', { class: 'block-handle-btn grip', title: 'Drag to move, click to open menu', draggable: 'true', html: '<svg class="ic"><use href="#i-grip"/></svg>' })
    );
    wrap.appendChild(handles);
  }
  wrap.insertAdjacentHTML('beforeend', markerFor(block, number));
  const content = el('div', { class: 'block-content' });
  const innerAttrs = contentEditableAttrs(block);

  if (block.type === 'divider') {
    content.appendChild(el('div', { class: 'divider-line' }));
  } else if (block.type === 'page_link') {
    const target = S.pageMap.get(block.props.pageId);
    content.appendChild(el('div', { class: 'page-link', onclick: () => { if (target) ED.opts.openPage?.(target.id); } },
      el('span', { class: 'page-link-icon', html: target ? pageIcon(target) : '<svg class="ic"><use href="#i-file"/></svg>' }),
      el('span', { class: 'page-link-title', text: target ? pageTitle(target) : (block.props.title || 'Untitled') })
    ));
  } else if (block.type === 'callout') {
    const box = el('div', { class: `callout-box ${block.props.color || 'default'}` });
    box.appendChild(el('span', { class: 'callout-icon', text: block.props.icon || '💡', title: 'Change icon' }));
    const inner = el('div', {
      class: 'block-inner', ...innerAttrs,
      'data-placeholder': 'Add a callout…', html: sanitizeHtml(block.html),
    });
    box.appendChild(inner);
    content.appendChild(box);
  } else if (block.type === 'code') {
    const code = el('div', { class: 'code-wrap' });
    const sel = el('select', { class: 'code-lang', title: 'Language' });
    for (const lang of CODE_LANGS) {
      const opt = el('option', { value: lang, text: lang });
      if ((block.props.language || 'plain text') === lang) opt.selected = true;
      sel.appendChild(opt);
    }
    const inner = el('div', { class: 'block-inner', ...innerAttrs, 'data-placeholder': 'Code', spellcheck: 'false' });
    inner.textContent = block.text || '';
    code.appendChild(sel);
    code.appendChild(inner);
    content.appendChild(code);
  } else if (block.type === 'image') {
    const wrapImg = el('div', { class: 'image-wrap' });
    if (block.props.src) {
      wrapImg.appendChild(el('img', { src: block.props.src, alt: block.props.alt || '', draggable: 'false' }));
      if (!ED.readOnly) {
        const caption = el('div', { class: 'image-caption', contenteditable: 'true', 'data-placeholder': 'Write a caption…' });
        caption.textContent = block.props.caption || '';
        caption.addEventListener('input', () => { block.props.caption = caption.innerText; ED.dirty = true; queueSave(); });
        wrapImg.appendChild(caption);
      } else if (block.props.caption) {
        wrapImg.appendChild(el('div', { class: 'image-caption', text: block.props.caption }));
      }
    } else {
      wrapImg.appendChild(el('button', {
        class: 'image-empty', onclick: () => pickImageFor(block),
        style: { width: '100%', minHeight: '140px', border: '1px dashed var(--border-strong)', borderRadius: '6px', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' },
        html: '<svg class="ic"><use href="#i-image"/></svg><span>Add an image</span>'
      }));
    }
    content.appendChild(wrapImg);
  } else if (block.type === 'table') {
    content.appendChild(renderTable(block));
  } else if (block.type === 'bookmark') {
    const url = block.props.url || '';
    const card = el('a', { class: 'bookmark-card', href: url || '#', onclick: (e) => { if (!url) { e.preventDefault(); promptBookmark(block); } } });
    card.appendChild(el('div', { class: 'bookmark-info' },
      el('div', { class: 'bookmark-title', text: block.props.title || url || 'Bookmark' }),
      el('div', { class: 'bookmark-url', text: url || 'Click to add a link' })
    ));
    card.appendChild(el('div', { class: 'bookmark-thumb', html: '<svg class="ic" style="width:22px;height:22px"><use href="#i-bookmark"/></svg>' }));
    if (!url) card.addEventListener('click', e => { e.preventDefault(); promptBookmark(block); });
    content.appendChild(card);
  } else if (block.type === 'video') {
    content.appendChild(el('div', { class: 'video-embed' },
      el('div', { style: { textAlign: 'center' }, html: `<svg class="ic" style="width:30px;height:30px;margin-bottom:6px"><use href="#i-video"/></svg><div>${block.props.url ? esc(block.props.url) : 'Add a video link'}</div>` })
    ));
    if (!block.props.url) content.querySelector('.video-embed').addEventListener('click', async () => {
      const url = await promptDialog({ title: 'Embed a video', label: 'Video URL', placeholder: 'https://…' });
      if (url) { block.props.url = url; block.props.title = url; queueSave(true); renderAll(block.id); }
    });
  } else if (block.type === 'equation') {
    const inner = el('div', { class: 'block-inner', ...innerAttrs, 'data-placeholder': 'E = mc²' });
    inner.textContent = block.text || '';
    content.appendChild(inner);
  } else {
    const tag = block.type === 'heading1' ? 'h1' : block.type === 'heading2' ? 'h2' : block.type === 'heading3' ? 'h3' : 'div';
    const inner = el(tag, {
      class: 'block-inner', ...innerAttrs, 'data-placeholder': meta.placeholder || "Write something…",
      html: sanitizeHtml(block.html),
    });
    if (block.type === 'toggle') {
      const arrow = el('button', { class: 'toggle-arrow', contenteditable: 'false', html: '<svg class="ic"><use href="#i-chevron-down"/></svg>' });
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        block.props.collapsed = !block.props.collapsed;
        wrap.classList.toggle('collapsed', !!block.props.collapsed);
        queueSave();
      });
      content.appendChild(arrow);
    }
    content.appendChild(inner);
  }

  if (block.type !== 'divider' && block.type !== 'image' && block.type !== 'table' && block.type !== 'bookmark' && block.type !== 'video' && block.type !== 'page_link') {
    const kidsWrap = el('div', { class: 'block-children' });
    content.appendChild(kidsWrap);
  } else {
    const kidsWrap = el('div', { class: 'block-children' });
    content.appendChild(kidsWrap);
  }
  wrap.appendChild(content);
  return wrap;
}

function renderTable(block) {
  const rows = Array.isArray(block.props.rows) && block.props.rows.length
    ? block.props.rows.map(r => Array.isArray(r) ? r.slice() : [String(r ?? '')])
    : [['Column 1', 'Column 2', 'Column 3'], ['', '', '']];
  const cols = Math.max(...rows.map(r => r.length), 1);
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  const header = el('thead');
  const hr = el('tr');
  for (let c = 0; c < cols; c++) {
    hr.appendChild(el('th', { contenteditable: ED.readOnly ? 'false' : 'true', dataset: { r: 0, c }, text: rows[0]?.[c] || '' }));
  }
  header.appendChild(hr);
  table.appendChild(header);
  const tbody = el('tbody');
  for (let r = 1; r < rows.length; r++) {
    const tr = el('tr');
    for (let c = 0; c < cols; c++) {
      tr.appendChild(el('td', { contenteditable: ED.readOnly ? 'false' : 'true', dataset: { r, c }, text: rows[r]?.[c] || '' }));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  if (!ED.readOnly) {
    const tools = el('div', { class: 'table-tools' },
      el('button', { class: 'table-tool', text: '+ Row', onclick: () => { rows.push(new Array(cols).fill('')); block.props.rows = rows; queueSave(true); renderAll(block.id); } }),
      el('button', { class: 'table-tool', text: '+ Column', onclick: () => { rows.forEach((r, i) => r.push('')); block.props.rows = rows; queueSave(true); renderAll(block.id); } }),
      el('button', { class: 'table-tool', text: 'Delete table', onclick: () => deleteBlockById(block.id) })
    );
    wrap.appendChild(tools);
  }
  return wrap;
}

function focusBlock(id, pos = 'end') {
  const node = ED.root?.querySelector(`.block[data-id="${id}"] > .block-content .block-inner`);
  if (!node) return;
  node.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  if (pos === 'start') range.collapse(true);
  else if (typeof pos === 'number') {
    let remaining = pos;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let target = null, offset = 0;
    while (walker.nextNode()) {
      const len = walker.currentNode.textContent.length;
      if (remaining <= len) { target = walker.currentNode; offset = remaining; break; }
      remaining -= len;
    }
    if (target) range.setStart(target, offset); else range.collapse(false);
  } else range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  ED.lastSelectedBlock = id;
}

export function focusEditorBlock(id, pos) { focusBlock(id, pos); }

/* ---------------- Save/state helpers ---------------- */
function updateBlockFromEl(block, inner) {
  if (block.type === 'code' || block.type === 'equation') {
    block.text = inner.innerText;
    block.html = esc(block.text);
  } else if (block.type === 'callout') {
    block.html = inner.innerHTML;
    block.text = inner.innerText;
  } else if (block.type !== 'table' && block.type !== 'image' && block.type !== 'bookmark' && block.type !== 'video' && block.type !== 'page_link' && block.type !== 'divider') {
    block.html = inner.innerHTML;
    block.text = inner.innerText;
  }
}

function onInput(e) {
  const cell = e.target.closest?.('th[contenteditable], td[contenteditable]');
  if (cell) {
    const block = blockById(cell.closest('.block')?.dataset.id);
    if (block && block.type === 'table') {
      const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
      block.props.rows = block.props.rows || [];
      block.props.rows[r] = block.props.rows[r] || [];
      block.props.rows[r][c] = cell.innerText;
      queueSave();
    }
    return;
  }
  const inner = e.target.closest('.block-inner');
  if (!inner) return;
  const blockEl = inner.closest('.block');
  const block = blockById(blockEl?.dataset.id);
  if (!block) return;
  updateBlockFromEl(block, inner);
  queueSave();
  updateWordCount();
  if (ED.slash) updateSlashQuery();
  else maybeOpenSlash(inner, block);
  updateInlineToolbar();
}

function addBlockAfter(id, type = 'paragraph', content = '') {
  const idx = ED.blocks.findIndex(b => b.id === id);
  const current = ED.blocks[idx];
  const block = {
    id: uid(), type, html: content ? esc(content) : '', text: content || '',
    props: type === 'to_do' ? { checked: false } : {}, parentId: current?.parentId || null, position: idx + 2,
  };
  ED.blocks.splice(idx + 1, 0, block);
  queueSave();
  renderAll(block.id);
  return block;
}

function appendParagraph() {
  const last = ED.blocks[ED.blocks.length - 1];
  if (last && last.type === 'paragraph' && !last.text.trim()) { focusBlock(last.id); return; }
  const block = { id: uid(), type: 'paragraph', html: '', text: '', props: {}, parentId: null, position: ED.blocks.length + 1 };
  ED.blocks.push(block);
  renderAll(block.id);
}

function deleteBlockById(id) {
  const idx = ED.blocks.findIndex(b => b.id === id);
  if (idx < 0) return;
  const block = ED.blocks[idx];
  const childIds = new Set(ED.blocks.filter(b => b.parentId === id).map(b => b.id));
  ED.blocks.splice(idx, 1);
  for (let i = ED.blocks.length - 1; i >= 0; i--) {
    if (ED.blocks[i].parentId === id) ED.blocks[i].parentId = block.parentId;
  }
  if (!ED.blocks.length) ED.blocks.push({ id: uid(), type: 'paragraph', html: '', text: '', props: {}, parentId: null, position: 1 });
  queueSave(true);
  const focusIdx = Math.min(idx, ED.blocks.length - 1);
  renderAll(ED.blocks[focusIdx].id, 'end');
}

function duplicateBlock(id) {
  const idx = ED.blocks.findIndex(b => b.id === id);
  if (idx < 0) return;
  const src = ED.blocks[idx];
  const copy = { ...src, id: uid(), props: JSON.parse(JSON.stringify(src.props || {})), parentId: src.parentId };
  ED.blocks.splice(idx + 1, 0, copy);
  queueSave(true);
  renderAll(copy.id);
}

function indentBlock(id) {
  const idx = ED.blocks.findIndex(b => b.id === id);
  if (idx <= 0) return;
  const prev = ED.blocks[idx - 1];
  const block = ED.blocks[idx];
  // only indent under previous when it is a toggle or when previous is at same level
  block.parentId = prev.id;
  queueSave();
  renderAll(block.id);
}

function outdentBlock(id) {
  const block = blockById(id);
  if (!block || !block.parentId) return;
  const parent = blockById(block.parentId);
  const grand = parent?.parentId || null;
  const idx = ED.blocks.findIndex(b => b.id === id);
  ED.blocks.splice(idx, 1);
  const parentIdx = ED.blocks.findIndex(b => b.id === parent?.id);
  let insertAt = parentIdx >= 0 ? parentIdx + 1 : ED.blocks.length;
  // place after last sibling subtree of parent
  while (insertAt < ED.blocks.length) {
    const b = ED.blocks[insertAt];
    if (b.parentId === parent?.id) insertAt++; else break;
  }
  block.parentId = grand;
  ED.blocks.splice(insertAt, 0, block);
  queueSave();
  renderAll(block.id);
}

function convertBlock(id, type, extraProps = {}) {
  const block = blockById(id);
  if (!block) return;
  const previous = block.type;
  block.type = type;
  block.props = { ...(block.props || {}), ...extraProps };
  if (type === 'to_do' && block.props.checked === undefined) block.props.checked = false;
  if (type === 'toggle' && block.props.collapsed === undefined) block.props.collapsed = false;
  if (type === 'callout') {
    if (!block.props.icon) block.props.icon = '💡';
    if (!block.props.color) block.props.color = 'default';
  }
  if (type === 'code') {
    block.text = stripHtml(block.html || block.text || '');
    block.html = esc(block.text);
    if (!block.props.language) block.props.language = 'javascript';
  }
  if (type === 'table' && !block.props.rows) block.props.rows = [['Column 1', 'Column 2', 'Column 3'], ['', '', '']];
  if (type === 'divider') { block.text = ''; block.html = ''; }
  if (type === 'heading1' || type === 'heading2' || type === 'heading3' || type === 'quote' || type === 'paragraph') {
    // keep rich content
  }
  queueSave(true);
  renderAll(block.id);
}

/* ---------------- Bindings (part 2) ---------------- */
function bindEditorEvents() {
  if (ED.bound) return;
  ED.bound = true;
  document.addEventListener('selectionchange', onSelectionChange);
}

function onSelectionChange() {
  if (!ED.mounted || !ED.root) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideInlineToolbar(); return; }
  const range = sel.getRangeAt(0);
  if (!ED.root.contains(range.commonAncestorContainer)) {
    if (!range.commonAncestorContainer?.parentElement?.closest?.('.inline-toolbar')) hideInlineToolbar();
    return;
  }
  const blockEl = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer.closest('.block')
    : range.commonAncestorContainer.parentElement?.closest('.block');
  if (blockEl) ED.lastSelectedBlock = blockEl.dataset.id;
  if (sel.isCollapsed) {
    hideInlineToolbar();
    if (ED.slash) updateSlashQuery();
    return;
  }
  setTimeout(() => {
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    if (!ED.root?.contains(r.commonAncestorContainer)) return;
    const rect = r.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    ED.lastRange = r.cloneRange();
    showInlineToolbar(rect);
  }, 30);
}

function hideInlineToolbar() {
  if (ED.inlineToolbar) { ED.inlineToolbar.remove(); ED.inlineToolbar = null; }
}

function showInlineToolbar(rect) {
  hideInlineToolbar();
  const bar = el('div', { class: 'inline-toolbar', contenteditable: 'false' });
  const blockEl = (window.getSelection().anchorNode?.nodeType === 1 ? window.getSelection().anchorNode : window.getSelection().anchorNode?.parentElement)?.closest?.('.block');
  const block = blockEl ? blockById(blockEl.dataset.id) : null;

  const btn = (icon, title, action, active = false, wide = false, label = '') => {
    const b = el('button', { class: `it-btn ${wide ? 'wide' : ''} ${active ? 'active' : ''}`, title, html: `${icon.startsWith('<') ? icon : `<svg class="ic"><use href="#i-${icon}"/></svg>`}${label ? `<span>${esc(label)}</span>` : ''}` });
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); action(); updateInlineToolbar(); });
    return b;
  };

  const turn = el('button', { class: 'it-select', title: 'Turn into' });
  turn.textContent = block ? ((BLOCK_TYPES[block.type]?.name || 'Text') + ' ▾') : 'Turn into ▾';
  turn.addEventListener('mousedown', e => e.preventDefault());
  turn.addEventListener('click', (e) => {
    e.preventDefault();
    const items = ['paragraph', 'heading1', 'heading2', 'heading3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code'].map(t => ({
      icon: BLOCK_TYPES[t].icon, label: BLOCK_TYPES[t].name,
      action: () => { if (block) convertBlock(block.id, t); },
    }));
    showMenu({ items, anchor: turn, width: 220 });
  });
  bar.appendChild(turn);
  bar.appendChild(el('div', { class: 'it-sep' }));
  bar.appendChild(btn('bold', 'Bold  Ctrl+B', () => document.execCommand('bold')));
  bar.appendChild(btn('italic', 'Italic  Ctrl+I', () => document.execCommand('italic')));
  bar.appendChild(btn('underline', 'Underline  Ctrl+U', () => document.execCommand('underline')));
  bar.appendChild(btn('strike', 'Strikethrough  Ctrl+Shift+S', () => document.execCommand('strikeThrough')));
  bar.appendChild(btn('code', 'Code  Ctrl+E', () => wrapSelection('code')));
  bar.appendChild(el('div', { class: 'it-sep' }));
  bar.appendChild(btn('link', 'Link  Ctrl+K', () => addLinkToSelection()));
  bar.appendChild(btn('comment', 'Comment', () => {
    const text = window.getSelection().toString();
    ED.opts.openComments?.(block?.id, text);
  }));
  const colorBtn = el('button', { class: 'it-btn', title: 'Text color', html: '<span style="font-weight:600;font-size:13px;border-bottom:2px solid currentColor;line-height:1">A</span>' });
  colorBtn.addEventListener('mousedown', e => e.preventDefault());
  colorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const colors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
    colorPicker(colorBtn, { colors, current: 'default', onPick: (c) => applyTextColor(c) });
  });
  bar.appendChild(colorBtn);
  bar.appendChild(btn('more', 'More', () => {
    showMenu({
      anchor: bar, align: 'right', width: 220, items: [
        { icon: 'copy', label: 'Copy text', action: () => navigator.clipboard.writeText(window.getSelection().toString()) },
        { icon: 'comment', label: 'Add comment', action: () => ED.opts.openComments?.(block?.id, window.getSelection().toString()) },
        { type: 'sep' },
        { icon: 'duplicate', label: 'Duplicate block', hint: 'Ctrl+D', action: () => block && duplicateBlock(block.id) },
        { icon: 'trash', label: 'Delete block', danger: true, action: () => block && deleteBlockById(block.id) },
      ]
    });
  }));

  document.body.appendChild(bar);
  ED.inlineToolbar = bar;
  const top = rect.top - 9;
  const below = top < 55;
  bar.style.left = `${Math.max(140, Math.min(window.innerWidth - 140, rect.left + rect.width / 2))}px`;
  bar.style.top = `${below ? rect.bottom + 9 : top}px`;
  if (below) bar.style.transform = 'translate(-50%, 0)';
}

function updateInlineToolbar() {
  // Toolbar rebuild is unnecessary on every keystroke; refresh active states.
  if (!ED.inlineToolbar) return;
}

function wrapSelection(tag) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const node = document.createElement(tag);
  try {
    range.surroundContents(node);
  } catch {
    node.appendChild(range.extractContents());
    range.insertNode(node);
  }
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(node);
  sel.addRange(r);
  ED.root.querySelector('.block[data-id]:focus-within')?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const blockEl = node.closest('.block');
  if (blockEl) {
    const b = blockById(blockEl.dataset.id);
    const inner = node.closest('.block-inner');
    if (b && inner) { b.html = inner.innerHTML; b.text = inner.innerText; queueSave(); }
  }
}

function applyTextColor(c) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  if (c !== 'default') span.className = `tx-${c}`;
  try { range.surroundContents(span); } catch {
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  sel.removeAllRanges();
  const r = document.createRange(); r.selectNodeContents(span); sel.addRange(r);
  const blockEl = span.closest('.block');
  if (blockEl) {
    const b = blockById(blockEl.dataset.id);
    const inner = span.closest('.block-inner');
    if (b && inner) { b.html = inner.innerHTML; b.text = inner.innerText; queueSave(); }
  }
}

async function addLinkToSelection() {
  const sel = window.getSelection();
  const text = sel.toString();
  const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const url = await promptDialog({ title: 'Add a link', label: text ? `Link for “${text.slice(0, 40)}”` : 'URL', placeholder: 'https://example.com', confirmText: 'Add link' });
  if (!url) return;
  if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
  if (text) {
    document.execCommand('createLink', false, url);
    const a = ED.root?.querySelector('a[href]');
    if (a) { a.target = '_blank'; a.rel = 'noreferrer'; }
  } else {
    document.execCommand('insertHTML', false, `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`);
  }
}

/* ---------------- Root event bindings ---------------- */
const boundRoots = new WeakSet();

function bindRootEvents(root) {
  if (!root || boundRoots.has(root)) return;
  boundRoots.add(root);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('paste', onPaste);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragend', onDragEnd);
  root.addEventListener('focusin', (e) => {
    const blockEl = e.target.closest?.('.block');
    if (blockEl) ED.lastSelectedBlock = blockEl.dataset.id;
  });
}

const _unusedMountEditor = null;

function onClick(e) {
  if (!ED.root) return;
  const checkbox = e.target.closest('.checkbox');
  if (checkbox) {
    e.preventDefault();
    const block = blockById(checkbox.dataset.check);
    if (!block) return;
    block.props.checked = !block.props.checked;
    queueSave();
    const blockEl = checkbox.closest('.block');
    blockEl.classList.toggle('checked', !!block.props.checked);
    checkbox.innerHTML = block.props.checked ? '<svg class="ic"><use href="#i-check"/></svg>' : '';
    return;
  }
  const calloutIcon = e.target.closest('.callout-icon');
  if (calloutIcon) {
    const block = blockById(calloutIcon.closest('.block').dataset.id);
    emojiPicker(calloutIcon, (emoji) => {
      block.props.icon = emoji;
      queueSave();
      renderAll(block.id);
    }, { allowRemove: false });
    return;
  }
  const addBtn = e.target.closest('.block-handle-btn.add');
  if (addBtn) {
    e.preventDefault();
    const blockEl = addBtn.closest('.block');
    openAddMenu(blockEl.dataset.id, addBtn);
    return;
  }
  const grip = e.target.closest('.block-handle-btn.grip');
  if (grip) {
    e.preventDefault();
    if (ED.justDragged) { ED.justDragged = false; return; }
    const blockEl = grip.closest('.block');
    openBlockMenu(blockEl.dataset.id, grip);
    return;
  }
  if (e.target.closest('.blocks-end')) {
    appendParagraph();
    return;
  }
  if (e.target === ED.root) {
    const blocks = $$('.block', ED.root);
    if (blocks.length) focusBlock(blocks[blocks.length - 1].dataset.id);
    return;
  }
  const link = e.target.closest('a[href]');
  if (link) {
    e.preventDefault();
    const href = link.getAttribute('href');
    if (href?.startsWith('http') || href?.startsWith('mailto:')) invoke('open_url', { url: href }).catch(err => toast(String(err), 'error'));
  }
  const cell = e.target.closest('th[contenteditable], td[contenteditable]');
  if (cell) {
    const block = blockById(cell.closest('.block')?.dataset.id);
    if (block && block.type === 'table') {
      // keep table data in sync on click/blur via input handler below
    }
  }
}

function onContextMenu(e) {
  const blockEl = e.target.closest('.block');
  if (!blockEl || e.target.closest('.inline-toolbar')) return;
  e.preventDefault();
  openBlockMenu(blockEl.dataset.id, null, e.clientX, e.clientY);
}

/* ---------------- Keyboard ---------------- */
function onKeyDown(e) {
  if (!ED.root) return;
  if (ED.slash) {
    if (handleSlashKey(e)) return;
  }
  const cell = e.target.closest('th[contenteditable], td[contenteditable]');
  if (cell) { handleTableKey(e, cell); return; }
  const inner = e.target.closest('.block-inner');
  if (!inner) return;
  const blockEl = inner.closest('.block');
  const block = blockById(blockEl.dataset.id);
  if (!block) return;
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Enter' && !e.shiftKey) {
    if (block.type === 'code') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
    e.preventDefault();
    if (inner.innerText.trim() === '---') {
      block.type = 'divider'; block.text = ''; block.html = '';
      const next = { id: uid(), type: 'paragraph', html: '', text: '', props: {}, parentId: block.parentId, position: 0 };
      const idx = ED.blocks.findIndex(b => b.id === block.id);
      ED.blocks.splice(idx + 1, 0, next);
      queueSave(true);
      renderAll(next.id);
      return;
    }
    const empty = !inner.innerText.trim();
    if (empty && LIST_TYPES.has(block.type)) {
      block.type = 'paragraph';
      block.props = {};
      ED.dirty = true;
      queueSave();
      renderAll(block.id);
      return;
    }
    if (empty && block.type === 'toggle') {
      block.type = 'paragraph';
      block.props = {};
      queueSave();
      renderAll(block.id);
      return;
    }
    splitBlock(block, inner);
    return;
  }

  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    document.execCommand('insertLineBreak');
    return;
  }

  if (e.key === 'Backspace') {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    const offset = getCaretOffset(inner);
    if (offset !== 0) return;
    const idx = ED.blocks.findIndex(b => b.id === block.id);
    if (block.parentId) {
      e.preventDefault();
      outdentBlock(block.id);
      return;
    }
    if (idx <= 0) return;
    e.preventDefault();
    const prev = ED.blocks[idx - 1];
    if (!TEXT_TYPES.has(prev.type)) {
      if (inner.innerText === '') deleteBlockById(block.id);
      return;
    }
    const prevInner = ED.root.querySelector(`.block[data-id="${prev.id}"] .block-inner`);
    if (!prevInner) return;
    const prevLen = prevInner.innerText.length;
    prevInner.innerHTML += inner.innerHTML;
    prev.html = prevInner.innerHTML;
    prev.text = prevInner.innerText;
    ED.blocks.splice(idx, 1);
    for (const b of ED.blocks) if (b.parentId === block.id) b.parentId = prev.id;
    queueSave(true);
    renderAll(prev.id, prevLen);
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) outdentBlock(block.id);
    else indentBlock(block.id);
    return;
  }

  if (e.key === 'ArrowUp' && !e.shiftKey) {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    if (!isCaretOnFirstLine(inner)) return;
    if (getCaretOffset(inner) > 0 && inner.innerText.includes('\n')) return;
    e.preventDefault();
    moveFocus(inner, -1, 'end');
    return;
  }
  if (e.key === 'ArrowDown' && !e.shiftKey) {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    if (!isCaretOnLastLine(inner)) return;
    if (inner.innerText.includes('\n') && getCaretOffset(inner) < inner.innerText.length) return;
    e.preventDefault();
    moveFocus(inner, 1, 'start');
    return;
  }

  if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateBlock(block.id);
    return;
  }

  if (mod && e.shiftKey && e.key === '0') {
    e.preventDefault();
    convertBlock(block.id, 'paragraph');
    return;
  }
  if (mod && e.altKey && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault();
    convertBlock(block.id, ['heading1', 'heading2', 'heading3'][Number(e.key) - 1]);
    return;
  }
  if (mod && e.shiftKey && ['7', '8', '9'].includes(e.key)) {
    e.preventDefault();
    const type = { '7': 'numbered_list_item', '8': 'bulleted_list_item', '9': 'to_do' }[e.key];
    convertBlock(block.id, type);
    return;
  }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    wrapSelection('code');
    return;
  }

  if (e.key === ' ' && !e.shiftKey) {
    const text = inner.innerText;
    const offset = getCaretOffset(inner);
    if (offset === text.length) {
      const map = {
        '#': 'heading1', '##': 'heading2', '###': 'heading3',
        '-': 'bulleted_list_item', '*': 'bulleted_list_item',
        '1.': 'numbered_list_item', '[]': 'to_do', '[ ]': 'to_do',
        '>': 'quote',
      };
      const type = map[text.trim()];
      if (type) {
        e.preventDefault();
        block.type = type;
        block.html = ''; block.text = '';
        if (type === 'to_do') block.props = { checked: false };
        queueSave();
        renderAll(block.id);
        return;
      }
      if (text === '```') {
        e.preventDefault();
        block.type = 'code';
        block.html = ''; block.text = '';
        block.props = { language: 'javascript' };
        queueSave();
        renderAll(block.id);
        return;
      }
    }
  }

  if (e.key === 'Escape') {
    hideInlineToolbar();
    e.target.blur?.();
  }
}

function handleTableKey(e, cell) {
  if (e.key === 'Tab') {
    const table = cell.closest('table');
    const cells = Array.from(table.querySelectorAll('th[contenteditable], td[contenteditable]'));
    const idx = cells.indexOf(cell);
    e.preventDefault();
    if (e.shiftKey) {
      if (idx > 0) cells[idx - 1].focus();
      return;
    }
    if (idx < cells.length - 1) cells[idx + 1].focus();
    else {
      const block = blockById(table.closest('.block').dataset.id);
      const rows = block.props.rows || [['']];
      rows.push(new Array(rows[0].length).fill(''));
      block.props.rows = rows;
      queueSave(true);
      renderAll(block.id);
      setTimeout(() => {
        const newCells = Array.from(ED.root.querySelectorAll(`.block[data-id="${block.id}"] td[contenteditable], .block[data-id="${block.id}"] th[contenteditable]`));
        newCells[newCells.length - rows[0].length]?.focus();
      }, 20);
    }
    return;
  }
  if (e.key === 'Enter') {
    const table = cell.closest('table');
    const cells = Array.from(table.querySelectorAll('th[contenteditable], td[contenteditable]'));
    const idx = cells.indexOf(cell);
    const cols = table.querySelector('tr')?.children.length || 1;
    e.preventDefault();
    const target = cells[idx + cols];
    if (target) target.focus();
    else cell.blur();
    return;
  }
  if (e.key === 'Escape') { cell.blur(); e.preventDefault(); }
}

function splitBlock(block, inner) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) range.deleteContents();
  const after = range.cloneRange();
  after.selectNodeContents(inner);
  after.setStart(range.endContainer, range.endOffset);
  const frag = after.extractContents();
  const temp = document.createElement('div');
  temp.appendChild(frag);
  block.html = inner.innerHTML;
  block.text = inner.innerText;
  let newType = 'paragraph';
  if (LIST_TYPES.has(block.type)) newType = block.type;
  if (block.type === 'toggle') newType = 'paragraph';
  const newBlock = {
    id: uid(),
    type: newType,
    html: temp.innerHTML,
    text: temp.innerText,
    props: newType === 'to_do' ? { checked: false } : {},
    parentId: block.parentId,
    position: 0,
  };
  const idx = ED.blocks.findIndex(b => b.id === block.id);
  ED.blocks.splice(idx + 1, 0, newBlock);
  queueSave();
  renderAll(newBlock.id, 'start');
}

function getCaretOffset(inner) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  try {
    range.selectNodeContents(inner);
    range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return range.toString().length;
  } catch { return 0; }
}

function isCaretOnFirstLine(inner) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0).cloneRange();
  const rects = range.getClientRects();
  const rect = rects[0] || range.getBoundingClientRect();
  const box = inner.getBoundingClientRect();
  return !rect || rect.top - box.top < 8;
}

function isCaretOnLastLine(inner) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0).cloneRange();
  const rects = range.getClientRects();
  const rect = rects[rects.length - 1] || range.getBoundingClientRect();
  const box = inner.getBoundingClientRect();
  return !rect || box.bottom - rect.bottom < 8;
}

function moveFocus(inner, dir, pos) {
  const all = $$('.block-inner', ED.root).filter(n => n.offsetParent !== null && n !== inner);
  const blocks = $$('.block', ED.root);
  const currentBlock = inner.closest('.block');
  const allBlocks = blocks.filter(n => n.offsetParent !== null && !n.classList.contains('collapsed'));
  const currentIdx = allBlocks.indexOf(currentBlock);
  let targetIdx = currentIdx + dir;
  while (targetIdx >= 0 && targetIdx < allBlocks.length) {
    const target = allBlocks[targetIdx].querySelector('.block-inner');
    if (target) { focusBlock(allBlocks[targetIdx].dataset.id, pos); return; }
    targetIdx += dir;
  }
}

/* ---------------- Markdown/paste ---------------- */
function onPaste(e) {
  const inner = e.target.closest?.('.block-inner');
  if (!inner) return;
  const block = blockById(inner.closest('.block')?.dataset.id);
  if (!block) return;
  const text = e.clipboardData?.getData('text/plain') || '';
  const html = e.clipboardData?.getData('text/html') || '';
  if (block.type === 'code') {
    e.preventDefault();
    document.execCommand('insertText', false, text);
    return;
  }
  const urlOnly = /^https?:\/\/\S+$/i.test(text.trim());
  const empty = !inner.innerText.trim();
  if (urlOnly && empty) {
    e.preventDefault();
    if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(text)) {
      block.type = 'image';
      block.props = { src: text.trim(), caption: '' };
    } else if (/\.(mp4|webm|mov)(\?|$)/i.test(text)) {
      block.type = 'video';
      block.props = { url: text.trim() };
    } else {
      block.type = 'bookmark';
      block.props = { url: text.trim(), title: text.trim() };
    }
    block.html = ''; block.text = '';
    queueSave(true);
    renderAll(block.id);
    return;
  }
  if (text.includes('\n') && !e.clipboardData?.getData('text/html')) {
    e.preventDefault();
    const lines = text.split(/\r?\n/);
    const first = lines.shift();
    if (first && inner.innerText.trim()) document.execCommand('insertText', false, first);
    else if (first) { inner.innerText = first; block.text = first; block.html = esc(first); }
    let insertAt = ED.blocks.findIndex(b => b.id === block.id) + 1;
    for (const line of lines) {
      if (!line.trim()) continue;
      const nb = { id: uid(), type: 'paragraph', html: esc(line), text: line, props: {}, parentId: block.parentId, position: 0 };
      ED.blocks.splice(insertAt++, 0, nb);
    }
    queueSave(true);
    renderAll(block.id, 'end');
    return;
  }
  if (html) {
    e.preventDefault();
    const clean = sanitizeHtml(html).replace(/\n/g, '');
    document.execCommand('insertHTML', false, clean);
  }
}

/* ---------------- Add / block menu ---------------- */
function openAddMenu(blockId, anchor) {
  const items = [];
  const groups = ['Basic blocks', 'Media', 'Advanced'];
  for (const group of groups) {
    items.push({ type: 'label', label: group });
    for (const [type, meta] of Object.entries(BLOCK_TYPES)) {
      if (meta.group !== group) continue;
      items.push({
        icon: meta.icon, label: meta.name,
        action: () => insertBlockOfType(blockId, type),
      });
    }
  }
  showMenu({ items, anchor, width: 250, searchable: true, className: 'menu-scroll' });
}

function insertBlockOfType(blockId, type) {
  if (type === 'divider') { addBlockAfter(blockId, 'divider'); return; }
  if (type === 'image') {
    const b = addBlockAfter(blockId, 'image');
    pickImageFor(b);
    return;
  }
  if (type === 'table') {
    const b = addBlockAfter(blockId, 'table');
    b.props = { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', '']] };
    queueSave(true); renderAll(b.id, 'start');
    return;
  }
  if (type === 'page_link') {
    pickPageFor(blockId);
    return;
  }
  if (type === 'bookmark') {
    const b = addBlockAfter(blockId, 'bookmark');
    promptBookmark(b);
    return;
  }
  if (type === 'video') {
    const b = addBlockAfter(blockId, 'video');
    openVideoPrompt(b);
    return;
  }
  if (type === 'callout') {
    const b = addBlockAfter(blockId, 'callout');
    b.props = { icon: '💡', color: 'default' };
    queueSave(true); renderAll(b.id, 'start');
    return;
  }
  addBlockAfter(blockId, type);
}

function openBlockMenu(blockId, anchor, x, y) {
  const block = blockById(blockId);
  if (!block) return;
  const items = [
    { icon: 'duplicate', label: 'Duplicate', hint: 'Ctrl+D', action: () => duplicateBlock(block.id) },
    { icon: 'arrow-up', label: 'Move up', action: () => moveBlockBy(block.id, -1) },
    { icon: 'arrow-down', label: 'Move down', action: () => moveBlockBy(block.id, 1) },
    { type: 'sep' },
    { icon: 'edit', label: 'Turn into', sub: true, action: () => openTurnInto(blockId, anchor) },
    { icon: 'palette', label: 'Color', action: () => {
      colorPicker(anchor || null, { x, y, colors: ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'], current: block.props?.color || 'default', onPick: (c) => {
        block.props.color = c;
        if (c === 'default') delete block.props.color;
        queueSave(true); renderAll(block.id);
      }});
    }},
    { type: 'sep' },
    { icon: 'copy', label: 'Copy text', action: () => navigator.clipboard.writeText(block.text || '') },
    { icon: 'link', label: 'Copy link to block', action: () => copyBlockLink(block.id) },
    { icon: 'comment', label: 'Comment', action: () => ED.opts.openComments?.(block.id, '') },
    { type: 'sep' },
    { icon: 'trash', label: 'Delete', danger: true, action: () => deleteBlockById(block.id) },
  ];
  showMenu({ items, anchor, x, y, width: 235, searchable: true });
}

function openTurnInto(blockId, anchor) {
  const items = ['paragraph', 'heading1', 'heading2', 'heading3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code', 'divider'].map(t => ({
    icon: BLOCK_TYPES[t].icon, label: BLOCK_TYPES[t].name,
    action: () => convertBlock(blockId, t),
  }));
  showMenu({ items, anchor, width: 220 });
}

function moveBlockBy(id, dir) {
  const block = blockById(id);
  if (!block) return;
  const siblings = ED.blocks.filter(b => (b.parentId || null) === (block.parentId || null));
  const sibIdx = siblings.findIndex(b => b.id === id);
  const targetSib = siblings[sibIdx + dir];
  if (!targetSib) return;
  ED.blocks = ED.blocks.filter(b => b.id !== id);
  const targetIdx = ED.blocks.findIndex(b => b.id === targetSib.id);
  ED.blocks.splice(dir < 0 ? targetIdx : targetIdx + 1, 0, block);
  queueSave(true);
  renderAll(id);
}

function copyBlockLink(id) {
  const url = `ideacraft://block/${id}`;
  navigator.clipboard.writeText(url).then(() => toast('Block link copied', 'success')).catch(() => {});
}

/* ---------------- Drag and drop ---------------- */
let dropTarget = null;
function onDragStart(e) {
  const grip = e.target.closest?.('.block-handle-btn.grip');
  if (!grip) return;
  const blockEl = grip.closest('.block');
  ED.dragId = blockEl.dataset.id;
  ED.dragging = false;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', blockEl.dataset.id);
  setTimeout(() => {
    blockEl.classList.add('dragging');
    ED.dragging = true;
  }, 0);
}
function onDragOver(e) {
  if (!ED.dragId) return;
  const blockEl = e.target.closest?.('.block');
  if (!blockEl || blockEl.dataset.id === ED.dragId) return;
  if (isDescendantOf(blockEl.dataset.id, ED.dragId)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropIndicators();
  const rect = blockEl.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  blockEl.style.boxShadow = before ? 'inset 0 2px 0 var(--accent)' : 'inset 0 -2px 0 var(--accent)';
  dropTarget = { id: blockEl.dataset.id, before };
}
function onDragLeave(e) {
  const blockEl = e.target.closest?.('.block');
  if (blockEl && !blockEl.contains(e.relatedTarget)) blockEl.style.boxShadow = '';
}
function onDrop(e) {
  if (!ED.dragId || !dropTarget) { clearDropIndicators(); return; }
  e.preventDefault();
  const dragBlock = blockById(ED.dragId);
  if (!dragBlock) return;
  const target = blockById(dropTarget.id);
  if (!target) return;
  ED.blocks = ED.blocks.filter(b => b.id !== dragBlock.id);
  const tIdx = ED.blocks.findIndex(b => b.id === target.id);
  dragBlock.parentId = target.parentId;
  ED.blocks.splice(dropTarget.before ? tIdx : tIdx + 1, 0, dragBlock);
  queueSave(true);
  clearDropIndicators();
  ED.justDragged = true;
  const id = ED.dragId;
  ED.dragId = null;
  renderAll(id);
}
function onDragEnd(e) {
  clearDropIndicators();
  if (ED.dragging) ED.justDragged = true;
  ED.dragId = null;
  ED.dragging = false;
}
function clearDropIndicators() {
  if (ED.root) $$('.block', ED.root).forEach(b => b.style.boxShadow = '');
  dropTarget = null;
}
function isDescendantOf(id, ancestorId) {
  let p = blockById(id);
  while (p) {
    if (p.id === ancestorId) return true;
    p = p.parentId ? blockById(p.parentId) : null;
  }
  return false;
}

/* ---------------- Slash commands ---------------- */
function maybeOpenSlash(inner, block) {
  if (ED.slash) return;
  const text = inner.innerText;
  const offset = getCaretOffset(inner);
  if (offset !== text.length) return;
  const idx = text.lastIndexOf('/');
  if (idx < 0) return;
  const before = text.slice(0, idx);
  if (before && !/\s$/.test(before)) return;
  if (text.slice(idx).includes(' ')) return;
  openSlash(inner, block, idx);
}

function openSlash(inner, block, offset) {
  closeSlash();
  const menu = el('div', { class: 'slash-menu', contenteditable: 'false' });
  document.body.appendChild(menu);
  const meta = { blockId: block.id, offset, query: '', menu, active: 0, items: [], inner, justOpened: true };
  ED.slash = meta;
  renderSlashMenu();
  positionSlash();
  document.addEventListener('keydown', onSlashKeyCapture, true);
  document.addEventListener('mousedown', onSlashOutside, true);
  setTimeout(() => { meta.justOpened = false; }, 40);
}

function getSlashItems(query) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const q = norm(query);
  const out = [];
  for (const group of ['Basic blocks', 'Media', 'Advanced']) {
    const groupItems = [];
    for (const [type, m] of Object.entries(BLOCK_TYPES)) {
      if (m.group !== group) continue;
      const hay = norm(`${m.name} ${m.desc} ${type}`);
      const alias = type === 'paragraph' ? 'text' : type === 'to_do' ? 'todo checkbox task' : type === 'bulleted_list_item' ? 'bullet ul' : type === 'numbered_list_item' ? 'number ol' : type === 'heading1' ? 'h1' : type === 'heading2' ? 'h2' : type === 'heading3' ? 'h3' : '';
      if (q && !hay.includes(q) && !norm(alias).includes(q)) continue;
      groupItems.push({ type, ...m });
    }
    if (groupItems.length) out.push({ label: group, items: groupItems });
  }
  return out;
}

function renderSlashMenu() {
  const meta = ED.slash;
  if (!meta) return;
  const groups = getSlashItems(meta.query);
  meta.items = groups.flatMap(g => g.items);
  if (meta.active >= meta.items.length) meta.active = 0;
  meta.menu.innerHTML = '';
  if (!meta.items.length) {
    meta.menu.appendChild(el('div', { class: 'slash-empty', text: `No results for “${meta.query}”` }));
    return;
  }
  let flatIdx = 0;
  for (const group of groups) {
    meta.menu.appendChild(el('div', { class: 'sm-label', text: group.label }));
    for (const item of group.items) {
      const node = el('div', {
        class: `slash-item ${flatIdx === meta.active ? 'active' : ''}`,
        onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); applySlashItem(item.type); },
        onmouseenter: () => { meta.active = flatIdx; refreshSlashActive(); },
      },
        el('div', { class: 'slash-icon', html: `<svg class="ic"><use href="#i-${item.icon}"/></svg>` }),
        el('div', { class: 'slash-text' },
          el('div', { class: 'slash-name', text: item.name }),
          el('div', { class: 'slash-desc', text: item.desc })
        )
      );
      meta.menu.appendChild(node);
      flatIdx++;
    }
  }
}

function refreshSlashActive() {
  const meta = ED.slash;
  if (!meta) return;
  $$('.slash-item', meta.menu).forEach((n, i) => n.classList.toggle('active', i === meta.active));
  const active = meta.menu.querySelector('.slash-item.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function updateSlashQuery() {
  const meta = ED.slash;
  if (!meta) return;
  const text = meta.inner.innerText;
  const offset = getCaretOffset(meta.inner);
  if (offset < meta.offset || text[meta.offset] !== '/') { closeSlash(); return; }
  const query = text.slice(meta.offset + 1, offset);
  if (/\s/.test(query)) { closeSlash(); return; }
  if (query !== meta.query) {
    meta.query = query;
    meta.active = 0;
    renderSlashMenu();
  }
  positionSlash();
}

function positionSlash() {
  const meta = ED.slash;
  if (!meta) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const menu = meta.menu;
  const mr = menu.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + mr.width > window.innerWidth - 10) left = window.innerWidth - mr.width - 10;
  if (top + mr.height > window.innerHeight - 10) top = rect.top - mr.height - 6;
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;
}

function onSlashKeyCapture(e) {
  if (!ED.slash) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    const n = ED.slash.items.length;
    if (!n) return;
    ED.slash.active = e.key === 'ArrowDown' ? (ED.slash.active + 1) % n : (ED.slash.active - 1 + n) % n;
    refreshSlashActive();
    return;
  }
  if (e.key === 'Enter' || (e.key === 'Tab' && ED.slash.items.length)) {
    e.preventDefault(); e.stopPropagation();
    const item = ED.slash.items[ED.slash.active];
    if (item) applySlashItem(item.type);
    return;
  }
}

function onSlashOutside(e) {
  if (ED.slash && !ED.slash.menu.contains(e.target)) closeSlash();
}

function handleSlashKey(e) {
  // handled by capture listener; ensure root handler doesn't double-process
  return false;
}

function closeSlash() {
  if (!ED.slash) return;
  ED.slash.menu.remove();
  document.removeEventListener('keydown', onSlashKeyCapture, true);
  document.removeEventListener('mousedown', onSlashOutside, true);
  ED.slash = null;
}

function applySlashItem(type) {
  const meta = ED.slash;
  if (!meta) return;
  const block = blockById(meta.blockId);
  const inner = meta.inner;
  const text = inner.innerText;
  const caret = getCaretOffset(inner);
  const cleaned = text.slice(0, meta.offset) + text.slice(caret);
  closeSlash();
  if (!block) return;
  block.html = esc(cleaned); block.text = cleaned;
  inner.innerText = cleaned;

  if (type === 'paragraph' || type === 'heading1' || type === 'heading2' || type === 'heading3' || type === 'quote' || type === 'code') {
    convertBlock(block.id, type);
    return;
  }
  if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
    convertBlock(block.id, type);
    return;
  }
  if (type === 'to_do') { convertBlock(block.id, 'to_do', { checked: false }); return; }
  if (type === 'toggle') { convertBlock(block.id, 'toggle', { collapsed: false }); return; }
  if (type === 'callout') { convertBlock(block.id, 'callout', { icon: '💡', color: 'default' }); return; }
  if (type === 'divider') {
    // keep text above as a separate paragraph when non-empty
    if (cleaned.trim()) {
      block.type = 'paragraph'; block.html = esc(cleaned); block.text = cleaned;
      const div = { id: uid(), type: 'divider', html: '', text: '', props: {}, parentId: block.parentId, position: 0 };
      const idx = ED.blocks.findIndex(b => b.id === block.id);
      ED.blocks.splice(idx + 1, 0, div);
      const p = { id: uid(), type: 'paragraph', html: '', text: '', props: {}, parentId: block.parentId, position: 0 };
      ED.blocks.splice(idx + 2, 0, p);
      queueSave(true); renderAll(p.id);
    } else {
      block.type = 'divider'; block.html = ''; block.text = '';
      const p = { id: uid(), type: 'paragraph', html: '', text: '', props: {}, parentId: block.parentId, position: 0 };
      const idx = ED.blocks.findIndex(b => b.id === block.id);
      ED.blocks.splice(idx + 1, 0, p);
      queueSave(true); renderAll(p.id);
    }
    return;
  }
  if (type === 'image') {
    block.type = 'image'; block.html = ''; block.text = ''; block.props = {};
    queueSave(true); renderAll(block.id); pickImageFor(block);
    return;
  }
  if (type === 'bookmark') {
    block.type = 'bookmark'; block.html = ''; block.text = '';
    queueSave(true); renderAll(block.id); promptBookmark(block);
    return;
  }
  if (type === 'video') {
    block.type = 'video'; block.html = ''; block.text = '';
    queueSave(true); renderAll(block.id); openVideoPrompt(block);
    return;
  }
  if (type === 'table') {
    block.type = 'table'; block.html = ''; block.text = '';
    block.props = { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', '']] };
    queueSave(true); renderAll(block.id);
    return;
  }
  if (type === 'page_link') {
    block.html = ''; block.text = '';
    convertBlock(block.id, 'paragraph');
    pickPageFor(block.id);
    return;
  }
  if (type === 'equation') {
    block.type = 'equation'; block.props = {}; queueSave(true); renderAll(block.id);
    return;
  }
}

/* ---------------- Pickers ---------------- */
async function pickImageFor(block) {
  try {
    const res = await invoke('pick_image');
    if (!res) return;
    block.props.src = res.dataUrl;
    block.props.caption = block.props.caption || '';
    block.props.alt = res.name;
    block.type = 'image';
    block.html = ''; block.text = '';
    queueSave(true);
    renderAll(block.id);
  } catch (e) { toast(String(e), 'error'); }
}

async function promptBookmark(block) {
  const url = await promptDialog({ title: 'Add a bookmark', label: 'URL', placeholder: 'https://example.com', confirmText: 'Add bookmark' });
  if (!url) return;
  block.type = 'bookmark';
  block.props = { url, title: prettyUrl(url) };
  block.html = ''; block.text = '';
  queueSave(true); renderAll(block.id);
}

async function openVideoPrompt(block) {
  const url = await promptDialog({ title: 'Embed a video', label: 'Video URL', placeholder: 'https://youtube.com/watch?v=…' });
  if (!url) return;
  block.type = 'video';
  block.props = { url, title: prettyUrl(url) };
  queueSave(true); renderAll(block.id);
}

function prettyUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function pickPageFor(blockId, mode = 'convert') {
  const pages = S.pages.filter(p => p.type !== 'row' && !p.trashedAt);
  const node = el('div', { class: 'menu', style: { width: '290px' } });
  const search = el('div', { class: 'menu-search', html: '<svg class="ic"><use href="#i-search"/></svg>' }, el('input', { placeholder: 'Search pages…' }));
  const list = el('div', { class: 'menu-scroll', style: { maxHeight: '280px' } });
  const renderList = (q = '') => {
    list.innerHTML = '';
    const filtered = pages.filter(p => pageTitle(p).toLowerCase().includes(q.toLowerCase())).slice(0, 40);
    if (!filtered.length) list.innerHTML = '<div class="slash-empty">No pages found</div>';
    for (const p of filtered) {
      list.appendChild(el('button', {
        class: 'menu-item',
        onclick: () => {
          const block = blockById(blockId);
          if (block) {
            block.type = 'page_link';
            block.props = { pageId: p.id, title: pageTitle(p) };
            block.html = ''; block.text = '';
            queueSave(true); renderAll(block.id);
            ED.opts.openPage && setTimeout(() => ED.opts.openPage(p.id), 30);
          }
          pop.close();
        }
      }, el('span', { class: 'mi-icon', html: pageIcon(p) }), el('span', { class: 'mi-label', text: pageTitle(p) })));
    }
  };
  node.appendChild(search);
  node.appendChild(list);
  const pop = showPopover({ node, anchor: blockId ? ED.root?.querySelector(`.block[data-id="${blockId}"] .block-handle-btn.add`) : null, width: 290, onMount: () => {
    const input = search.querySelector('input');
    input.addEventListener('input', () => renderList(input.value));
    input.focus();
    renderList();
  }});
}

/* ---------------- Exported actions for views ---------------- */
export function addEditorBlock(type = 'paragraph') {
  const last = ED.blocks[ED.blocks.length - 1];
  const b = addBlockAfter(last?.id || '', type);
  if (type === 'image') pickImageFor(b);
  if (type === 'table') { b.props = { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', '']] }; queueSave(true); renderAll(b.id); }
  return b;
}

const INLINE_MD = (line) => {
  let out = esc(line);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
};

/** Insert plain text / light Markdown into the open editor. */
export function insertEditorText(text, opts = {}) {
  if (!ED.mounted || ED.readOnly) return false;
  const value = String(text ?? '').replace(/\r\n/g, '\n');
  if (!value.trim()) return false;
  const makeBlock = (type, line) => ({
    id: uid(), type, html: INLINE_MD(line), text: stripHtml(INLINE_MD(line)),
    props: type === 'to_do' ? { checked: false } : {}, parentId: null, position: 0,
  });
  const lines = value.split('\n');
  const created = [];
  let prevId = ED.lastSelectedBlock || ED.blocks[ED.blocks.length - 1]?.id || '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      created.push(makeBlock('paragraph', ''));
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const num = /^\d+[.)]\s+(.+)$/.exec(line);
    const todo = /^\[[ x]\]\s+(.+)$/i.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (h) created.push(makeBlock(`heading${h[1].length}`, h[2]));
    else if (todo) { const b = makeBlock('to_do', todo[1]); b.props.checked = /^\[x\]/i.test(line); created.push(b); }
    else if (bullet) created.push(makeBlock('bulleted_list_item', bullet[1]));
    else if (num) created.push(makeBlock('numbered_list_item', num[1]));
    else if (quote) created.push(makeBlock('quote', quote[1]));
    else created.push(makeBlock('paragraph', line));
  }
  // If the current block is empty, replace it rather than adding a blank line above.
  const holder = prevId && blockById(prevId);
  if (holder && !(holder.text || '').trim() && ['paragraph', 'heading1', 'heading2', 'heading3'].includes(holder.type) && created.length) {
    Object.assign(holder, created.shift());
  }
  let insertAt = holder ? ED.blocks.findIndex(b => b.id === holder.id) : ED.blocks.length - 1;
  for (const b of created) {
    insertAt += 1;
    ED.blocks.splice(insertAt, 0, b);
  }
  ED.blocks.forEach((b, i) => { b.position = i + 1; });
  ED.dirty = true;
  queueSave(true);
  renderAll(created.length ? created[created.length - 1].id : holder?.id, 'end');
  ED.opts.onStatus?.('Saved', 'saved');
  return true;
}

export function getEditorText() {
  if (!ED.mounted) return '';
  const lines = [];
  const walk = (parentId, depth) => {
    for (const b of ED.blocks.filter(x => (x.parentId || null) === (parentId || null))) {
      const pad = '  '.repeat(depth);
      if (b.type === 'divider') lines.push(`${pad}---`);
      else if (b.type === 'to_do') lines.push(`${pad}- [${b.props.checked ? 'x' : ' '}] ${b.text || ''}`);
      else if (b.type === 'bulleted_list_item') lines.push(`${pad}- ${b.text || ''}`);
      else if (b.type === 'numbered_list_item') lines.push(`${pad}1. ${b.text || ''}`);
      else if (b.type === 'heading1') lines.push(`# ${b.text || ''}`);
      else if (b.type === 'heading2') lines.push(`## ${b.text || ''}`);
      else if (b.type === 'heading3') lines.push(`### ${b.text || ''}`);
      else if (b.type === 'quote') lines.push(`> ${b.text || ''}`);
      else if (b.type === 'code') lines.push('```\n' + (b.text || '') + '\n```');
      else if (b.text) lines.push(`${pad}${b.text}`);
      walk(b.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n');
}


