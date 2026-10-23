/* IdeaCraft – UI primitives: menus, popovers, modals, pickers, toasts */
import { $, el, esc, EMOJIS, formatDate, hasTauri, invoke } from './api.js';

const layers = [];

export function hasLayers() { return layers.length > 0; }

export function closeTopLayer() {
  const layer = layers[layers.length - 1];
  if (!layer) return false;
  layer.close();
  return true;
}

function registerLayer(layer) {
  layers.push(layer);
  layer.node?.addEventListener?.('remove', () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  });
  return layer;
}

export function unregisterLayer(layer) {
  const i = layers.indexOf(layer);
  if (i >= 0) layers.splice(i, 1);
}

export function toast(message, type = '', ms = 2600) {
  const root = $('#toasts');
  if (!root) return;
  const icons = { success: 'check', error: 'warning', info: 'info' };
  const node = el('div', { class: `toast ${type}` },
    icons[type] ? el('span', { class: 'toast-icon', html: `<svg class="ic"><use href="#i-${icons[type]}"/></svg>` }) : null,
    el('span', { text: message })
  );
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity 160ms, transform 160ms';
    node.style.opacity = '0';
    node.style.transform = 'translateY(5px)';
    setTimeout(() => node.remove(), 180);
  }, ms);
}

export function announce(text) {
  const lr = $('#liveRegion');
  if (lr) lr.textContent = text;
}

/* ---------------- Menus ---------------- */
export function showMenu(opts = {}) {
  closeAllMenus();
  const {
    items = [], x, y, anchor, align = 'left', vAlign = 'below',
    width = null, className = '', searchable = false, onClose = null, header = null,
  } = opts;

  const menu = el('div', { class: `menu ${className}`, role: 'menu' });
  if (searchable) {
    const searchRow = el('div', { class: 'menu-search' },
      `<svg class="ic"><use href="#i-search"/></svg>`,
      el('input', { type: 'text', placeholder: 'Search actions…', spellcheck: 'false' })
    );
    menu.appendChild(searchRow);
    const input = searchRow.querySelector('input');
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      menu.querySelectorAll('.menu-item').forEach(it => {
        it.style.display = it.dataset.searchText.includes(q) ? '' : 'none';
      });
    });
  }
  if (header) menu.insertAdjacentHTML('beforeend', `<div class="menu-header">${esc(header)}</div>`);

  let activeIndex = -1;
  const getItems = () => Array.from(menu.querySelectorAll('.menu-item:not(.disabled)')).filter(n => n.style.display !== 'none');

  const renderItems = (list) => {
    for (const item of list) {
      if (!item) continue;
      if (item.type === 'sep') { menu.appendChild(el('div', { class: 'menu-sep' })); continue; }
      if (item.type === 'label') { menu.appendChild(el('div', { class: 'menu-label', text: item.label })); continue; }
      if (item.type === 'custom') { menu.appendChild(item.node); continue; }
      const btn = el('button', {
        class: `menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`,
        role: 'menuitem',
        onclick: (e) => {
          e.stopPropagation();
          if (item.disabled) return;
          if (item.keepOpen) { item.action?.(e); return; }
          close();
          item.action?.(e);
        },
      });
      btn.dataset.searchText = `${item.label || ''} ${item.hint || ''}`.toLowerCase();
      if (item.checked !== undefined) {
        btn.appendChild(el('span', { class: 'menu-check', html: item.checked ? '<svg class="ic"><use href="#i-check"/></svg>' : '' }));
      } else if (item.icon) {
        btn.insertAdjacentHTML('beforeend', `<span class="mi-icon">${item.icon.startsWith('<') ? item.icon : `<svg class="ic"><use href="#i-${item.icon}"/></svg>`}</span>`);
      }
      if (item.colorDot) {
        btn.insertAdjacentHTML('beforeend', `<span class="opt-swatch" style="background:${esc(item.colorDot)}"></span>`);
      }
      btn.appendChild(el('span', { class: 'mi-label', text: item.label || '' }));
      if (item.hint) btn.appendChild(el('span', { class: 'mi-hint', text: item.hint }));
      if (item.sub) btn.appendChild(el('span', { class: 'mi-hint', text: '›' }));
      menu.appendChild(btn);
    }
  };
  renderItems(items);
  document.body.appendChild(menu);

  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.addEventListener('mousedown', (e) => e.stopPropagation());

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    unregisterLayer(layer);
  };

  const layer = registerLayer({ close, node: menu, type: 'menu' });

  const onDown = (e) => {
    if (!menu.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = getItems();
      if (!list.length) return;
      activeIndex = e.key === 'ArrowDown' ? (activeIndex + 1) % list.length : (activeIndex - 1 + list.length) % list.length;
      list.forEach((n, i) => n.classList.toggle('active', i === activeIndex));
      list[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const list = getItems();
      if (activeIndex >= 0 && list[activeIndex]) { e.preventDefault(); list[activeIndex].click(); }
    }
  };

  const place = () => {
    const rect = menu.getBoundingClientRect();
    let left = x ?? 0;
    let top = y ?? 0;
    if (anchor) {
      const ar = anchor.getBoundingClientRect();
      left = align === 'right' ? ar.right - rect.width : align === 'center' ? ar.left + ar.width / 2 - rect.width / 2 : ar.left;
      top = vAlign === 'above' ? ar.top - rect.height - 5 : ar.bottom + 5;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    if (top < 8) top = 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  if (width) menu.style.width = `${width}px`;
  place();

  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    if (searchable) menu.querySelector('input')?.focus();
  }, 0);
  return { close, node: menu };
}

export function closeAllMenus() {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i].type === 'menu' || layers[i].type === 'popover') layers[i].close();
  }
}

/* ---------------- Popovers ---------------- */
export function showPopover(opts = {}) {
  closeAllMenus();
  const { html = '', node, x, y, anchor, align = 'left', vAlign = 'below', className = '', width = null, onMount, onClose } = opts;
  const pop = node || el('div', { class: `menu ${className}`, html });
  if (node) {
    node.classList.add('menu');
    for (const name of String(className || '').split(/\s+/).filter(Boolean)) node.classList.add(name);
  }
  document.body.appendChild(pop);
  if (width) pop.style.width = `${width}px`;
  pop.style.maxHeight = 'calc(100vh - 20px)';
  pop.style.overflowY = 'auto';

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    unregisterLayer(layer);
  };
  const layer = registerLayer({ close, node: pop, type: 'popover' });
  const onDown = (e) => {
    if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const place = () => {
    const rect = pop.getBoundingClientRect();
    let left = x ?? 0;
    let top = y ?? 0;
    if (anchor) {
      const ar = anchor.getBoundingClientRect();
      left = align === 'right' ? ar.right - rect.width : align === 'center' ? ar.left + ar.width / 2 - rect.width / 2 : ar.left;
      top = vAlign === 'above' ? ar.top - rect.height - 6 : ar.bottom + 6;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    if (top + rect.height > window.innerHeight - 8) {
      if (anchor && vAlign !== 'above') top = Math.max(8, anchor.getBoundingClientRect().top - rect.height - 6);
      else top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    if (top < 8) top = 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  pop.addEventListener('mousedown', e => e.stopPropagation());
  pop.addEventListener('click', e => e.stopPropagation());
  place();
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    onMount?.(pop, close);
  }, 0);
  return { close, node: pop };
}

/* ---------------- Modals ---------------- */
export function openModal(opts = {}) {
  const {
    title = '', subtitle = '', body = '', footer = '', width = 700, className = '',
    onMount, onClose, closeOnBackdrop = true, bodyClass = '', showClose = true, icon = '',
  } = opts;
  const overlay = el('div', { class: 'overlay' });
  const modal = el('div', { class: `modal ${className}` });
  modal.style.width = typeof width === 'number' ? `${width}px` : width;
  const head = el('div', { class: 'modal-head' },
    icon ? el('span', { html: icon, style: { fontSize: '17px', display: 'flex' } }) : null,
    el('h2', { text: title }),
    subtitle ? el('span', { class: 'modal-sub', text: subtitle }) : null,
    showClose ? el('button', { class: 'modal-close', 'aria-label': 'Close', html: '<svg class="ic"><use href="#i-close"/></svg>', onclick: () => close() }) : null
  );
  const bodyEl = el('div', { class: `modal-body ${bodyClass}` });
  if (body instanceof Node) bodyEl.appendChild(body); else bodyEl.innerHTML = body;
  modal.appendChild(head);
  modal.appendChild(bodyEl);
  if (footer) {
    const foot = el('div', { class: 'modal-foot' });
    if (footer instanceof Node) foot.appendChild(footer); else foot.innerHTML = footer;
    modal.appendChild(foot);
  }
  overlay.appendChild(modal);
  $('#overlays').appendChild(overlay);

  const layer = registerLayer({ close: () => close(), node: overlay, type: 'modal' });
  const onKey = (e) => {
    if (e.key === 'Escape' && layers[layers.length - 1] === layer) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    unregisterLayer(layer);
  };
  overlay.addEventListener('mousedown', e => { if (e.target === overlay && closeOnBackdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => {
    onMount?.(bodyEl, close, modal);
    const focusable = modal.querySelector('input, textarea, [contenteditable="true"], .btn.primary');
    focusable?.focus?.();
  }, 20);
  return { close, modal, body: bodyEl };
}

export function confirmDialog(opts = {}) {
  const { title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, icon = '' } = opts;
  return new Promise(resolve => {
    let settled = false;
    const done = (val) => { if (settled) return; settled = true; resolve(val); };
    const { close } = openModal({
      title, width: 440, className: 'small', icon,
      body: `<div class="dialog-text">${message}</div>`,
      footer: el('div', { style: { display: 'flex', gap: '8px' } },
        el('button', { class: 'btn', text: cancelText, onclick: () => { done(false); close(); } }),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmText, onclick: () => { done(true); close(); } })
      ),
      onClose: () => done(false),
    });
    setTimeout(() => {
      const btn = document.querySelector('.modal .btn.primary, .modal .btn.danger');
      btn?.focus();
    }, 40);
  });
}

export function promptDialog(opts = {}) {
  const { title = 'Enter a value', label = '', value = '', placeholder = '', confirmText = 'Save', multiline = false } = opts;
  return new Promise(resolve => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; resolve(v); };
    const input = multiline
      ? el('textarea', { placeholder, style: { height: '110px' } })
      : el('input', { type: 'text', placeholder });
    input.value = value;
    const body = el('div', { class: 'field' }, label ? el('label', { text: label }) : null, input);
    const submit = () => { const v = input.value.trim(); done(v || null); close(); };
    const { close } = openModal({
      title, width: 460,
      body,
      footer: el('div', { style: { display: 'flex', gap: '8px' } },
        el('button', { class: 'btn', text: 'Cancel', onclick: () => { done(null); close(); } }),
        el('button', { class: 'btn primary', text: confirmText, onclick: submit })
      ),
      onMount: () => { input.focus(); input.select(); },
      onClose: () => done(null),
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); submit(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
  });
}

/* ---------------- Emoji picker ---------------- */
const EMOJI_TABS = {
  'People': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  'Nature': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🌵','🎄','🌲','🌳','🌴','🪵','🌱','🌿','☘️','🍀','🎍','🪴','🎋','🍃','🍂','🍁','🍄','🐚','🪨','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌎','🌍','🌏','🪐','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪️','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','☔','☂️','🌊','🌫️'],
  'Objects': ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','🧾','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','🩻','🩸','💊','💉','🩼','🩸','🧬','🦠','🧫','🧪','🌡️','🧹','🪠','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪥','🪒','🧽','🪣','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🎀','🪄','🪅','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','🪧','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'],
  'Symbols': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️','®️','👁️‍🗨️','🔚','🔙','🔛','🔝','🔜','〰️','➰','➿','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'],
  'Food': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂'],
};

export function emojiPicker(anchor, onPick, opts = {}) {
  const { allowRemove = true, onRemove = null, current = '', onUpload = null } = opts;
  const node = el('div', { class: 'menu emoji-pop' });
  const tabs = el('div', { class: 'emoji-tabs' });
  const grid = el('div', { class: 'emoji-grid' });
  const searchWrap = el('div', { class: 'emoji-search' }, el('input', { type: 'text', placeholder: 'Search emoji…', spellcheck: 'false' }));
  let activeTab = Object.keys(EMOJI_TABS)[0];
  const render = (q = '') => {
    grid.innerHTML = '';
    if (q) {
      const all = Object.values(EMOJI_TABS).flat();
      const uniq = [...new Set(all)];
      const matches = uniq.filter(e => {
        const name = EMOJI_NAMES[e] || '';
        return name.includes(q.toLowerCase());
      }).slice(0, 120);
      if (!matches.length) grid.innerHTML = '<div class="slash-empty" style="grid-column:1/-1">No results</div>';
      matches.forEach(e => grid.appendChild(el('button', { class: 'emoji-btn', text: e, onclick: () => { onPick(e); pop.close(); } })));
      return;
    }
    (EMOJI_TABS[activeTab] || []).forEach(e => grid.appendChild(el('button', { class: 'emoji-btn', text: e, onclick: () => { onPick(e); pop.close(); } })));
  };
  Object.keys(EMOJI_TABS).forEach(name => {
    tabs.appendChild(el('button', {
      class: `emoji-tab ${name === activeTab ? 'active' : ''}`, text: name,
      onclick: () => {
        activeTab = name;
        tabs.querySelectorAll('.emoji-tab').forEach(b => b.classList.toggle('active', b.textContent === name));
        searchWrap.querySelector('input').value = '';
        render();
      }
    }));
  });
  node.appendChild(tabs);
  node.appendChild(searchWrap);
  node.appendChild(grid);
  if (allowRemove || onUpload) {
    node.appendChild(el('div', { class: 'emoji-remove' },
      onUpload ? el('button', {
        html: '<svg class="ic"><use href="#i-upload"/></svg><span style="margin-left:6px">Upload image…</span>',
        onclick: () => { pop.close(); onUpload(); }
      }) : null,
      allowRemove && current ? el('button', {
        text: /^(data:|https?:)/i.test(current) ? 'Remove photo' : 'Remove icon',
        onclick: () => { onRemove ? onRemove() : onPick(''); pop.close(); }
      }) : null
    ));
  }
  const pop = showPopover({ node, anchor, className: 'emoji-pop', width: 300, align: opts.align || 'left', onMount: () => {
    searchWrap.querySelector('input').addEventListener('input', e => render(e.target.value.trim()));
    searchWrap.querySelector('input').focus();
    render();
  }});
  return pop;
}

const EMOJI_NAMES = {
  '📄':'page document','📝':'note memo writing','📚':'books library','📖':'book reading','🗂️':'folders organize','📁':'folder','📌':'pin','📎':'paperclip attach','🔖':'bookmark','📊':'chart bar analytics','📈':'chart up growth','📉':'chart down','🧠':'brain idea mind','💡':'idea lightbulb','✨':'sparkles magic','🔥':'fire hot','⭐':'star','🌟':'star glow','✅':'check done','☑️':'checkbox done','🎯':'target goal','🚀':'rocket launch','⚡':'bolt energy','🌈':'rainbow','☀️':'sun','🌙':'moon night','☁️':'cloud','🌱':'seedling','🌿':'plant leaf','🍀':'clover luck','🌸':'flower','🌊':'wave water','🏔️':'mountain','🌍':'earth globe','🗺️':'map','🧭':'compass','🏠':'home house','🏡':'house garden','🏢':'building office','💼':'briefcase work','🛠️':'tools build','⚙️':'gear settings','🧪':'experiment lab','🔬':'microscope','🎨':'art palette','🎭':'theater','🎬':'movie clapper','🎵':'music note','🎧':'headphones','📷':'camera','📸':'camera flash','💻':'laptop computer','🖥️':'desktop monitor','⌨️':'keyboard','📱':'phone mobile','✉️':'envelope mail','📧':'email','💬':'chat comment','👥':'people team','👤':'person user','🧑‍💻':'developer','🦄':'unicorn','🐱':'cat','🐶':'dog','🐢':'turtle','🦊':'fox','🐻':'bear','🐼':'panda','🦋':'butterfly','🐝':'bee','🌻':'sunflower','🍎':'apple','🍋':'lemon','🍇':'grapes','🍓':'strawberry','🍒':'cherry','🥑':'avocado','🍕':'pizza','🍩':'donut','☕':'coffee','🍵':'tea','🎉':'party','🎁':'gift','🏆':'trophy','🥇':'gold medal','🎓':'graduation','🔑':'key','🔒':'lock','🔓':'unlock','❤️':'heart love','🧡':'orange heart','💛':'yellow heart','💚':'green heart','💙':'blue heart','💜':'purple heart','🖤':'black heart','💯':'hundred','♾️':'infinity','🔮':'crystal ball','🧩':'puzzle','🪄':'magic wand','🪴':'potted plant','🕯️':'candle','⏰':'alarm clock','⏳':'hourglass','📅':'calendar','🗓️':'calendar spiral','🛒':'cart shopping','💰':'money bag','🧾':'receipt','📍':'location pin','🚩':'flag','🏁':'checkered flag','🏷️':'tag label','🔗':'link','📏':'ruler','✂️':'scissors','🖊️':'pen','✏️':'pencil','📘':'blue book','📓':'notebook','🗒️':'notepad','🗃️':'card box','🗄️':'file cabinet','📦':'package box','🎒':'backpack','🧳':'luggage','🪁':'kite','🛸':'ufo',
};

/* ---------------- Cover picker ---------------- */
export const COVER_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #ff8177 0%, #b12a5b 100%)',
  'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
  'linear-gradient(135deg, #cfd9df 0%, #e2ebf0 100%)',
  'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
  'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
  'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
];

export function coverPicker(anchor, { onPick, onUpload, onRemove }) {
  const node = el('div', { class: 'menu cover-pop' });
  const grid = el('div', { class: 'cover-grid' });
  COVER_GRADIENTS.forEach(g => {
    grid.appendChild(el('button', { class: 'cover-swatch', style: { background: g }, title: 'Gradient', onclick: () => { onPick(g); pop.close(); } }));
  });
  node.appendChild(grid);
  const actions = el('div', { class: 'cover-actions' },
    el('button', { class: 'cover-action', html: '<svg class="ic"><use href="#i-image"/></svg><span>Upload image…</span>', onclick: () => { pop.close(); onUpload(); } }),
    el('button', { class: 'cover-action', html: '<svg class="ic"><use href="#i-upload"/></svg><span>Choose from computer</span>', onclick: () => { pop.close(); onUpload(); } }),
    el('button', { class: 'cover-action', html: '<svg class="ic"><use href="#i-close"/></svg><span>Remove cover</span>', onclick: () => { onRemove(); pop.close(); } }),
  );
  node.appendChild(actions);
  const pop = showPopover({ node, anchor, className: 'cover-pop', width: 330, align: 'right' });
  return pop;
}

export function colorPicker(anchor, { colors, onPick, current, x, y }) {
  const node = el('div', { class: 'menu', style: { width: '184px' } });
  const grid = el('div', { class: 'color-grid' });
  const map = {
    gray: '#787774', brown: '#9f6b53', orange: '#d9730d', yellow: '#dfab01', green: '#448361',
    blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#e03e3e', default: 'transparent',
  };
  colors.forEach(c => {
    const sw = el('button', {
      class: 'color-swatch', title: c, style: { background: map[c] || c, border: c === 'default' ? '1px dashed var(--border-strong)' : '' },
      onclick: () => { onPick(c); pop.close(); }
    });
    if (current === c) sw.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>';
    grid.appendChild(sw);
  });
  node.appendChild(grid);
  const pop = showPopover({ node, anchor: anchor || null, x, y, className: '', align: 'left' });
  return pop;
}

/* ---------------- misc ---------------- */
export function sectionLabel(text) {
  return el('div', { class: 'menu-label', text });
}

export function menuButton({ icon, label, hint, action, danger, checked, disabled, colorDot, keepOpen }) {
  return { icon, label, hint, action, danger, checked, disabled, colorDot, keepOpen };
}

export function spinner(size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="42" stroke-dashoffset="14" stroke-linecap="round"/></svg><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
}

export function progressRing(percent, size = 18) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:none"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="2"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - percent / 100)}" transform="rotate(-90 ${size/2} ${size/2})" stroke-linecap="round"/></svg>`;
}

export function dateLabel(value) {
  if (!value) return '';
  return formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function openImageFile() {
  return invoke('pick_image');
}

export async function copyToClipboard(text) {
  try {
    await invoke('copy_text', { text });
    return true;
  } catch {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
}
