# SGPro iOS — คู่มือ Build และติดตั้ง (ไม่ต้องมี Mac)

แอป iOS ใช้ Capacitor 8 + `@capacitor-community/bluetooth-le` เชื่อม ESP32 (`SG-KLINE-PVX150`, Service `FFE0` / Characteristic `FFE1`) ผ่าน Native BLE
เฟิร์มแวร์ ESP32 ไม่ต้องแก้ ส่วนหน้าเว็บเดิมยังเปิดด้วย `start-server.bat` ได้เหมือนเดิม

## เวอร์ชันที่ใช้

| แพ็กเกจ | เวอร์ชัน |
| --- | --- |
| @capacitor/core, @capacitor/ios, @capacitor/cli | 8.6.0 |
| @capacitor-community/bluetooth-le | 8.3.0 |
| Node.js (ใช้บน GitHub Actions) | 22 |
| iOS Deployment Target | 15.0 (ค่าเริ่มต้นของ Capacitor 8) |
| Xcode | latest-stable บน runner `macos-latest` ของ GitHub |

## 1. ส่งโค้ดขึ้น GitHub → ได้ไฟล์ IPA

ทุกครั้งที่ push เข้า branch `main` ระบบจะ build ให้อัตโนมัติ (หรือกด **Actions → iOS build → Run workflow**)

1. เปิด repo บน GitHub → แท็บ **Actions** → เลือกรอบล่าสุดที่ขึ้น ✓ สีเขียว
2. เลื่อนลงไปที่ **Artifacts** → ดาวน์โหลด `SGPro-unsigned-ipa` (ได้ไฟล์ zip)
3. แตก zip จะได้ `SGPro-unsigned.ipa`

## 2. ติดตั้งลง iPhone ด้วย Sideloadly (บน Windows)

ครั้งแรกเท่านั้น:

1. ติดตั้ง **iTunes** และ **iCloud** แบบดาวน์โหลดจากเว็บ Apple (ไม่ใช่ Microsoft Store) — Sideloadly ต้องใช้ไดรเวอร์ของทั้งสองตัว
2. ดาวน์โหลด Sideloadly จาก https://sideloadly.io แล้วติดตั้ง
3. iPhone: เปิด **ตั้งค่า > ความเป็นส่วนตัวและความปลอดภัย > โหมดนักพัฒนา (Developer Mode)** → เปิด แล้วรีสตาร์ต
   (ถ้าไม่เห็นเมนูนี้ ให้ติดตั้งแอปครั้งแรกก่อน เมนูจะโผล่ขึ้นมา)

ทุกครั้งที่ติดตั้ง:

1. เสียบ iPhone กับคอมด้วยสาย กด **Trust / เชื่อถือ** บนมือถือ
2. เปิด Sideloadly → ลากไฟล์ `SGPro-unsigned.ipa` ใส่ → ใส่ Apple ID → กด **Start**
3. ครั้งแรกบน iPhone: **ตั้งค่า > ทั่วไป > VPN และการจัดการอุปกรณ์** → แตะ Apple ID ของคุณ → **เชื่อถือ**
4. เปิดแอป SGPro → อนุญาต Bluetooth เมื่อถาม

ข้อจำกัดของ Apple ID ฟรี: แอปใช้ได้ 7 วัน ครบแล้วต้องติดตั้งซ้ำด้วย Sideloadly (ข้อมูลในแอปไม่หาย ถ้าใช้ Apple ID เดิม)

## 3. ทดสอบเว็บบน Windows (ไม่ต้องติดตั้งอะไรเพิ่ม)

ดับเบิลคลิก `start-server.bat` แล้วเปิด http://localhost:8080 ใน Chrome/Edge — ใช้ Web Bluetooth แบบเดิม

ถ้าจะ build โฟลเดอร์ `www/` เองบน Windows (ไม่จำเป็น) ต้องมี Node.js 22 ขึ้นไป:

```
npm install
npm run build
```

## 4. แก้โค้ดแล้วอยากได้แอปเวอร์ชันใหม่

แก้ไฟล์เดิม (`index.html`, `script.js`, `style.css`, `ble-transport.js` …) → commit + push เข้า `main` → รอ Actions เสร็จ (~5–10 นาที) → ทำข้อ 1–2 ซ้ำ

## ไฟล์ที่เกี่ยวกับแอป iOS

| ไฟล์ | หน้าที่ |
| --- | --- |
| `ble-transport.js` | ชั้น Bluetooth: ในแอปใช้ Native BLE, ในเบราว์เซอร์ใช้ Web Bluetooth |
| `capacitor.config.json` | ชื่อแอป `SGPro`, App ID `com.smartgate.sgpro`, โฟลเดอร์เว็บ `www` |
| `scripts/build-www.js` | คัดลอกไฟล์เว็บ + JS ของปลั๊กอินไป `www/` |
| `ios/` | โปรเจกต์ Xcode (มี `NSBluetoothAlwaysUsageDescription` ใน `Info.plist` แล้ว) |
| `.github/workflows/ios-build.yml` | build IPA บน Mac ของ GitHub |
| `vendor/swiper/` | Swiper 10.3.1 เก็บในแอป เปิดได้แม้ไม่มีเน็ต |

## Test Plan บน iPhone จริง (ยังไม่ได้ทดสอบ — ต้องทำเอง)

- [ ] เปิดแอปครั้งแรก กด Connect → iOS ถามสิทธิ์ Bluetooth → อนุญาต
- [ ] กด **Auto** → เจอ `SG-KLINE-PVX150` และเชื่อมต่อได้ (log ขึ้น Service `…ffe0…`, Characteristic `…ffe1…`)
- [ ] กด **Connect** (เลือกเอง) → มีรายชื่ออุปกรณ์ให้เลือก
- [ ] เข็ม RPM/ความเร็ว และหน้า Live Data ขยับต่อเนื่อง ทุก ~200ms
- [ ] หน้า ESP32 log แสดงภาษาไทยถูกต้อง ไม่มีตัว �
- [ ] ปุ่ม Rescan ส่ง `SCAN` แล้ว ESP32 log ขึ้น `[CMD] SCAN`
- [ ] ดึงปลั๊ก ESP32 → แอปขึ้น "ตัดการเชื่อมต่อ" แล้วลองต่อใหม่เอง 3 ครั้ง; เสียบกลับ → ต่อได้
- [ ] กด Disconnect → ไม่ต่อใหม่เอง
- [ ] ปิด Bluetooth ที่ Control Center → ขึ้นเตือน; เปิดกลับ → ต่อใหม่
- [ ] ปฏิเสธสิทธิ์ Bluetooth (ตั้งค่า > SGPro) → กด Connect แล้วมีปุ่มพาไปหน้าตั้งค่า
- [ ] สลับไปแอปอื่นแล้วกลับมา / ปิดแอปแล้วเปิดใหม่ → ต่อได้ ข้อมูลไม่ซ้ำ
- [ ] ปุ่มและหน้าอื่นๆ (Gauge, Drag, DTC, Settings) ยังใช้ได้

ข้อจำกัดที่รู้แล้ว:
- แอปไม่ได้เปิดโหมด Bluetooth เบื้องหลัง ถ้าสลับไปแอปอื่นนานๆ iOS อาจตัดการเชื่อมต่อ เมื่อกลับมาแอปจะต่อใหม่เอง
- ปุ่มดาวน์โหลดไฟล์ log (.txt) ใช้ไม่ได้ในแอป iOS เพราะ WebView ของแอปไม่รองรับการดาวน์โหลดไฟล์ ต้องเพิ่มปลั๊กอิน Share ถ้าต้องการ
