/*
 * ═══════════════════════════════════════════════════════════════
 *  ESP32 K-Line BLE Bridge v2.1 — Honda PGM-FI (PCX 150 / PCX 160)
 *  AUTO-SCAN: วนหาโปรโตคอลเองจนกว่า ECU จะตอบ
 * ═══════════════════════════════════════════════════════════════
 *
 *  รองรับกล่อง:
 *    30400-K36-T01  PCX150 2014 (กุญแจ)
 *    30400-K36-T31  PCX150 2015–2017 (Smart Key)
 *    30400-K97-T01  PCX150 2018–2020
 *    30400-K1Z-T01 / T11 / TC1 / TC2  PCX160 2021–2026
 *
 *  ลำดับที่สแกน (ทุกตัว 10400 baud — K-line ของ Honda ใช้ baud นี้หมด
 *  ที่ต่างกันคือ "วิธี init" กับ "รูปแบบ packet"):
 *    0  HONDA      Honda K-line  : wake (LOW 70ms / HIGH 130ms) → FE 04 FF FF
 *                                 → 72 05 00 F0 99  (ตอบ 02 04 00 FA)
 *                                 → อ่านตาราง 72 05 71 <table> <cs>
 *                                 วนลองตาราง 11, 10, 17, 13, 20, 16, 12, D1
 *    1  KWP_F12    KWP2000 fast init, physical  81 12 F1  (แบบที่ ELM327 ใช้ได้)
 *    2  KWP_F11    KWP2000 fast init, physical  81 11 F1
 *    3  KWP_F33    KWP2000 fast init, functional C1 33 F1
 *    4  SLOW_33    5-baud slow init 0x33 → ISO9141-2 หรือ KWP2000 slow
 *  โปรโตคอลที่เจอจะถูกจำไว้ใน flash แล้วลองเป็นตัวแรกในครั้งถัดไป
 *
 *  ฮาร์ดแวร์:
 *    ESP32 GPIO16 (RX2) ← K-Line Module TX/RXD-out
 *    ESP32 GPIO17 (TX2) → K-Line Module RX/TXD-in
 *    Module K ↔ ขา K-line ของปลั๊ก DLC 4 ขา (ปลั๊กแดง), GND ร่วมกับรถ
 *    Module VS = 12V จากรถ, ESP32 = 3.3V/5V
 *    ต้องเปิดกุญแจ (ON) ECU ถึงจะตอบ — ไม่ต้องติดเครื่องก็ได้
 *
 *  BLE: Service 0xFFE0 / Characteristic 0xFFE1 (Notify + Write)
 *    ส่ง JSON {"type":"KLINE_DATA",...} ทุก 200ms (แบ่ง chunk ตาม MTU
 *    ให้ iPhone/Bluefy ที่ MTU 185 รับได้ครบ)
 *    ส่ง log ของ ESP32 {"type":"KLINE_LOG","t":ms,"msg":"..."} ให้เว็บแสดง
 *    (บรรทัดเดียวกับที่ขึ้นใน Serial Monitor + hex ที่รับ/ส่งตอนสแกน)
 *    เขียนคำสั่งเข้ามาได้:  "SCAN"     = ลืมโปรโตคอลเดิม แล้วสแกนใหม่
 *                           "PROTO:n"  = บังคับใช้โปรโตคอล n (0-4)
 *
 *  ต้องการไลบรารี: ArduinoJson v7
 * ═══════════════════════════════════════════════════════════════
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// ──── PIN CONFIG ────────────────────────────────────────────
#define KLINE_RX_PIN   16    // GPIO16 = RX2 ← K-Line Module TX
#define KLINE_TX_PIN   17    // GPIO17 = TX2 → K-Line Module RX
#define KLINE_BAUD     10400 // Honda K-Line baud rate (ทุกรุ่น)
#define LED_PIN        2     // Onboard LED (status)

// ──── BLE CONFIG ────────────────────────────────────────────
#define BLE_DEVICE_NAME   "SG-KLINE-PVX150"
#define SERVICE_UUID_16BIT      0xFFE0
#define CHAR_UUID_16BIT         0xFFE1

static BLEUUID serviceUUID((uint16_t)SERVICE_UUID_16BIT);
static BLEUUID charUUID((uint16_t)CHAR_UUID_16BIT);

// ──── K-LINE ADDRESSES ──────────────────────────────────────
#define TESTER_ADDR    0xF1

// ──── TIMING ────────────────────────────────────────────────
#define POLL_INTERVAL_MS   60    // ระยะห่างระหว่าง request (Honda/KWP P3 ≥ 55ms)
#define BLE_TX_INTERVAL_MS 200
#define MAX_FAILS_BEFORE_REINIT 6
#define SCAN_PAUSE_MS      2000  // พักหลังสแกนครบทุกโปรโตคอลแล้วไม่เจอ

// ──── PROTOCOLS ─────────────────────────────────────────────
enum ProtoId : uint8_t {
  P_HONDA = 0,
  P_KWP_F12,
  P_KWP_F11,
  P_KWP_F33,
  P_SLOW_33,
  P_COUNT
};
const char* PROTO_NAMES[P_COUNT] = {
  "HONDA", "KWP_FAST_12", "KWP_FAST_11", "KWP_FAST_33", "SLOW_INIT_33"
};

// ตาราง Honda ที่จะลอง (เรียงตามที่พบบ่อยใน PCX/Click/CBR)
const uint8_t HONDA_TABLES[] = { 0x11, 0x10, 0x17, 0x13, 0x20, 0x16, 0x12, 0xD1 };

// ──── GLOBALS ───────────────────────────────────────────────
HardwareSerial KLine(2);
Preferences    prefs;

BLEServer*         pServer         = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
volatile bool      bleConnected    = false;
bool               oldBleConnected = false;
int8_t             connectedCount  = 0;
volatile uint16_t  lastConnId      = 0;

// ── คำสั่งจากแอป (เขียนจาก BLE callback, อ่านใน K-line task) ──
volatile bool    cmdRescan     = false;
volatile int8_t  cmdForceProto = -1;

// ── ECU / scan state (เขียนโดย K-line task เท่านั้น) ──
volatile bool    ecuInitialized = false;
volatile bool    ecuResponding  = false;
int8_t           activeProto    = -1;   // โปรโตคอลที่ใช้ได้ตอนนี้
uint8_t          hondaTable     = 0;    // ตาราง Honda ที่ใช้ได้
uint8_t          kwpTarget      = 0x12; // KWP/ISO target address
uint8_t          kwpFormat      = 0x80; // 0x80 physical, 0xC0 functional
bool             isoMode        = false;// true = ISO9141-2 header 68 6A F1
uint8_t          failCount      = 0;

// ── Sensor Data ──
struct SensorData {
  uint16_t rpm     = 0;
  uint8_t  speed   = 0;
  float    tps     = 0.0;
  int16_t  ect     = 0;
  int16_t  iat     = 0;
  uint8_t  map_kpa = 0;
  float    batt    = 0.0;
  float    inj_ms  = 0.0;
  float    ign_adv = 0.0;
  float    o2v     = 0.0;
  float    afr     = 14.7;
  float    stft    = 0.0;
  float    ltft    = 0.0;
  uint8_t  load    = 0;
  float    duty    = 0.0;
} sensorData;

// สถานะที่ส่งให้แอปเห็นใน log (ใช้ spinlock เพราะสอง task ใช้ร่วมกัน)
portMUX_TYPE dataMux = portMUX_INITIALIZER_UNLOCKED;
char statusText[128] = "boot";
char rawHex[100]    = "";

void elog(const char* fmt, ...);

void setStatus(const char* fmt, ...) {
  char tmp[128];
  va_list ap; va_start(ap, fmt); vsnprintf(tmp, sizeof(tmp), fmt, ap); va_end(ap);
  portENTER_CRITICAL(&dataMux);
  strncpy(statusText, tmp, sizeof(statusText) - 1);
  statusText[sizeof(statusText) - 1] = 0;
  portEXIT_CRITICAL(&dataMux);
  elog("[SCAN] %s", tmp);
}

void setRaw(const uint8_t* buf, int len) {
  char tmp[100];
  int n = 0;
  for (int i = 0; i < len && n < (int)sizeof(tmp) - 3; i++) n += sprintf(tmp + n, "%02X", buf[i]);
  tmp[n] = 0;
  portENTER_CRITICAL(&dataMux);
  strcpy(rawHex, tmp);
  portEXIT_CRITICAL(&dataMux);
}

// ── Log queue: ทุกบรรทัดที่พิมพ์ลง Serial จะถูกส่งต่อให้เว็บผ่าน BLE ด้วย ──
#define LOG_Q   32
#define LOG_LEN 160   // ภาษาไทยใช้ 3 byte ต่อตัวอักษร
char         logQ[LOG_Q][LOG_LEN];
uint8_t      logHead = 0, logCount = 0;
portMUX_TYPE logMux = portMUX_INITIALIZER_UNLOCKED;
bool         traceOn = true;   // log hex ของทุก frame (เปิดตอนสแกน, สุ่มตอน poll)

void elog(const char* fmt, ...) {
  char tmp[LOG_LEN];
  va_list ap; va_start(ap, fmt); vsnprintf(tmp, sizeof(tmp), fmt, ap); va_end(ap);
  Serial.println(tmp);
  portENTER_CRITICAL(&logMux);
  if (logCount == LOG_Q) { logHead = (logHead + 1) % LOG_Q; logCount--; }  // เต็ม → ทิ้งบรรทัดเก่าสุด
  strcpy(logQ[(logHead + logCount) % LOG_Q], tmp);
  logCount++;
  portEXIT_CRITICAL(&logMux);
}

bool popLog(char* out) {
  bool ok = false;
  portENTER_CRITICAL(&logMux);
  if (logCount > 0) {
    strcpy(out, logQ[logHead]);
    logHead = (logHead + 1) % LOG_Q;
    logCount--;
    ok = true;
  }
  portEXIT_CRITICAL(&logMux);
  return ok;
}

void traceHex(const char* tag, const uint8_t* buf, int len) {
  if (!traceOn) return;
  char hex[LOG_LEN - 12];
  int n = 0;
  for (int i = 0; i < len && n < (int)sizeof(hex) - 4; i++) n += sprintf(hex + n, "%02X ", buf[i]);
  hex[n] = 0;
  elog("%s %s", tag, len ? hex : "(none)");
}

// ════════════════════════════════════════════════════════════
//  BLE CALLBACKS
// ════════════════════════════════════════════════════════════

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s, esp_ble_gatts_cb_param_t* param) override {
    connectedCount++;
    lastConnId   = param->connect.conn_id;
    bleConnected = true;
    elog("[BLE] client connected");
    BLEDevice::startAdvertising();
  }
  void onDisconnect(BLEServer* s) override {
    if (connectedCount > 0) connectedCount--;
    if (connectedCount <= 0) {
      connectedCount = 0;
      bleConnected = false;
    }
    elog("[BLE] client disconnected");
    BLEDevice::startAdvertising();
  }
};

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = String(c->getValue().c_str());
    v.trim();
    v.toUpperCase();
    if (v == "SCAN" || v == "RESCAN") {
      cmdRescan = true;
      elog("[CMD] SCAN — ลืมโปรโตคอลเดิม สแกนใหม่");
    } else if (v.startsWith("PROTO:")) {
      int p = v.substring(6).toInt();
      if (p >= 0 && p < P_COUNT) { cmdForceProto = p; elog("[CMD] force %s", PROTO_NAMES[p]); }
    }
    // คำสั่งอื่น (เช่น ATZ ที่แอปส่งมาตอนเปลี่ยนรุ่น) ไม่สนใจ
  }
};

// ════════════════════════════════════════════════════════════
//  K-LINE LOW LEVEL
//  K-line เป็นสายเดียว → ทุก byte ที่ส่งจะสะท้อนกลับ (echo)
//  ฟังก์ชันส่งจะกิน echo ออก แต่ถ้า byte ที่อ่านได้ไม่ใช่ echo
//  จะเก็บไว้ใน pending buffer เพื่อไม่ให้คำตอบของ ECU หาย
// ════════════════════════════════════════════════════════════

uint8_t pend[64];
int     pendHead = 0, pendTail = 0;

void klineFlushRx() {
  pendHead = pendTail = 0;
  while (KLine.available()) KLine.read();
}

int klineGetByte(uint32_t timeoutMs) {
  if (pendHead < pendTail) return pend[pendHead++];
  uint32_t start = millis();
  while ((millis() - start) < timeoutMs) {
    if (KLine.available()) return KLine.read();
    delay(1);
  }
  return -1;
}

void klineSend(const uint8_t* data, int len) {
  klineFlushRx();
  traceHex("TX", data, len);
  KLine.write(data, len);
  KLine.flush();
  // อ่าน echo กลับมา (ถ้า module ไม่ echo ก็จะ timeout แล้วไปต่อ)
  pendHead = pendTail = 0;
  for (int i = 0; i < len; i++) {
    int b = -1;
    uint32_t start = millis();
    while ((millis() - start) < 15) {
      if (KLine.available()) { b = KLine.read(); break; }
      delay(1);
    }
    if (b < 0) {                       // ไม่มี echo
      if (i == 0 && traceOn) elog("[K] no echo — เช็คสาย RX (GPIO16) / ไฟ 12V ของ module");
      return;
    }
    if (b != data[i]) {                // ไม่ใช่ echo → เป็นคำตอบ ECU เก็บไว้
      pend[pendTail++] = (uint8_t)b;
      while (KLine.available() && pendTail < (int)sizeof(pend)) pend[pendTail++] = KLine.read();
      return;
    }
  }
}

uint8_t sum8(const uint8_t* d, int len) {
  uint8_t s = 0;
  for (int i = 0; i < len; i++) s += d[i];
  return s;
}

// เปลี่ยน TX เป็น GPIO ชั่วคราวเพื่อทำ pulse (wakeup / fast init)
void txPulse(uint32_t idleHighMs, uint32_t lowMs, uint32_t highMs) {
  KLine.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(idleHighMs);
  digitalWrite(KLINE_TX_PIN, LOW);
  delay(lowMs);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(highMs);
  KLine.begin(KLINE_BAUD, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);
  klineFlushRx();
}

// ════════════════════════════════════════════════════════════
//  HONDA K-LINE (proprietary)
//  Frame: [type] [len รวมทั้ง frame] [data...] [cs]  ผลรวมทุก byte = 0x00
// ════════════════════════════════════════════════════════════

uint8_t hBuf[64];
int     hLen = 0;

void hondaSend(const uint8_t* body, int bodyLen) {
  uint8_t pkt[16];
  memcpy(pkt, body, bodyLen);
  pkt[bodyLen] = (uint8_t)(0x100 - sum8(body, bodyLen));
  klineSend(pkt, bodyLen + 1);
}

// อ่าน frame ตอบกลับ (ขึ้นต้น 0x02) ตรวจ checksum
bool hondaReadRaw(uint32_t timeoutMs) {
  hLen = 0;
  int b;
  uint32_t start = millis();
  do {                                   // ข้ามขยะจนเจอ 0x02
    b = klineGetByte(timeoutMs);
    if (b < 0) return false;
  } while (b != 0x02 && (millis() - start) < timeoutMs);
  if (b != 0x02) return false;
  hBuf[hLen++] = 0x02;
  b = klineGetByte(30);
  if (b < 3 || b > (int)sizeof(hBuf)) return false;
  int total = b;
  hBuf[hLen++] = (uint8_t)b;
  while (hLen < total) {
    b = klineGetByte(30);
    if (b < 0) return false;
    hBuf[hLen++] = (uint8_t)b;
  }
  return sum8(hBuf, hLen) == 0;
}

bool hondaRead(uint32_t timeoutMs) {
  bool ok = hondaReadRaw(timeoutMs);
  traceHex(ok ? "RX" : "RX-BAD", hBuf, hLen);
  return ok;
}

bool hondaInit() {
  setStatus("HONDA: wakeup");
  txPulse(300, 70, 130);
  const uint8_t wake[] = { 0xFE, 0x04, 0xFF, 0xFF };   // ไม่มีคำตอบ
  klineSend(wake, 4);
  delay(200);
  const uint8_t init[] = { 0x72, 0x05, 0x00, 0xF0 };   // + cs 0x99
  for (int attempt = 0; attempt < 2; attempt++) {
    hondaSend(init, 4);
    if (hondaRead(250) && hLen >= 4 && hBuf[2] == 0x00) {
      setRaw(hBuf, hLen);
      setStatus("HONDA: init OK (02 04 00 FA)");
      return true;
    }
    delay(100);
  }
  return false;
}

bool hondaReadTable(uint8_t table) {
  const uint8_t req[] = { 0x72, 0x05, 0x71, table };
  hondaSend(req, 4);
  if (!hondaRead(250)) return false;
  return hLen >= 5 && hBuf[2] == 0x71 && hBuf[3] == table;
}

bool hondaFindTable() {
  for (uint8_t i = 0; i < sizeof(HONDA_TABLES); i++) {
    uint8_t t = HONDA_TABLES[i];
    if (hondaReadTable(t) && hLen - 5 >= 8) {   // อย่างน้อย 8 byte ข้อมูล
      hondaTable = t;
      setRaw(hBuf, hLen);
      setStatus("HONDA: table %02X OK (%d bytes)", t, hLen - 5);
      return true;
    }
    elog("[HONDA] table %02X no answer", t);
    delay(POLL_INTERVAL_MS);
  }
  setStatus("HONDA: init OK แต่ไม่มีตารางที่ตอบ");
  return false;
}

// Layout ตาราง 0x10 / 0x11 (ข้อมูลหลัง "71 tt"):
//  0-1 RPM | 2 TPS volt | 3 TPS | 4 ECT volt | 5 ECT | 6 IAT volt | 7 IAT
//  8 MAP volt | 9 MAP kPa | 10-11 ? | 12 BATT x0.1V | 13 SPEED
//  14-15 INJ | 16 IGN | 17+ แตกต่างตามรุ่น
//  ค่า 0-13 ตรงกับข้อมูลชุมชน HondaECU, ค่า 14+ ยังเป็นค่าประมาณ
//  — ดู raw ใน log ของแอปเพื่อเทียบ
void hondaDecode() {
  const uint8_t* d = hBuf + 4;
  int n = hLen - 5;
  if (hondaTable != 0x10 && hondaTable != 0x11) {
    // ตารางอื่นยังไม่รู้ layout → ส่งเฉพาะ raw ให้ดูก่อน
    return;
  }
  SensorData s = sensorData;
  if (n > 1)  s.rpm     = (d[0] << 8) | d[1];
  if (n > 3)  s.tps     = constrain(d[3] / 1.6, 0.0, 100.0);
  if (n > 5)  s.ect     = (int16_t)d[5] - 40;
  if (n > 7)  s.iat     = (int16_t)d[7] - 40;
  if (n > 9)  s.map_kpa = d[9];
  if (n > 12) s.batt    = d[12] / 10.0;
  if (n > 13) s.speed   = d[13];
  if (n > 15) s.inj_ms  = ((d[14] << 8) | d[15]) * 0.004;
  if (n > 16) s.ign_adv = d[16] / 2.0 - 64.0;
  s.load = (s.rpm > 0) ? (uint8_t)min(100.0, s.tps * 0.6 + s.map_kpa * 0.4) : 0;
  portENTER_CRITICAL(&dataMux);
  sensorData = s;
  portEXIT_CRITICAL(&dataMux);
}

bool hondaPoll() {
  if (!hondaReadTable(hondaTable)) return false;
  setRaw(hBuf, hLen);
  hondaDecode();
  return true;
}

// ════════════════════════════════════════════════════════════
//  KWP2000 / ISO9141-2 (OBD-II style)
// ════════════════════════════════════════════════════════════

uint8_t kBuf[64];
int     kLen = 0;      // จำนวน byte ทั้ง frame
int     kData = 0;     // index เริ่มของ data (SID)
int     kDataLen = 0;

void kwpSend(const uint8_t* data, int len) {
  uint8_t pkt[16];
  int n = 0;
  if (isoMode) {
    pkt[n++] = 0x68; pkt[n++] = 0x6A; pkt[n++] = TESTER_ADDR;
  } else {
    pkt[n++] = kwpFormat | (uint8_t)len;
    pkt[n++] = kwpTarget;
    pkt[n++] = TESTER_ADDR;
  }
  memcpy(pkt + n, data, len); n += len;
  pkt[n] = sum8(pkt, n); n++;
  klineSend(pkt, n);
}

bool kwpReadRaw(uint32_t timeoutMs) {
  kLen = 0;
  int b = klineGetByte(timeoutMs);
  if (b < 0) return false;
  kBuf[kLen++] = (uint8_t)b;

  if (isoMode) {
    // ISO9141: ไม่มี length → อ่านจนเว้นช่วง > 20ms
    while (kLen < (int)sizeof(kBuf)) {
      b = klineGetByte(20);
      if (b < 0) break;
      kBuf[kLen++] = (uint8_t)b;
    }
    if (kLen < 5) return false;
    kData = 3; kDataLen = kLen - 4;
    return sum8(kBuf, kLen - 1) == kBuf[kLen - 1];
  }

  uint8_t fmt = kBuf[0];
  int len = fmt & 0x3F;
  int hdr = 1;
  if (fmt & 0x80) {                   // มี target + source
    for (int i = 0; i < 2; i++) {
      b = klineGetByte(30); if (b < 0) return false;
      kBuf[kLen++] = (uint8_t)b;
    }
    hdr = 3;
  }
  if (len == 0) {                     // length byte แยก
    b = klineGetByte(30); if (b < 0) return false;
    kBuf[kLen++] = (uint8_t)b;
    len = b; hdr++;
  }
  if (hdr + len + 1 > (int)sizeof(kBuf)) return false;
  for (int i = 0; i < len + 1; i++) {
    b = klineGetByte(30); if (b < 0) return false;
    kBuf[kLen++] = (uint8_t)b;
  }
  kData = hdr; kDataLen = len;
  return sum8(kBuf, kLen - 1) == kBuf[kLen - 1];
}

bool kwpRead(uint32_t timeoutMs) {
  bool ok = kwpReadRaw(timeoutMs);
  traceHex(ok ? "RX" : "RX-BAD", kBuf, kLen);
  return ok;
}

// ส่ง request แล้วรอคำตอบที่ SID ตรง (ข้าม 7F xx 78 = response pending)
bool kwpRequest(const uint8_t* req, int len, uint8_t expectSid) {
  kwpSend(req, len);
  uint32_t start = millis();
  while ((millis() - start) < 1000) {
    if (!kwpRead(300)) return false;
    if (kBuf[kData] == expectSid) { setRaw(kBuf, kLen); return true; }
    if (kBuf[kData] == 0x7F && kDataLen >= 3 && kBuf[kData + 2] == 0x78) continue;
    return false;
  }
  return false;
}

bool kwpFastInit(uint8_t format, uint8_t target) {
  setStatus("KWP fast init %02X %02X F1", format | 1, target);
  isoMode   = false;
  kwpFormat = format;
  kwpTarget = target;
  txPulse(300, 25, 25);                 // W5 idle ≥300ms, Tini 25ms LOW / 25ms HIGH
  const uint8_t sc[] = { 0x81 };        // StartCommunication
  if (kwpRequest(sc, 1, 0xC1)) {
    setStatus("KWP fast init OK (%02X)", target);
    delay(POLL_INTERVAL_MS);
    return true;
  }
  return false;
}

// 5-baud slow init ที่ address 0x33 แล้วดู keyword ว่าเป็น ISO9141 หรือ KWP
bool slowInit5Baud() {
  setStatus("5-baud slow init 0x33");
  KLine.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300);
  const uint8_t addr = 0x33;
  digitalWrite(KLINE_TX_PIN, LOW); delay(200);          // start bit
  for (int i = 0; i < 8; i++) {                         // data LSB first
    digitalWrite(KLINE_TX_PIN, (addr >> i) & 1 ? HIGH : LOW);
    delay(200);
  }
  digitalWrite(KLINE_TX_PIN, HIGH);                     // stop bit
  KLine.begin(KLINE_BAUD, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);
  klineFlushRx();
  delay(5);

  int sync = -1;
  uint32_t start = millis();
  while ((millis() - start) < 500) {                    // W1 ≤ 300ms + margin
    int b = klineGetByte(10);
    if (b == 0x55) { sync = b; break; }
  }
  if (sync != 0x55) return false;
  int kw1 = klineGetByte(50);
  int kw2 = klineGetByte(50);
  if (kw1 < 0 || kw2 < 0) return false;
  delay(30);                                            // W4 25–50ms
  uint8_t inv = ~(uint8_t)kw2;
  klineSend(&inv, 1);
  int ack = klineGetByte(100);                          // ควรได้ ~0x33 = 0xCC
  elog("[SLOW] KW1=%02X KW2=%02X ACK=%02X", kw1, kw2, ack);
  if (ack != 0xCC) return false;

  // KW2 = 0x8F → KWP2000 slow, ไม่งั้นเป็น ISO9141-2
  isoMode   = (kw2 != 0x8F);
  kwpFormat = 0xC0;
  kwpTarget = 0x33;
  setStatus("slow init OK (%s KW %02X %02X)", isoMode ? "ISO9141" : "KWP", kw1, kw2);
  delay(POLL_INTERVAL_MS);
  return true;
}

// ยืนยันว่าคุยได้จริงด้วย 01 00 (supported PIDs)
bool obdVerify() {
  const uint8_t req[] = { 0x01, 0x00 };
  if (kwpRequest(req, 2, 0x41)) return true;
  // บางกล่องไม่ตอบ 0100 แต่ตอบ RPM
  delay(POLL_INTERVAL_MS);
  const uint8_t req2[] = { 0x01, 0x0C };
  return kwpRequest(req2, 2, 0x41);
}

const uint8_t OBD_PIDS[] = { 0x0D, 0x11, 0x05, 0x0F, 0x0B, 0x0E, 0x42, 0x14, 0x06, 0x07, 0x04 };
uint8_t obdIdx = 0;
bool    obdRpmTurn = true;

bool obdPoll() {
  // RPM ทุกรอบสลับกับ PID อื่น
  uint8_t pid = obdRpmTurn ? 0x0C : OBD_PIDS[obdIdx];
  if (!obdRpmTurn) obdIdx = (obdIdx + 1) % sizeof(OBD_PIDS);
  obdRpmTurn = !obdRpmTurn;

  const uint8_t req[] = { 0x01, pid };
  if (!kwpRequest(req, 2, 0x41)) return false;
  if (kDataLen < 3 || kBuf[kData + 1] != pid) return true;   // ตอบแต่ไม่ใช่ PID นี้
  const uint8_t* d = kBuf + kData + 2;
  int n = kDataLen - 2;
  SensorData s = sensorData;
  switch (pid) {
    case 0x0C: if (n >= 2) s.rpm = ((d[0] << 8) | d[1]) / 4; break;
    case 0x0D: s.speed   = d[0]; break;
    case 0x11: s.tps     = d[0] * 100.0 / 255.0; break;
    case 0x05: s.ect     = (int16_t)d[0] - 40; break;
    case 0x0F: s.iat     = (int16_t)d[0] - 40; break;
    case 0x0B: s.map_kpa = d[0]; break;
    case 0x0E: s.ign_adv = d[0] / 2.0 - 64.0; break;
    case 0x42: if (n >= 2) s.batt = ((d[0] << 8) | d[1]) / 1000.0; break;
    case 0x14: s.o2v     = d[0] / 200.0;
               s.afr     = constrain(14.7 + (0.45 - s.o2v) * 11.0, 10.0, 20.0); break;
    case 0x06: s.stft    = (d[0] - 128) * 100.0 / 128.0; break;
    case 0x07: s.ltft    = (d[0] - 128) * 100.0 / 128.0; break;
    case 0x04: s.load    = d[0] * 100 / 255; break;
  }
  portENTER_CRITICAL(&dataMux);
  sensorData = s;
  portEXIT_CRITICAL(&dataMux);
  return true;
}

// ════════════════════════════════════════════════════════════
//  AUTO-SCAN
// ════════════════════════════════════════════════════════════

bool tryProto(uint8_t p) {
  switch (p) {
    case P_HONDA:   return hondaInit() && hondaFindTable();
    case P_KWP_F12: return kwpFastInit(0x80, 0x12) && obdVerify();
    case P_KWP_F11: return kwpFastInit(0x80, 0x11) && obdVerify();
    case P_KWP_F33: return kwpFastInit(0xC0, 0x33) && obdVerify();
    case P_SLOW_33: return slowInit5Baud() && obdVerify();
  }
  return false;
}

bool pollActive() {
  return (activeProto == P_HONDA) ? hondaPoll() : obdPoll();
}

int8_t loadSavedProto() {
  prefs.begin("kline", true);
  int8_t p = prefs.getChar("proto", -1);
  prefs.end();
  return (p >= 0 && p < P_COUNT) ? p : -1;
}

void saveProto(int8_t p) {
  prefs.begin("kline", false);
  prefs.putChar("proto", p);
  prefs.end();
}

// สแกนทีละโปรโตคอล คืน true ถ้าเจอ
bool autoScan() {
  int8_t saved = loadSavedProto();
  uint8_t order[P_COUNT];
  uint8_t n = 0;
  if (cmdForceProto >= 0) {
    order[n++] = cmdForceProto;
  } else {
    if (saved >= 0) order[n++] = saved;
    for (uint8_t p = 0; p < P_COUNT; p++) if (p != saved) order[n++] = p;
  }

  for (uint8_t i = 0; i < n; i++) {
    if (!bleConnected || cmdRescan) return false;
    uint8_t p = order[i];
    setStatus("trying %s (%d/%d)", PROTO_NAMES[p], i + 1, n);
    if (tryProto(p)) {
      activeProto = p;
      if (p != saved) saveProto(p);
      setStatus("FOUND %s%s", PROTO_NAMES[p],
                p == P_HONDA ? (hondaTable == 0x11 ? " T11" : hondaTable == 0x10 ? " T10" : " Tx") : "");
      return true;
    }
    delay(300);  // ให้ ECU กลับสู่ idle ก่อนลองแบบต่อไป
  }
  setStatus("no ECU answer — เปิดกุญแจ/เช็คสาย K-line");
  return false;
}

// ════════════════════════════════════════════════════════════
//  K-LINE TASK (แยกจาก BLE เพื่อไม่ให้การ init บล็อกการส่งข้อมูล)
// ════════════════════════════════════════════════════════════

void klineTask(void*) {
  for (;;) {
    if (!bleConnected) {
      ecuInitialized = false;
      ecuResponding  = false;
      delay(100);
      continue;
    }

    if (cmdRescan) {
      cmdRescan = false;
      cmdForceProto = -1;
      prefs.begin("kline", false); prefs.remove("proto"); prefs.end();
      ecuInitialized = false;
    }

    if (!ecuInitialized) {
      ecuResponding = false;
      if (autoScan()) {
        ecuInitialized = true;
        ecuResponding  = true;
        failCount = 0;
        cmdForceProto = -1;
      } else {
        delay(SCAN_PAUSE_MS);
      }
      continue;
    }

    static uint16_t pollN = 0;
    traceOn = (++pollN % 50 == 0);       // ตอน poll ปกติ log hex แค่ 1 ใน 50 frame
    bool ok = pollActive();
    traceOn = true;
    if (ok) {
      failCount = 0;
      ecuResponding = true;
    } else if (++failCount >= MAX_FAILS_BEFORE_REINIT) {
      setStatus("ECU หยุดตอบ %d ครั้ง — init ใหม่", failCount);
      ecuInitialized = false;
      ecuResponding  = false;
    }
    delay(POLL_INTERVAL_MS);
  }
}

// ════════════════════════════════════════════════════════════
//  BUILD & SEND BLE JSON PAYLOAD
// ════════════════════════════════════════════════════════════

// แบ่งเป็น chunk ตาม MTU — iOS (Bluefy) มัก MTU 185 → ส่งได้ 182 byte/ครั้ง
// แอปต่อ chunk กลับเองด้วยการนับวงเล็บ { }
uint16_t notifyJson(const String& json) {
  uint16_t mtu = pServer ? pServer->getPeerMTU(lastConnId) : 23;
  int chunk = (mtu > 23 ? mtu : 23) - 3;
  if (chunk > 500) chunk = 500;
  const char* p = json.c_str();
  int left = json.length();
  while (left > 0) {
    int n = left > chunk ? chunk : left;
    pCharacteristic->setValue((uint8_t*)p, n);
    pCharacteristic->notify();
    p += n; left -= n;
    if (left > 0) delay(5);
  }
  return mtu;
}

void sendBLELogs() {
  if (!bleConnected || !pCharacteristic) return;
  char line[LOG_LEN];
  for (int i = 0; i < 4 && popLog(line); i++) {
    JsonDocument doc;
    doc["type"] = "KLINE_LOG";
    doc["t"]    = millis();
    doc["msg"]  = line;
    String json;
    serializeJson(doc, json);
    notifyJson(json);
    delay(5);
  }
}

void sendBLEData() {
  if (!bleConnected || !pCharacteristic) return;

  SensorData s;
  char st[128], raw[100];
  portENTER_CRITICAL(&dataMux);
  s = sensorData;
  strcpy(st, statusText);
  strcpy(raw, rawHex);
  portEXIT_CRITICAL(&dataMux);

  JsonDocument doc;
  doc["type"]     = "KLINE_DATA";
  doc["rpm"]      = s.rpm;
  doc["speed"]    = s.speed;
  doc["tps"]      = round(s.tps * 10.0) / 10.0;
  doc["eot"]      = s.ect;
  doc["iat"]      = s.iat;
  doc["map"]      = s.map_kpa;
  doc["batt"]     = round(s.batt * 10.0) / 10.0;
  doc["inj"]      = round(s.inj_ms * 100.0) / 100.0;
  doc["igt"]      = round(s.ign_adv * 10.0) / 10.0;
  doc["o2"]       = round(s.o2v * 100.0) / 100.0;
  doc["afr"]      = round(s.afr * 10.0) / 10.0;
  doc["stft"]     = round(s.stft * 10.0) / 10.0;
  doc["ltft"]     = round(s.ltft * 10.0) / 10.0;
  doc["load"]     = s.load;
  doc["duty"]     = round(s.duty * 10.0) / 10.0;
  doc["boxCode"]  = "";
  doc["flashOk"]  = (bool)(ecuInitialized && ecuResponding);
  doc["ecuOk"]    = (bool)ecuResponding;
  doc["proto"]    = activeProto >= 0 && ecuInitialized ? PROTO_NAMES[activeProto] : "SCANNING";
  if (activeProto == P_HONDA && ecuInitialized) {
    char t[3]; sprintf(t, "%02X", hondaTable);
    doc["tbl"] = t;
  }
  doc["scan"]     = st;
  doc["raw"]      = raw;

  String json;
  serializeJson(doc, json);

  uint16_t mtu = notifyJson(json);

  static uint8_t printCounter = 0;
  if (++printCounter % 10 == 0) {
    Serial.printf("[BLE TX] mtu=%d proto=%s RPM=%d TPS=%.1f ECT=%d | %s\n",
                  mtu, doc["proto"].as<const char*>(), s.rpm, s.tps, s.ect, st);
  }
}

// ════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("╔═══════════════════════════════════════╗");
  Serial.println("║  SG K-Line BLE Bridge v2.1 AUTO-SCAN  ║");
  Serial.println("║  Honda PCX150 / PCX160                ║");
  Serial.println("╚═══════════════════════════════════════╝");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  KLine.begin(KLINE_BAUD, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);
  Serial.printf("[K-Line] Serial2 @ %d baud (RX=%d, TX=%d)\n", KLINE_BAUD, KLINE_RX_PIN, KLINE_TX_PIN);
  int8_t saved = loadSavedProto();
  Serial.printf("[K-Line] saved protocol: %s\n", saved >= 0 ? PROTO_NAMES[saved] : "(none)");

  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(512);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(serviceUUID);
  pCharacteristic = pService->createCharacteristic(
    charUUID,
    BLECharacteristic::PROPERTY_READ    |
    BLECharacteristic::PROPERTY_WRITE   |
    BLECharacteristic::PROPERTY_WRITE_NR |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharCallbacks());
  pCharacteristic->setValue("SG-KLINE Ready");
  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(serviceUUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] ✓ Advertising as \"%s\" (FFE0/FFE1)\n", BLE_DEVICE_NAME);

  // K-line ทำงานใน task แยก → loop() ส่ง BLE ได้ตลอดแม้ระหว่างสแกน
  xTaskCreatePinnedToCore(klineTask, "kline", 6144, nullptr, 1, nullptr, 1);

  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH); delay(150);
    digitalWrite(LED_PIN, LOW);  delay(150);
  }
  Serial.println("[READY] เปิดกุญแจรถ แล้วกด SCAN & CONNECT ในแอป (โหมด PVX150)");
}

// ════════════════════════════════════════════════════════════
//  MAIN LOOP (BLE เท่านั้น)
// ════════════════════════════════════════════════════════════

uint32_t lastBLETxTime = 0;
uint32_t lastLogTxTime = 0;

void loop() {
  uint32_t now = millis();

  if (bleConnected != oldBleConnected) {
    oldBleConnected = bleConnected;
    elog(bleConnected ? "[BLE] ★ connected — start auto-scan (fw v2.1)" : "[BLE] disconnected");
    if (bleConnected) {
      int8_t sp = loadSavedProto();
      elog("[INFO] saved protocol: %s", sp >= 0 ? PROTO_NAMES[sp] : "(none)");
    }
  }

  if (bleConnected && (now - lastBLETxTime) >= BLE_TX_INTERVAL_MS) {
    lastBLETxTime = now;
    sendBLEData();
  }

  if (bleConnected && (now - lastLogTxTime) >= 50) {
    lastLogTxTime = now;
    sendBLELogs();
  }

  // LED: กระพริบเร็ว = อ่าน ECU ได้, ช้า = BLE ต่อแล้วแต่กำลังสแกน, แว้บ = รอ BLE
  if (ecuInitialized && ecuResponding)  digitalWrite(LED_PIN, (now % 500) < 250 ? HIGH : LOW);
  else if (bleConnected)                digitalWrite(LED_PIN, (now % 2000) < 1000 ? HIGH : LOW);
  else                                  digitalWrite(LED_PIN, (now % 4000) < 200 ? HIGH : LOW);

  delay(5);
}
