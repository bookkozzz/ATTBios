# ATBB v2.0 dev3 — หน้าแก้ไข BIN และระบบพักไฟล์ ESP32

สถานะ: เปิดแก้ไฟล์ออฟไลน์สำหรับ BIN/XDF K97F-T01 ที่แนบได้ มี source ESP32 สำหรับเก็บไฟล์และรับส่งต่อ ยังไม่มีไดรเวอร์เขียน ECU จริง และยังไม่มี IPA หรือ firmware binary ที่ผ่านการ build/ทดสอบบนฮาร์ดแวร์

ต้นฉบับใน Downloads และ BIN/XDF บน Desktop ไม่ถูกแก้ไข ใช้สำเนาแยกในชุดนี้

## ใช้งานหน้าเว็บ
รัน `python -m http.server 8080 --bind 127.0.0.1` จากโฟลเดอร์นี้ แล้วเปิด http://localhost:8080
เลื่อนไปหน้า “จูน ECU” (หน้าที่ 7) เลือกชุดไฟล์ที่ชื่อ XDF ลงท้าย `unlock.xdf` แล้วกด “แก้ไข / เปิด Workspace”
ไม่เปิดผ่าน file:// เพราะการโหลดไฟล์ การเก็บข้อมูล และ crypto ต้องใช้ localhost/HTTPS หรือแอป Capacitor

## สิ่งที่ทำได้
- คลัง BIN/XDF หลายชุดใน IndexedDB แสดงชื่อ ขนาด SHA-256 เก็บต้นฉบับและดาวน์โหลดกลับได้
- ชุด K97F-T01 เปิดตารางจาก XDF ที่ผู้ใช้ปลดรหัสแล้ว ไม่ต้องเลือก XDF ใหม่ทุกครั้ง
- อ่านตารางจริง 22 รายการ แก้ได้ 20 รายการแบบออฟไลน์ ส่วน Id และ DIAGNOSTIC TROUBLE CODES อ่านอย่างเดียว
- ตารางจริงรวม TPS Table, MAP Table, RPM Table, MAP // RPM, TPS // RPM, Ignition, Timing, Limiter-1 ถึง Limiter-5, Throttle ::TPS, AF Ratio และ Lamda
- Flags 11 รายการแสดง address, mask และ raw แบบอ่านอย่างเดียว ความหมายของ mask ยังไม่ยืนยันพอจะใช้เปิด/ปิดเซนเซอร์
- ตารางที่ชื่อซ้ำแยกด้วย unique ID และ address ไม่รวมเป็นตารางเดียว
- ตรวจชนิดข้อมูล ขอบเขต address ขนาดตาราง สูตร linear และช่วงค่าก่อนแก้ มี Undo และ diff ระดับ byte
- บันทึกฉบับร่างในเบราว์เซอร์ โหลดกลับได้เมื่อเลือกชุดไฟล์เดิม กดบันทึกก่อนเปลี่ยนชุดไฟล์หรือปิดแอป
- ส่งออก Patch JSON หรือ BIN ฉบับร่างที่ชื่อระบุ NOT-FOR-FLASH
- Connect ผ่าน BLE เดิม รับข้อมูลสด พร้อม cursor ช่องใกล้เคียงสำหรับแกนที่จับคู่จาก breakpoint ได้ ไม่ได้ปรับค่าใน RAM ของ ECU
- ส่ง BIN ต้นฉบับ หรือ snapshot ฉบับร่างที่กำลังแก้ ไปเก็บใน ESP32 ตรวจ SHA-256 หลังครบไฟล์
- สื่อสารแบบ request/ACK ส่งต่อจาก offset ของ ESP32 ป้องกันการเขียนซ้ำเมื่อ ACK หาย
- BLE กลับมาแล้วส่งต่ออัตโนมัติได้เมื่อแอปยังเปิดและเปิดตัวเลือกไว้ หรือกดส่งต่อเอง

## สิ่งที่ยังไม่พร้อม
- อ่านรหัส ECU/เวอร์ชัน/ROM จากรถจริง เฟิร์มแวร์เดิมยังส่ง boxCode ว่าง การอ่าน Id ในไฟล์ไม่ใช่การระบุตัวรถที่เสียบอยู่
- checksum: XDF ให้ช่วง 0x18000–0x5FFFF และ store 0x5FFF8 แต่ calculationmethod=0 ยังไม่ได้ยืนยันอัลกอริทึมกับไฟล์ที่คำนวณโดยเครื่องมือจริง
- XDF HEADER region=0x40000 (256 KiB) แต่ BIN=0x60000 (384 KiB) จึงใช้ขอบเขต BIN จริงในการอ่าน และยังไม่เปิดการแฟลช
- ไม่มีขั้นตอนเข้า programming session, erase, program, verify และ recovery ของ ECU รุ่นนี้
- ไม่มีการปลดล็อก TPS หรือ RPM limiter อัตโนมัติ การแก้เซลล์ใน BIN ไม่ได้พิสูจน์ว่าเป็นวิธีปลดล็อกของรถ
- ไม่รับประกันการทำงานต่อระหว่าง ECU programming เพราะรุ่นนี้ยังปฏิเสธ COMMIT/FLASH/UNLOCK ทุกคำสั่ง
- BLE หลุด, K-Line หลุด และไฟเลี้ยงดับเป็นคนละกรณี การส่งไฟล์ต่อไม่ได้เท่ากับกู้ ECU ที่เขียนค้าง
- ยังไม่ทดสอบกับ iPhone/ESP32/ECU จริง และยังไม่ผ่าน Xcode build

## การป้องกันและขอบเขต
โปรไฟล์ editor ผูกกับ SHA-256 ทั้ง BIN และ XDF ที่ตรงกัน รุ่นอื่นในคลังเก็บได้แต่ยังไม่มีโปรไฟล์เปิดแก้
รายการเป้าหมาย Shindengen PCX150: K50A-T02, K96-V01, K97A-U01, K97G-N01, K97G-N31 และ K97F-T01 (ทุกตัวขึ้นต้น 30400-)
การอยู่ในรายการไม่ใช่การยืนยันว่าอ่าน/เขียน ECU รุ่นนั้นได้
มี preflight logic สำหรับรุ่น/เฟิร์มแวร์/ROM เดิม/checksum/ไฟเลี้ยง/รอบเครื่อง/ความสดของข้อมูล เพื่อใช้กับไดรเวอร์ในอนาคต ไม่ใช่การตรวจที่ผ่านกับ ECU จริงแล้ว
ESP32 ไม่ใช้ flashOk, ชื่อไฟล์ หรือข้อความยืนยันจากแอปเป็นสิทธิ์เขียน ECU และยังไม่มีโค้ด erase/program ECU ใน service ใหม่

## Build และทดสอบ
ใช้ Node.js 22: `npm ci`, `npm test`, `npm run build`, `npx cap sync ios`
ดู BUILD-IOS.md และ esp32_kline/README.md
มี workflows สำหรับตรวจ source/สร้าง unsigned IPA บน macOS และ compile ESP32 บน Linux ต้องรันให้ผ่านก่อนใช้กับอุปกรณ์ ไม่มีการ push หรือสั่ง workflow ให้แล้วในงานนี้

การทดสอบที่ผ่านในงานนี้: 19 tests บน Node 22 รวม DOM integration, ค่าจริง Limiter-1=9400/9600 และ ROM ID=SV850T06C121RV101, edit/save/undo, guards และการส่งต่อจำลองเมื่อ ACK/BLE หาย; web asset build และ Capacitor iOS sync ผ่าน
การ compile ESP32 ในเครื่องนี้ติด Windows Illegal System DLL Relocation ก่อน compiler เริ่ม จึงยังไม่มีผล compile ผ่าน ดู TEST-REPORT.md
