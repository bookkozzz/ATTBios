// ========================================================
// SGBle — ชั้น Transport ของ Bluetooth LE (Platform Adapter)
//  • แอป iOS (Capacitor)            → @capacitor-community/bluetooth-le (Native BLE)
//  • เบราว์เซอร์ (Chrome/Edge/Bluefy) → Web Bluetooth แบบเดิม
// script.js เรียกผ่าน interface เดียวกันทั้งสองแบบ
// ข้อมูลที่ส่งเข้า handler เป็น DataView เหมือน event.target.value ของ Web Bluetooth
// ========================================================
(function () {
    'use strict';

    const isNative = !!(window.Capacitor
        && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform());

    // 0xFFE0 / 'ffe0' / 'generic_access' / UUID เต็ม → UUID 128-bit ตัวพิมพ์เล็ก
    const NAMED_UUIDS = { generic_access: 0x1800 };
    function toUUID(u) {
        if (typeof u === 'string' && NAMED_UUIDS[u] !== undefined) u = NAMED_UUIDS[u];
        if (typeof u === 'number') return `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
        u = String(u).toLowerCase();
        if (/^[0-9a-f]{4}$/.test(u)) return `0000${u}-0000-1000-8000-00805f9b34fb`;
        return u;
    }

    // ตรวจว่าอุปกรณ์ตรงกับ filter แบบ Web Bluetooth ({name}|{namePrefix}|{services}) หรือไม่
    function matchesFilter(f, name, uuids) {
        if (f.name && name !== f.name) return false;
        if (f.namePrefix && !(name || '').startsWith(f.namePrefix)) return false;
        if (f.services && !f.services.map(toUUID).every(s => uuids.includes(s))) return false;
        return !!(f.name || f.namePrefix || f.services);
    }

    function errText(e) {
        return (e && (e.message || e.errorMessage || e.name)) || String(e || '') || 'Unknown error';
    }

    // ════════════════════════════════════════════════════
    //  NATIVE (Capacitor + @capacitor-community/bluetooth-le)
    // ════════════════════════════════════════════════════
    function createNativeTransport() {
        let clientPromise = null;
        let initialized = false;
        let device = null;          // { deviceId, name }
        let channel = null;         // { service, characteristic } UUID 128-bit
        let connected = false;
        let notifying = false;
        let enabledWatch = false;
        let onDisconnectCb = null;

        function loadScript(src) {
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = src;
                s.onload = resolve;
                s.onerror = () => reject(new Error(`โหลด ${src} ไม่ได้`));
                document.head.appendChild(s);
            });
        }

        // ไฟล์ JS ของ Capacitor + ปลั๊กอินถูกคัดลอกมาไว้ที่ vendor/capacitor/ ตอน build (scripts/build-www.js)
        function getClient() {
            if (!clientPromise) {
                clientPromise = (async () => {
                    if (!window.capacitorExports) await loadScript('vendor/capacitor/capacitor.js');
                    if (!window.capacitorCommunityBluetoothLe) await loadScript('vendor/capacitor/bluetooth-le.js');
                    return window.capacitorCommunityBluetoothLe.BleClient;
                })().catch(e => { clientPromise = null; throw e; });
            }
            return clientPromise;
        }

        // ขอสิทธิ์ + เปิดตัวจัดการ BLE (ครั้งแรก iOS จะถามสิทธิ์ Bluetooth)
        async function init() {
            const ble = await getClient();
            if (!initialized) {
                try {
                    await ble.initialize();
                } catch (e) {
                    const msg = errText(e);
                    const err = new Error(/permission|unauthori/i.test(msg)
                        ? 'ไม่ได้รับสิทธิ์ใช้ Bluetooth — เปิดได้ที่ ตั้งค่า > ATBB PRO > Bluetooth'
                        : msg);
                    err.code = /permission|unauthori/i.test(msg) ? 'PERMISSION_DENIED' : 'INIT_FAILED';
                    throw err;
                }
                initialized = true;
                try {
                    await ble.setDisplayStrings({
                        scanning: 'กำลังค้นหาอุปกรณ์...',
                        cancel: 'ยกเลิก',
                        availableDevices: 'อุปกรณ์ที่พบ',
                        noDeviceFound: 'ไม่พบอุปกรณ์',
                    });
                } catch (_) { }
            }
            if (!(await ble.isEnabled())) {
                const err = new Error('Bluetooth ปิดอยู่ — เปิดที่ Control Center หรือ ตั้งค่า > Bluetooth');
                err.code = 'BT_OFF';
                throw err;
            }
            return ble;
        }

        // สแกนหาอุปกรณ์ตาม filter แบบ Web Bluetooth แล้วเลือกตัวแรกที่ตรง (ใช้กับโหมด Auto)
        async function scanForMatch(ble, filters, timeoutMs) {
            return new Promise((resolve, reject) => {
                let done = false;
                const finish = async (result, err) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    try { await ble.stopLEScan(); } catch (_) { }
                    err ? reject(err) : resolve(result);
                };
                const timer = setTimeout(() => {
                    const e = new Error('ไม่พบอุปกรณ์ที่ตรงกัน');
                    e.name = 'NotFoundError';
                    finish(null, e);
                }, timeoutMs);
                ble.requestLEScan({}, r => {
                    const name = r.localName || (r.device && r.device.name) || '';
                    const uuids = (r.uuids || []).map(toUUID);
                    if (filters.some(f => matchesFilter(f, name, uuids))) {
                        finish({ deviceId: r.device.deviceId, name });
                    }
                }).catch(e => finish(null, e));
            });
        }

        return {
            isNative: true,
            isAvailable: () => true,
            init,

            // options เหมือน navigator.bluetooth.requestDevice()
            async requestDevice(options) {
                const ble = await init();
                if (options.acceptAllDevices) {
                    // iOS แสดงรายชื่ออุปกรณ์ให้เลือก (เหมือนตัวเลือกของเบราว์เซอร์)
                    const d = await ble.requestDevice({
                        optionalServices: (options.optionalServices || []).map(toUUID),
                    });
                    device = { deviceId: d.deviceId, name: d.name || '' };
                } else {
                    device = await scanForMatch(ble, options.filters || [], 10000);
                }
                return device;
            },

            // ใช้อุปกรณ์เดิม (สำหรับต่อใหม่อัตโนมัติ) โดยไม่ต้องสแกน
            useDevice(d) { device = d; },
            getDevice: () => device,

            async connect(onDisconnect) {
                const ble = await init();
                onDisconnectCb = onDisconnect;
                await ble.connect(device.deviceId, () => {
                    const wasConnected = connected;
                    connected = false;
                    notifying = false;
                    if (wasConnected && onDisconnectCb) onDisconnectCb();
                }, { timeout: 10000 });
                connected = true;
            },

            // หา Service/Characteristic ตามลำดับที่ระบุ ไม่เจอใช้ตัวแรก (เหมือน logic เดิม)
            async openChannel(serviceCandidates, charCandidates) {
                const ble = await getClient();
                const services = await ble.getServices(device.deviceId);
                if (!services.length) throw new Error('No BT services found');
                let svc = null;
                for (const u of serviceCandidates.map(toUUID)) {
                    svc = services.find(s => s.uuid === u);
                    if (svc) break;
                }
                if (!svc) svc = services[0];
                const chars = svc.characteristics || [];
                if (!chars.length) throw new Error('No BT characteristics found');
                let ch = null;
                for (const u of charCandidates.map(toUUID)) {
                    ch = chars.find(c => c.uuid === u);
                    if (ch) break;
                }
                if (!ch) ch = chars[0];
                channel = { service: svc.uuid, characteristic: ch.uuid };
                return channel;
            },

            async startNotifications(handler) {
                const ble = await getClient();
                // ปลด subscription เดิมก่อน กันข้อมูลซ้ำเมื่อเชื่อมต่อใหม่
                if (notifying) {
                    try { await ble.stopNotifications(device.deviceId, channel.service, channel.characteristic); } catch (_) { }
                    notifying = false;
                }
                await ble.startNotifications(device.deviceId, channel.service, channel.characteristic, handler);
                notifying = true;
            },

            async write(bytes) {
                if (!connected || !channel) throw new Error('Not connected');
                const ble = await getClient();
                await ble.write(device.deviceId, channel.service, channel.characteristic,
                    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
            },

            isConnected: () => connected,

            async disconnect() {
                if (!device) return;
                const ble = await getClient();
                const wasConnected = connected;
                connected = false;   // ไม่เรียก onDisconnect เพราะผู้ใช้กดตัดเอง
                if (notifying && channel) {
                    try { await ble.stopNotifications(device.deviceId, channel.service, channel.characteristic); } catch (_) { }
                    notifying = false;
                }
                if (wasConnected) {
                    try { await ble.disconnect(device.deviceId); } catch (_) { }
                }
            },

            // แจ้งเมื่อผู้ใช้เปิด/ปิด Bluetooth ของเครื่อง
            async watchEnabled(cb) {
                if (enabledWatch) return;
                const ble = await getClient();
                if (!initialized) return;
                enabledWatch = true;
                try { await ble.startEnabledNotifications(cb); } catch (_) { enabledWatch = false; }
            },

            async openAppSettings() {
                const ble = await getClient();
                try { await ble.openAppSettings(); } catch (_) { }
            },
        };
    }

    // ════════════════════════════════════════════════════
    //  WEB BLUETOOTH (Chrome/Edge บน PC/Android, Bluefy บน iPhone)
    // ════════════════════════════════════════════════════
    function createWebTransport() {
        let device = null;
        let server = null;
        let char = null;
        let notifyHandler = null;
        let onDisconnectCb = null;

        const onGattDisconnected = () => { if (onDisconnectCb) onDisconnectCb(); };
        const onValueChanged = (event) => { if (notifyHandler) notifyHandler(event.target.value); };

        function detachListeners() {
            if (device) device.removeEventListener('gattserverdisconnected', onGattDisconnected);
            if (char) char.removeEventListener('characteristicvaluechanged', onValueChanged);
        }

        return {
            isNative: false,
            isAvailable: () => !!navigator.bluetooth,
            async init() { },

            async requestDevice(options) {
                detachListeners();
                device = await navigator.bluetooth.requestDevice(options);
                char = null;
                return { deviceId: device.id, name: device.name || '' };
            },

            useDevice() { },   // Web Bluetooth ต่อซ้ำได้ด้วย device object เดิม
            getDevice: () => device ? { deviceId: device.id, name: device.name || '' } : null,

            async connect(onDisconnect) {
                onDisconnectCb = onDisconnect;
                device.removeEventListener('gattserverdisconnected', onGattDisconnected);
                device.addEventListener('gattserverdisconnected', onGattDisconnected);
                server = await device.gatt.connect();
            },

            async openChannel(serviceCandidates, charCandidates) {
                let service = null;
                for (const uuid of serviceCandidates) {
                    try { service = await server.getPrimaryService(uuid); break; } catch (e) { }
                }
                if (!service) {
                    const svcs = await server.getPrimaryServices();
                    if (!svcs.length) throw new Error('No BT services found');
                    service = svcs[0];
                }
                let ch = null;
                for (const uuid of charCandidates) {
                    try { ch = await service.getCharacteristic(uuid); break; } catch (e) { }
                }
                if (!ch) {
                    const chs = await service.getCharacteristics();
                    if (!chs.length) throw new Error('No BT characteristics found');
                    ch = chs[0];
                }
                if (char) char.removeEventListener('characteristicvaluechanged', onValueChanged);
                char = ch;
                return { service: service.uuid, characteristic: ch.uuid };
            },

            async startNotifications(handler) {
                notifyHandler = handler;
                char.removeEventListener('characteristicvaluechanged', onValueChanged);
                await char.startNotifications();
                char.addEventListener('characteristicvaluechanged', onValueChanged);
            },

            async write(bytes) {
                if (!char) throw new Error('Not connected');
                await char.writeValue(bytes);
            },

            isConnected: () => !!(device && device.gatt.connected),

            async disconnect() {
                detachListeners();
                if (device && device.gatt.connected) device.gatt.disconnect();
            },

            async watchEnabled() { },
            async openAppSettings() { },
        };
    }

    window.SGBle = isNative ? createNativeTransport() : createWebTransport();
    window.SGBle.toUUID = toUUID;
})();
