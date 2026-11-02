// คัดลอกไฟล์เว็บแอปเดิมไปไว้ที่ www/ สำหรับ Capacitor (ไฟล์ต้นฉบับไม่ถูกย้ายหรือแก้)
// + คัดลอก JS ของ Capacitor และปลั๊กอิน BLE จาก node_modules ไปที่ www/vendor/capacitor/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');

const FILES = [
    'index.html', 'style.css', 'script.js', 'log.js', 'ble-transport.js', 'maptable.js', 'tuning.js', 'tune-core.js', 'tune-transfer.js', 'tune-workspace.js', 'tune-profiles.js', 'tune-graph.js', 'tuning.css', 'gps.js', 'manifest.json',
    'logo.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-192.svg', 'icon-512.svg',
    'apple-touch-icon.png',
];
const DIRS = ['vendor/swiper', 'ecu-library'];
const NODE_FILES = {
    'vendor/capacitor/capacitor.js': 'node_modules/@capacitor/core/dist/capacitor.js',
    'vendor/capacitor/bluetooth-le.js': 'node_modules/@capacitor-community/bluetooth-le/dist/plugin.js',
};


// สร้าง tune-profiles.js จาก ecu-library/*.profile.json ให้หน้า Workspace เปิดได้แม้ไม่มี server (file://)
{
    const lib = path.join(root, 'ecu-library'), profiles = {};
    for (const f of fs.readdirSync(lib).filter(f => f.endsWith('.profile.json'))) profiles[f.replace('.profile.json', '')] = JSON.parse(fs.readFileSync(path.join(lib, f), 'utf8'));
    fs.writeFileSync(path.join(root, 'tune-profiles.js'), '/* Generated from ecu-library/*.profile.json by scripts/build-www.js — do not edit by hand. Lets the tuning workspace open without a web server (file://). */\nwindow.ATBBProfiles=Object.freeze(' + JSON.stringify(profiles) + ');\n');
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copy(src, dest) {
    if (!fs.existsSync(src)) throw new Error(`ไม่พบไฟล์ ${path.relative(root, src)}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
}

for (const f of FILES) copy(path.join(root, f), path.join(out, f));
for (const d of DIRS) copy(path.join(root, d), path.join(out, d));
for (const [dest, src] of Object.entries(NODE_FILES)) {
    if (!fs.existsSync(path.join(root, src))) throw new Error(`ไม่พบ ${src} — รัน npm install ก่อน`);
    copy(path.join(root, src), path.join(out, dest));
}

console.log(`✓ www/ พร้อม (${FILES.length} ไฟล์ + vendor)`);
