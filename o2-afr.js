/* ATBB · AFR ประมาณจากเซนเซอร์ O2 (narrowband) ของกล่องเดิม
 * 1) หา byte แรงดัน O2: ดูทุก byte ในตารางหลักและตารางเสริม (raw/raw20/raw21 จาก ESP32)
 *    แล้วจัดอันดับ byte ที่แกว่งขึ้น–ลงแบบ O2 (closed loop สลับหนา/บางราว 1 ครั้ง/วินาที)
 * 2) ผู้ใช้เลือก byte → แปลงเป็นแรงดัน → AFR ประมาณตามเส้นโค้ง narrowband
 * 3) เติมค่าเข้า event 'sg:kline' (d.o2, d.afr, d.afrSrc) ก่อนหน้าอื่นใช้ จึงแสดงได้ทุกหน้า
 * ต้องโหลดหลัง script.js และก่อน maptable.js / tuning.js
 */
(function () {
'use strict';
const KEY = 'atbb-o2-source', WINDOW_MS = 45000;
// แกนหลักของตาราง 0x10/0x11 ที่รู้ความหมายแล้ว → ไม่นับเป็นผู้สมัคร
const KNOWN = { '10': new Set([0,1,2,3,4,5,6,7,8,9,12,13,14,15,16]), '11': new Set([0,1,2,3,4,5,6,7,8,9,12,13,14,15,16]) };
const SCALES = { v5: { label: '0–5 V (raw × 5/255)', f: r => r * 5 / 255 }, v1: { label: '0–1 V (raw / 255)', f: r => r / 255 } };
// เส้นโค้ง narrowband ทั่วไป: แรงดัน → AFR (แม่นเฉพาะแถว 14.7 · ห่างออกไปเป็นค่าประมาณคร่าวๆ)
const CURVE = [[0.05,16.2],[0.1,15.8],[0.2,15.2],[0.3,14.95],[0.4,14.8],[0.45,14.7],[0.5,14.6],[0.6,14.4],[0.7,14.0],[0.8,13.4],[0.85,13.0],[0.9,12.6]];
function afrFromVolts(v) {
 if (!Number.isFinite(v)) return null;
 if (v <= CURVE[0][0]) return CURVE[0][1];
 for (let i = 1; i < CURVE.length; i++) if (v <= CURVE[i][0]) { const [a, fa] = CURVE[i - 1], [b, fb] = CURVE[i]; return fa + (fb - fa) * (v - a) / (b - a); }
 return CURVE[CURVE.length - 1][1];
}
function frameBytes(hex) {
 if (typeof hex !== 'string' || hex.length < 12 || hex.length % 2) return null;
 const b = []; for (let i = 0; i < hex.length; i += 2) { const v = parseInt(hex.slice(i, i + 2), 16); if (!Number.isFinite(v)) return null; b.push(v); }
 if (b[0] !== 0x02 || b[2] !== 0x71) return null;
 const table = b[3].toString(16).toUpperCase().padStart(2, '0');
 return { table, data: b.slice(4, Math.min(b.length, b[1]) - 1) };
}
const load = () => { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && typeof c.table === 'string' && Number.isInteger(c.idx) && SCALES[c.scale] ? c : null; } catch { return null; } };
const save = c => { try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch {} };
let source = load(), latest = {}, last = null;
const stats = new Map();   // key "T11:17" → [{t,v}]
function record(frame, now) {
 if (!frame) return;
 latest[frame.table] = frame.data;
 frame.data.forEach((v, idx) => {
  if (KNOWN[frame.table]?.has(idx)) return;
  const k = `T${frame.table}:${idx}`; let a = stats.get(k); if (!a) stats.set(k, a = []);
  a.push({ t: now, v }); while (a.length && now - a[0].t > WINDOW_MS) a.shift();
 });
}
function score(samples) {
 if (samples.length < 12) return null;
 let min = 255, max = 0; for (const s of samples) { if (s.v < min) min = s.v; if (s.v > max) max = s.v; }
 const range = max - min; if (range < 10) return { min, max, swings: 0 };
 const lo = min + range * 0.35, hi = min + range * 0.65; let state = null, swings = 0;
 for (const s of samples) { if (s.v >= hi && state !== 'hi') { if (state === 'lo') swings++; state = 'hi'; } else if (s.v <= lo && state !== 'lo') { if (state === 'hi') swings++; state = 'lo'; } }
 const minutes = Math.max(0.25, (samples[samples.length - 1].t - samples[0].t) / 60000);
 // O2 สลับ หนา/บาง: ค่าส่วนใหญ่อยู่ใกล้ขอบบน-ล่าง (mid ต่ำ) และขึ้น-ลงพอๆ กัน
 // ตัวนับ/ค่าที่ไต่ขึ้นเรื่อยๆ: กระจายทั้งช่วง (mid สูง) และเปลี่ยนไปทางเดียว (mono สูง)
 let mid = 0, up = 0, down = 0;
 samples.forEach((s, i) => { if (s.v > lo && s.v < hi) mid++; if (i) { const d = s.v - samples[i - 1].v; if (d > 0) up++; else if (d < 0) down++; } });
 const mono = (up + down) ? Math.max(up, down) / (up + down) : 1;
 return { min, max, swings, perMin: swings / minutes, mid: mid / samples.length, mono };
}
function candidates() {
 const out = [];
 for (const [k, a] of stats) { const s = score(a); if (s && s.swings >= 4 && s.mono < 0.85) out.push({ k, ...s, now: a[a.length - 1].v }); }
 // คะแนนต่ำ = เหมือน O2: อยู่ขอบบน/ล่างเป็นส่วนใหญ่ + แกว่ง 15–150 ครั้ง/นาที
 const rank = c => c.mid * 2 + Math.abs(Math.log((c.perMin + 1) / 60)) * 0.5 + (c.perMin < 15 || c.perMin > 150 ? 1 : 0);
 out.sort((x, y) => rank(x) - rank(y));
 return out.slice(0, 6);
}
function current() {
 if (!source) return null;
 const data = latest[source.table]; if (!data || source.idx >= data.length) return null;
 const raw = data[source.idx], volts = SCALES[source.scale].f(raw);
 return { raw, volts, afr: afrFromVolts(volts) };
}
// ── เติมค่าเข้า event ก่อนหน้าอื่นอ่าน ─────────────────────
window.addEventListener('sg:kline', e => {
 const d = e.detail; if (!d || typeof d !== 'object') return;
 const now = Date.now();
 record(frameBytes(d.raw), now); record(frameBytes(d.raw20), now); record(frameBytes(d.raw21), now);
 last = now;
 const c = current();
 if (c && (d.afr === null || d.afr === undefined)) {   // ไม่ทับค่า AFR จริง (เช่น wideband)
  d.o2 = Math.round(c.volts * 100) / 100;
  d.afr = Math.round(c.afr * 10) / 10;
  d.afrSrc = 'O2_NARROWBAND_EST';
 }
});
// ── UI ในหน้าจูน ECU ─────────────────────────────────────
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function mount() {
 const anchor = document.querySelector('.tune-panel .tune-status'); if (!anchor || document.getElementById('o2-card')) return;
 const card = el('details', 'tune-card tune-o2'); card.id = 'o2-card'; card.open = !source;
 const sum = el('summary'); sum.append(el('b', '', 'AFR จาก O2 (ประมาณ)'), el('span', 'tune-o2-sum')); sum.lastChild.id = 'o2-summary';
 const body = el('div', 'tune-o2-body'); body.id = 'o2-body';
 card.append(sum, body); anchor.after(card); render();
}
function render() {
 const body = document.getElementById('o2-body'), summary = document.getElementById('o2-summary'); if (!body) return;
 const fresh = last && Date.now() - last < 3000, c = current();
 summary.textContent = source ? (c && fresh ? ` · O2 ${c.volts.toFixed(2)} V → AFR ~${c.afr.toFixed(1)} ${c.volts >= 0.45 ? '(หนา)' : '(บาง)'}` : ' · รอข้อมูล') : ' · ยังไม่ได้เลือกแหล่ง O2';
 body.replaceChildren();
 if (source) {
  const p = el('p', '', `ใช้ตาราง ${source.table} byte ${source.idx} · ${SCALES[source.scale].label}`); body.append(p);
  if (c && fresh) {
   const meter = el('div', 'tune-o2-meter'), bar = el('i'); bar.style.left = `${Math.min(100, Math.max(0, c.volts / 1 * 100))}%`; meter.append(el('span', '', 'บาง'), bar, el('span', '', 'หนา')); body.append(meter);
  }
  const note = el('p', 'tune-note', 'เซนเซอร์เดิมเป็น narrowband: เชื่อได้แค่ หนา/บาง และค่าแถว 14.7 · ตัวเลขที่ห่างจาก 14.7 เป็นค่าประมาณคร่าวๆ ถ้าจะจูนจริงควรใช้ wideband'); body.append(note);
  const reset = el('button', 'tune-btn', 'เปลี่ยน / ยกเลิกแหล่ง O2'); reset.type = 'button'; reset.onclick = () => { source = null; save(null); document.getElementById('o2-card').open = true; render(); }; body.append(reset);
  return;
 }
 body.append(el('p', '', fresh ? 'ติดเครื่องให้ร้อน แล้วเดินเบาค้างไว้ 1–2 นาที ระบบจะหา byte ที่แกว่งขึ้นลงแบบเซนเซอร์ O2 แล้วเสนอด้านล่าง' : 'เชื่อมต่อ ESP32 (โหมด PVX150) ก่อน · ต้องใช้เฟิร์มแวร์ที่ส่ง raw20/raw21'));
 const list = candidates();
 if (!list.length) { body.append(el('p', 'tune-note', fresh ? `กำลังเก็บข้อมูล… (${stats.size} byte ที่ติดตาม)` : '')); return; }
 const table = el('table', 'tune-o2-table'), head = table.createTHead().insertRow();
 for (const h of ['แหล่ง', 'ตอนนี้', 'ต่ำ–สูง', 'แกว่ง/นาที', 'สเกล', '']) head.append(el('th', '', h));
 const tb = table.createTBody();
 list.forEach((c, i) => {
  const [table_, idx] = c.k.slice(1).split(':'), row = tb.insertRow();
  row.insertCell().textContent = `ตาราง ${table_} · byte ${idx}${i === 0 ? ' ⭐' : ''}`;
  row.insertCell().textContent = String(c.now);
  row.insertCell().textContent = `${c.min}–${c.max}`;
  row.insertCell().textContent = c.perMin.toFixed(0);
  const sel = el('select'); for (const [k, s] of Object.entries(SCALES)) { const o = el('option', '', s.label); o.value = k; sel.append(o); } sel.value = c.max <= 60 ? 'v5' : 'v1'; row.insertCell().append(sel);
  const use = el('button', 'tune-btn tune-btn-go', 'ใช้ค่านี้'); use.type = 'button';
  use.onclick = () => { source = { table: table_, idx: Number(idx), scale: sel.value }; save(source); document.getElementById('o2-card').open = false; render(); };
  row.insertCell().append(use);
 });
 body.append(table, el('p', 'tune-note', '⭐ = น่าจะเป็น O2 มากที่สุด (แกว่ง ~20–120 ครั้ง/นาที) · ถ้าเลือกแล้วค่าไม่ขยับตามการบิด/ปล่อยคันเร่ง ให้กดเปลี่ยนแล้วลองอันดับถัดไป'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
setInterval(() => { const card = document.getElementById('o2-card'); if (card?.offsetParent !== null && !card.contains(document.activeElement)) render(); }, 1000);  // ไม่วาดทับตอนผู้ใช้กำลังเลือก
window.ATBBO2 = { afrFromVolts, frameBytes, candidates, get source() { return source; } };
})();
