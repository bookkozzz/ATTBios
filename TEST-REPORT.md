# Test report — ATBB v2.0 dev3
วันที่ 2026-11-02 (Asia/Bangkok)

ผ่าน: 19/19 tests บน Node 22.23.4 รวม DOM integration ด้วย jsdom/fake-indexeddb, คลังไฟล์, ตารางจริง 22 รายการและ flags อ่านอย่างเดียว 11 รายการ, edit/save/load/undo, original unchanged และ telemetry
ROM fixture: Limiter-1 ที่ 0x1890A อ่านได้ 9400/9600 ตรงกับ TunerPro และ Id=SV850T06C121RV101
ผ่าน tests ของ source hash/size binding, endian, signed data, address/range/NaN/quantization bounds, readonly ID และ preflight logic สำหรับข้อมูลผิดรุ่น/เฟิร์มแวร์/checksum/ไฟเลี้ยง/รอบเครื่อง/ข้อมูลหมดอายุ
ผ่าน app-side transport simulator สำหรับ ACK หาย, bad offset/hash, งานคนละไฟล์, pause, disconnect/resume และ MTU ขั้นต่ำ ไม่มีการส่ง FLASH/COMMIT
npm run build และ Capacitor 8.6.0 sync ios ผ่าน ใช้ BLE plugin 8.3.0

ยังไม่ยืนยัน:
- ESP32 compile ไม่สำเร็จเพราะตัวคอมไพเลอร์ xtensa-esp32-elf-g++.exe เริ่มไม่ได้จาก Windows Illegal System DLL Relocation ก่อนตรวจ sketch จึงยังไม่มี compile success หรือ firmware binary ที่รับรอง
- มี CI Linux สำหรับตรวจต่อ แต่ยังไม่ได้ push หรือรัน CI
- ยังไม่มี Xcode archive, signing หรือ IPA ที่ build แล้ว
- DOM tests ไม่ใช่ screenshot/layout QA บน iPhone หรือ browser engine จริง
- ยังไม่ได้ทดสอบ BLE, LittleFS, reboot/power interruption หรือ reconnect อัตโนมัติกับ ESP32/iPhone จริง
- ยังไม่ได้ทดสอบ ECU ID/ROM read, checksum, flash write/readback หรือ recovery กับ ECU จริง
- การส่งต่อที่ทดสอบเป็น app-side simulator ไม่ใช่การเขียน ECU ต่อหลัง BLE หลุด

BIN ต้นฉบับ 393216 bytes SHA-256:
9675900f6bfb8f80b56f3d3fac20bac8c892810dd236905c5011de8fc7df508c
Unlocked XDF 43608 bytes SHA-256:
52442c2750d000f2c87fb194aba8c38b6cffbc4ab1714cdda81905a0cba2e6d3
ไฟล์ผู้ใช้บน Desktop/Downloads ไม่ถูกแก้ไข

เปิดใช้งาน: file library, offline editor, draft/patch export, telemetry UI และ staging client/source firmware
ปิด: ECU flash, unlock commands และ RAM calibration
BIN ฉบับร่างยังไม่มี checksum ที่ยืนยัน ห้ามใช้แฟลช ECU
