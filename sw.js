// เปลี่ยนเลขเวอร์ชันทุกครั้งที่อัปเดตไฟล์ เพื่อให้เครื่องผู้ใช้โหลดของใหม่
const CACHE_NAME = 'sgpro-v3.2.0';

// ใช้ path แบบ relative เพื่อให้ทำงานได้แม้ host อยู่ใน sub-folder (เช่น GitHub Pages)
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './log.js',
    './ble-transport.js',
    './maptable.js',
    './gps.js',
    './vendor/swiper/swiper-bundle.min.js',
    './vendor/swiper/swiper-bundle.min.css',
    './manifest.json',
    './icon-192.svg',
    './icon-512.svg',
    './logo.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // แคชทีละไฟล์ ไฟล์ไหนโหลดไม่ได้ก็ไม่ทำให้ติดตั้งล้มทั้งหมด
            .then(cache => Promise.all(ASSETS.map(url => cache.add(url).catch(() => { }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network-first: ออนไลน์ได้ของใหม่เสมอ, ออฟไลน์ใช้ของในแคช
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    event.respondWith(
        fetch(req)
            .then(res => {
                // แคชทั้งไฟล์ของเราและ CDN (Swiper, ฟอนต์) เพื่อให้เปิดได้ตอนไม่มีเน็ต
                if (res.ok || res.type === 'opaque') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true })
                .then(cached => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
});
