(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ATBBTransfer=api;})(globalThis,()=>{
'use strict';
class Client {
 constructor(send,{timeout=8000,onProgress=()=>{},onState=()=>{}}={}){this.send=send;this.timeout=timeout;this.onProgress=onProgress;this.onState=onState;this.pending=new Map();this.serial=0;this.busy=false;this.paused=false;this.fragmentSerial=Promise.resolve();}
 receive(d){if(d?.type!=='TUNE_REPLY'||!Number.isSafeInteger(d.id))return;const p=this.pending.get(d.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(d.id);if(d.ok!==true)p.reject(Error(d.error||'ESP32 ปฏิเสธคำสั่ง'));else p.resolve(d);}
 disconnect(){this.paused=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('BLE หลุด · เชื่อมต่อแล้วกดส่งต่อ'));}this.pending.clear();this.onState('PAUSED');}
 request(op,fields={}){
  const id=++this.serial,frame='T2:'+JSON.stringify({id,op,...fields})+'\n';
  if(frame.length>700)return Promise.reject(Error('คำสั่งเกินขนาดที่กำหนด'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('ไม่ได้รับ ACK · กดตรวจสถานะหรือส่งต่อหลังเชื่อมต่อ'));},this.timeout);
   this.pending.set(id,{resolve,reject,timer});
   const emit=async()=>{for(let i=0;i<frame.length;i+=18){if(!this.pending.has(id))throw Error('ยกเลิกคำสั่ง');await this.send(new TextEncoder().encode(frame.slice(i,i+18)));}};
   this.fragmentSerial=this.fragmentSerial.catch(()=>{}).then(emit);
   this.fragmentSerial.catch(error=>{if(this.pending.has(id)){clearTimeout(timer);this.pending.delete(id);reject(error);}});
  });
 }
 async upload({buffer,sha256,code}){
  if(this.busy)throw Error('มีงานส่งไฟล์อยู่แล้ว');
  if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength||!/^[a-f0-9]{64}$/.test(sha256))throw Error('ข้อมูลไฟล์ไม่ถูกต้อง');
  this.busy=true;this.paused=false;
  try {
   const caps=await this.request('CAPS');
   if(caps.protocol!==2||caps.staging!==true)throw Error('ต้องใช้เฟิร์มแวร์ ESP32 ATBB v2 สำหรับเก็บไฟล์');
   if(buffer.byteLength>caps.maxImage)throw Error('ไฟล์ใหญ่เกินพื้นที่ ESP32');
   const begin=await this.request('BEGIN',{job:sha256,sha256,code,size:buffer.byteLength});
   let offset=begin.offset;
   if(!Number.isSafeInteger(offset)||offset<0||offset>buffer.byteLength)throw Error('ESP32 แจ้งตำแหน่งไฟล์ไม่ถูกต้อง');
   const bytes=new Uint8Array(buffer);this.onState('UPLOADING');this.onProgress(offset,bytes.length);
   while(offset<bytes.length){
    if(this.paused)throw Error('พักส่งไฟล์แล้ว · กดส่งต่อได้หลังเชื่อมต่อ');
    const block=bytes.slice(offset,offset+96),hex=[...block].map(v=>v.toString(16).padStart(2,'0')).join('');
    const reply=await this.request('BLOCK',{job:sha256,offset,hex});
    if(reply.offset!==offset+block.length)throw Error('ACK ตำแหน่งไฟล์ไม่ตรง');
    offset=reply.offset;this.onProgress(offset,bytes.length);
   }
   if(this.paused)throw Error('พักส่งไฟล์ก่อนตรวจ hash');
   this.onState('VERIFYING');const verified=await this.request('VERIFY',{job:sha256});
   if(verified.state!=='STAGED_UNVERIFIED'||verified.sha256!==sha256||verified.offset!==bytes.length)throw Error('ตรวจ SHA-256 ไฟล์ใน ESP32 ไม่ผ่าน');
   this.onState('STAGED_UNVERIFIED');return verified;
  }catch(error){this.onState('PAUSED');throw error;}finally{this.busy=false;}
 }
 pause(){this.paused=true;}
}
return {Client};
});
