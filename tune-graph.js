/* ATBB tune graph — TunerPro-style heat colours, 3D surface (2-D tables) and line graph (1-D tables). Pure canvas, no deps. */
(function (root) {
'use strict';
function heat(p) {
 p = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
 const hue = 215 - p * 210;
 return `hsl(${hue}, 85%, ${40 + Math.sin(p * Math.PI) * 8}%)`;
}
// TunerPro palette: cyan (low) → grey (mid) → red (high)
function tpHeat(p) {
 p = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
 const lo = [128, 255, 255], mid = [196, 196, 196], hi = [255, 92, 92];
 const [a, b, t] = p < 0.5 ? [lo, mid, p / 0.5] : [mid, hi, (p - 0.5) / 0.5];
 return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}
function range(values) {
 let min = Infinity, max = -Infinity;
 for (const row of values) for (const v of row) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
 if (!Number.isFinite(min)) return [0, 1];
 if (min === max) return [min - 1, max + 1];
 return [min, max];
}
const norm = (v, [min, max]) => (v - min) / (max - min);
function prep(canvas) {
 const dpr = root.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 360;
 if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
 const ctx = canvas.getContext('2d'); if (!ctx) return null;
 ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
 return { ctx, W, H };
}
function label(ctx, text, x, y, color = '#8fa3bd') { ctx.fillStyle = color; ctx.fillText(String(text), x, y); }
function line(canvas, values, opts) {
 const g = prep(canvas); if (!g) return; const { ctx, W, H } = g;
 const series = values.length > 1 ? values.map(r => r[0]) : values[0];
 const axis = values.length > 1 ? opts.rowAxis : opts.colAxis;
 const rg = range([series]), padL = 54, padR = 16, padT = 16, padB = 34;
 const x = i => padL + (series.length < 2 ? 0.5 : i / (series.length - 1)) * (W - padL - padR);
 const y = v => padT + (1 - norm(v, rg)) * (H - padT - padB);
 ctx.font = '11px Prompt, sans-serif'; ctx.strokeStyle = '#1d2c42'; ctx.lineWidth = 1;
 for (let k = 0; k <= 4; k++) { const v = rg[0] + (rg[1] - rg[0]) * k / 4, yy = y(v); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke(); label(ctx, v.toFixed(opts.decimals ?? 1), 6, yy + 4); }
 const step = Math.max(1, Math.ceil(series.length / 10));
 series.forEach((_, i) => { if (i % step === 0 || i === series.length - 1) label(ctx, axis?.[i] ?? i, x(i) - 8, H - 12); });
 ctx.lineWidth = 2.5; ctx.strokeStyle = '#2fb8ff'; ctx.beginPath(); series.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke();
 series.forEach((v, i) => { ctx.beginPath(); ctx.fillStyle = tpHeat(norm(v, rg)); ctx.arc(x(i), y(v), opts.active?.r === i || opts.active?.c === i ? 6 : 3.5, 0, Math.PI * 2); ctx.fill(); });
}
function surface(canvas, values, opts) {
 const g = prep(canvas); if (!g) return; const { ctx, W, H } = g;
 const rows = values.length, cols = values[0].length, rg = range(values), cam = opts.cam || { yaw: -0.6, pitch: 0.55, zoom: 1 };
 const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
 const scale = Math.min(W, H) * 0.42 * cam.zoom;
 const proj = (x, y, z) => { const xr = x * cy - y * sy, yr = x * sy + y * cy, zz = (z - 0.35) * 1.3, up = zz * cp + yr * sp, depth = yr * cp - zz * sp, k = 1 / (1 + depth * 0.2); return { x: W / 2 + xr * scale * k, y: H * 0.56 - up * scale * k, d: depth }; };
 const X = c => cols < 2 ? 0 : (c / (cols - 1)) * 2 - 1, Y = r => rows < 2 ? 0 : (r / (rows - 1)) * 2 - 1;
 ctx.font = '10px Prompt, sans-serif'; ctx.strokeStyle = 'rgba(47,184,255,.3)'; ctx.lineWidth = 1; ctx.beginPath();
 [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([a, b], i) => { const q = proj(a, b, 0); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
 for (const r of [0, Math.floor(rows / 2), rows - 1]) { const q = proj(-1.15, Y(r), 0); label(ctx, opts.rowAxis?.[r] ?? r, q.x - 22, q.y); }
 for (const c of [0, Math.floor(cols / 2), cols - 1]) { const q = proj(X(c), 1.15, 0); label(ctx, opts.colAxis?.[c] ?? c, q.x - 8, q.y + 6); }
 const pts = values.map((row, r) => row.map((v, c) => ({ ...proj(X(c), Y(r), norm(v, rg)), p: norm(v, rg) })));
 const quads = [];
 for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const q = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]]; quads.push({ q, d: q.reduce((s, p) => s + p.d, 0) / 4, p: q.reduce((s, p) => s + p.p, 0) / 4 }); }
 quads.sort((a, b) => b.d - a.d);
 for (const qd of quads) { ctx.beginPath(); qd.q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = tpHeat(qd.p); ctx.fill(); ctx.strokeStyle = 'rgba(5,14,30,.55)'; ctx.stroke(); }
 const a = opts.active; if (a && pts[a.r]?.[a.c]) { const p = pts[a.r][a.c]; ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#36edb0'; ctx.lineWidth = 3; ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
 label(ctx, 'ลากเพื่อหมุน · ล้อเมาส์/สองนิ้วเพื่อซูม', 10, H - 10, '#61748d');
}
function draw(canvas, values, opts = {}) {
 if (!canvas || !values?.length || !values[0]?.length) return;
 (values.length > 1 && values[0].length > 1 ? surface : line)(canvas, values, opts);
}
function attachOrbit(canvas, cam, redraw) {
 const pointers = new Map(); let pinch = 0;
 canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
 canvas.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId); if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * d / pinch)); pinch = d; }
  else { cam.yaw += (e.clientX - prev.x) * 0.01; cam.pitch = Math.max(0.05, Math.min(1.45, cam.pitch + (e.clientY - prev.y) * 0.01)); }
  redraw();
 });
 const end = e => { pointers.delete(e.pointerId); pinch = 0; };
 canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
 canvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); redraw(); }, { passive: false });
}
root.ATBBTuneGraph = { heat, tpHeat, range, norm, draw, attachOrbit };
})(globalThis);
