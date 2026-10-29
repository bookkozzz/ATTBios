document.addEventListener('DOMContentLoaded', () => {

    const APP_VERSION = 'v5.0.0';
    document.getElementById('set-version').textContent = APP_VERSION;

    function fmtNum(val, decimals = 0) {
        const n = Number(val);
        if (!isFinite(n)) return 0;
        return parseFloat(n.toFixed(decimals));
    }

    function debugLog(msg, color = '#00d2ff') {
        const ts = new Date().toLocaleTimeString('th-TH', { hour12: false });
        console.log(`%c[SGPro ${ts}] ${msg}`, `color:${color}; font-weight:bold;`);
    }

    debugLog(`🚀 Smartgate Pro ${APP_VERSION} initialized`);
    if (window.SGLog) SGLog.info(`App v${APP_VERSION} started`);

    // =========================================
    // CANVAS GAUGE SYSTEM
    // =========================================
    const CVW = 400, CVH = 230;
    const CX = CVW / 2, CY = CVH;
    const R = 190, TR = 150, IR = 110;

    const canvasSpeed = document.getElementById('speedCanvas');
    const ctxS = canvasSpeed.getContext('2d');
    const canvasRPM = document.getElementById('rpmCanvas');
    const ctxR = canvasRPM.getContext('2d');

    function setCanvasSize(cv) {
        const cssW = cv.parentElement ? cv.parentElement.clientWidth : CVW;
        const dpr = window.devicePixelRatio || 1;
        const ratio = CVH / CVW;
        const w = Math.round(cssW * dpr);
        const h = Math.round(cssW * ratio * dpr);
        if (cv.width !== w || cv.height !== h) {
            cv.width = w; cv.height = h;
            cv.style.height = (cssW * ratio) + 'px';
        }
    }

    let currentSpeed = 0, currentRPM = 0;
    let animSpeed = 0, animRPM = 0;
    let rafId = null;

    function getColor(pct, isRPM) {
        if (isRPM) {
            if (pct < 0.6) return `hsl(${130 - pct / 0.6 * 30},100%,58%)`;
            if (pct < 0.85) return `hsl(${100 - (pct - 0.6) / 0.25 * 70},100%,60%)`;
            return 'hsl(0,100%,55%)';
        } else {
            if (pct < 0.5) return `hsl(${240 - pct / 0.5 * 60},100%,${55 + pct / 0.5 * 10}%)`;
            if (pct < 0.85) return `hsl(${180 - (pct - 0.5) / 0.35 * 150},100%,65%)`;
            return `hsl(${30 - (pct - 0.85) / 0.15 * 30},100%,60%)`;
        }
    }

    function drawGauge(cv, c, pct, isRPM) {
        const W = cv.width, H = cv.height;
        const scX = W / CVW, scY = H / CVH;
        c.clearRect(0, 0, W, H);
        c.save();
        c.scale(scX, scY);
        c.beginPath();
        c.arc(CX, CY, R, Math.PI, 2 * Math.PI, false);
        c.lineTo(CX + IR, CY);
        c.arc(CX, CY, IR, 2 * Math.PI, Math.PI, true);
        c.closePath();
        const bg = c.createRadialGradient(CX, CY, IR * 0.5, CX, CY, R);
        bg.addColorStop(0, 'rgba(3,5,38,0.80)');
        bg.addColorStop(1, 'rgba(8,18,80,0.97)');
        c.fillStyle = bg; c.fill();
        c.beginPath();
        c.arc(CX, CY, TR, Math.PI, 2 * Math.PI, false);
        c.strokeStyle = 'rgba(12,22,95,0.90)';
        c.lineWidth = 28; c.lineCap = 'butt'; c.stroke();
        const N = 24;
        for (let i = 0; i <= N; i++) {
            const a = Math.PI + (i / N) * Math.PI;
            const major = i % 4 === 0;
            const ro = R * (major ? 0.975 : 0.945);
            const ri = ro - (major ? 22 : 12);
            const x1 = CX + ro * Math.cos(a), y1 = CY + ro * Math.sin(a);
            const x2 = CX + ri * Math.cos(a), y2 = CY + ri * Math.sin(a);
            c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
            c.strokeStyle = i / N <= pct ? getColor(pct, isRPM) : 'rgba(65,105,210,0.30)';
            c.lineWidth = major ? 3 : 1.5; c.lineCap = 'round'; c.stroke();
        }
        if (pct > 0.005) {
            const endA = Math.PI + pct * Math.PI;
            const color = getColor(pct, isRPM);
            const aColor = color.replace('hsl(', 'hsla(').replace(')', ',0.22)');
            c.beginPath(); c.arc(CX, CY, TR, Math.PI, endA, false);
            c.strokeStyle = aColor; c.lineWidth = 56; c.lineCap = 'round'; c.stroke();
            c.beginPath(); c.arc(CX, CY, TR, Math.PI, endA, false);
            c.strokeStyle = color; c.lineWidth = 24; c.lineCap = 'round';
            c.shadowBlur = 20; c.shadowColor = color; c.stroke(); c.shadowBlur = 0;
            c.beginPath(); c.arc(CX, CY, TR, Math.PI, endA, false);
            c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2; c.lineCap = 'round'; c.stroke();
            const tx = CX + TR * Math.cos(endA), ty = CY + TR * Math.sin(endA);
            c.beginPath(); c.arc(tx, ty, 6, 0, Math.PI * 2);
            c.fillStyle = '#fff'; c.shadowBlur = 14; c.shadowColor = color; c.fill(); c.shadowBlur = 0;
        }
        c.restore();
    }

    function tick() {
        let go = false;
        const ds = currentSpeed - animSpeed, dr = currentRPM - animRPM;
        if (Math.abs(ds) > 0.25) { animSpeed += ds * 0.16; go = true; } else animSpeed = currentSpeed;
        if (Math.abs(dr) > 4) { animRPM += dr * 0.16; go = true; } else animRPM = currentRPM;
        drawGauge(canvasSpeed, ctxS, animSpeed / 240, false);
        drawGauge(canvasRPM, ctxR, animRPM / 8000, true);
        const sEl = document.getElementById('val-speed-gauge');
        const rEl = document.getElementById('val-rpm-center');
        if (sEl) sEl.textContent = Math.round(animSpeed);
        if (rEl) rEl.textContent = Math.round(animRPM);
        rafId = go ? requestAnimationFrame(tick) : null;
    }

    function setGaugeValues(speed, rpm) {
        currentSpeed = fmtNum(speed, 0);
        currentRPM = fmtNum(rpm, 0);
        if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function resizeAll() {
        setCanvasSize(canvasSpeed); setCanvasSize(canvasRPM);
        drawGauge(canvasSpeed, ctxS, animSpeed / 240, false);
        drawGauge(canvasRPM, ctxR, animRPM / 8000, true);
    }

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(resizeAll);
        ro.observe(canvasSpeed.parentElement || document.body);
        ro.observe(canvasRPM.parentElement || document.body);
    } else {
        window.addEventListener('resize', resizeAll);
    }
    setTimeout(resizeAll, 80);


    // =========================================
    // THEME SYSTEM
    // =========================================
    const themes = {
        default: { primary: '#00d2ff', secondary: '#0077ff', dark: '#0033cc', border: '#0077ff', contrast: '#ffaa00' },
        green: { primary: '#00ff88', secondary: '#00cc55', dark: '#007733', border: '#00cc55', contrast: '#ff5500' },
        orange: { primary: '#ff8c00', secondary: '#ff5500', dark: '#cc2200', border: '#ff5500', contrast: '#00d2ff' },
        purple: { primary: '#cc44ff', secondary: '#8800cc', dark: '#550088', border: '#8800cc', contrast: '#ffee00' },
        red: { primary: '#ff3333', secondary: '#cc0000', dark: '#880000', border: '#cc0000', contrast: '#00ff88' },
        white: { primary: '#ffffff', secondary: '#aaccff', dark: '#334466', border: '#aaccff', contrast: '#ff8800' },
    };

    let activeTheme = themes.default;

    function applyTheme(name) {
        const t = themes[name] || themes.default;
        activeTheme = t;
        const root = document.documentElement;
        root.style.setProperty('--primary-color', t.primary);
        root.style.setProperty('--secondary-color', t.secondary);
        root.style.setProperty('--dark-accent', t.dark);
        root.style.setProperty('--border-color', t.border);
        document.querySelectorAll('.theme-chip').forEach(c => c.classList.toggle('active', c.dataset.theme === name));
        localStorage.setItem('sg_theme', name);
        debugLog(`🎨 Theme: ${name.toUpperCase()}`, t.primary);
    }

    document.getElementById('theme-grid').addEventListener('click', e => {
        const chip = e.target.closest('.theme-chip');
        if (chip) applyTheme(chip.dataset.theme);
    });

    applyTheme(localStorage.getItem('sg_theme') || 'default');


    // =========================================
    // i18n
    // =========================================
    const i18n = {
        EN: {
            title_tacho: 'TACHOMETER', title_live: 'LIVE DATA', title_gps: 'GPS METER',
            title_drag: 'DRAG METER', title_dtc: 'DTC SCANNER', title_settings: 'SETTINGS',
            inj: 'INJ', speed: 'SPEED', tps: 'TPS', mode: 'MODE', afr: 'AFR', eot: 'EOT',
            igt: 'IGT', duty: 'DUTY', rpm: 'RPM', iat: 'IAT', map: 'MAP', batt: 'BATT',
            o2: 'O2', stft: 'STFT', ltft: 'LTFT', load: 'LOAD',
            weak_signal: 'WEAK ±80 M', trip: 'TRIP', max: 'MAX', avg: 'AVG',
            heading: 'HEADING', altitude: 'ALTITUDE', time: 'TIME', armed: 'ARMED',
            elapsed_time: 'ELAPSED TIME (S)', dist: 'DIST', gps_on: 'GPS ON',
            reset: 'RESET', save: 'SAVE', runs: 'RUNS', arm: 'ARM',
            dtc_title: 'DTC SCANNER', dtc_codes: 'Codes', scan_dtc: 'SCAN CODES',
            clear_dtc: 'CLEAR CODES', freeze_frame: 'FREEZE FRAME',
            mil_status: 'MIL', protocol_lbl: 'PROTOCOL', monitors: 'MONITORS',
            dtc_empty: 'Press SCAN CODES to scan for Fault Codes',
            app_info: 'APPLICATION INFO', version: 'VERSION', device_name: 'DEVICE',
            vehicle_info: 'VEHICLE INFO', car_brand: 'BRAND', car_model: 'MODEL', car_year: 'YEAR',
            comm_system: 'COMMUNICATION', protocol_type: 'TYPE', comm_protocol: 'BUS',
            theme_settings: 'THEME', raw_monitor: 'RAW DATA MONITOR',
            raw_empty: 'Connect ELM327 to see raw data',
            bt_connect_title: 'ELM327 Connection', bt_connect_sub: 'Search & connect OBD2 Adapter',
            bt_ready: 'Ready to search', bt_scan_connect: '🔍 SCAN & CONNECT',
            bt_auto_connect: '⚡ AUTO CONNECT', bt_disconnect: '⊘ DISCONNECT', bt_close: '✕ CLOSE',
        },
        TH: {
            title_tacho: 'หน้าปัดหลัก', title_live: 'ข้อมูลสด', title_gps: 'มาตรวัด GPS',
            title_drag: 'จับเวลาทางตรง', title_dtc: 'สแกน DTC', title_settings: 'ตั้งค่า',
            inj: 'หัวฉีด', speed: 'ความเร็ว', tps: 'ปีกผีเสื้อ', mode: 'โหมด',
            afr: 'ส่วนผสม', eot: 'อุณ.น้ำมัน', igt: 'จุดระเบิด', duty: 'ภาระ',
            rpm: 'รอบเครื่อง', iat: 'อุณ.ไอดี', map: 'แรงดันไอดี', batt: 'แบตเตอรี่',
            o2: 'ออกซิเจน', stft: 'ปรับสั้น', ltft: 'ปรับยาว', load: 'โหลด',
            weak_signal: 'สัญญาณอ่อน ±80 ม.', trip: 'ระยะทาง', max: 'สูงสุด', avg: 'เฉลี่ย',
            heading: 'ทิศทาง', altitude: 'ความสูง', time: 'เวลา', armed: 'พร้อมทำงาน',
            elapsed_time: 'เวลาที่ใช้ (วินาที)', dist: 'ระยะ', gps_on: 'เปิด GPS',
            reset: 'รีเซ็ต', save: 'บันทึก', runs: 'รอบวิ่ง', arm: 'เตรียมพร้อม',
            dtc_title: 'สแกนรหัสข้อผิดพลาด', dtc_codes: 'รหัส', scan_dtc: 'สแกน CODE',
            clear_dtc: 'ลบ CODE', freeze_frame: 'FREEZE FRAME',
            mil_status: 'MIL', protocol_lbl: 'โปรโตคอล', monitors: 'มอนิเตอร์',
            dtc_empty: 'กด สแกน CODE เพื่อค้นหา Fault Codes',
            app_info: 'ข้อมูลแอป', version: 'เวอร์ชัน', device_name: 'อุปกรณ์',
            vehicle_info: 'ข้อมูลรถ', car_brand: 'ยี่ห้อ', car_model: 'รุ่น', car_year: 'ปี',
            comm_system: 'ระบบสื่อสาร', protocol_type: 'ประเภท', comm_protocol: 'บัส',
            theme_settings: 'ธีม', raw_monitor: 'ข้อมูล Raw Data',
            raw_empty: 'เชื่อมต่อ ELM327 เพื่อดูค่า Raw Data',
            bt_connect_title: 'เชื่อมต่อ ELM327', bt_connect_sub: 'ค้นหาและเชื่อมต่อ OBD2 Adapter',
            bt_ready: 'พร้อมค้นหา', bt_scan_connect: '🔍 ค้นหา & เชื่อมต่อ',
            bt_auto_connect: '⚡ เชื่อมต่ออัตโนมัติ', bt_disconnect: '⊘ ตัดการเชื่อมต่อ', bt_close: '✕ ปิด',
        }
    };

    let currentLang = localStorage.getItem('sg_lang') || 'EN';
    const btnLang = document.getElementById('btn-lang');

    function updateLanguage() {
        btnLang.textContent = currentLang === 'EN' ? 'TH' : 'EN';
        const langObj = i18n[currentLang];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (langObj[key]) el.textContent = langObj[key];
        });
        titleEl.textContent = langObj[`title_${screenKeys[swiper.activeIndex]}`];
    }

    btnLang.addEventListener('click', () => {
        currentLang = currentLang === 'EN' ? 'TH' : 'EN';
        localStorage.setItem('sg_lang', currentLang);
        updateLanguage();
    });


    // =========================================
    // SWIPER
    // =========================================
    const screenKeys = ['tacho', 'live', 'gps', 'drag', 'dtc', 'settings'];
    const titleEl = document.getElementById('screen-title');
    const dotsContainer = document.querySelector('.pagination-dots');

    screenKeys.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = `dot ${i === 0 ? 'active' : ''}`;
        dotsContainer.appendChild(dot);
    });

    const dots = document.querySelectorAll('.dot');

    const swiper = new Swiper('.mySwiper', {
        navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        grabCursor: true,
        touchStartPreventDefault: false,
        touchReleaseOnEdges: true,
        threshold: 15,
        on: {
            slideChange() {
                titleEl.textContent = i18n[currentLang][`title_${screenKeys[this.activeIndex]}`];
                dots.forEach(d => d.classList.remove('active'));
                dots[this.activeIndex].classList.add('active');
            }
        }
    });

    // แอป iOS (Capacitor) ไม่ใช้ Service Worker — ไฟล์ทั้งหมดอยู่ในแอปอยู่แล้ว
    if ('serviceWorker' in navigator && !window.SGBle.isNative) {
        window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
    }


    // =========================================
    // ELM327 BLUETOOTH ENGINE
    // =========================================

    const btnBt = document.getElementById('btn-bluetooth');
    const btLed = document.getElementById('bt-led');
    const btStatusEl = document.getElementById('bt-status');
    const btModal = document.getElementById('bt-modal');
    const btScanStatus = document.getElementById('bt-scan-status');
    const btScanText = document.getElementById('bt-scan-text');
    const btDeviceInfo = document.getElementById('bt-device-info');
    const btDeviceNameModal = document.getElementById('bt-device-name-modal');
    const btModalLog = document.getElementById('bt-modal-log');
    const btnModalConnect = document.getElementById('btn-modal-connect');
    const btnModalAuto = document.getElementById('btn-modal-auto');
    const btnModalDisconnect = document.getElementById('btn-modal-disconnect');
    const btnModalClose = document.getElementById('btn-modal-close');

    // ตัวเชื่อมต่อจริงอยู่ใน ble-transport.js (Native BLE ในแอป iOS / Web Bluetooth ในเบราว์เซอร์)
    const ble = window.SGBle;
    let btDevice = null;           // { deviceId, name } ของอุปกรณ์ที่เลือก
    let btChar = null;             // { service, characteristic } เมื่อพร้อมรับส่งข้อมูล
    let btDecoder = new TextDecoder('utf-8');   // stream: ต่ออักษรไทยที่ถูกตัดคร่อม chunk ให้ถูก
    let userDisconnected = false;  // ผู้ใช้กดตัดเอง → ไม่ต่อใหม่อัตโนมัติ
    let reconnectTries = 0;
    let reconnectTimer = null;
    const MAX_RECONNECT = 3;
    let receiveBuffer = '';
    let lastRawResponse = '';
    let pollActive = false;
    let isInitializing = false;
    let currentTPS = 0;
    let currentLoad = 0;
    let currentMAP = 0;

    // ── ESP32 K-Line BLE Mode ──
    let isKlineMode = false;       // true when connected to ESP32 K-Line bridge
    let klineJsonBuffer = '';      // buffer for incoming JSON chunks
    let ecuBoxCode = '--';         // ECU part number
    let flashReady = false;        // Flash-capable status
    let ecuStatus = false;         // ECU responding status

    let currentVehicleProfile = localStorage.getItem('sg_vehicle_profile') || 'pcx160';

    // ✅ PID ที่ Honda PCX ECU รองรับจริง
    const PIDS = {
        ENGINE_LOAD: '0104',
        COOLANT: '0105',
        STFT_B1: '0106',
        MAP: '010B',
        RPM: '010C',
        SPEED: '010D',
        TIMING_ADV: '010E',
        IAT: '010F',
        TPS: '0111',
        O2_B1S1: '0114',
        BATT: '0142',
    };

    // ⚡⚡⚡ TURBO MODE — RPM อย่างเดียววนเร็วสุด
    // Priority: RPM ONLY → refresh ทุก ~200ms
    const priorityPollQueue = [
        PIDS.RPM,
    ];

    // Fast: SPEED + TPS → refresh ทุก ~500ms
    const fastPollQueue = [
        PIDS.SPEED, PIDS.TPS,
    ];

    // Slow: ค่าที่คงที่ → refresh ทุก ~4s
    const slowPollQueue = [
        PIDS.MAP, PIDS.ENGINE_LOAD, PIDS.COOLANT, PIDS.IAT,
        PIDS.BATT, PIDS.O2_B1S1, PIDS.STFT_B1, PIDS.TIMING_ADV,
    ];

    // ✅ Round-robin state
    let priorityIdx = 0;
    let fastIdx = 0;
    let slowIdx = 0;
    let fastCounter = 0;
    let slowCounter = 0;

    // ⚡ Turbo: RPM วน 4 ครั้ง → ค่อยอ่าน SPEED/TPS 1 ครั้ง
    const FAST_DIVIDER = 4;    // → fast ทุก ~800ms
    // Slow: RPM วน 16 ครั้ง → ค่อยอ่าน MAP/LOAD/COOLANT 1 ครั้ง
    const SLOW_DIVIDER = 16;   // → slow ทุก ~3.2s

    const POLL_DELAY_MS = 0;

    const rawData = {};

    const PID_LABELS = {
        '0104': 'LOAD', '0105': 'COOLANT', '0106': 'STFT',
        '010B': 'MAP', '010C': 'RPM', '010D': 'SPEED', '010E': 'IGT-ADV',
        '010F': 'IAT', '0111': 'TPS', '0114': 'O2', '0142': 'BATT',
    };

    // ── Toast ─────────────────────────────────────────────────
    function showStatus(msg, duration = 3200) {
        btStatusEl.textContent = msg;
        btStatusEl.classList.add('show');
        clearTimeout(btStatusEl._t);
        btStatusEl._t = setTimeout(() => btStatusEl.classList.remove('show'), duration);
    }

    function modalLog(msg, type = 'info') {
        const line = document.createElement('div');
        line.className = `modal-log-line log-${type}`;
        const ts = new Date().toLocaleTimeString('th-TH', { hour12: false });
        line.textContent = `[${ts}] ${msg}`;
        btModalLog.appendChild(line);
        btModalLog.scrollTop = btModalLog.scrollHeight;
        debugLog(msg, type === 'error' ? '#ff4444' : type === 'success' ? '#00ff88' : type === 'warn' ? '#ffaa00' : '#7aaeff');
        if (window.SGLog) {
            if (type === 'error') SGLog.error(msg);
            else if (type === 'warn') SGLog.warn(msg);
            else SGLog.info(msg);
        }
    }

    function setConnectedUI(connected, name = '') {
        btLed.classList.toggle('connected', connected);
        btnModalConnect.style.display = connected ? 'none' : '';
        btnModalAuto.style.display = connected ? 'none' : '';
        btnModalDisconnect.style.display = connected ? '' : 'none';
        if (connected) {
            btDeviceNameModal.textContent = name || 'ELM327';
            btDeviceInfo.style.display = 'flex';
            btScanText.textContent = '✅ Connected!';
            btScanStatus.classList.add('scanning-done');
            btScanStatus.classList.remove('scanning');
            document.getElementById('set-device-name').textContent = name || 'ELM327';
        } else {
            btDeviceInfo.style.display = 'none';
            btScanStatus.classList.remove('scanning-done', 'scanning');
            btScanText.textContent = i18n[currentLang].bt_ready;
        }
    }

    function setEl(id, val, unit = '') {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = unit ? `${val}<span class="${el.classList.contains('g-val') ? 'g-unit' : 'unit'}">${unit}</span>` : String(val);
    }

    function setBar(id, val, max) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.min((val / max) * 100, 100) + '%';
    }

    function updateRawMonitor() {
        const mon = document.getElementById('raw-monitor');
        if (!mon) return;
        mon.innerHTML = '';
        Object.values(rawData).forEach(d => {
            const row = document.createElement('div');
            row.className = 'raw-row';
            row.innerHTML = `<span class="raw-label">${d.label}</span><span class="raw-val">${d.val}<span class="raw-unit"> ${d.unit}</span></span>`;
            mon.appendChild(row);
        });
    }

    // ── PID parser & UI updater ───────────────────────────────
    function processOBDFrame(rawInput) {
        if (window.SGLog) SGLog.rx(rawInput);

        if (rawInput.includes('UNABLETOCONNECT') || rawInput.includes('NODATA') || rawInput.includes('ERROR')) {
            debugLog(`⚠️ ECU Error Response: ${rawInput}`, '#ffaa00');
            if (window.SGLog && lastCommandSent) {
                const lbl = PID_LABELS[lastCommandSent] || lastCommandSent;
                SGLog.pidFail(lastCommandSent, lbl, rawInput.includes('NODATA') ? 'NODATA' : 'ERROR');
            }
            return;
        }

        let data = rawInput
            .replace(/^(83F1[0-9A-F]{2}|C1[0-9A-F]{2}F1|7E8[0-9A-F]{0,2})/i, '')
            .replace(/^01[0-9A-F]{2}/i, (match) => rawInput.includes('41') ? '' : match);

        if (data.includes('ELM327')) {
            document.getElementById('set-elm-ver').textContent = data.replace(/[^A-Z0-9.\s]/g, '').trim().substring(0, 20);
        }

        const voltMatch = data.match(/(\d+\.\d+)V/);
        if (voltMatch) {
            setEl('ld-batt', voltMatch[1], 'V');
            setEl('val-batt1', voltMatch[1]);
            if (window.SGLog) SGLog.pid('ATRV', 'BATT', voltMatch[1], 'V', rawInput);
        }

        if (/ISO|CAN|SAE|PWM|KWP|VPW/.test(data)) {
            const isCANBus = /CAN|ISO15765|11215|11230/.test(data);
            const busType = isCANBus ? 'CAN BUS' : 'K-LINE';
            document.getElementById('set-comm-badge').textContent = busType;
            document.getElementById('set-comm-badge').className = `settings-value comm-badge ${isCANBus ? 'badge-can' : 'badge-kline'}`;
            document.getElementById('dtc-protocol').textContent = busType;
            document.getElementById('set-protocol').textContent = data.substring(0, 22);
        }

        const idx4101 = data.indexOf('4101');
        if (idx4101 !== -1 && data.length >= idx4101 + 6) {
            const hex = data.substring(idx4101 + 4);
            const A = parseInt(hex.substring(0, 2), 16) || 0;
            const milOn = (A & 0x80) !== 0;
            const numDTC = A & 0x7F;
            const milEl = document.getElementById('dtc-mil-status');
            milEl.textContent = milOn ? 'ON ⚠' : 'OFF';
            milEl.style.color = milOn ? '#ff3333' : '#00ff88';
            document.getElementById('dtc-monitors').textContent = numDTC;
            if (numDTC > 0) document.getElementById('dtc-count').textContent = numDTC;
        }

        const idx0902 = data.indexOf('4902');
        if (idx0902 !== -1 && data.length > idx0902 + 4) {
            let vin = '';
            const hex = data.substring(idx0902 + 4);
            for (let i = 0; i < hex.length - 1; i += 2) {
                const c = parseInt(hex.substring(i, i + 2), 16);
                if (c > 31 && c < 127) vin += String.fromCharCode(c);
            }
            if (vin.length > 5) document.getElementById('set-vin').textContent = vin;
        }

        const matchOBD = data.match(/41([0-9A-F]{2})([0-9A-F]+)/);
        if (matchOBD) {
            const pidHex = matchOBD[1];
            const pid = '01' + pidHex;
            const hex = matchOBD[2];
            const A = parseInt(hex.substring(0, 2), 16) || 0;
            const B = hex.length >= 4 ? parseInt(hex.substring(2, 4), 16) || 0 : 0;

            let val, label, unit;

            switch (pid) {
                case PIDS.RPM:
                    val = Math.round(((A * 256) + B) / 4);
                    label = 'RPM'; unit = 'rpm';
                    currentRPM = val;
                    setGaugeValues(currentSpeed, val);
                    setEl('ld-rpm', val, 'rpm'); setBar('lb-rpm', val, 8000);
                    break;

                case PIDS.SPEED:
                    val = fmtNum(A, 0);
                    label = 'SPEED'; unit = 'km/h';
                    currentSpeed = val;
                    setGaugeValues(val, currentRPM);
                    setEl('val-speed1', val); setBar('bar-speed', val, 240);
                    setEl('ld-speed', val, 'km/h'); setBar('lb-speed', val, 240);
                    break;

                case PIDS.TPS:
                    val = fmtNum((A * 100) / 255, 0);
                    label = 'TPS'; unit = '%';
                    currentTPS = val;
                    setEl('val-tps1', val); setBar('bar-tps', val, 100);
                    setEl('ld-tps', val, '%'); setBar('lb-tps', val, 100);
                    break;

                case PIDS.COOLANT:
                    val = fmtNum(A - 40, 0);
                    label = 'COOLANT'; unit = '°C';
                    setEl('val-eot1', val); setBar('bar-eot', A, 215);
                    setEl('ld-eot', val, '°C'); setBar('lb-eot', A, 215);
                    break;

                case PIDS.IAT:
                    val = fmtNum(A - 40, 0);
                    label = 'IAT'; unit = '°C';
                    setEl('ld-iat', val, '°C'); setBar('lb-iat', A, 215);
                    break;

                case PIDS.MAP:
                    val = fmtNum(A, 0);
                    label = 'MAP'; unit = 'kPa';
                    currentMAP = val;
                    setEl('ld-map', val, 'kPa'); setBar('lb-map', val, 255);
                    break;

                case PIDS.ENGINE_LOAD:
                    val = fmtNum((A * 100) / 255, 0);
                    label = 'LOAD'; unit = '%';
                    currentLoad = val;
                    setEl('ld-load', val, '%'); setBar('lb-load', val, 100);
                    break;

                case PIDS.STFT_B1:
                    val = fmtNum((A - 128) * 100 / 128, 1);
                    label = 'STFT B1'; unit = '%';
                    setEl('ld-stft', val, '%'); setBar('lb-stft', A, 255);
                    break;

                case PIDS.O2_B1S1:
                    val = fmtNum(A * 0.005, 3);
                    label = 'O2 B1S1'; unit = 'V';
                    setEl('ld-o2', val, 'V'); setBar('lb-o2', A, 255);
                    break;

                case PIDS.BATT:
                    val = fmtNum((A * 256 + B) / 1000, 2);
                    label = 'BATT'; unit = 'V';
                    setEl('val-batt1', val);
                    setEl('ld-batt', val, 'V'); setBar('lb-batt', parseFloat(val), 16);
                    break;

                case PIDS.TIMING_ADV:
                    val = fmtNum(A / 2 - 64, 1);
                    label = 'IGT Advance'; unit = '°';
                    setEl('val-igt1', val); setEl('ld-igt', val, '°');
                    break;

                default:
                    val = A; label = pid; unit = '';
            }

            if (val !== undefined) {
                rawData[pid] = { label, val, unit };
                updateRawMonitor();
                if (window.SGLog) SGLog.pid(pid, label, val, unit, rawInput);
            }
        }

        if (data.includes('43')) {
            const idx43 = data.indexOf('43');
            renderDTCs(parseDTCBytes(data.substring(idx43)));
        }
    }

    // ⚡⚡⚡ TURBO Round-robin: RPM ทุกครั้ง, SPEED/TPS ทุก 4, อื่นๆ ทุก 16
    let lastCommandSent = '';

    // ════════════════════════════════════════════════════════════
    //  ESP32 LOG VIEWER (log ที่ ESP32 ส่งมาทาง BLE แบบ KLINE_LOG)
    // ════════════════════════════════════════════════════════════
    const ESP_LOG_MAX = 400;
    const espLogLines = [];
    let espLogStarted = false;

    function espLogRender() {
        const el = document.getElementById('esp-log');
        if (!el) return;
        el.textContent = espLogLines.join('\n');
        const auto = document.getElementById('esp-log-autoscroll');
        if (!auto || auto.checked) el.scrollTop = el.scrollHeight;
    }

    let espLogRenderPending = false;
    function espLogAppend(t, msg) {
        const now = new Date().toLocaleTimeString('th-TH', { hour12: false });
        const ms = (typeof t === 'number') ? ` +${(t / 1000).toFixed(2)}s` : '';
        if (!espLogStarted) { espLogLines.length = 0; espLogStarted = true; }
        espLogLines.push(`${now}${ms}  ${msg}`);
        if (espLogLines.length > ESP_LOG_MAX) espLogLines.splice(0, espLogLines.length - ESP_LOG_MAX);
        if (window.SGLog) SGLog.info(`[ESP32] ${msg}`);
        // รวม render เป็นรอบละครั้งต่อเฟรม เพราะ log มาถี่
        if (!espLogRenderPending) {
            espLogRenderPending = true;
            requestAnimationFrame(() => { espLogRenderPending = false; espLogRender(); });
        }
    }

    document.getElementById('btn-esp-rescan')?.addEventListener('click', () => {
        if (!btChar || !isKlineMode) { espLogAppend(null, '⚠ ยังไม่ได้เชื่อมต่อ ESP32 (โหมด PVX150)'); return; }
        espLogAppend(null, '→ ส่งคำสั่ง SCAN ให้ ESP32');
        sendCommand('SCAN');
    });
    document.getElementById('btn-esp-clear')?.addEventListener('click', () => {
        espLogLines.length = 0;
        espLogRender();
    });
    document.getElementById('btn-esp-copy')?.addEventListener('click', async () => {
        const text = espLogLines.join('\n');
        try {
            await navigator.clipboard.writeText(text);
            showStatus('📋 Copied ESP32 log');
        } catch (e) {
            // Bluefy/iOS บางรุ่นไม่ให้ใช้ clipboard API → เลือกข้อความให้กด Copy เอง
            const el = document.getElementById('esp-log');
            if (el) {
                const r = document.createRange(); r.selectNodeContents(el);
                const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
            }
        }
    });

    // ════════════════════════════════════════════════════════════
    //  ESP32 K-LINE BLE JSON HANDLER
    // ════════════════════════════════════════════════════════════
    function handleKLineJSON(jsonStr) {
        try {
            const d = JSON.parse(jsonStr);
            if (d.type === 'KLINE_LOG') { espLogAppend(d.t, d.msg); return; }
            if (d.type !== 'KLINE_DATA') return;

            // ── สถานะ auto-scan ของ ESP32 ──
            if (d.proto !== undefined) {
                const pEl = document.getElementById('esp-proto');
                if (pEl) {
                    pEl.textContent = d.proto + (d.tbl ? ` (table ${d.tbl})` : '');
                    pEl.style.color = d.proto === 'SCANNING' ? '#ffaa00' : '#00ff88';
                }
                const protoEl = document.getElementById('set-protocol');
                if (protoEl) protoEl.textContent = `K-Line ESP32 · ${d.proto}`;
            }
            if (d.scan !== undefined) { const e = document.getElementById('esp-scan'); if (e) e.textContent = d.scan; }
            if (d.raw !== undefined) { const e = document.getElementById('esp-raw'); if (e) e.textContent = d.raw || '--'; }

            debugLog(`📡 K-Line: RPM=${d.rpm} TPS=${d.tps} SPD=${d.speed}`, '#00ff88');
            if (window.SGLog) SGLog.rx(jsonStr);

            // ── Update sensor values ──
            if (d.rpm !== undefined) {
                currentRPM = fmtNum(d.rpm, 0);
                setGaugeValues(currentSpeed, currentRPM);
                setEl('ld-rpm', currentRPM, 'rpm'); setBar('lb-rpm', currentRPM, 8000);
                rawData['010C'] = { label: 'RPM', val: currentRPM, unit: 'rpm' };
            }
            if (d.speed !== undefined) {
                currentSpeed = fmtNum(d.speed, 0);
                setGaugeValues(currentSpeed, currentRPM);
                setEl('val-speed1', currentSpeed); setBar('bar-speed', currentSpeed, 240);
                setEl('ld-speed', currentSpeed, 'km/h'); setBar('lb-speed', currentSpeed, 240);
                rawData['010D'] = { label: 'SPEED', val: currentSpeed, unit: 'km/h' };
            }
            if (d.tps !== undefined) {
                currentTPS = fmtNum(d.tps, 1);
                setEl('val-tps1', currentTPS); setBar('bar-tps', currentTPS, 100);
                setEl('ld-tps', currentTPS, '%'); setBar('lb-tps', currentTPS, 100);
                rawData['0111'] = { label: 'TPS', val: currentTPS, unit: '%' };
            }
            if (d.eot !== undefined) {
                setEl('val-eot1', d.eot); setBar('bar-eot', d.eot + 40, 215);
                setEl('ld-eot', d.eot, '°C'); setBar('lb-eot', d.eot + 40, 215);
                rawData['0105'] = { label: 'ECT', val: d.eot, unit: '°C' };
            }
            if (d.iat !== undefined) {
                setEl('ld-iat', d.iat, '°C'); setBar('lb-iat', d.iat + 40, 215);
                rawData['010F'] = { label: 'IAT', val: d.iat, unit: '°C' };
            }
            if (d.map !== undefined) {
                currentMAP = fmtNum(d.map, 0);
                setEl('ld-map', currentMAP, 'kPa'); setBar('lb-map', currentMAP, 255);
                rawData['010B'] = { label: 'MAP', val: currentMAP, unit: 'kPa' };
            }
            if (d.batt !== undefined) {
                setEl('val-batt1', d.batt);
                setEl('ld-batt', d.batt, 'V'); setBar('lb-batt', parseFloat(d.batt), 16);
                rawData['0142'] = { label: 'BATT', val: d.batt, unit: 'V' };
            }
            if (d.inj !== undefined) {
                setEl('val-inj', d.inj);
                setEl('ld-inj', d.inj, 'ms'); setBar('lb-inj', (parseFloat(d.inj) / 15) * 100, 100);
                rawData['INJ'] = { label: 'INJ', val: d.inj, unit: 'ms' };
            }
            if (d.igt !== undefined) {
                setEl('val-igt1', d.igt);
                setEl('ld-igt', d.igt, '°'); setBar('lb-igt', (parseFloat(d.igt) + 10) * 2, 100);
                rawData['010E'] = { label: 'IGT', val: d.igt, unit: '°' };
            }
            if (d.o2 !== undefined) {
                setEl('ld-o2', d.o2, 'V'); setBar('lb-o2', parseFloat(d.o2) * 100, 100);
                rawData['0114'] = { label: 'O2', val: d.o2, unit: 'V' };
            }
            if (d.afr !== undefined) {
                setEl('val-afr1', d.afr);
                setEl('ld-afr', d.afr, 'λ'); setBar('lb-afr', (parseFloat(d.afr) / 2) * 100, 100);
                rawData['AFR'] = { label: 'AFR', val: d.afr, unit: 'λ' };
            }
            if (d.stft !== undefined) {
                setEl('ld-stft', d.stft, '%'); setBar('lb-stft', Math.abs(parseFloat(d.stft)) * 4, 100);
                rawData['0106'] = { label: 'STFT', val: d.stft, unit: '%' };
            }
            if (d.ltft !== undefined) {
                setEl('ld-ltft', d.ltft, '%'); setBar('lb-ltft', Math.abs(parseFloat(d.ltft)) * 4, 100);
                rawData['LTFT'] = { label: 'LTFT', val: d.ltft, unit: '%' };
            }
            if (d.load !== undefined) {
                currentLoad = fmtNum(d.load, 0);
                setEl('ld-load', currentLoad, '%'); setBar('lb-load', currentLoad, 100);
                rawData['0104'] = { label: 'LOAD', val: currentLoad, unit: '%' };
            }
            if (d.duty !== undefined) {
                setEl('val-duty1', d.duty);
                setEl('ld-duty', d.duty, '%'); setBar('lb-duty', d.duty, 100);
                rawData['DUTY'] = { label: 'DUTY', val: d.duty, unit: '%' };
            }

            // ── ECU Box Code ──
            if (d.boxCode) {
                ecuBoxCode = d.boxCode;
                const boxEl = document.getElementById('set-ecu-boxcode');
                if (boxEl) boxEl.textContent = ecuBoxCode;
                // Also update VIN field with box code
                const vinEl = document.getElementById('set-vin');
                if (vinEl) vinEl.textContent = ecuBoxCode;
            }

            // ── Flash Ready Status ──
            if (d.flashOk !== undefined) {
                flashReady = d.flashOk;
                const dotEl = document.getElementById('flash-status-dot');
                const txtEl = document.getElementById('flash-status-text');
                if (dotEl && txtEl) {
                    if (flashReady) {
                        dotEl.style.background = '#00ff88';
                        dotEl.style.boxShadow = '0 0 8px #00ff88';
                        txtEl.textContent = 'READY';
                        txtEl.style.color = '#00ff88';
                    } else {
                        dotEl.style.background = '#ff8c00';
                        dotEl.style.boxShadow = '0 0 8px #ff8c00';
                        txtEl.textContent = 'NOT READY';
                        txtEl.style.color = '#ff8c00';
                    }
                }
            }

            // ── ECU Status ──
            if (d.ecuOk !== undefined) {
                ecuStatus = d.ecuOk;
                const ecuEl = document.getElementById('set-ecu-status');
                if (ecuEl) {
                    ecuEl.textContent = ecuStatus ? '✓ ECU Responding' : '✗ No ECU Response';
                    ecuEl.style.color = ecuStatus ? '#00ff88' : '#ff4444';
                }
            }

            updateRawMonitor();

            // Log to SGLog
            if (window.SGLog) {
                SGLog.pid('KLINE', 'RPM', d.rpm || 0, 'rpm', jsonStr);
            }

        } catch (e) {
            // Not valid JSON yet, might be partial
            debugLog(`⚠ JSON parse error: ${e.message}`, '#ffaa00');
        }
    }

    // ════════════════════════════════════════════════════════════
    //  DATA HANDLER (routes to ELM327 or K-Line mode)
    // ════════════════════════════════════════════════════════════

    function handleData(event) {
        const str = btDecoder.decode(event.target.value, { stream: true });

        // ── ESP32 K-Line BLE mode: receive JSON ──
        if (isKlineMode) {
            klineJsonBuffer += str;

            // JSON might arrive in chunks; look for complete objects
            // ESP32 sends one JSON object per notification
            let braceDepth = 0;
            let startIdx = -1;

            for (let i = 0; i < klineJsonBuffer.length; i++) {
                if (klineJsonBuffer[i] === '{') {
                    if (braceDepth === 0) startIdx = i;
                    braceDepth++;
                }
                if (klineJsonBuffer[i] === '}') {
                    braceDepth--;
                    if (braceDepth === 0 && startIdx >= 0) {
                        const complete = klineJsonBuffer.substring(startIdx, i + 1);
                        handleKLineJSON(complete);
                        klineJsonBuffer = klineJsonBuffer.substring(i + 1);
                        startIdx = -1;
                        i = -1;  // restart scan
                    }
                }
            }

            // Prevent buffer overflow
            if (klineJsonBuffer.length > 4096) {
                klineJsonBuffer = klineJsonBuffer.substring(klineJsonBuffer.length - 1024);
            }
            return;
        }

        // ── ELM327 mode: standard AT command handling ──
        receiveBuffer += str;

        while (receiveBuffer.includes('>')) {
            const idx = receiveBuffer.indexOf('>');
            const raw = receiveBuffer.substring(0, idx).replace(/[\r\n\s]/g, '').toUpperCase();
            receiveBuffer = receiveBuffer.substring(idx + 1);

            if (raw.length > 2) {
                lastRawResponse = raw;
                processOBDFrame(raw);
            }

            // ⚡ Turbo polling
            if (pollActive && !isInitializing) {
                let nextCmd;
                fastCounter++;
                slowCounter++;

                // Slow ทุก 16 cycle — MAP/LOAD/COOLANT/IAT/BATT/O2/STFT/IGT
                if ((slowCounter % SLOW_DIVIDER) === 0) {
                    nextCmd = slowPollQueue[slowIdx];
                    slowIdx = (slowIdx + 1) % slowPollQueue.length;
                    fastCounter = 0; // reset ไม่ให้ fast ชน
                }
                // Fast ทุก 4 cycle — SPEED/TPS
                else if ((fastCounter % FAST_DIVIDER) === 0) {
                    nextCmd = fastPollQueue[fastIdx];
                    fastIdx = (fastIdx + 1) % fastPollQueue.length;
                }
                // Priority ทุก cycle — RPM
                else {
                    nextCmd = priorityPollQueue[priorityIdx];
                    priorityIdx = (priorityIdx + 1) % priorityPollQueue.length;
                }

                setTimeout(() => {
                    if (pollActive && !isInitializing) {
                        sendCommandFast(nextCmd);
                    }
                }, POLL_DELAY_MS);
            }
        }
    }

    async function sendCommand(cmd) {
        if (!btChar) return;
        lastCommandSent = cmd;
        if (window.SGLog) SGLog.tx(cmd);
        try {
            await ble.write(new TextEncoder().encode(cmd + '\r'));
        } catch (e) {
            debugLog(`✗ TX: ${e.message}`, '#ff4444');
        }
    }

    function sendCommandFast(cmd) {
        if (!btChar) return;
        lastCommandSent = cmd;
        if (window.SGLog) SGLog.tx(cmd);
        ble.write(new TextEncoder().encode(cmd + '\r'))
            .catch(e => debugLog(`✗ TX: ${e.message}`, '#ff4444'));
    }

    const delay = ms => new Promise(r => setTimeout(r, ms));

    // ── ELM327 initialization ─────────────────────────────────
    async function initELM327() {
        isInitializing = true;
        pollActive = false;
        modalLog('🔧 Initializing ELM327...', 'info');

        await sendCommand('ATZ'); await delay(1200); modalLog('ATZ → Cold Reset', 'info');
        await sendCommand('ATE0'); await delay(200); modalLog('ATE0 → Echo OFF', 'info');
        await sendCommand('ATL0'); await delay(200); modalLog('ATL0 → LF OFF', 'info');
        await sendCommand('ATS0'); await delay(200); modalLog('ATS0 → Spaces OFF', 'info');
        await sendCommand('ATH0'); await delay(200); modalLog('ATH0 → Headers OFF', 'info');
        await sendCommand('ATAT2'); await delay(200); modalLog('ATAT2 → Adaptive Timing 2 (fast)', 'info');
        await sendCommand('ATST19'); await delay(200); modalLog('ATST19 → Timeout 100ms (fast)', 'info');
        await sendCommand('ATRV'); await delay(300); modalLog('ATRV → Voltage check', 'info');

        // ✅ KWP2000 Fast FIRST — Honda PCX ใช้ K-Line
        const protocols = [
            { proto: 'ATSP5', header: 'ATSH8112F1', testPIDs: ['0100'], waitMs: 1200, label: 'KWP2000 Fast (8112F1)' },
            { proto: 'ATSP5', header: 'ATSH8111F1', testPIDs: ['0100'], waitMs: 1200, label: 'KWP2000 Fast (8111F1)' },
            { proto: 'ATSP5', header: 'ATSH8133F1', testPIDs: ['0100'], waitMs: 1200, label: 'KWP2000 Fast (8133F1)' },
            { proto: 'ATSP5', header: 'ATSHC133F1', testPIDs: ['0100'], waitMs: 1200, label: 'KWP2000 Fast (C133F1)' },
            { proto: 'ATSP4', header: 'ATSH8112F1', testPIDs: ['0100'], waitMs: 2500, label: 'KWP2000 5Baud (8112F1)' },
            { proto: 'ATSP3', header: 'ATSH8112F1', testPIDs: ['0100'], waitMs: 2500, label: 'ISO 9141-2 (8112F1)' },
            { proto: 'ATSP6', header: 'ATSH7E0', testPIDs: ['0100'], waitMs: 800, label: 'CAN 500k (fallback)' },
            { proto: 'ATSP0', header: null, testPIDs: ['0100'], waitMs: 3000, label: 'Auto Protocol' },
        ];

        function isValidReply(raw) {
            if (!raw || raw.length < 4) return false;
            const errorWords = ['ERROR', 'UNABLE', 'NODATA', 'STOPPED', 'SEARCHING', 'BUSINIIT', 'BUSINITIALIZATION'];
            if (errorWords.some(w => raw.includes(w))) return false;
            return /41[0-9A-F]{2}|61[0-9A-F]{2}/.test(raw);
        }

        let ecuConnected = false;

        for (const p of protocols) {
            if (!ble.isConnected()) {
                modalLog('⚠ GATT disconnected. Aborting ECU init.', 'error');
                isInitializing = false;
                return;
            }

            modalLog(`🔄 Trying ${p.label}...`, 'info');
            if (window.SGLog) SGLog.info(`Trying protocol: ${p.label}`);

            lastRawResponse = ''; receiveBuffer = '';
            await sendCommand(p.proto);
            await delay(250);

            if (p.header) {
                lastRawResponse = ''; receiveBuffer = '';
                await sendCommand(p.header);
                await delay(250);
            }

            for (const pid of p.testPIDs) {
                if (!ble.isConnected()) break;

                lastRawResponse = '';
                receiveBuffer = '';
                await sendCommand(pid);
                await delay(p.waitMs);

                const reply = lastRawResponse;
                const replyShort = reply.substring(0, 40) || '(no response)';
                modalLog(`  [${pid}] → ${replyShort}`, reply && !reply.includes('ERROR') ? 'info' : 'warn');

                if (isValidReply(reply)) {
                    ecuConnected = true;
                    if (window.SGLog) SGLog.setProtocol(p.label);
                    modalLog(`✅ ECU responded to ${pid} via ${p.label}!`, 'success');
                    break;
                }

                if (reply.includes('BUSINIIT') || reply.includes('BUSINITIALIZATION') ||
                    (reply.includes('ERROR') && !reply.includes('NODATA'))) {
                    break;
                }
            }

            if (ecuConnected) break;
            modalLog(`  ✗ ${p.label} — no valid ECU response`, 'warn');
        }

        if (!ble.isConnected()) {
            modalLog('❌ Connection lost before completing init.', 'error');
            isInitializing = false;
            return;
        }

        if (!ecuConnected) {
            modalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warn');
            modalLog('⚠️  All protocols exhausted — no ECU response', 'warn');
            modalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warn');
            isInitializing = false;
            return;
        }

        document.getElementById('set-car-brand').textContent = 'Honda';
        if (currentVehicleProfile === 'pcx160') {
            document.getElementById('set-car-model').textContent = 'PCX 160 (K1Z)';
            document.getElementById('set-car-year').textContent = '2025-2026 (30400-K1Z-TC2)';
        } else {
            document.getElementById('set-car-model').textContent = 'PCX 150 (K36)';
            document.getElementById('set-car-year').textContent = '2014-2016 (30400-K36-T01)';
        }

        await sendCommand('ATDP'); await delay(300);
        await sendCommand('0101'); await delay(300);

        modalLog('✅ Init complete! Turbo polling started.', 'success');
        debugLog('⚡⚡⚡ TURBO MODE — RPM refresh ~200ms', '#00ff88');
        if (window.SGLog) SGLog.info('ELM327 init complete — TURBO polling started');

        isInitializing = false;
        pollActive = true;
        priorityIdx = 0;
        fastIdx = 0;
        slowIdx = 0;
        fastCounter = 0;
        slowCounter = 0;
        sendCommandFast(priorityPollQueue[0]);
    }

    function onGattDisconnect() {
        pollActive = false;
        btChar = null;
        setConnectedUI(false);
        showStatus(currentLang === 'TH' ? 'บลูทูธตัดการเชื่อมต่อ' : 'Bluetooth Disconnected');
        modalLog('⚠ Connection lost', 'error');
        if (window.SGLog) SGLog.warn('BLE connection lost');
        scheduleReconnect();
    }

    // ต่อใหม่อัตโนมัติกับอุปกรณ์เดิมเมื่อหลุดเอง (ไม่ใช่ผู้ใช้กดตัด) สูงสุด MAX_RECONNECT ครั้ง
    function scheduleReconnect() {
        if (userDisconnected || !btDevice || reconnectTimer) return;
        if (reconnectTries >= MAX_RECONNECT) {
            modalLog(currentLang === 'TH'
                ? `✗ ต่อใหม่ไม่สำเร็จ ${MAX_RECONNECT} ครั้ง — กด Connect เพื่อลองอีกครั้ง`
                : `✗ Reconnect failed ${MAX_RECONNECT} times — press Connect to retry`, 'error');
            return;
        }
        reconnectTries++;
        const waitMs = 2000 * reconnectTries;
        modalLog(`🔄 Reconnect ${reconnectTries}/${MAX_RECONNECT} in ${waitMs / 1000}s...`, 'info');
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            // แอปอยู่เบื้องหลัง → รอกลับมาหน้าแอปค่อยต่อ (ดู visibilitychange ด้านล่าง)
            if (!document.hidden) connectBluetooth(true, btDevice);
        }, waitMs);
    }

    // กลับมาที่แอป/แท็บ แล้วการเชื่อมต่อหลุดไประหว่างนั้น → ต่อใหม่กับอุปกรณ์เดิม
    document.addEventListener('visibilitychange', () => {
        if (document.hidden || userDisconnected || !btDevice || ble.isConnected() || reconnectTimer) return;
        reconnectTries = 0;
        connectBluetooth(true, btDevice);
    });

    async function doDisconnect() {
        userDisconnected = true;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        pollActive = false;
        btChar = null;
        await ble.disconnect();
        setConnectedUI(false);
        modalLog('⊘ Disconnected.', 'warn');
        showStatus('Disconnected');

        if (window.SGLog) {
            SGLog.info('User disconnected');
            SGLog.printSummary();
        }
    }

    btnModalDisconnect.addEventListener('click', doDisconnect);

    let connecting = false;

    // reuseDevice: อุปกรณ์เดิม (ใช้ตอนต่อใหม่อัตโนมัติ) → ข้ามขั้นตอนสแกน/เลือกอุปกรณ์
    async function connectBluetooth(autoMode = false, reuseDevice = null) {
        if (ble.isConnected() || connecting) return;

        // เบราว์เซอร์ไม่มี Web Bluetooth (เช่น Safari/Chrome บน iPhone) → แนะนำ Bluefy
        // (ในแอป iOS ใช้ Native BLE เสมอ จึงไม่เข้าเงื่อนไขนี้)
        if (!ble.isAvailable()) {
            btModal.style.display = 'none';
            if (window.showBluefyGate && window.showBluefyGate()) return;
            showStatus(currentLang === 'TH'
                ? '❌ เบราว์เซอร์นี้ไม่รองรับ Bluetooth — ใช้ Chrome/Edge'
                : '❌ This browser has no Web Bluetooth — use Chrome/Edge', 4000);
            return;
        }

        connecting = true;
        userDisconnected = false;

        btModalLog.innerHTML = '';
        btScanStatus.classList.add('scanning');
        btScanStatus.classList.remove('scanning-done');
        btScanText.textContent = reuseDevice
            ? (currentLang === 'TH' ? 'กำลังเชื่อมต่อใหม่...' : 'Reconnecting...')
            : autoMode
                ? (currentLang === 'TH' ? 'กำลังค้นหาอุปกรณ์...' : 'Auto scanning...')
                : (currentLang === 'TH' ? 'กำลังเปิด Picker...' : 'Opening device picker...');

        // Detect if we're in K-Line ESP32 mode
        const isPVX = currentVehicleProfile === 'pvx150';
        if (reuseDevice) {
            modalLog(`🔄 Reconnecting to ${reuseDevice.name || 'Unknown'}...`, 'info');
        } else if (isPVX) {
            modalLog('📡 Scanning for ESP32 K-Line Bridge (SG-KLINE-PVX150)...', 'info');
        } else {
            modalLog('📡 Starting Bluetooth scan...', 'info');
        }
        if (ble.isNative) modalLog('📱 Native BLE (iOS app)', 'info');


        try {
            if (reuseDevice) {
                ble.useDevice(reuseDevice);
            } else {
                let requestOptions;

                if (isPVX && autoMode) {
                    // Auto-connect specifically for ESP32 K-Line bridge
                    requestOptions = {
                        filters: [
                            { namePrefix: 'SG-KLINE' },
                            { namePrefix: 'SG_KLINE' },
                            { namePrefix: 'ESP32' },
                            { services: ['0000ffe0-0000-1000-8000-00805f9b34fb'] },
                        ],
                        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb', 'generic_access']
                    };
                } else if (autoMode) {
                    requestOptions = {
                        filters: [
                            { name: 'OBDII' }, { name: 'ELM327' }, { name: 'OBD2' },
                            { namePrefix: 'ELM' }, { namePrefix: 'OBD' }, { namePrefix: 'OBDII' },
                            { namePrefix: 'SG-KLINE' }, { namePrefix: 'SG_KLINE' },
                            { services: [0xFFE0] },
                        ],
                        optionalServices: ['generic_access']
                    };
                } else {
                    requestOptions = { acceptAllDevices: true, optionalServices: [0xFFE0, 0xFFF0, '0000ffe0-0000-1000-8000-00805f9b34fb', 'generic_access'] };
                }

                btDevice = await ble.requestDevice(requestOptions);
            }
            const name = btDevice.name || 'Unknown';
            modalLog(`✅ Found: ${name}`, 'success');

            // Detect ESP32 K-Line bridge by name
            const isESP32Bridge = /SG.?KLINE|ESP32.*KLINE|KLINE.*BLE/i.test(name) || isPVX;
            if (isESP32Bridge) {
                isKlineMode = true;
                klineJsonBuffer = '';
                modalLog('🔌 ESP32 K-Line Bridge detected!', 'success');
                document.getElementById('set-elm-ver').textContent = 'ESP32 K-Line Bridge';
            } else {
                isKlineMode = false;
            }

            btScanText.textContent = 'Connecting GATT...';
            await ble.connect(onGattDisconnect);
            modalLog('✅ GATT Connected', 'success');

            // Try known service / characteristic UUIDs (ไม่เจอใช้ตัวแรก)
            const serviceUUIDs = isKlineMode
                ? ['0000ffe0-0000-1000-8000-00805f9b34fb', 0xFFE0, 0xFFF0]
                : [0xFFE0, 0xFFF0, '0000ffe0-0000-1000-8000-00805f9b34fb'];
            const charUUIDs = isKlineMode
                ? ['0000ffe1-0000-1000-8000-00805f9b34fb', 0xFFE1, 0xFFF1]
                : [0xFFE1, 0xFFF1, '0000ffe1-0000-1000-8000-00805f9b34fb'];

            const chan = await ble.openChannel(serviceUUIDs, charUUIDs);
            modalLog(`✅ Service: ${chan.service}`, 'success');
            modalLog(`✅ Characteristic: ${chan.characteristic}`, 'success');

            // เริ่มรอบใหม่: ล้าง buffer เดิมก่อนรับข้อมูล
            btDecoder = new TextDecoder('utf-8');
            receiveBuffer = '';
            klineJsonBuffer = '';
            await ble.startNotifications(value => handleData({ target: { value } }));
            btChar = chan;
            reconnectTries = 0;

            // แจ้งผู้ใช้เมื่อปิด/เปิด Bluetooth ของเครื่อง (เฉพาะแอป iOS)
            ble.watchEnabled(enabled => {
                showStatus(enabled
                    ? (currentLang === 'TH' ? 'Bluetooth เปิดแล้ว' : 'Bluetooth ON')
                    : (currentLang === 'TH' ? '⚠ Bluetooth ถูกปิด' : '⚠ Bluetooth is OFF'), 3000);
                if (enabled && !userDisconnected && btDevice && !ble.isConnected()) {
                    reconnectTries = 0;
                    scheduleReconnect();
                }
            });

            setConnectedUI(true, name);
            showStatus(`✅ Connected: ${name}`);

            if (isKlineMode) {
                // K-Line mode: ESP32 handles everything, just listen
                modalLog('✅ K-Line Bridge active — waiting for ECU data...', 'success');
                modalLog('📊 Data will appear automatically when ESP32 reads ECU', 'info');

                // Set up vehicle info for PVX150
                document.getElementById('set-car-brand').textContent = 'Honda';
                document.getElementById('set-car-model').textContent = 'PVX 150';
                document.getElementById('set-car-year').textContent = '(30400-K36-T01)';
                document.getElementById('set-protocol').textContent = 'K-Line Direct (ESP32)';
                const badge = document.getElementById('set-comm-badge');
                if (badge) { badge.textContent = 'K-LINE'; badge.className = 'settings-value comm-badge badge-kline'; }
                document.getElementById('dtc-protocol').textContent = 'K-LINE';

                // Set processing as active
                pollActive = true;

                if (window.SGLog) {
                    SGLog.setProtocol('ESP32 K-Line Direct');
                    SGLog.info('K-Line Bridge connected — passive data receive mode');
                }

                setTimeout(() => { btModal.style.display = 'none'; }, 1500);
            } else {
                // ELM327 mode: run standard init
                await initELM327();
                setTimeout(() => { btModal.style.display = 'none'; }, 1500);
            }

        } catch (err) {
            btChar = null;
            try { await ble.disconnect(); } catch (_) { }
            btScanStatus.classList.remove('scanning');
            btScanText.textContent = i18n[currentLang].bt_ready;
            // บางเบราว์เซอร์ (เช่น Bluefy) reject โดยไม่มี err.message → เคยขึ้น "❌ undefined"
            const errMsg = (err && (err.message || err.name)) || String(err || '') || 'Unknown error';
            const cancelled = !reuseDevice && ((err && err.name === 'NotFoundError' && !ble.isNative) || /cancel/i.test(errMsg) || !err);
            modalLog(`✗ ${errMsg}`, 'error');
            showStatus(cancelled
                ? (currentLang === 'TH' ? 'ยกเลิกการเลือกอุปกรณ์' : 'Device selection cancelled')
                : '❌ ' + errMsg);

            // iOS: ผู้ใช้เคยปฏิเสธสิทธิ์ Bluetooth → พาไปหน้าตั้งค่าของแอป
            if (err && err.code === 'PERMISSION_DENIED') {
                const go = confirm(currentLang === 'TH'
                    ? 'แอปยังไม่ได้รับสิทธิ์ใช้ Bluetooth\nเปิดหน้าตั้งค่าเพื่ออนุญาตหรือไม่?'
                    : 'Bluetooth permission is off.\nOpen Settings to allow it?');
                if (go) ble.openAppSettings();
            }

            // ต่อใหม่อัตโนมัติไม่สำเร็จ → ลองรอบถัดไป
            if (reuseDevice && !userDisconnected) {
                connecting = false;
                scheduleReconnect();
            }
        } finally {
            connecting = false;
        }
    }

    btnModalConnect.addEventListener('click', () => connectBluetooth(false));
    btnModalAuto.addEventListener('click', () => connectBluetooth(true));

    btnBt.addEventListener('click', () => { btModal.style.display = 'flex'; });
    btnModalClose.addEventListener('click', () => { btModal.style.display = 'none'; });
    btModal.addEventListener('click', e => { if (e.target === btModal) btModal.style.display = 'none'; });


    // =========================================
    // DTC SCANNER
    // =========================================
    const dtcDesc = {
        'P0100': 'MAF Sensor Circuit', 'P0101': 'MAF Sensor Performance',
        'P0105': 'MAP Sensor Circuit', 'P0110': 'IAT Circuit',
        'P0115': 'ECT Circuit', 'P0120': 'TPS Circuit',
        'P0121': 'TPS Performance', 'P0130': 'O2 Sensor Circuit',
        'P0131': 'O2 Sensor Low Voltage', 'P0171': 'System Lean Bank 1',
        'P0172': 'System Rich Bank 1', 'P0300': 'Random/Multiple Misfire',
        'P0301': 'Cylinder 1 Misfire', 'P0302': 'Cylinder 2 Misfire',
        'P0303': 'Cylinder 3 Misfire', 'P0304': 'Cylinder 4 Misfire',
        'P0400': 'EGR Flow Malfunction', 'P0420': 'Catalyst Efficiency Low',
        'P0440': 'EVAP System Malfunction', 'P0500': 'VSS Circuit',
        'P0505': 'Idle Control System', 'P0600': 'Serial Comm Malfunction',
        'P0700': 'Transmission Control', 'U0100': 'Lost Comm with ECM',
        'U0073': 'CAN Bus Off',
    };

    function parseDTCBytes(data) {
        const types = ['P', 'C', 'B', 'U'];
        const codes = [];
        if (!data.startsWith('43')) return codes;
        const hex = data.substring(2);
        for (let i = 0; i < hex.length - 3; i += 4) {
            const b1 = parseInt(hex.substring(i, i + 2), 16);
            const b2 = parseInt(hex.substring(i + 2, i + 4), 16);
            if (b1 === 0 && b2 === 0) continue;
            const type = types[(b1 >> 6) & 0x03];
            const digit = (b1 >> 4) & 0x03;
            const code = type + digit + b2.toString(16).toUpperCase().padStart(2, '0');
            codes.push(code);
        }
        return codes;
    }

    function renderDTCs(codes) {
        const dtcList = document.getElementById('dtc-list');
        const dtcCount = document.getElementById('dtc-count');
        if (!codes || codes.length === 0) {
            dtcList.innerHTML = `<div class="dtc-empty">✅ ${currentLang === 'TH' ? 'ไม่พบรหัสข้อผิดพลาด' : 'No fault codes found'}</div>`;
            dtcCount.textContent = '0';
            return;
        }
        dtcList.innerHTML = '';
        dtcCount.textContent = codes.length;
        codes.forEach(code => {
            const desc = dtcDesc[code] || 'Unknown fault code';
            const typeChar = code.charAt(0);
            const typeName = typeChar === 'P' ? 'Powertrain' : typeChar === 'C' ? 'Chassis' : typeChar === 'B' ? 'Body' : 'Network';
            const cls = code.startsWith('P0') ? '' : code.startsWith('P1') ? 'dtc-manufacturer' : 'dtc-other';
            const item = document.createElement('div');
            item.className = `dtc-item ${cls}`;
            item.innerHTML = `<div class="dtc-item-code">${code}</div><div class="dtc-item-desc">${desc}</div><div class="dtc-item-type">${typeName}</div>`;
            dtcList.appendChild(item);
        });
        showStatus(`⚠ Found ${codes.length} DTC code(s)`);
    }

    function startDTCScan() {
        if (!btChar) {
            showStatus(currentLang === 'TH' ? '⚠ ยังไม่ได้เชื่อมต่อ' : '⚠ Not connected to ELM327');
            document.getElementById('dtc-list').innerHTML = `<div class="dtc-error">⚠ ${currentLang === 'TH' ? 'กรุณาเชื่อมต่อ ELM327 ก่อน' : 'Connect ELM327 first'}</div>`;
            return;
        }
        pollActive = false;
        document.getElementById('dtc-list').innerHTML = '<div class="dtc-scanning"><div class="dtc-spin"></div> Scanning...</div>';
        showStatus('Scanning...');
        sendCommand('0101');
        setTimeout(() => {
            sendCommand('03');
            setTimeout(() => {
                pollActive = true;
                sendCommandFast(priorityPollQueue[priorityIdx]);
            }, 3000);
        }, 600);
    }

    async function clearDTCs() {
        if (!btChar) { showStatus('⚠ Not connected'); return; }
        const confirmMsg = currentLang === 'TH' ? 'ลบ Fault Codes ทั้งหมดหรือไม่?' : 'Clear all Fault Codes?';
        if (!confirm(confirmMsg)) return;
        pollActive = false;
        showStatus('Clearing DTCs...');
        await sendCommand('04');
        setTimeout(() => {
            document.getElementById('dtc-list').innerHTML = `<div class="dtc-empty">✅ ${currentLang === 'TH' ? 'ลบเรียบร้อยแล้ว' : 'Cleared successfully'}</div>`;
            document.getElementById('dtc-count').textContent = '0';
            document.getElementById('dtc-mil-status').textContent = 'OFF';
            document.getElementById('dtc-mil-status').style.color = '#00ff88';
            showStatus('✅ DTCs cleared');
            pollActive = true;
            sendCommandFast(priorityPollQueue[priorityIdx]);
        }, 2000);
    }

    document.getElementById('btn-scan-dtc').addEventListener('click', startDTCScan);
    document.getElementById('btn-clear-dtc').addEventListener('click', clearDTCs);
    document.getElementById('btn-freeze').addEventListener('click', () => {
        if (!btChar) { showStatus('⚠ Not connected'); return; }
        pollActive = false;
        sendCommand('0200');
        setTimeout(() => { pollActive = true; sendCommandFast(priorityPollQueue[priorityIdx]); }, 3000);
    });


    // =========================================
    // setupVehicleProtocol(mode)
    // =========================================
    async function setupVehicleProtocol(mode) {
        if (!btChar) {
            showStatus('⚠ Not connected — please connect first');
            return false;
        }

        const modeUpper = (mode || '').toUpperCase();
        modalLog(`🔄 Switching protocol to ${modeUpper}...`, 'info');
        pollActive = false;
        isInitializing = true;

        const commonCmds = [
            { cmd: 'ATZ', wait: 1200 }, { cmd: 'ATE0', wait: 200 },
            { cmd: 'ATL0', wait: 200 }, { cmd: 'ATS0', wait: 200 },
            { cmd: 'ATAT2', wait: 200 }, { cmd: 'ATRV', wait: 300 },
        ];

        for (const c of commonCmds) {
            await sendCommand(c.cmd);
            await delay(c.wait);
        }

        let protocolCmds = [];

        if (modeUpper === 'PVX150') {
            // PVX150 uses ESP32 K-Line bridge — no ELM327 AT commands needed
            currentVehicleProfile = 'pvx150';
            isKlineMode = true;
            if (window.SGLog) SGLog.setVehicle(currentVehicleProfile);
            // Skip protocol commands — ESP32 handles K-Line directly
            protocolCmds = [];
        } else if (modeUpper === 'PCX160' || modeUpper === 'PCX150') {
            isKlineMode = false;
            protocolCmds = [
                { cmd: 'ATH0', wait: 200 },
                { cmd: 'ATSP5', wait: 300 },
                { cmd: 'ATSH8112F1', wait: 250 },
                { cmd: 'ATST19', wait: 250 },
            ];
            currentVehicleProfile = modeUpper === 'PCX160' ? 'pcx160' : 'pcx150';
            if (window.SGLog) SGLog.setVehicle(currentVehicleProfile);
        } else {
            modalLog('❌ Unknown mode.', 'error');
            isInitializing = false;
            return false;
        }

        for (const c of protocolCmds) {
            await sendCommand(c.cmd);
            await delay(c.wait);
        }

        localStorage.setItem('sg_vehicle_profile', currentVehicleProfile);
        const profileKey = currentVehicleProfile;
        const profiles = {
            pcx160: {
                brand: 'Honda', model: 'PCX 160 (K1Z)', year: '2025-2026',
                ecu: '30400-K1Z-TC2', bus: 'K-LINE', badgeClass: 'badge-kline',
                protocolDesc: 'ISO 14230-4 KWP2000 Fast',
                targetEcuLabel: '30400-K1Z-TC2 (K-LINE 10.4k)',
            },
            pcx150: {
                brand: 'Honda', model: 'PCX 150 (K36)', year: '2014-2016',
                ecu: '30400-K36-T01', bus: 'K-LINE', badgeClass: 'badge-kline',
                protocolDesc: 'ISO 14230-4 KWP / ISO 9141-2',
                targetEcuLabel: '30400-K36-T01 (K-LINE 10.4k)',
            },
            pvx150: {
                brand: 'Honda', model: 'PVX 150', year: '---',
                ecu: '30400-K36-T01', bus: 'K-LINE', badgeClass: 'badge-kline',
                protocolDesc: 'ESP32 K-Line Direct (10400 baud)',
                targetEcuLabel: '30400-K36-T01 (ESP32 K-Line BLE)',
            }
        };
        const p = profiles[profileKey];
        if (p) {
            const s = id => document.getElementById(id);
            if (s('set-car-brand')) s('set-car-brand').textContent = p.brand;
            if (s('set-car-model')) s('set-car-model').textContent = p.model;
            if (s('set-car-year')) s('set-car-year').textContent = p.year;
            if (s('dtc-protocol')) s('dtc-protocol').textContent = p.bus;
            if (s('set-protocol')) s('set-protocol').textContent = p.protocolDesc;
            if (s('bt-target-ecu')) s('bt-target-ecu').textContent = p.targetEcuLabel;
            const badge = s('set-comm-badge');
            if (badge) { badge.textContent = p.bus; badge.className = `settings-value comm-badge ${p.badgeClass}`; }
        }

        document.querySelectorAll('.mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === modeUpper));
        document.querySelectorAll('.modal-mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === modeUpper));

        modalLog(`✅ Protocol switched to ${modeUpper}.`, 'success');

        isInitializing = false;
        if (pollActive === false && btChar) {
            pollActive = true;
            priorityIdx = 0;
            fastIdx = 0;
            slowIdx = 0;
            fastCounter = 0;
            slowCounter = 0;
            sendCommandFast(priorityPollQueue[priorityIdx]);
        }
        return true;
    }

    // =========================================
    // HUD VISUALIZER
    // =========================================
    const stripEl = document.getElementById('rpm-strip-leds');
    const STRIP_TOTAL = 20;
    const STRIP_COLS = [
        ...Array(6).fill('#00ff55'), ...Array(6).fill('#aaff00'),
        ...Array(4).fill('#ffee00'), ...Array(4).fill('#ff2222'),
    ];

    function buildStripLEDs() {
        if (!stripEl) return;
        stripEl.innerHTML = '';
        for (let i = 0; i < STRIP_TOTAL; i++) {
            const led = document.createElement('div');
            led.className = 'strip-led';
            led.id = `led-${i}`;
            led.style.color = STRIP_COLS[i];
            stripEl.appendChild(led);
        }
    }
    buildStripLEDs();

    function updateStripLEDs(rpm) {
        if (!stripEl) return;
        const pct = Math.min(rpm / 8000, 1.0);
        const lit = Math.round(pct * STRIP_TOTAL);
        for (let i = 0; i < STRIP_TOTAL; i++) {
            const led = document.getElementById(`led-${i}`);
            if (!led) continue;
            if (i < lit) {
                led.classList.add('on');
                led.style.background = STRIP_COLS[i];
            } else {
                led.classList.remove('on');
                led.style.background = '';
            }
        }
    }

    const hudCanvas = document.getElementById('hudGraphCanvas');
    const hudCtx = hudCanvas ? hudCanvas.getContext('2d') : null;
    const GRAPH_SAMPLES = 80;
    const graphData = { rpm: Array(GRAPH_SAMPLES).fill(0), spd: Array(GRAPH_SAMPLES).fill(0) };
    let hudRafId = null;

    function resizeHudCanvas() {
        if (!hudCanvas) return;
        const parent = hudCanvas.parentElement;
        if (!parent) return;
        const dpr = window.devicePixelRatio || 1;
        hudCanvas.width = Math.round(parent.clientWidth * dpr);
        hudCanvas.height = Math.round(parent.clientHeight * dpr);
        hudCanvas.style.width = parent.clientWidth + 'px';
        hudCanvas.style.height = parent.clientHeight + 'px';
    }

    function drawHudGraph() {
        if (!hudCtx || !hudCanvas) return;
        const t = activeTheme || themes.default;
        const W = hudCanvas.width, H = hudCanvas.height;
        const dpr = window.devicePixelRatio || 1;
        const w = W / dpr, h = H / dpr;

        hudCtx.save();
        hudCtx.scale(dpr, dpr);
        hudCtx.clearRect(0, 0, w, h);

        hudCtx.strokeStyle = 'rgba(255,255,255,0.06)';
        hudCtx.lineWidth = 0.5;
        for (let i = 1; i < 4; i++) {
            const y = (h / 4) * i;
            hudCtx.beginPath(); hudCtx.moveTo(0, y); hudCtx.lineTo(w, y); hudCtx.stroke();
        }

        const step = w / (GRAPH_SAMPLES - 1);

        hudCtx.beginPath();
        graphData.spd.forEach((v, i) => {
            const x = i * step;
            const y = h - (v / 240) * (h * 0.85) - h * 0.05;
            i === 0 ? hudCtx.moveTo(x, y) : hudCtx.lineTo(x, y);
        });
        hudCtx.strokeStyle = t.contrast || '#ffaa00';
        hudCtx.lineWidth = 1.5;
        hudCtx.shadowBlur = 4;
        hudCtx.shadowColor = t.contrast || '#ffaa00';
        hudCtx.stroke();
        hudCtx.shadowBlur = 0;

        hudCtx.beginPath();
        graphData.rpm.forEach((v, i) => {
            const x = i * step;
            const y = h - (v / 8000) * (h * 0.85) - h * 0.05;
            i === 0 ? hudCtx.moveTo(x, y) : hudCtx.lineTo(x, y);
        });
        hudCtx.strokeStyle = t.primary;
        hudCtx.lineWidth = 2;
        hudCtx.shadowBlur = 6;
        hudCtx.shadowColor = t.primary;
        hudCtx.stroke();
        hudCtx.shadowBlur = 0;

        hudCtx.font = `bold ${Math.round(h * 0.28)}px Orbitron, sans-serif`;
        hudCtx.fillStyle = t.primary;
        hudCtx.fillText('RPM', 4, h * 0.28);
        hudCtx.fillStyle = t.contrast || '#ffaa00';
        hudCtx.fillText('SPD', w * 0.5, h * 0.28);

        hudCtx.restore();
    }

    function pushGraphData(rpm, spd) {
        graphData.rpm.push(fmtNum(rpm, 0)); if (graphData.rpm.length > GRAPH_SAMPLES) graphData.rpm.shift();
        graphData.spd.push(fmtNum(spd, 0)); if (graphData.spd.length > GRAPH_SAMPLES) graphData.spd.shift();

        const activeView = document.querySelector('.hud-view.active');
        if (activeView && activeView.id === 'hud-view-graph') {
            if (!hudRafId) hudRafId = requestAnimationFrame(() => { drawHudGraph(); hudRafId = null; });
        }
    }

    document.querySelectorAll('.hud-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hud-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.hud-view').forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            const view = document.getElementById(`hud-view-${tab.dataset.view}`);
            if (view) {
                view.classList.add('active');
                if (tab.dataset.view === 'graph') { resizeHudCanvas(); drawHudGraph(); }
            }
        });
    });

    if (window.ResizeObserver && hudCanvas) {
        const hudObs = new ResizeObserver(() => { resizeHudCanvas(); drawHudGraph(); });
        if (hudCanvas.parentElement) hudObs.observe(hudCanvas.parentElement);
    }
    setTimeout(() => { resizeHudCanvas(); drawHudGraph(); }, 120);

    function updateCluster(rpm, spd, tps, load, map) {
        const ratio = spd > 0 && rpm > 0 ? (rpm / spd).toFixed(1) : '--';
        const hp = ((rpm * 0.00006) * (load / 100) * 11).toFixed(1);
        const cEl = id => document.getElementById(id);
        if (cEl('c-ratio')) cEl('c-ratio').textContent = ratio;
        if (cEl('c-tps')) cEl('c-tps').textContent = tps.toFixed(1) + '%';
        if (cEl('c-load')) cEl('c-load').textContent = load + '%';
        if (cEl('c-map')) cEl('c-map').textContent = map + ' kPa';
        if (cEl('c-hp')) cEl('c-hp').textContent = hp + ' HP';
    }

    function updateThrottleBar(tpsPct) {
        const valEl = document.getElementById('val-tps-center');
        const barEl = document.getElementById('bar-tps-center');
        if (valEl) valEl.textContent = tpsPct.toFixed(1);
        if (barEl) {
            barEl.style.width = Math.min(tpsPct, 100) + '%';
            const pw = barEl.parentElement ? barEl.parentElement.clientWidth : 0;
            if (pw > 0) barEl.style.backgroundSize = `${pw}px 100%`;
        }
    }

    let isRedlineFlashing = false;
    const tacho = document.querySelector('.slide-tachometer');

    function setRedlineFlash(active) {
        if (!tacho) return;
        if (active && !isRedlineFlashing) {
            tacho.classList.add('redline-flash-active');
            isRedlineFlashing = true;
        } else if (!active && isRedlineFlashing) {
            tacho.classList.remove('redline-flash-active');
            isRedlineFlashing = false;
        }
    }

    function enhancedTick() {
        updateCluster(currentRPM, currentSpeed, currentTPS, currentLoad || 0, currentMAP || 0);
        updateThrottleBar(currentTPS);
        updateStripLEDs(currentRPM);
        if (!enhancedTick._fc) enhancedTick._fc = 0;
        if (++enhancedTick._fc % 3 === 0) pushGraphData(currentRPM, currentSpeed);
        setRedlineFlash(currentRPM > 6600);
    }

    window._sgHudEnabled = true;
    (function patchTick() {
        function hudPoll() {
            if (window._sgHudEnabled) enhancedTick();
            requestAnimationFrame(hudPoll);
        }
        requestAnimationFrame(hudPoll);
    })();

    // =========================================
    // VEHICLE MODE SWITCHER WIRING
    // =========================================
    function activateModeButtons(mode) {
        document.querySelectorAll('.mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === mode));
        document.querySelectorAll('.modal-mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === mode));
    }

    document.getElementById('vehicle-mode-switch').addEventListener('click', async e => {
        const btn = e.target.closest('.mode-btn');
        if (!btn) return;
        const mode = btn.dataset.mode;
        activateModeButtons(mode);
        if (btChar) {
            showStatus(`🔄 Switching to ${mode}...`);
            await setupVehicleProtocol(mode);
            showStatus(`✅ ${mode} protocol active`);
        } else {
            currentVehicleProfile = mode === 'PCX160' ? 'pcx160' : mode === 'PVX150' ? 'pvx150' : 'pcx150';
            isKlineMode = mode === 'PVX150';
            localStorage.setItem('sg_vehicle_profile', currentVehicleProfile);
            if (window.SGLog) SGLog.setVehicle(currentVehicleProfile);
        }
    });

    document.getElementById('bt-modal').addEventListener('click', async e => {
        const btn = e.target.closest('.modal-mode-btn');
        if (!btn) return;
        const mode = btn.dataset.mode;
        activateModeButtons(mode);
        currentVehicleProfile = mode === 'PCX160' ? 'pcx160' : mode === 'PVX150' ? 'pvx150' : 'pcx150';
        isKlineMode = mode === 'PVX150';
        localStorage.setItem('sg_vehicle_profile', currentVehicleProfile);
        if (window.SGLog) SGLog.setVehicle(currentVehicleProfile);
        const targetEl = document.getElementById('bt-target-ecu');
        if (targetEl) {
            if (mode === 'PVX150') targetEl.textContent = '30400-K36-T01 (ESP32 K-Line BLE)';
            else if (mode === 'PCX160') targetEl.textContent = '30400-K1Z-TC2 (K-LINE 10.4k)';
            else targetEl.textContent = '30400-K36-T01 (K-LINE 10.4k)';
        }
    });

    const _initMode = currentVehicleProfile === 'pcx160' ? 'PCX160' : currentVehicleProfile === 'pvx150' ? 'PVX150' : 'PCX150';
    isKlineMode = currentVehicleProfile === 'pvx150';
    activateModeButtons(_initMode);
    if (window.SGLog) SGLog.setVehicle(currentVehicleProfile);

    // =========================================
    // SIMULATOR RECEIVER
    // =========================================
    function applySimulatedData(data) {
        if (!data) return;
        if (data.rpm !== undefined) {
            currentRPM = fmtNum(data.rpm, 0);
            setGaugeValues(currentSpeed, currentRPM);
            setEl('ld-rpm', currentRPM, 'rpm'); setBar('lb-rpm', currentRPM, 8000);
        }
        if (data.speed !== undefined) {
            currentSpeed = fmtNum(data.speed, 0);
            setGaugeValues(currentSpeed, currentRPM);
            setEl('val-speed1', currentSpeed); setBar('bar-speed', currentSpeed, 240);
            setEl('ld-speed', currentSpeed, 'km/h'); setBar('lb-speed', currentSpeed, 240);
        }
        if (data.tps !== undefined) {
            currentTPS = fmtNum(data.tps, 0);
            setEl('val-tps1', currentTPS); setBar('bar-tps', currentTPS, 100);
            setEl('ld-tps', currentTPS, '%'); setBar('lb-tps', currentTPS, 100);
        }
        if (data.batt !== undefined) {
            setEl('val-batt1', data.batt);
            setEl('ld-batt', data.batt, 'V'); setBar('lb-batt', parseFloat(data.batt), 16);
        }
        if (data.eot !== undefined) {
            setEl('val-eot1', data.eot); setBar('bar-eot', data.eot, 150);
            setEl('ld-eot', data.eot, '°C'); setBar('lb-eot', data.eot, 150);
        }
        if (data.iat !== undefined) {
            setEl('ld-iat', data.iat, '°C'); setBar('lb-iat', data.iat, 100);
        }
        if (data.map !== undefined) {
            currentMAP = fmtNum(data.map, 0);
            setEl('ld-map', currentMAP, 'kPa'); setBar('lb-map', currentMAP, 255);
        }
        if (data.load !== undefined) {
            currentLoad = fmtNum(data.load, 0);
            setEl('ld-load', currentLoad, '%'); setBar('lb-load', currentLoad, 100);
        }
        if (data.inj !== undefined) {
            setEl('val-inj', data.inj);
            setEl('ld-inj', data.inj, 'ms'); setBar('lb-inj', (parseFloat(data.inj) / 15) * 100, 100);
        }
        if (data.duty !== undefined) {
            setEl('val-duty1', data.duty);
            setEl('ld-duty', data.duty, '%'); setBar('lb-duty', data.duty, 100);
        }
        if (data.igt !== undefined) {
            setEl('val-igt1', data.igt);
            setEl('ld-igt', data.igt, '°'); setBar('lb-igt', (parseFloat(data.igt) + 10) * 2, 100);
        }
        if (data.afr !== undefined) {
            setEl('val-afr1', data.afr);
            setEl('ld-afr', data.afr, 'λ'); setBar('lb-afr', (parseFloat(data.afr) / 2) * 100, 100);
        }
        if (data.o2 !== undefined) {
            setEl('ld-o2', data.o2, 'V'); setBar('lb-o2', parseFloat(data.o2) * 100, 100);
        }
        if (data.stft !== undefined) {
            setEl('ld-stft', data.stft, '%'); setBar('lb-stft', Math.abs(parseFloat(data.stft)) * 4, 100);
        }
        if (data.ltft !== undefined) {
            setEl('ld-ltft', data.ltft, '%'); setBar('lb-ltft', Math.abs(parseFloat(data.ltft)) * 4, 100);
        }
        if (data.dtcCodes !== undefined) renderDTCs(data.dtcCodes);
        if (data.mil !== undefined) {
            const milEl = document.getElementById('dtc-mil-status');
            if (milEl) {
                milEl.textContent = data.mil ? 'ON ⚠' : 'OFF';
                milEl.style.color = data.mil ? '#ff3333' : '#00ff88';
            }
        }
    }

    try {
        const simChannel = new BroadcastChannel('sg_obd_simulator');
        simChannel.onmessage = (e) => {
            if (e.data && e.data.type === 'SYNC_DATA') applySimulatedData(e.data.payload);
            else if (e.data && e.data.type === 'PING') simChannel.postMessage({ type: 'PONG', active: true });
        };
        simChannel.postMessage({ type: 'DASHBOARD_READY', active: true });
    } catch (e) { }

    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'SYNC_DATA') applySimulatedData(e.data.payload);
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'sg_sim_data' && e.newValue) {
            try { applySimulatedData(JSON.parse(e.newValue)); } catch (err) { }
        }
    });

    window.sgApplySimData = applySimulatedData;

    // =========================================
    // LOG FILE CONTROLS
    // =========================================
    const btnLogStart = document.getElementById('btn-log-start');
    const btnLogStop = document.getElementById('btn-log-stop');
    const btnLogDownload = document.getElementById('btn-log-download');

    if (btnLogStart) {
        btnLogStart.addEventListener('click', async () => {
            if (!window.SGLog) { showStatus('⚠ SGLog not loaded'); return; }
            const ok = await SGLog.start();
            if (ok || !SGLog.isFileApiSupported()) {
                btnLogStart.style.display = 'none';
                if (btnLogStop) btnLogStop.style.display = '';
                showStatus('▶ Logging to .txt file');
            } else {
                showStatus('⚠ File picker cancelled');
            }
        });
    }

    if (btnLogStop) {
        btnLogStop.addEventListener('click', async () => {
            if (!window.SGLog) return;
            await SGLog.stop();
            btnLogStop.style.display = 'none';
            if (btnLogStart) btnLogStart.style.display = '';
            showStatus('■ Log saved');
        });
    }

    if (btnLogDownload) {
        btnLogDownload.addEventListener('click', () => {
            if (!window.SGLog) return;
            SGLog.download();
            showStatus('📥 Downloaded .txt');
        });
    }

    let btHoldTimer = null;
    const startHold = () => {
        btHoldTimer = setTimeout(() => {
            if (window.SGLog) {
                SGLog.printSummary();
                SGLog.download();
                showStatus('📥 Log downloaded!');
            }
        }, 3000);
    };
    const cancelHold = () => clearTimeout(btHoldTimer);
    btnBt.addEventListener('mousedown', startHold);
    btnBt.addEventListener('mouseup', cancelHold);
    btnBt.addEventListener('mouseleave', cancelHold);
    btnBt.addEventListener('touchstart', startHold);
    btnBt.addEventListener('touchend', cancelHold);

    // =========================================
    // BOOT
    // =========================================
    updateLanguage();
    debugLog(`💡 Click [BT] to connect`, '#7aaeff');
    debugLog(`⚡⚡⚡ TURBO MODE — RPM refresh ~200ms | SPEED/TPS every 4 | Others every 16`, '#00ff88');
    if (window.SGLog) SGLog.info(`App ready — TURBO polling (RPM priority)`);

    // =========================================
    // PWA INSTALLATION PROMPT — MULTI-PLATFORM
    // =========================================

    // =========================================
    // iOS → BLUEFY GATE
    // Safari/Chrome บน iOS ใช้ WebKit ที่ไม่มี Web Bluetooth
    // (รวมถึงไอคอนบนหน้าจอโฮม) จึงพาผู้ใช้ไปเปิดในแอป Bluefy
    // =========================================

    (function initBluefyGate() {
        if (window.SGBle.isNative) return;   // แอป iOS ใช้ Native BLE ไม่ต้องพึ่ง Bluefy
        const BLUEFY_APP_STORE = 'https://apps.apple.com/app/id1492822055';
        // URL scheme ของ Bluefy — ถ้าเปิดไม่ขึ้น ผู้ใช้ยังวางลิงก์ที่คัดลอกไว้ได้
        const BLUEFY_SCHEME = 'bluefy://open?url=';

        const ua = navigator.userAgent;
        const isIos = /iphone|ipad|ipod/i.test(ua)
            || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1); // iPadOS แสดงตัวเป็น Mac
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: fullscreen)').matches
            || window.navigator.standalone === true;

        const gate = document.getElementById('ios-bluefy-gate');
        const btnOpen = document.getElementById('btn-open-bluefy');
        const btnCopy = document.getElementById('btn-copy-link');
        const btnSkip = document.getElementById('btn-bluefy-skip');
        const fallback = document.getElementById('bluefy-fallback');
        const a2hs = document.getElementById('bluefy-a2hs');
        if (!gate) return;

        const pageUrl = location.href.split('#')[0];

        async function copyLink() {
            try {
                await navigator.clipboard.writeText(pageUrl);
                return true;
            } catch (e) {
                // สำรองสำหรับ iOS รุ่นเก่า
                const ta = document.createElement('textarea');
                ta.value = pageUrl;
                ta.setAttribute('readonly', '');
                ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, pageUrl.length);
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (_) { }
                ta.remove();
                return ok;
            }
        }

        function show() {
            if (!isIos || navigator.bluetooth) return false;
            // ปุ่ม "เพิ่มลงหน้าจอโฮม" แสดงเฉพาะตอนเปิดใน Safari (ยังไม่ได้ติดตั้ง)
            a2hs.style.display = isStandalone ? 'none' : 'block';
            gate.style.display = 'flex';
            return true;
        }
        window.showBluefyGate = show;

        btnOpen.addEventListener('click', async () => {
            await copyLink();
            let left = false;
            const onHide = () => { if (document.hidden) left = true; };
            document.addEventListener('visibilitychange', onHide);
            location.href = BLUEFY_SCHEME + encodeURIComponent(pageUrl);
            // ถ้า 1.5 วิแล้วยังอยู่หน้านี้ = Bluefy ไม่เปิด → บอกวิธีสำรอง
            setTimeout(() => {
                document.removeEventListener('visibilitychange', onHide);
                if (!left) fallback.style.display = 'block';
            }, 1500);
        });

        btnCopy.addEventListener('click', async () => {
            const ok = await copyLink();
            btnCopy.textContent = ok ? '✓ คัดลอกแล้ว' : pageUrl;
            setTimeout(() => { btnCopy.textContent = '📋 คัดลอกลิงก์'; }, 2500);
        });

        btnSkip.addEventListener('click', () => {
            gate.style.display = 'none';
            sessionStorage.setItem('bluefy_gate_skipped', '1');
        });

        if (isIos && !navigator.bluetooth) {
            debugLog('🍎 iOS without Web Bluetooth → Bluefy gate', '#ff375f');
            if (!sessionStorage.getItem('bluefy_gate_skipped')) show();
        }
    })();

    // =========================================
    // FULLSCREEN + กันจอดับ
    // ในเบราว์เซอร์ (เช่น Bluefy) แถบที่อยู่จะกินพื้นที่จอ
    // ปุ่ม ⛶ ขอเต็มจอผ่าน Fullscreen API ถ้าเบราว์เซอร์รองรับ
    // =========================================

    (function initFullscreen() {
        const btnFs = document.getElementById('btn-fullscreen');
        if (!btnFs) return;
        if (window.SGBle.isNative) { btnFs.style.display = 'none'; return; }   // แอปเต็มจออยู่แล้ว
        const root = document.documentElement;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: fullscreen)').matches
            || window.navigator.standalone === true;
        const canFs = !!(root.requestFullscreen || root.webkitRequestFullscreen);
        const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

        // เป็นแอปบนหน้าจอโฮมอยู่แล้ว หรือเบราว์เซอร์ไม่มี Fullscreen API (เช่น Bluefy บน iPhone) → ซ่อนปุ่ม
        if (isStandalone || !canFs) { btnFs.style.display = 'none'; return; }

        async function enterFs() {
            try {
                if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
                else root.webkitRequestFullscreen();
                return true;
            } catch (e) {
                return false;
            }
        }
        function exitFs() {
            if (document.exitFullscreen) document.exitFullscreen().catch(() => { });
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }

        btnFs.addEventListener('click', async () => {
            if (isFs()) {
                exitFs();
                try { localStorage.removeItem('sg_fullscreen'); } catch (_) { }
                return;
            }
            const ok = canFs && await enterFs();
            if (ok) {
                try { localStorage.setItem('sg_fullscreen', '1'); } catch (_) { }
            } else {
                showStatus(currentLang === 'TH'
                    ? 'เบราว์เซอร์นี้ไม่ให้เว็บเปิดเต็มจอ — ใน Bluefy ลองดูเมนู ≡ หรือหมุนจอแนวนอน'
                    : 'Fullscreen not allowed here — in Bluefy check the ≡ menu', 5000);
            }
        });

        // เคยเปิดเต็มจอไว้ → แตะจอครั้งแรกจะเข้าเต็มจอให้อัตโนมัติ (ต้องมีการแตะก่อนตามกฎเบราว์เซอร์)
        let wantFs = false;
        try { wantFs = localStorage.getItem('sg_fullscreen') === '1'; } catch (_) { }
        if (canFs && wantFs) {
            document.addEventListener('click', function once(e) {
                document.removeEventListener('click', once, true);
                if (e.target !== btnFs && !isFs()) enterFs();
            }, true);
        }

        // กันจอดับระหว่างขับ (Screen Wake Lock — iOS 16.4+, Chrome Android)
        let wakeLock = null;
        async function keepAwake() {
            if (!('wakeLock' in navigator) || document.hidden) return;
            try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { }
        }
        document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
        document.addEventListener('click', keepAwake, { once: true });
        keepAwake();
    })();

    (function initPWA() {
        // ── Platform detection ────────────────────────────────
        const ua = navigator.userAgent.toLowerCase();
        const isIos = /iphone|ipad|ipod/.test(ua);
        const isAndroid = /android/.test(ua);
        const isMobile = isIos || isAndroid;
        const isPC = !isMobile;
        const isSafariOnly = isIos && /safari/.test(ua) && !/crios|fxios|opios|chrome/.test(ua);
        const isChrome = /chrome|crios/.test(ua) && !/edge|edg/.test(ua);
        const isEdge = /edge|edg/.test(ua);

        // ── Already installed as PWA? ─────────────────────────
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;

        if (isStandalone) return; // already running as PWA — hide everything
        if (window.SGBle.isNative) return; // แอป iOS (Capacitor) — ไม่ต้องแนะนำติดตั้ง PWA

        // ── Dismissed cooldown (7 days) ───────────────────────
        function isDismissed(key) {
            const ts = parseInt(localStorage.getItem(key) || '0', 10);
            return Date.now() - ts < 7 * 24 * 60 * 60 * 1000; // 7 days
        }
        function dismiss(key) {
            localStorage.setItem(key, Date.now());
        }

        // ── Grab banner elements ──────────────────────────────
        const androidBanner = document.getElementById('pwa-install-banner');
        const iosBanner = document.getElementById('ios-install-prompt');
        const pcBanner = document.getElementById('pc-install-prompt');
        const btnInstall = document.getElementById('btn-pwa-install');
        const btnClosePwa = document.getElementById('btn-pwa-close');
        const btnCloseIos = document.getElementById('btn-ios-close');
        const btnPcInstall = document.getElementById('btn-pc-install');
        const btnPcClose = document.getElementById('btn-pc-close');

        let deferredPrompt = null;

        // ── Handle beforeinstallprompt (Android Chrome / PC) ──
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;

            if (isAndroid && !isDismissed('pwa_android_dismissed')) {
                androidBanner.style.display = 'block';
                debugLog('📲 Android PWA banner shown', '#00d2ff');
            } else if (isPC && !isDismissed('pwa_pc_dismissed')) {
                pcBanner.style.display = 'block';
                debugLog('🖥 PC PWA banner shown', '#cc44ff');
            }
        });

        // Android install button
        if (btnInstall) {
            btnInstall.addEventListener('click', async () => {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                androidBanner.style.display = 'none';
                if (outcome === 'accepted') {
                    debugLog('✅ Android PWA Installed!', '#00ff88');
                    showStatus('✅ ติดตั้งสำเร็จ!');
                }
                deferredPrompt = null;
            });
        }
        if (btnClosePwa) {
            btnClosePwa.addEventListener('click', () => {
                androidBanner.style.display = 'none';
                dismiss('pwa_android_dismissed');
            });
        }

        // PC install button
        if (btnPcInstall) {
            btnPcInstall.addEventListener('click', async () => {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                pcBanner.style.display = 'none';
                if (outcome === 'accepted') {
                    debugLog('✅ PC PWA Installed!', '#00ff88');
                    showStatus('✅ ติดตั้งสำเร็จ!');
                }
                deferredPrompt = null;
            });
        }
        if (btnPcClose) {
            btnPcClose.addEventListener('click', () => {
                pcBanner.style.display = 'none';
                dismiss('pwa_pc_dismissed');
            });
        }

        // ── iOS ใน Bluefy: แนะนำให้บันทึกบุ๊กมาร์ก ─────────────
        // (Safari/Chrome บน iOS ไม่มี Bluetooth → ใช้ Bluefy gate แทน)
        if (isIos && navigator.bluetooth && !isDismissed('pwa_ios_dismissed')) {
            // Delay 2s to let page settle
            setTimeout(() => {
                iosBanner.style.display = 'block';
                debugLog('🍎 Bluefy bookmark tip shown', '#ff375f');
            }, 2000);
        }

        if (btnCloseIos) {
            btnCloseIos.addEventListener('click', () => {
                iosBanner.style.display = 'none';
                dismiss('pwa_ios_dismissed');
            });
        }

        // ── Handle appinstalled event ─────────────────────────
        window.addEventListener('appinstalled', () => {
            androidBanner.style.display = 'none';
            pcBanner.style.display = 'none';
            deferredPrompt = null;
            showStatus('✅ App ติดตั้งเรียบร้อย!', 4000);
            debugLog('🎉 PWA installed successfully!', '#00ff88');
        });

        debugLog(`🔍 Platform: ${isIos ? 'iOS' : isAndroid ? 'Android' : 'PC'} | Safari:${isSafariOnly} Chrome:${isChrome} Edge:${isEdge}`, '#7aaeff');
    })();

});