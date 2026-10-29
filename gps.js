// ========================================================
// SGGps — หน้า GPS METER และ DRAG METER
//  ใช้ navigator.geolocation (ทำงานทั้งในแอป iOS และเบราว์เซอร์/Bluefy)
//  GPS ของ iPhone ส่งตำแหน่งประมาณ 1 ครั้ง/วินาที → เวลาช่วงระยะใช้การ interpolate ระหว่างจุด
// ========================================================
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const th = () => (localStorage.getItem('sg_lang') || 'TH') === 'TH';

    // ระยะทางระหว่าง 2 จุด (เมตร)
    function haversine(a, b) {
        const R = 6371000, rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
        const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(x));
    }

    // ════════════════════════════════════════════════════
    //  ตัวรับตำแหน่ง GPS (ใช้ร่วมกันทั้ง 2 หน้า)
    // ════════════════════════════════════════════════════
    let watchId = null;
    const listeners = [];
    let lastFix = null;      // { lat, lon, t, speed(m/s), acc, heading, alt }

    function onPosition(pos) {
        const c = pos.coords;
        const fix = { lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now(), acc: c.accuracy,
            heading: c.heading, alt: c.altitude, speed: null };
        if (c.speed !== null && c.speed !== undefined && c.speed >= 0) {
            fix.speed = c.speed;
        } else if (lastFix && fix.t > lastFix.t) {
            // บางเครื่องไม่ส่ง speed → คำนวณจากระยะ/เวลา
            fix.speed = haversine(lastFix, fix) / ((fix.t - lastFix.t) / 1000);
        } else {
            fix.speed = 0;
        }
        const prev = lastFix;
        lastFix = fix;
        listeners.forEach(fn => fn(fix, prev));
    }

    function onError(err) {
        const msg = err.code === 1
            ? (th() ? 'ไม่ได้รับสิทธิ์ตำแหน่ง — เปิดที่ ตั้งค่า > SGPro > ตำแหน่ง' : 'Location permission denied')
            : (th() ? 'หาสัญญาณ GPS ไม่ได้' : 'GPS unavailable');
        $('gps-signal').textContent = msg;
        $('gps-signal').style.color = '#ff4444';
        if (err.code === 1) stopGps();
    }

    function startGps() {
        if (watchId !== null) return true;
        if (!navigator.geolocation) {
            $('gps-signal').textContent = th() ? 'อุปกรณ์นี้ไม่มี GPS' : 'No GPS on this device';
            return false;
        }
        $('gps-signal').textContent = th() ? 'กำลังหาสัญญาณ...' : 'SEARCHING...';
        $('gps-signal').style.color = '#ffaa00';
        watchId = navigator.geolocation.watchPosition(onPosition, onError,
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
        $('btn-gps-toggle').textContent = 'GPS OFF';
        return true;
    }

    function stopGps() {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        lastFix = null;
        $('btn-gps-toggle').textContent = 'GPS ON';
        $('gps-signal').textContent = 'GPS OFF';
        $('gps-signal').style.color = '';
        if (drag.state === 'armed' || drag.state === 'running') dragReset();
    }

    // ════════════════════════════════════════════════════
    //  หน้า GPS METER
    // ════════════════════════════════════════════════════
    const trip = { dist: 0, max: 0, movingMs: 0, startT: null };
    const MOVE_KMH = 3;          // ต่ำกว่านี้ถือว่าจอดอยู่ (กันระยะไหลตอนจอด)
    const MAX_ACC_M = 30;        // ความคลาดเคลื่อนเกินนี้ไม่นับระยะ

    function fmtTime(ms) {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function renderGps(fix) {
        const kmh = fix ? fix.speed * 3.6 : 0;
        $('gps-speed').textContent = Math.round(kmh);
        $('gps-max').textContent = Math.round(trip.max);
        $('gps-avg').textContent = trip.movingMs > 0 ? Math.round(trip.dist / 1000 / (trip.movingMs / 3600000)) : 0;
        $('gps-trip').textContent = (trip.dist / 1000).toFixed(2);
        $('gps-trip-main').textContent = (trip.dist / 1000).toFixed(2);
        $('gps-time').textContent = fmtTime(trip.movingMs);
        if (fix) {
            $('gps-heading').textContent = (fix.heading !== null && fix.heading !== undefined && kmh > MOVE_KMH && isFinite(fix.heading)) ? Math.round(fix.heading) : '-';
            $('gps-alt').textContent = (fix.alt !== null && fix.alt !== undefined && isFinite(fix.alt)) ? Math.round(fix.alt) : '-';
            const acc = Math.round(fix.acc);
            const good = fix.acc <= 10, ok = fix.acc <= MAX_ACC_M;
            $('gps-signal').textContent = `${good ? 'GOOD' : ok ? 'OK' : 'WEAK'} ±${acc} M`;
            $('gps-signal').style.color = good ? '#00ff88' : ok ? '#ffaa00' : '#ff4444';
        }
    }

    listeners.push((fix, prev) => {
        const kmh = fix.speed * 3.6;
        if (prev && fix.acc <= MAX_ACC_M && kmh >= MOVE_KMH) {
            const d = haversine(prev, fix), dt = fix.t - prev.t;
            // ตัดจุดกระโดด (เร็วเกิน 300 km/h ระหว่างจุด)
            if (dt > 0 && d / (dt / 1000) < 83) {
                trip.dist += d;
                trip.movingMs += dt;
            }
        }
        if (fix.acc <= MAX_ACC_M && kmh > trip.max) trip.max = kmh;
        renderGps(fix);
    });

    $('btn-gps-toggle').addEventListener('click', () => { watchId === null ? startGps() : stopGps(); });
    $('btn-gps-reset').addEventListener('click', () => {
        trip.dist = 0; trip.max = 0; trip.movingMs = 0;
        renderGps(lastFix);
    });

    // ════════════════════════════════════════════════════
    //  หน้า DRAG METER
    //  ARM → รอออกตัว (ความเร็ว ≥ 5 km/h) → จับเวลาจนถึง 1000 ม.
    // ════════════════════════════════════════════════════
    const SPLITS = [
        { key: '60', m: 18.288 }, { key: '100', m: 100 }, { key: '201', m: 201.168 },
        { key: '402', m: 402.336 }, { key: '600', m: 600 }, { key: '1000', m: 1000 },
    ];
    const LAUNCH_KMH = 5;
    const RUNS_KEY = 'sg_drag_runs';

    const drag = { state: 'idle', t0: 0, dist: 0, splits: {}, lastT: 0, lastDist: 0, raf: null };

    function setStatus(text, color) {
        const el = $('drag-status');
        el.textContent = text;
        el.style.color = color || '';
    }

    function renderSplits() {
        SPLITS.forEach(s => {
            const t = drag.splits[s.key];
            $(`drag-t-${s.key}`).textContent = t !== undefined ? t.toFixed(2) : '-';
            $(`drag-bar-${s.key}`).style.width = `${Math.min(100, drag.dist / s.m * 100)}%`;
        });
        $('drag-dist').textContent = Math.round(drag.dist);
    }

    function tick() {
        if (drag.state !== 'running') return;
        $('drag-time').textContent = ((performance.now() - drag.t0) / 1000).toFixed(2);
        drag.raf = requestAnimationFrame(tick);
    }

    function dragReset() {
        cancelAnimationFrame(drag.raf);
        Object.assign(drag, { state: 'idle', t0: 0, dist: 0, splits: {}, lastT: 0, lastDist: 0 });
        $('drag-time').textContent = '0.00';
        $('drag-speed').textContent = '0';
        setStatus('READY');
        renderSplits();
    }

    function finish() {
        drag.state = 'done';
        cancelAnimationFrame(drag.raf);
        $('drag-time').textContent = drag.splits['1000'].toFixed(2);
        setStatus(th() ? 'จบรอบ' : 'FINISHED', '#00ff88');
    }

    // แปลงเวลา GPS (Date.now) เป็นเวลาของ performance.now เพื่อจับเวลาบนจอให้ลื่น
    const perfOffset = () => performance.now() - Date.now();

    listeners.push((fix, prev) => {
        const kmh = fix.speed * 3.6;
        $('drag-speed').textContent = Math.round(kmh);
        if (drag.state === 'armed') {
            if (kmh >= LAUNCH_KMH && prev) {
                // ประมาณเวลาออกตัว (ความเร็ว = 0) โดยถือว่าความเร่งคงที่ระหว่าง 2 จุดล่าสุด
                const dt = (fix.t - prev.t) / 1000;
                const v0 = Math.max(0, prev.speed), v1 = fix.speed;
                const a = dt > 0 && v1 > v0 ? (v1 - v0) / dt : 0;
                const sinceLaunch = a > 0 ? Math.min(v1 / a, dt + 1) : 0;   // วินาทีนับจากออกตัวถึงจุดนี้
                const launchT = fix.t - sinceLaunch * 1000;
                drag.t0 = launchT + perfOffset();
                drag.state = 'running';
                drag.dist = a > 0 ? (v1 * v1) / (2 * a) : 0;   // ระยะที่วิ่งไปแล้วตั้งแต่ออกตัว
                drag.lastT = fix.t; drag.lastDist = drag.dist;
                setStatus(th() ? 'กำลังจับเวลา' : 'RUNNING', '#ffaa00');
                tick();
            }
            return;
        }
        if (drag.state !== 'running' || !prev) return;
        const d = haversine(prev, fix);
        if (fix.t <= prev.t) return;
        const newDist = drag.dist + d;
        // หาเวลาที่ผ่านแต่ละระยะด้วย linear interpolation ระหว่างจุด
        SPLITS.forEach(s => {
            if (drag.splits[s.key] === undefined && newDist >= s.m) {
                const f = d > 0 ? (s.m - drag.dist) / d : 1;
                const tCross = prev.t + f * (fix.t - prev.t);
                drag.splits[s.key] = (tCross + perfOffset() - drag.t0) / 1000;
            }
        });
        drag.dist = newDist;
        renderSplits();
        if (drag.splits['1000'] !== undefined) finish();
    });

    $('btn-drag-arm').addEventListener('click', () => {
        if (!startGps()) return;
        dragReset();
        drag.state = 'armed';
        setStatus(th() ? 'พร้อม — ออกตัวได้' : 'ARMED', '#00d2ff');
        if (lastFix && lastFix.speed * 3.6 >= LAUNCH_KMH) {
            setStatus(th() ? 'จอดนิ่งก่อนออกตัว' : 'STOP FIRST', '#ff4444');
        }
    });
    $('btn-drag-reset').addEventListener('click', dragReset);

    $('btn-drag-save').addEventListener('click', () => {
        if (!Object.keys(drag.splits).length) { setStatus(th() ? 'ยังไม่มีผลให้บันทึก' : 'NO RUN', '#ff4444'); return; }
        let runs = [];
        try { runs = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); } catch (_) { }
        runs.unshift({ at: new Date().toISOString(), splits: drag.splits });
        try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, 20))); } catch (_) { }
        setStatus(th() ? 'บันทึกแล้ว' : 'SAVED', '#00ff88');
    });

    $('btn-drag-runs').addEventListener('click', () => {
        let runs = [];
        try { runs = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); } catch (_) { }
        if (!runs.length) { alert(th() ? 'ยังไม่มีรอบที่บันทึก' : 'No saved runs'); return; }
        const fmt = v => v === undefined ? '-' : v.toFixed(2);
        alert(runs.slice(0, 10).map((r, i) => {
            const d = new Date(r.at);
            return `${i + 1}. ${d.toLocaleDateString()} ${d.toLocaleTimeString()}\n` +
                `   60ft ${fmt(r.splits['60'])}  100m ${fmt(r.splits['100'])}  201m ${fmt(r.splits['201'])}\n` +
                `   402m ${fmt(r.splits['402'])}  600m ${fmt(r.splits['600'])}  1000m ${fmt(r.splits['1000'])}`;
        }).join('\n\n'));
    });

    dragReset();
    renderGps(null);
    window.SGGps = { start: startGps, stop: stopGps, _feed: (pos) => onPosition(pos), _drag: drag };
})();
