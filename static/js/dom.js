// Tiny DOM helper. All text goes through textContent / createTextNode: no HTML-string sinks anywhere (output escaping by construction).
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function announce(msg) { const a = document.getElementById('announce'); a.textContent = ''; setTimeout(() => { a.textContent = msg; }, 30); }

// FTS snippet uses [ ] as highlight markers -> <mark> nodes (text only).
export function snippet(s) {
  const out = []; const re = /\[([^\]]*)\]/g; let last = 0; let m;
  while ((m = re.exec(s))) { if (m.index > last) out.push(s.slice(last, m.index)); out.push(h('mark', {}, m[1])); last = re.lastIndex; }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
    const ta = h('textarea', { class: 'vh', 'aria-hidden': 'true' }); ta.value = text; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; } ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = ok ? 'Kopyalandı' : 'Kopyalanamadı — elle seçin'; setTimeout(() => { btn.textContent = old; }, 1600); }
  announce(ok ? 'Komut panoya kopyalandı' : 'Kopyalanamadı; komutu elle seçin');
}
