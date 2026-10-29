// ========================================================
// SGMap — หน้าตารางจูนแบบ TunePro
//  • ตาราง 2D ไล่สี + มุมมอง 3D (หมุน/ซูมได้)
//  • ค่าในช่อง = ค่าที่แก้เอง (ถ้ามี) ไม่งั้นใช้ค่าเฉลี่ยที่วัดได้จาก ESP32 ขณะขี่
//  • แก้ค่าได้: ใส่ค่า, +/−, %, interpolate X/Y/XY, smooth, ก๊อบ/วาง, undo/redo
//  • ✔ บันทึก / ✖ ยกเลิกการแก้ — เก็บในแอปเท่านั้น ยังไม่ได้เขียนลงกล่อง ECU
//  รับข้อมูลสดจาก event 'sg:kline' ที่ script.js ส่งทุกครั้งที่ได้ KLINE_DATA
// ========================================================
(function () {
    'use strict';

    // แกนเดียวกับตาราง Fuel Base Map ของ TunePro (รอบต่ำอยู่บน)
    const RPM_BINS = [840, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2250, 2500, 2750,
        3000, 3250, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 9800];
    const TPS_BINS = [0.0, 0.5, 1.0, 1.5, 2.6, 3.3, 4.0, 4.6, 5.2, 6.5, 7.8, 10.5, 13.0,
        15.7, 18.3, 21.0, 24.5, 27.6, 34.8, 41.9, 52.2, 58.9, 66.0, 78.2, 95.0];
    const NR = RPM_BINS.length, NC = TPS_BINS.length;

    // key = ฟิลด์ใน JSON ของ ESP32, step = ขนาดของปุ่ม +/−
    const TABLES = {
        inj: { name: 'Fuel หัวฉีด (ms)', dec: 2, step: 0.05 },
        igt: { name: 'Ignition องศาไฟ (°)', dec: 1, step: 0.5 },
        afr: { name: 'AFR อัตราส่วนไอดี', dec: 1, step: 0.1 },
        map: { name: 'MAP แรงดันท่อไอดี (kPa)', dec: 0, step: 1 },
        load: { name: 'Load โหลด (%)', dec: 0, step: 1 },
    };
    const KEYS = Object.keys(TABLES);

    const LOG_KEY = 'sg_map_tables_v2';     // ค่าเฉลี่ยจาก log (เหมือนเวอร์ชันก่อน)
    const EDIT_KEY = 'sg_map_edits_v1';     // ค่าที่ผู้ใช้แก้แล้วกด ✔
    const TRAIL_MS = 1500;

    const $ = id => document.getElementById(id);
    const grid = $('map-grid');
    if (!grid) return;

    // ── ข้อมูล ───────────────────────────────────────
    const blank = (fill) => Array.from({ length: NR }, () => Array.from({ length: NC }, fill));
    function loadLog() {
        try {
            const raw = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
            if (raw && raw.rpm && raw.rpm.join() === RPM_BINS.join() && raw.tps.join() === TPS_BINS.join()) {
                for (const k of KEYS) if (!raw.t[k]) raw.t[k] = blank(() => ({ sum: 0, n: 0 }));
                return raw.t;
            }
        } catch (_) { }
        const t = {};
        for (const k of KEYS) t[k] = blank(() => ({ sum: 0, n: 0 }));
        return t;
    }
    function loadEdits() {
        try {
            const raw = JSON.parse(localStorage.getItem(EDIT_KEY) || 'null');
            if (raw && raw.rpm && raw.rpm.join() === RPM_BINS.join()) {
                for (const k of KEYS) if (!raw.t[k]) raw.t[k] = blank(() => null);
                return raw.t;
            }
        } catch (_) { }
        const t = {};
        for (const k of KEYS) t[k] = blank(() => null);
        return t;
    }

    const logData = loadLog();
    const saved = loadEdits();          // ค่าที่บันทึกแล้ว
    let draft = null;                   // ค่าที่กำลังแก้ (ยังไม่กด ✔) — สำเนาของ saved[current]
    let current = localStorage.getItem('sg_map_current');
    if (!TABLES[current]) current = 'inj';
    let undoStack = [], redoStack = [];
    let clipboard = null;

    const edits = () => draft || saved[current];
    function cellValue(r, c) {
        const e = edits()[r][c];
        if (e !== null && e !== undefined) return e;
        const l = logData[current][r][c];
        return l.n ? l.sum / l.n : null;
    }
    const isEdited = (r, c) => { const e = edits()[r][c]; return e !== null && e !== undefined; };

    let saveLogTimer = null;
    function scheduleLogSave() {
        if (saveLogTimer) return;
        saveLogTimer = setTimeout(() => {
            saveLogTimer = null;
            try { localStorage.setItem(LOG_KEY, JSON.stringify({ rpm: RPM_BINS, tps: TPS_BINS, t: logData })); } catch (_) { }
        }, 3000);
    }
    function saveEdits() {
        try { localStorage.setItem(EDIT_KEY, JSON.stringify({ rpm: RPM_BINS, tps: TPS_BINS, t: saved })); } catch (_) { }
    }

    // ── สี (ฟ้า → เขียว → เหลือง → แดง แบบในรูป) ───────
    function heat(p) {
        const hue = 215 - Math.max(0, Math.min(1, p)) * 210;
        return `hsl(${hue}, 95%, ${48 + Math.sin(p * Math.PI) * 6}%)`;
    }
    function range() {
        let min = Infinity, max = -Infinity;
        for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
            const v = cellValue(r, c);
            if (v === null) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return min === Infinity ? [0, 0] : [min, max];
    }
    const norm = (v, min, max) => max > min ? (v - min) / (max - min) : 0.5;

    // ── สถานะหน้าจอ ─────────────────────────────────
    let liveCell = null;
    const trail = new Map();
    let sel = { r0: 0, c0: 0, r1: 0, c1: 0, active: false };
    let rangeMode = false;
    let realTime = true;
    let fit = false;
    let view3d = false;
    let cells = [];

    const nearest = (bins, v) => {
        let best = 0;
        for (let i = 1; i < bins.length; i++) if (Math.abs(bins[i] - v) < Math.abs(bins[best] - v)) best = i;
        return best;
    };
    const selBox = () => ({
        rA: Math.min(sel.r0, sel.r1), rB: Math.max(sel.r0, sel.r1),
        cA: Math.min(sel.c0, sel.c1), cB: Math.max(sel.c0, sel.c1),
    });

    // ── ตาราง 2D ────────────────────────────────────
    function build() {
        let html = `<thead><tr><th class="map-corner">Y \\ X</th>`;
        TPS_BINS.forEach((t, c) => { html += `<th class="map-col-h" data-c="${c}">${t.toFixed(1)}</th>`; });
        html += '</tr></thead><tbody>';
        for (let r = 0; r < NR; r++) {
            html += `<tr><th class="map-row-h" data-r="${r}">${RPM_BINS[r]}</th>`;
            for (let c = 0; c < NC; c++) html += `<td data-r="${r}" data-c="${c}"></td>`;
            html += '</tr>';
        }
        grid.innerHTML = html + '</tbody>';
        cells = RPM_BINS.map((_, r) => TPS_BINS.map((_, c) => grid.querySelector(`td[data-r="${r}"][data-c="${c}"]`)));
    }

    function renderGrid() {
        const [min, max] = range();
        const dec = TABLES[current].dec;
        for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
            const td = cells[r][c], v = cellValue(r, c);
            if (v === null) { td.textContent = ''; td.style.background = ''; td.style.color = ''; td.classList.remove('edited'); continue; }
            const p = norm(v, min, max);
            td.textContent = v.toFixed(dec);
            td.style.background = heat(p);
            td.style.color = (p > 0.3 && p < 0.75) ? '#05101c' : '#fff';
            td.classList.toggle('edited', isEdited(r, c));
        }
        $('map-lg-min').textContent = min.toFixed(dec);
        $('map-lg-mid').textContent = ((min + max) / 2).toFixed(dec);
        $('map-lg-max').textContent = max.toFixed(dec);
        renderSel();
        renderLive();
    }

    function renderSel() {
        grid.querySelectorAll('td.sel').forEach(td => td.classList.remove('sel'));
        if (!sel.active) return;
        const b = selBox();
        for (let r = b.rA; r <= b.rB; r++) for (let c = b.cA; c <= b.cB; c++) cells[r][c].classList.add('sel');
    }

    function renderLive() {
        grid.querySelectorAll('.live, .trail, .live-axis').forEach(el => el.classList.remove('live', 'trail', 'live-axis'));
        const now = Date.now();
        for (const [k, ts] of trail) {
            if (now - ts > TRAIL_MS) { trail.delete(k); continue; }
            const [r, c] = k.split(',').map(Number);
            cells[r][c].classList.add('trail');
        }
        if (!liveCell || !realTime) return;
        const td = cells[liveCell.r][liveCell.c];
        td.classList.add('live');
        grid.querySelector(`th[data-r="${liveCell.r}"]`).classList.add('live-axis');
        grid.querySelector(`th[data-c="${liveCell.c}"]`).classList.add('live-axis');
        if (!fit) {
            const wrap = $('map-grid-wrap'), pad = 40;
            if (td.offsetLeft - pad < wrap.scrollLeft) wrap.scrollLeft = td.offsetLeft - pad - 40;
            else if (td.offsetLeft + td.offsetWidth > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = td.offsetLeft + td.offsetWidth - wrap.clientWidth + 10;
            if (td.offsetTop - pad < wrap.scrollTop) wrap.scrollTop = td.offsetTop - pad;
            else if (td.offsetTop + td.offsetHeight > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = td.offsetTop + td.offsetHeight - wrap.clientHeight + 10;
        }
    }

    // ── มุมมอง 3D (canvas, painter's algorithm) ───────
    const canvas = $('map-canvas3d');
    const ctx = canvas.getContext('2d');
    const cam = { yaw: -0.55, pitch: 0.6, zoom: 0.7 };

    function render3d() {
        if (!view3d) return;
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        if (!W || !H) return;
        if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const [min, max] = range();
        const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
        const scale = Math.min(W, H) * 0.42 * cam.zoom;
        // จุดในโลก: x = TPS (−1..1), y = RPM (−1..1), z = ค่า (0..1)
        function proj(x, y, z) {
            const xr = x * cy - y * sy, yr = x * sy + y * cy;
            const zz = (z - 0.35) * 1.3;                // ความสูงของพื้นผิว
            const up = zz * cp + yr * sp;                // กล้องมองจากด้านหน้า-ด้านบน (pitch = มุมก้ม)
            const depth = yr * cp - zz * sp;             // ค่ามาก = ไกลกล้อง
            const persp = 1 / (1 + depth * 0.2);
            return { x: W / 2 + xr * scale * persp, y: H * 0.55 - up * scale * persp, d: depth };
        }
        const X = c => (c / (NC - 1)) * 2 - 1, Y = r => (r / (NR - 1)) * 2 - 1;
        const pts = blank(() => null);
        for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
            const v = cellValue(r, c);
            pts[r][c] = v === null ? null : { ...proj(X(c), Y(r), norm(v, min, max)), p: norm(v, min, max) };
        }

        // ฐานและแกน
        ctx.strokeStyle = 'rgba(0,210,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([x, y], i) => {
            const q = proj(x, y, 0); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        });
        ctx.stroke();
        ctx.fillStyle = '#7aaeff';
        ctx.font = '10px Orbitron, monospace';
        [0, Math.floor(NR / 3), Math.floor(2 * NR / 3), NR - 1].forEach(r => {
            const q = proj(-1.12, Y(r), 0); ctx.fillText(RPM_BINS[r], q.x - 18, q.y);
        });
        [0, Math.floor(NC / 3), Math.floor(2 * NC / 3), NC - 1].forEach(c => {
            const q = proj(X(c), 1.12, 0); ctx.fillText(TPS_BINS[c].toFixed(1), q.x - 8, q.y + 4);
        });
        const qr = proj(-1.25, 0, 0), qt = proj(0, 1.3, 0);
        ctx.fillStyle = '#00d2ff'; ctx.fillText('RPM', qr.x - 20, qr.y); ctx.fillText('TPS %', qt.x - 14, qt.y + 8);

        // พื้นผิว: วาดจากไกลมาใกล้
        const quads = [];
        for (let r = 0; r < NR - 1; r++) for (let c = 0; c < NC - 1; c++) {
            const a = pts[r][c], b = pts[r][c + 1], d = pts[r + 1][c + 1], e = pts[r + 1][c];
            if (!a || !b || !d || !e) continue;
            quads.push({ q: [a, b, d, e], d: (a.d + b.d + d.d + e.d) / 4, p: (a.p + b.p + d.p + e.p) / 4 });
        }
        quads.sort((m, n) => n.d - m.d);   // ไกลก่อน ใกล้ทีหลัง
        for (const qd of quads) {
            ctx.beginPath();
            qd.q.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
            ctx.closePath();
            ctx.fillStyle = heat(qd.p);
            ctx.fill();
            ctx.strokeStyle = 'rgba(5,16,40,0.55)';
            ctx.stroke();
        }
        if (!quads.length) {
            ctx.fillStyle = '#6f86a8'; ctx.font = '13px Prompt, sans-serif';
            ctx.fillText('ยังไม่มีข้อมูลพอจะวาด 3D — ขี่เก็บค่าหรือใส่ค่าในตารางก่อน', 20, H / 2);
        }

        // จุดที่เครื่องวิ่งอยู่
        if (realTime && liveCell) {
            const v = cellValue(liveCell.r, liveCell.c);
            const q = proj(X(liveCell.c), Y(liveCell.r), v === null ? 0 : norm(v, min, max));
            ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
        }
        $('map-note').textContent = `หมุน ${Math.round(((cam.yaw * 180 / Math.PI) % 360 + 360) % 360)}° / ${Math.round(cam.pitch * 180 / Math.PI)}° · ซูม ${cam.zoom.toFixed(2)}x · 1 นิ้ว = หมุน · 2 นิ้ว = ซูม`;
    }

    // หมุนด้วย 1 นิ้ว / เมาส์, ซูมด้วย 2 นิ้ว / ล้อเมาส์
    const pointers = new Map();
    let pinchStart = null;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    canvas.addEventListener('pointermove', e => {
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            cam.yaw += (e.clientX - prev.x) * 0.01;
            cam.pitch = Math.max(0.15, Math.min(1.5, cam.pitch + (e.clientY - prev.y) * 0.01));
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchStart === null) pinchStart = { dist, zoom: cam.zoom };
            cam.zoom = Math.max(0.4, Math.min(3, pinchStart.zoom * dist / pinchStart.dist));
        }
        render3d();
    });
    const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); render3d(); }, { passive: false });

    // ── แสดงผลรวม ───────────────────────────────────
    function updateButtons() {
        $('map-undo').disabled = !undoStack.length;
        $('map-redo').disabled = !redoStack.length;
        $('map-apply').disabled = !draft;
        $('map-cancel').disabled = !draft;
        $('map-range').classList.toggle('on', rangeMode);
        $('map-rt').classList.toggle('on', realTime);
        $('map-fit').classList.toggle('on', fit);
        $('map-3d').classList.toggle('on', view3d);
        $('map-grid-wrap').classList.toggle('fit', fit);
        $('map-grid-wrap').hidden = view3d;
        canvas.hidden = !view3d;
        $('map-select').value = current;
        document.querySelectorAll('.map-tab').forEach(b => b.classList.toggle('active', b.dataset.map === current));
        $('map-title').textContent = TABLES[current].name + (view3d ? ' · 3D HEATMAP' : '') + (draft ? ' · กำลังแก้ (ยังไม่บันทึก)' : '');
        if (!view3d) {
            const b = selBox();
            $('map-note').textContent = sel.active
                ? `เลือก ${RPM_BINS[b.rA]}–${RPM_BINS[b.rB]} rpm × ${TPS_BINS[b.cA]}–${TPS_BINS[b.cB]}% · ช่องมีจุดมุม = ค่าที่แก้เอง`
                : 'แตะช่องเพื่อเลือก · ค่า = Log จาก ESP32 หรือค่าที่แก้เอง · ยังไม่เขียนลงกล่อง';
        }
    }
    function renderAll() {
        updateButtons();
        if (view3d) render3d(); else renderGrid();
    }

    // ── การแก้ค่า ───────────────────────────────────
    function beginEdit() {
        if (!draft) draft = saved[current].map(row => row.slice());
        undoStack.push(draft.map(row => row.slice()));
        if (undoStack.length > 50) undoStack.shift();
        redoStack = [];
    }
    function forSel(fn) {
        const b = selBox();
        for (let r = b.rA; r <= b.rB; r++) for (let c = b.cA; c <= b.cB; c++) fn(r, c);
    }
    function askNumber(msg, def) {
        const s = prompt(msg, def);
        if (s === null) return null;
        const n = parseFloat(String(s).replace(',', '.'));
        return isFinite(n) ? n : null;
    }

    function applyOp(op) {
        $('map-adjust').classList.remove('open');
        if (!sel.active) { alert('แตะเลือกช่องในตารางก่อน'); return; }
        const b = selBox(), t = TABLES[current];
        const round = v => parseFloat(v.toFixed(t.dec + 2));

        if (op === 'copy') {
            clipboard = [];
            for (let r = b.rA; r <= b.rB; r++) { const row = []; for (let c = b.cA; c <= b.cB; c++) row.push(cellValue(r, c)); clipboard.push(row); }
            return;
        }
        if (op === 'paste') {
            if (!clipboard) { alert('ยังไม่ได้ก๊อบ'); return; }
            beginEdit();
            clipboard.forEach((row, i) => row.forEach((v, j) => {
                const r = b.rA + i, c = b.cA + j;
                if (r < NR && c < NC && v !== null) draft[r][c] = v;
            }));
        } else if (op === 'set') {
            const v = askNumber('ใส่ค่าที่ต้องการ', cellValue(b.rA, b.cA) ?? '');
            if (v === null) return;
            beginEdit();
            forSel((r, c) => { draft[r][c] = v; });
        } else if (op === 'inc' || op === 'dec') {
            beginEdit();
            forSel((r, c) => { const v = cellValue(r, c); if (v !== null) draft[r][c] = round(v + (op === 'inc' ? t.step : -t.step)); });
        } else if (op === 'pct') {
            const p = askNumber('ปรับกี่ % (เช่น 5 หรือ -3)', '5');
            if (p === null) return;
            beginEdit();
            forSel((r, c) => { const v = cellValue(r, c); if (v !== null) draft[r][c] = round(v * (1 + p / 100)); });
        } else if (op === 'ix' || op === 'iy' || op === 'ixy') {
            // ต้องมีค่าที่มุม/ขอบของช่วงที่เลือก
            const v00 = cellValue(b.rA, b.cA), v01 = cellValue(b.rA, b.cB), v10 = cellValue(b.rB, b.cA), v11 = cellValue(b.rB, b.cB);
            beginEdit();
            let missing = false;
            forSel((r, c) => {
                const fx = b.cB > b.cA ? (TPS_BINS[c] - TPS_BINS[b.cA]) / (TPS_BINS[b.cB] - TPS_BINS[b.cA]) : 0;
                const fy = b.rB > b.rA ? (RPM_BINS[r] - RPM_BINS[b.rA]) / (RPM_BINS[b.rB] - RPM_BINS[b.rA]) : 0;
                let v = null;
                if (op === 'ix') { const L = cellValue(r, b.cA), R = cellValue(r, b.cB); if (L !== null && R !== null) v = L + (R - L) * fx; }
                else if (op === 'iy') { const T = cellValue(b.rA, c), B = cellValue(b.rB, c); if (T !== null && B !== null) v = T + (B - T) * fy; }
                else if ([v00, v01, v10, v11].every(x => x !== null)) v = v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy;
                if (v === null) missing = true; else draft[r][c] = round(v);
            });
            if (missing) alert('บางแถว/คอลัมน์ไม่มีค่าที่ขอบช่วง จึงข้ามไป');
        } else if (op === 'smooth') {
            beginEdit();
            const src = blank(() => null);
            for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) src[r][c] = cellValue(r, c);
            forSel((r, c) => {
                if (src[r][c] === null) return;
                let s = 0, n = 0;
                for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                    const v = src[r + dr]?.[c + dc];
                    if (v !== null && v !== undefined) { s += v; n++; }
                }
                draft[r][c] = round(s / n);
            });
        }
        renderAll();
    }

    document.querySelectorAll('#map-adjust button').forEach(b => b.addEventListener('click', () => applyOp(b.dataset.op)));
    $('map-adjust-btn').addEventListener('click', () => {
        const menu = $('map-adjust'), r = $('map-adjust-btn').getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 470))}px`;
        menu.style.top = `${r.bottom}px`;
        menu.classList.toggle('open');
    });

    $('map-undo').addEventListener('click', () => {
        if (!undoStack.length) return;
        redoStack.push(draft.map(row => row.slice()));
        draft = undoStack.pop();
        renderAll();
    });
    $('map-redo').addEventListener('click', () => {
        if (!redoStack.length) return;
        undoStack.push(draft.map(row => row.slice()));
        draft = redoStack.pop();
        renderAll();
    });
    $('map-apply').addEventListener('click', () => {
        if (!draft) return;
        saved[current] = draft;
        draft = null; undoStack = []; redoStack = [];
        saveEdits();
        renderAll();
    });
    function cancelDraft() { draft = null; undoStack = []; redoStack = []; }
    $('map-cancel').addEventListener('click', () => { cancelDraft(); renderAll(); });

    function selectMap(k) {
        if (k === current) return;
        if (draft && !confirm('ยังไม่ได้บันทึกการแก้ — ทิ้งการแก้แล้วเปลี่ยนตาราง?')) { $('map-select').value = current; return; }
        cancelDraft();
        current = k;
        localStorage.setItem('sg_map_current', current);
        renderAll();
    }
    $('map-select').innerHTML = KEYS.map(k => `<option value="${k}">${TABLES[k].name}</option>`).join('');
    $('map-select').addEventListener('change', e => selectMap(e.target.value));
    $('map-tab-list').innerHTML = KEYS.map(k => `<button class="map-tab" data-map="${k}">${TABLES[k].name}</button>`).join('');
    document.querySelectorAll('.map-tab').forEach(b => b.addEventListener('click', () => selectMap(b.dataset.map)));

    $('map-range').addEventListener('click', () => { rangeMode = !rangeMode; updateButtons(); });
    $('map-rt').addEventListener('click', () => { realTime = !realTime; renderAll(); });
    $('map-fit').addEventListener('click', () => {
        if (view3d) { cam.yaw = -0.55; cam.pitch = 0.6; cam.zoom = 0.7; } else fit = !fit;
        renderAll();
    });
    $('map-3d').addEventListener('click', () => { view3d = !view3d; renderAll(); });

    // แตะช่อง = เลือก; โหมด "ช่วง" หรือ Shift = ขยายจากช่องเดิม; ลากด้วยเมาส์ = เลือกช่วง
    let dragging = false;
    grid.addEventListener('pointerdown', e => {
        const td = e.target.closest('td'); if (!td) return;
        const r = +td.dataset.r, c = +td.dataset.c;
        if ((rangeMode || e.shiftKey) && sel.active) { sel.r1 = r; sel.c1 = c; }
        else sel = { r0: r, c0: c, r1: r, c1: c, active: true };
        dragging = e.pointerType === 'mouse';
        renderSel(); updateButtons();
    });
    grid.addEventListener('pointerover', e => {
        if (!dragging) return;
        const td = e.target.closest('td'); if (!td) return;
        sel.r1 = +td.dataset.r; sel.c1 = +td.dataset.c;
        renderSel(); updateButtons();
    });
    window.addEventListener('pointerup', () => { dragging = false; });

    // ── ข้อมูลสดจาก ESP32 ───────────────────────────
    function setLive(id, v, dec) {
        const el = $(id);
        if (el) el.textContent = (v === undefined || v === null || !isFinite(Number(v))) ? '--' : Number(v).toFixed(dec);
    }
    let pending = false;
    window.addEventListener('sg:kline', (e) => {
        const d = e.detail || {};
        const rpm = Number(d.rpm), tps = Number(d.tps);
        setLive('map-live-rpm', d.rpm, 0);
        setLive('map-live-tps', d.tps, 1);
        setLive('map-live-inj', d.inj, 2);
        setLive('map-live-igt', d.igt, 1);
        setLive('map-live-afr', d.afr, 1);

        if (!isFinite(rpm) || !isFinite(tps) || rpm < 500) {
            if (liveCell) { liveCell = null; if (grid.offsetParent || view3d) renderAll(); }
            return;
        }
        const r = nearest(RPM_BINS, rpm), c = nearest(TPS_BINS, tps);
        if (liveCell && (liveCell.r !== r || liveCell.c !== c)) trail.set(`${liveCell.r},${liveCell.c}`, Date.now());
        liveCell = { r, c };

        let changed = false;
        for (const k of KEYS) {
            const v = Number(d[k]);
            if (d[k] === undefined || !isFinite(v)) continue;
            const cell = logData[k][r][c];
            cell.sum += v; cell.n++;
            changed = true;
        }
        if (changed) scheduleLogSave();

        // วาดเฉพาะตอนหน้านี้เปิดอยู่ รวมรอบละ 1 เฟรม
        const visible = (view3d ? canvas.offsetParent : grid.offsetParent) !== null;
        if (visible && !pending) {
            pending = true;
            requestAnimationFrame(() => { pending = false; view3d ? render3d() : renderGrid(); });
        }
    });

    // ── Sidebar ─────────────────────────────────────
    const layout = $('map-layout');
    if (localStorage.getItem('sg_map_sidebar') === 'closed') layout.classList.add('sb-closed');
    $('map-sb-toggle').addEventListener('click', () => {
        layout.classList.toggle('sb-closed');
        localStorage.setItem('sg_map_sidebar', layout.classList.contains('sb-closed') ? 'closed' : 'open');
        if (view3d) setTimeout(render3d, 300);
    });
    $('map-reset').addEventListener('click', () => {
        if (!confirm('ล้างค่า Log ที่วัดจาก ESP32 ทั้งหมดหรือไม่? (ค่าที่แก้เองยังอยู่)')) return;
        for (const k of KEYS) logData[k] = blank(() => ({ sum: 0, n: 0 }));
        trail.clear();
        try { localStorage.removeItem(LOG_KEY); } catch (_) { }
        renderAll();
    });

    setInterval(() => { if (trail.size && !view3d && grid.offsetParent !== null) renderLive(); }, 500);
    window.addEventListener('resize', () => { if (view3d) render3d(); });

    window.SGMap = { refresh: renderAll };
    build();
    renderAll();
})();
