// Lattice Vault UI v3 — hash router + views. Vanilla ES modules, read-only.
import { h, clear, announce, snippet, copyText } from './dom.js';
import { get } from './api.js';
import { date, timeEl, typeLabel, shortId, badge, actorLabel } from './fmt.js';

const view = document.getElementById('view');
const PAGE = 50;
const state = { q: '', type: '', actor: '', status: '', from: '', to: '', offset: 0, histOffset: 0, meta: null };
const ST = { active: 'etkin', proposed: 'önerildi', rejected: 'reddedildi', reverted: 'geri alındı', redacted: 'imha edildi' };
const STATUS_OPTS = [['', 'tümü'], ['proposed', 'Önerildi'], ['active', 'Etkin (onaylı / kaydedilmiş)'], ['corrected', 'Düzeltildi'], ['rejected', 'Reddedildi'], ['reverted', 'Geri alındı'], ['redacted', 'İmha edildi']];

function loading(label) { return h('p', { class: 'loading', role: 'status' }, label || 'Yükleniyor…'); }
function errorState(err, retry) {
  return h('div', { class: 'state error', role: 'alert' },
    h('p', {}, h('strong', {}, 'Veri okunamadı. '), err.message),
    h('p', { class: 'mono' }, 'Sunucu yerelde çalışıyor olmalı: python3 server.py --db <yol>/vault.db'),
    retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, 'Yeniden dene') : null);
}
function cmd(text, label) {
  return h('div', { class: 'cmdrow' }, h('code', { class: 'cmd' }, text),
    h('button', { class: 'btn', type: 'button', 'aria-label': `${label}: ${text}`, onclick: (e) => copyText(text, e.currentTarget) }, label));
}

async function loadMeta() {
  try { state.meta = await get('/api/meta'); document.getElementById('queue-count').textContent = `(${state.meta.pending})`; }
  catch (_) { document.getElementById('queue-count').textContent = '(?)'; }
  return state.meta;
}

function setTab(tab) {
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// ---------------- Bellekler ----------------
function selectEl(id, label, opts, value, onchange) {
  return h('div', { class: 'field' }, h('label', { for: id }, label),
    h('select', { id, onchange }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
}

function wrapFilters(fields) {
  if (!matchMedia('(max-width:720px)').matches) return fields;
  const any = state.type || state.actor || state.status || state.from || state.to;
  return h('details', { class: 'more', open: any ? true : null },
    h('summary', { class: 'mono' }, 'Filtreler (tür, ajan, durum, tarih)'), h('div', { class: 'more-body' }, fields));
}

async function renderMemories(selId) {
  document.title = 'Bellekler · Lattice Vault';
  const meta = state.meta || await loadMeta() || { types: [], actors: [] };
  const listBox = h('div', { id: 'list-box' });
  const detailBox = h('section', { class: 'panel detail', id: 'detail', 'aria-labelledby': 'detail-title', tabindex: '-1' });
  const q = h('input', { id: 'f-q', type: 'search', value: state.q, autocomplete: 'off', placeholder: 'ör. fesleğen, koşu, karar', 'aria-describedby': 'q-hint' });
  const form = h('form', { class: 'filters', role: 'search', 'aria-label': 'Bellek arama ve filtreler', onsubmit: (e) => { e.preventDefault(); state.q = q.value.trim(); state.offset = 0; refresh(); } },
    h('div', { class: 'field q' }, h('label', { for: 'f-q' }, 'ara (tam metin, Türkçe)'), q,
      h('span', { id: 'q-hint', class: 'vh' }, 'Türkçe karakterler normalize edilir; tam kelime eşleşir.')),
    wrapFilters([
    selectEl('f-type', 'tür', [['', 'tümü'], ...meta.types.map((t) => [t, `${typeLabel(t)} (${t})`])], state.type, (e) => { state.type = e.target.value; state.offset = 0; refresh(); }),
    selectEl('f-actor', 'ajan / kaynak', [['', 'tümü'], ...meta.actors.map((a) => [a, a])], state.actor, (e) => { state.actor = e.target.value; state.offset = 0; refresh(); }),
    selectEl('f-status', 'durum', STATUS_OPTS, state.status, (e) => { state.status = e.target.value; state.offset = 0; refresh(); }),
    h('div', { class: 'field' }, h('label', { for: 'f-from' }, 'tarih ≥'), h('input', { id: 'f-from', type: 'date', value: state.from, onchange: (e) => { state.from = e.target.value; state.offset = 0; refresh(); } })),
    h('div', { class: 'field' }, h('label', { for: 'f-to' }, 'tarih ≤'), h('input', { id: 'f-to', type: 'date', value: state.to, onchange: (e) => { state.to = e.target.value; state.offset = 0; refresh(); } }))]),
    h('button', { class: 'btn', type: 'submit' }, 'Ara'),
    h('button', { class: 'btn link', type: 'button', onclick: () => { Object.assign(state, { q: '', type: '', actor: '', status: '', from: '', to: '', offset: 0 }); renderMemories(); } }, 'Temizle'));

  clear(view).append(
    h('h1', {}, 'Bellekler'),
    h('p', { class: 'lede' }, 'Kasadaki kayıtlar, en yeni önce. Salt-okunur: değişiklikler yalnızca CLI ile yapılır.'),
    form,
    h('div', { class: 'split' }, h('section', { 'aria-label': 'Bellek listesi' }, listBox), detailBox));

  async function refresh() {
    clear(listBox).append(loading('Bellekler yükleniyor…'));
    listBox.setAttribute('aria-busy', 'true');
    try {
      const d = await get('/api/memories', { q: state.q, type: state.type, actor: state.actor, status: state.status, from: state.from, to: state.to, limit: PAGE, offset: state.offset });
      drawList(d);
    } catch (err) { clear(listBox).append(errorState(err, refresh)); }
    listBox.removeAttribute('aria-busy');
  }

  function drawList(d) {
    clear(listBox);
    const filtered = state.q || state.type || state.actor || state.status || state.from || state.to;
    if (!d.items.length) {
      listBox.append(h('div', { class: 'state' },
        filtered ? [h('p', {}, state.q ? `“${state.q}” için sonuç yok.` : 'Bu filtrelerle eşleşen bellek yok.'),
          h('p', { class: 'mono' }, 'İpucu: arama tam kelime eşleştirir (ı/i, ş/s farkı yok sayılır). Filtreleri temizleyip tekrar deneyin.')]
          : [h('p', {}, 'Henüz bellek yok.'), cmd('vault import-markdown <klasör>', 'CLI komutunu kopyala')]));
      announce('Sonuç yok');
      drawDetail(null);
      return;
    }
    const from = d.offset + 1, to = d.offset + d.items.length;
    listBox.append(h('p', { class: 'result-info', role: 'status' }, `${d.total} kayıt · ${from}–${to} gösteriliyor${state.q ? ` · arama: “${state.q}”` : ''}`));
    const ul = h('ul', { class: 'list', id: 'mem-list', 'aria-label': 'Bellekler (ok tuşlarıyla gezin)' });
    for (const it of d.items) {
      const btn = h('button', { type: 'button', class: 'row', 'data-id': it.id, 'aria-current': it.id === selId ? 'true' : 'false', onclick: () => { location.hash = `#/bellekler/${it.id}`; } },
        h('span', { class: 'row-text' }, it.text_short || '(boş)'),
        it.snippet ? h('span', { class: 'snip' }, snippet(it.snippet)) : null,
        h('span', { class: 'row-meta' }, badge(it.label_key, it.label), h('span', {}, typeLabel(it.type)), h('span', {}, it.actor), timeEl(it.ts)));
      ul.append(h('li', {}, btn));
    }
    ul.addEventListener('keydown', rowKeys);
    listBox.append(ul, pager(d, (off) => { state.offset = off; refresh(); }));
    announce(`${d.total} kayıt`);
    if (!selId) drawDetail(null);
  }

  async function loadDetail(id) {
    clear(detailBox).append(loading('Ayrıntı yükleniyor…'));
    try { drawDetail(await get(`/api/memories/${encodeURIComponent(id)}`)); }
    catch (err) { clear(detailBox).append(err.status === 404 ? h('div', { class: 'state' }, h('h2', { id: 'detail-title' }, 'Kayıt bulunamadı'), h('p', { class: 'mono' }, id)) : errorState(err, () => loadDetail(id))); }
  }

  function drawDetail(d) {
    clear(detailBox);
    if (!d) {
      detailBox.append(h('h2', { id: 'detail-title' }, 'Ayrıntı'), h('p', { class: 'lede' }, 'Bir kayıt seçin: içerik, kaynak, köken, düzeltme geçmişi ve ilişkiler burada görünür.'));
      return;
    }
    detailBox.append(h('button', { type: 'button', class: 'btn link back', onclick: () => {
      const r = document.querySelector(`.row[data-id="${CSS.escape(d.id)}"]`); if (r) { r.scrollIntoView({ block: 'center' }); r.focus(); } } }, '← Listeye dön'), renderDetail(d));
  }

  await refresh();
  if (selId) {
    const sr = document.querySelector(`.row[data-id="${CSS.escape(selId)}"]`); if (sr) sr.scrollIntoView({ block: 'nearest' });
    await loadDetail(selId);
    if (matchMedia('(max-width:1100px)').matches) { detailBox.scrollIntoView({ block: 'start' }); detailBox.focus({ preventScroll: true }); }
  }
}

function rowKeys(e) {
  const rows = [...e.currentTarget.querySelectorAll('.row')];
  const i = rows.indexOf(document.activeElement);
  let n = null;
  if (e.key === 'ArrowDown' || e.key === 'j') n = Math.min(rows.length - 1, i + 1);
  else if (e.key === 'ArrowUp' || e.key === 'k') n = Math.max(0, i - 1);
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = rows.length - 1;
  if (n !== null && rows[n]) { e.preventDefault(); rows[n].focus(); }
}

function pager(d, go) {
  const prev = d.offset > 0, next = d.offset + d.items.length < d.total;
  const mk = (label, ok, off) => h('button', { class: 'btn', type: 'button', 'aria-disabled': ok ? null : 'true', onclick: () => { if (ok) go(off); } }, label);
  return h('nav', { class: 'pager', 'aria-label': 'Sayfalama' }, mk('← Önceki', prev, Math.max(0, d.offset - d.limit)),
    h('span', {}, `sayfa ${Math.floor(d.offset / d.limit) + 1} / ${Math.max(1, Math.ceil(d.total / d.limit))}`), mk('Sonraki →', next, d.offset + d.limit));
}

function mainText(p) {
  if (typeof p === 'string') return p;
  if (!p || typeof p !== 'object') return String(p ?? '');
  for (const k of ['text', 'value', 'decision', 'title', 'new_value']) if (typeof p[k] === 'string') return p[k];
  return JSON.stringify(p);
}

function renderDetail(d) {
  const h_ = d.history || {};
  const cv = d.chain_verification;
  const frag = document.createDocumentFragment();
  frag.append(
    h('p', { class: 'mono', style: null }, `${typeLabel(d.type)} · ${d.type} · ${d.subject}${d.key ? ' / ' + d.key : ''}`),
    h('h2', { id: 'detail-title', class: 'content' }, mainText(d.payload)),
    h('p', { class: 'row-meta' }, badge(d.label_key, d.label),
      cv ? badge(cv.ok ? 'ok' : 'fail', cv.ok ? 'Hash zinciri doğrulandı (bu olaya kadar)' : 'Hash zinciri DOĞRULANAMADI') : null,
      d.encrypted ? badge('', 'şifreli alanlar gösterilmez') : null));
  if (h_.effective_payload && h_.descendants && h_.descendants.length) {
    frag.append(h('p', {}, h('span', { class: 'mono' }, 'geçerli değer: '), mainText(h_.effective_payload)));
  }
  frag.append(h('h3', {}, 'Kaynak'), h('dl', { class: 'kv' },
    h('dt', {}, 'kaynak / ajan'), h('dd', { class: 'mono' }, actorLabel(d.actor)),
    h('dt', {}, 'güven'), h('dd', { class: 'mono' }, d.trust + (d.trust !== d.trust_recorded ? ` (kayıtta: ${d.trust_recorded})` : '')),
    h('dt', {}, 'event ID'), h('dd', {}, h('code', { class: 'mono' }, d.id), ' ', h('button', { class: 'btn link', type: 'button', 'aria-label': 'Event ID kopyala', onclick: (e) => copyText(d.id, e.currentTarget) }, 'kopyala')),
    h('dt', {}, 'oluşturuldu'), h('dd', {}, timeEl(d.ts)),
    h('dt', {}, 'kasaya yazıldı'), h('dd', {}, timeEl(d.recorded_at)),
    d.decided_by ? [h('dt', {}, 'karar veren'), h('dd', { class: 'mono' }, `${d.decided_by} (CLI, imzasız)`)] : null,
    d.import_id ? [h('dt', {}, 'içe aktarım'), h('dd', { class: 'mono' }, d.import_id)] : null));

  // lineage
  frag.append(h('h3', {}, 'Düzeltme / supersede geçmişi'));
  const tl = (h_.timeline || []);
  if (tl.length <= 1) frag.append(h('p', { class: 'mono' }, 'Bu kaydın düzeltmesi yok.'));
  else {
    if (h_.conflict) frag.append(h('p', { role: 'note' }, badge('fail', 'Çakışma: birden fazla geçerli baş')));
    frag.append(h('ol', { class: 'monolist', 'aria-label': 'Eskiden yeniye' }, tl.map((t) => h('li', { 'aria-current': t.selected ? 'true' : null },
      `${date(t.ts)} · ${typeLabel(t.type)} · ${shortId(t.id)} · ${ST[t.status] || t.status || '—'}`,
      t.supersedes && t.supersedes.length ? ` · supersede ${t.supersedes.map(shortId).join(', ')}` : '',
      t.targets && t.targets.length ? ` → ${t.targets.map(shortId).join(', ')}` : '',
      t.head ? ' · geçerli baş' : '', t.selected ? ' · (seçili)' : ''))));
  }

  // provenance
  frag.append(h('h3', {}, 'Kanıt / köken'));
  const prov = h('dl', { class: 'kv' });
  prov.append(h('dt', {}, 'kaynaklar'), h('dd', {}, d.sources.length
    ? h('ul', { class: 'monolist' }, d.sources.map((s) => h('li', {}, String(s))))
    : h('span', { class: 'mono' }, 'kayıtta kaynak yok')));
  prov.append(h('dt', {}, 'inceleme'), h('dd', {}, h('ul', { class: 'monolist' }, d.review.map((r) =>
    h('li', {}, `${date(r.at)} · ${({ proposed: 'önerildi', created: 'oluşturuldu', approved: 'onaylandı (CLI)', rejected: 'reddedildi', reverted: 'geri alındı', redacted: 'imha edildi', batch_approved: 'toplu onay' })[r.action] || r.action} · ${r.by}`)))));
  prov.append(h('dt', {}, 'hash'), h('dd', {}, h('code', { class: 'mono' }, d.hash)));
  prov.append(h('dt', {}, 'önceki hash'), h('dd', {}, h('code', { class: 'mono' }, d.prev_hash)));
  if (cv) prov.append(h('dt', {}, 'zincir'), h('dd', { class: 'mono' }, cv.ok ? 'genesisten bu olaya kadar her olayın hash bağı yeniden hesaplandı ve tuttu' : cv.detail));
  prov.append(h('dt', {}, 'imza'), h('dd', { class: 'mono' }, 'yok — onaylar kriptografik olarak imzalanmaz'));
  frag.append(prov);

  frag.append(h('h3', {}, 'İlişkiler'));
  if (!d.relations.length) frag.append(h('p', { class: 'mono' }, 'Veride bağlantı yok.'));
  else frag.append(h('ul', { class: 'monolist' }, d.relations.map((r) => h('li', {},
    r.id ? [r.rel, ': ', h('a', { href: `#/bellekler/${r.id}` }, shortId(r.id))] : `${r.rel} (aynı konuda ${r.same_subject_count} kayıt daha)`))));

  frag.append(h('h3', {}, 'Ham veri'), h('details', {}, h('summary', { class: 'mono' }, 'payload (şifreli alanlar çözülmez)'),
    h('pre', { class: 'payload' }, typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload, null, 2))));
  frag.append(cmd(d.cli_show, 'CLI komutunu kopyala'));
  return frag;
}

// ---------------- Kuyruk ----------------
async function renderQueue() {
  document.title = 'Kuyruk · Lattice Vault';
  const box = h('div', {});
  clear(view).append(h('h1', {}, 'Kuyruk'),
    h('p', { class: 'lede' }, 'Ajanların önerdiği, henüz karar verilmemiş kayıtlar. Bu arayüz onay vermez; kararı terminalde CLI ile siz verirsiniz.'), box,
    h('section', { class: 'planned', 'aria-labelledby': 'planned-h' },
      h('h2', { id: 'planned-h' }, 'Arayüzden korumalı onay ', badge('plan', 'Planlandı — henüz uygulanmadı')),
      h('p', {}, 'Sahip doğrulamalı, yalnızca yerel bir inceleme akışı ayrı bir güvenlik tasarımı gerektiriyor. O zamana kadar bu sunucuda hiçbir onay/ret uç noktası yoktur (tüm POST istekleri 405 döner).')));
  box.append(loading('Kuyruk yükleniyor…'));
  try {
    const d = await get('/api/queue');
    clear(box);
    document.getElementById('queue-count').textContent = `(${d.total})`;
    if (!d.items.length) { box.append(h('div', { class: 'state' }, h('p', {}, 'Bekleyen öneri yok.'))); return; }
    box.append(h('p', { class: 'result-info' }, `${d.total} öneri bekliyor · en eski önce`));
    box.append(h('ul', { class: 'list' }, d.items.map((it) => h('li', { class: 'qitem' },
      h('span', { class: 'row-text' }, it.text_short),
      h('span', { class: 'row-meta' }, badge(it.label_key, it.label), h('span', {}, typeLabel(it.type)), h('span', {}, it.actor), h('span', {}, `güven: ${it.trust}`), timeEl(it.ts),
        h('a', { href: `#/bellekler/${it.id}` }, `ayrıntı ${shortId(it.id)}`)),
      cmd(it.cli_approve, 'CLI komutunu kopyala (onay)'), cmd(it.cli_reject, 'CLI komutunu kopyala (ret)')))));
  } catch (err) { clear(box).append(errorState(err, renderQueue)); }
}

// ---------------- Geçmiş ----------------
async function renderHistory() {
  document.title = 'Geçmiş · Lattice Vault';
  const box = h('div', {});
  clear(view).append(h('h1', {}, 'Geçmiş'),
    h('p', { class: 'lede' }, 'Yalnızca-ekleme olay günlüğü (tüm olaylar, onay/ret/düzeltme dahil), en yeni önce. Hiçbir olay silinmez; imha edilenlerin içeriği gizlenir.'), box);
  async function load() {
    clear(box).append(loading('Geçmiş yükleniyor…'));
    try {
      const d = await get('/api/history', { limit: PAGE, offset: state.histOffset });
      clear(box);
      if (!d.items.length) { box.append(h('div', { class: 'state' }, h('p', {}, 'Günlükte olay yok.'))); return; }
      box.append(h('p', { class: 'result-info' }, `${d.total} olay`));
      box.append(h('ol', { class: 'timeline', 'aria-label': 'Olay günlüğü' }, d.items.map((it) => h('li', {},
        h('span', { class: 'when' }, date(it.ts)), h('span', { class: 'seq' }, `#${it.seq}`),
        h('span', {}, h('strong', {}, typeLabel(it.type)), ' ', it.meta ? null : badge(it.label_key, it.label), ' ',
          h('span', { class: 'mono' }, `${it.actor} · `), h('a', { href: `#/bellekler/${it.id}`, class: 'mono' }, shortId(it.id)),
          it.targets.length ? h('span', { class: 'mono' }, ` → ${it.targets.map(shortId).join(', ')}`) : null,
          it.supersedes.length ? h('span', { class: 'mono' }, ` · supersede ${it.supersedes.map(shortId).join(', ')}`) : null,
          it.text_short ? h('span', { class: 'snip' }, it.text_short) : null)))));
      box.append(pager(d, (off) => { state.histOffset = off; load(); view.parentElement.focus(); }));
    } catch (err) { clear(box).append(errorState(err, load)); }
  }
  await load();
}

// ---------------- Ayarlar ----------------
async function renderSettings() {
  document.title = 'Ayarlar · Lattice Vault';
  const m = state.meta || await loadMeta();
  const sec = (title, ...kids) => h('section', { 'aria-labelledby': `s-${title}` }, h('h2', { id: `s-${title}` }, title), ...kids);
  clear(view).append(h('div', { class: 'settings' }, h('h1', {}, 'Ayarlar'),
    h('p', { class: 'lede' }, 'Bilgi amaçlı, salt-okunur. Bu ekrandan hiçbir ayar değiştirilmez.'),
    m ? sec('Kasa',
      h('dl', { class: 'kv' },
        h('dt', {}, 'veritabanı'), h('dd', { class: 'mono' }, `${m.db_file} (tam yol gizlendi)`),
        h('dt', {}, 'erişim'), h('dd', { class: 'mono' }, 'salt-okunur (SQLite mode=ro)'),
        h('dt', {}, 'sunucu'), h('dd', { class: 'mono' }, `${m.bind} — yalnızca bu bilgisayar`),
        h('dt', {}, 'şema'), h('dd', { class: 'mono' }, `v${m.schema_version}`),
        h('dt', {}, 'olay sayısı'), h('dd', { class: 'mono' }, String(m.events_total)),
        h('dt', {}, 'bekleyen'), h('dd', { class: 'mono' }, String(m.pending)))) : errorState(new Error('meta okunamadı'), renderSettings),
    sec('Gizlilik',
      h('ul', {}, h('li', {}, 'Tamamen yerel: veri hiçbir yere gönderilmez; harici font/CDN/analitik yok (CSP: yalnızca self).'),
        h('li', {}, 'Şifreli alanlar bu arayüzde çözülmez; gizli anahtar benzeri metinler [filtered] olarak gösterilir.'))),
    sec('Yedekleme ve dışa aktarma (CLI)',
      cmd('vault backup --out <hedef-klasör>', 'CLI komutunu kopyala'),
      cmd('vault export-context --out baglam.md', 'CLI komutunu kopyala'),
      cmd('vault doctor --full', 'CLI komutunu kopyala'),
      h('p', { class: 'mono' }, '“vault” = core deposundaki python3 vault.py. Tam komut listesi: python3 vault.py --help')),
    sec('Güvenlik sınırları (dürüst not)',
      h('ul', {},
        h('li', {}, 'Onaylar imzasızdır: “Onaylandı (CLI)” yalnızca yerel kullanıcı hesabının CLI komutu çalıştırdığını gösterir; kriptografik doğrulama değildir.'),
        h('li', {}, 'Bu arayüz erişim denetimi/oturum açma yapmaz; aynı bilgisayardaki herhangi bir yerel süreç 127.0.0.1 portuna erişebilir.'),
        h('li', {}, 'Arayüz kendi okuma erişimini denetim (audit) kaydına yazmaz.'),
        h('li', {}, 'Hash zinciri değişikliği tespit eder; ancak dosyaya yazma yetkisi olan biri zinciri baştan üretebilir (imza/çapa yok).'),
        h('li', {}, 'Koyu tema ve arayüzden korumalı onay planlandı, henüz yok.'))),
    sec('Lisanslar', h('p', {}, 'Yazı tipleri: Source Serif 4 ve IBM Plex Mono — SIL Open Font License 1.1 (',
      h('a', { href: '/static/fonts/OFL-SourceSerif4.txt' }, 'Source Serif 4'), ', ', h('a', { href: '/static/fonts/OFL-IBMPlexMono.txt' }, 'IBM Plex Mono'), ').'))));
}

// ---------------- router ----------------
async function route() {
  const [, tab = 'bellekler', id] = (location.hash || '#/bellekler').split('/');
  const t = ['bellekler', 'kuyruk', 'gecmis', 'ayarlar'].includes(tab) ? tab : 'bellekler';
  setTab(t);
  if (t === 'kuyruk') await renderQueue();
  else if (t === 'gecmis') await renderHistory();
  else if (t === 'ayarlar') await renderSettings();
  else {
    const prevFocusRow = document.activeElement && document.activeElement.classList.contains('row');
    await renderMemories(id ? decodeURIComponent(id) : null);
    if (prevFocusRow && id) { const r = document.querySelector(`.row[data-id="${CSS.escape(decodeURIComponent(id))}"]`); if (r) r.focus(); }
  }
}
window.addEventListener('hashchange', route);
loadMeta();
route();
