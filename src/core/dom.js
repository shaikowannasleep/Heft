export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
let toastHost;
export function toast(msg, kind = 'info', ms = 2400) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts' }));
  const t = toastHost.appendChild(h('div', { class: 'toast ' + kind }, msg));
  setTimeout(() => t.remove(), ms);
}
