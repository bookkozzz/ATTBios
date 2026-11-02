(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ATBBTuneCore=api;})(globalThis,()=>{
'use strict';
const TYPES={u8:[1,false],s8:[1,true],u16:[2,false],s16:[2,true],u32:[4,false],s32:[4,true]};
function spec(entry,length){
 if(!entry||entry.verified!==true)throw Error('ยังไม่ยืนยันตำแหน่งตาราง');
 const t=TYPES[entry.type];if(!t)throw Error('ชนิดข้อมูลไม่รองรับ');
 const rows=entry.rows,cols=entry.cols;
 if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(cols)||rows<1||cols<1||rows*cols>65536)throw Error('ขนาดตารางไม่ถูกต้อง');
 if(!Number.isSafeInteger(entry.address)||entry.address<0||entry.address+rows*cols*t[0]>length)throw Error('ตำแหน่งตารางอยู่นอกไฟล์');
 if(t[0]>1&&!['le','be'].includes(entry.endian))throw Error('ไม่ทราบ byte order');
 if(!Number.isFinite(entry.scale)||entry.scale===0||!Number.isFinite(entry.offset))throw Error('สูตรแปลงค่าไม่ถูกต้อง');
 if(!Number.isFinite(entry.min)||!Number.isFinite(entry.max)||entry.min>entry.max)throw Error('ขอบเขตค่าไม่ถูกต้อง');
 return {bytes:t[0],signed:t[1],rows,cols};
}
class Editor{
 constructor(buffer,profile,sourceHash){
  if(!(buffer instanceof ArrayBuffer))throw Error('ต้องใช้ ArrayBuffer');
  if(!profile||profile.sourceSha256!==sourceHash||!Number.isSafeInteger(profile.romSize)||profile.romSize!==buffer.byteLength)throw Error('โปรไฟล์ไม่ตรงกับ ROM');
  this.profile=profile;this.original=buffer.slice(0);this.buffer=buffer.slice(0);this.undoStack=[];
 }
 entry(id){const e=this.profile.entries.find(e=>e.id===id);spec(e,this.buffer.byteLength);return e;}
 position(e,r,c){const s=spec(e,this.buffer.byteLength);if(!Number.isInteger(r)||!Number.isInteger(c)||r<0||c<0||r>=s.rows||c>=s.cols)throw Error('ช่องตารางไม่ถูกต้อง');return e.address+(r*s.cols+c)*s.bytes;}
 raw(e,r,c){const v=new DataView(this.buffer),p=this.position(e,r,c),s=spec(e,this.buffer.byteLength);return v[`get${s.signed?'Int':'Uint'}${s.bytes*8}`](p,e.endian==='le');}
 read(id,r,c){const e=this.entry(id);return this.raw(e,r,c)*e.scale+e.offset;}
 write(id,r,c,value){
  const e=this.entry(id),s=spec(e,this.buffer.byteLength),p=this.position(e,r,c);
  if(e.readOnly===true)throw Error('ตารางนี้อ่านอย่างเดียว');
  if(!Number.isFinite(value)||value<e.min||value>e.max)throw Error(`ค่าต้องอยู่ระหว่าง ${e.min}–${e.max}`);
  const scaled=(value-e.offset)/e.scale,raw=Math.round(scaled),bits=s.bytes*8,min=s.signed?-(2**(bits-1)):0,max=s.signed?2**(bits-1)-1:2**bits-1;
  if(!Number.isFinite(raw)||raw<min||raw>max)throw Error('ค่าเกินขนาดข้อมูล');
  const actual=raw*e.scale+e.offset;if(actual<e.min||actual>e.max)throw Error('ค่าหลังแปลงเกินขอบเขตตาราง');
  const before=new Uint8Array(this.buffer.slice(p,p+s.bytes));
  new DataView(this.buffer)[`set${s.signed?'Int':'Uint'}${bits}`](p,raw,e.endian==='le');
  this.undoStack.push({p,before});return raw*e.scale+e.offset;
 }
 undo(){const change=this.undoStack.pop();if(change)new Uint8Array(this.buffer).set(change.before,change.p);}
 diff(){const a=new Uint8Array(this.original),b=new Uint8Array(this.buffer),result=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])result.push({offset:i,before:a[i],after:b[i]});return result;}
}
function preflight({profile,identity,sha256,size,telemetry,now,checksumVerified,stagedSha256,capabilities}){
 const reasons=[];
 if(!profile?.flashVerified)reasons.push('ไม่มีโปรไฟล์เขียน ECU ที่ผ่านการยืนยัน');
 if(!identity?.verified||!identity.code||!identity.firmware||!identity.baseSha256)reasons.push('ยังไม่ยืนยันตัวตน ECU และ ROM เดิม');
 if(profile?.code!==identity?.code||profile?.firmware!==identity?.firmware||profile?.sourceSha256!==identity?.baseSha256)reasons.push('ECU หรือเวอร์ชันเฟิร์มแวร์ไม่ตรง');
 if(size!==profile?.romSize)reasons.push('ขนาด ROM ไม่ตรง');
 if(!/^[a-f0-9]{64}$/.test(sha256||'')||sha256!==stagedSha256)reasons.push('ไฟล์ใน ESP32 ยังไม่ตรงกับไฟล์ที่เลือก');
 if(checksumVerified!==true)reasons.push('ยังไม่ผ่านการตรวจ checksum');
 if(!telemetry||telemetry.ecuOk!==true||!Number.isFinite(telemetry.at)||!Number.isFinite(now)||now-telemetry.at>2000||now<telemetry.at)reasons.push('ข้อมูล ECU หมดอายุ');
 if(!Number.isFinite(telemetry?.rpm)||telemetry.rpm!==0)reasons.push('ต้องดับเครื่องยนต์');
 if(!Number.isFinite(profile?.minVoltage)||!Number.isFinite(profile?.maxVoltage)||!Number.isFinite(telemetry?.batt)||telemetry.batt<profile.minVoltage||telemetry.batt>profile.maxVoltage)reasons.push('แรงดันไฟไม่ผ่านเกณฑ์ของโปรไฟล์');
 if(capabilities?.ecuWrite!==true||capabilities?.autonomousWrite!==true)reasons.push('เฟิร์มแวร์ไม่รองรับการเขียน ECU แบบทำงานเอง');
 return {ok:reasons.length===0,reasons};
}
return {Editor,spec,preflight};
});
