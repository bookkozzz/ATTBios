# Build iOS — ATBB v2.0 dev3

ชุดนี้มีโปรเจ็ค ios/ และ workflow แล้ว แต่ยังไม่ใช่ IPA ที่ build/เซ็นเสร็จ
ใช้ Node.js >=22 และแพ็กเกจตาม package-lock.json

## บน Mac ที่ติดตั้ง Xcode
1. `npm ci`
2. `npm test`
3. `npm run build`
4. `npx cap sync ios`
5. `npx cap open ios`
6. เลือก Team / Bundle ID ที่มีสิทธิ์ใน Xcode แล้ว build ลง iPhone

Bluetooth usage description มีใน Info.plist ใช้ @capacitor-community/bluetooth-le 8.3.0
ESP32 service FFE0 / characteristic FFE1 ชื่อเดิม SG-KLINE-PVX150 ใช้ปุ่ม Connect แล้วเลือกอุปกรณ์เดิม

## บน GitHub Actions
นำโฟลเดอร์นี้เป็นราก repository แล้วรัน workflow “ATBB iOS development build”
Workflow ใช้ macos-latest, Node 22, npm test/build, cap sync ios แล้ว xcodebuild
ผลที่ตั้งให้สร้างคือ ATBB-v2-unsigned.ipa ซึ่งยังต้องเซ็นด้วยเครื่องมือ/บัญชีที่คุณมีสิทธิ์ก่อนติดตั้ง ไม่ใช่ signed IPA ที่ติดตั้งได้ทันที
ยังไม่ได้รัน workflow นี้หรือ Xcode build จริงในงานนี้

## ขอบเขตทดสอบบนโทรศัพท์
เริ่มจากคลังไฟล์ เปิดตารางออฟไลน์ และการบันทึกฉบับร่าง
ส่วน ESP32 ต้อง compile firmware ให้ผ่านก่อน จึงทดสอบเชื่อมต่อ อ่าน telemetry และพักไฟล์/ส่งต่อได้
ไม่มีปุ่มเขียน ECU ที่เปิดใช้งาน อย่าใช้ BIN ที่ส่งออกชื่อ NOT-FOR-FLASH ไปแฟลชด้วยเครื่องมืออื่น เพราะ checksum ยังไม่ผ่านการยืนยัน

BLE/การทำงานเบื้องหลัง iOS: การส่งต่ออัตโนมัติในรุ่นนี้ใช้เมื่อแอปยังเปิดอยู่ ไม่รับประกันเมื่อ iOS ระงับหรือปิดแอป หากเปิดใหม่ให้เลือกไฟล์เดิมและกดส่งต่อ โดย ESP32 จะรายงาน offset ที่มีอยู่
