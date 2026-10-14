import { h } from './dom.js';
// Absolute dates in Europe/Istanbul (UTC+3, no DST since 2016).
const DF = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function date(ts) {
  if (!ts) return '—';
  const d = new Date(ts); if (isNaN(d)) return ts;
  const p = Object.fromEntries(DF.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (UTC+3)`;
}
export function timeEl(ts) { return h('time', { datetime: ts, class: 'mono' }, date(ts)); }
const KIND = { preference: 'tercih', decision: 'karar', project: 'proje', goal: 'hedef', learning: 'öğrenme', event: 'olay', import: 'içe aktarım', subject: 'konu', conflict: 'çakışma' };
const TYPE = { 'event.approved': 'onay', 'event.rejected': 'ret', 'event.reverted': 'geri alma', 'event.corrected': 'düzeltme', 'event.redacted': 'imha', 'subject.shredded': 'konu imhası', 'import.batch_approved': 'toplu onay' };
export function typeLabel(t) { return TYPE[t] || KIND[t.split('.')[0]] || t; }
export function shortId(id) { return id ? '…' + id.slice(-12) : '—'; }
export function badge(key, text) { return h('span', { class: `badge ${key}` }, text); }
export function actorLabel(a) { return a.startsWith('agent:') ? `ajan · ${a.slice(6)}` : a.startsWith('user:') ? `kullanıcı · ${a.slice(5)}` : a; }
