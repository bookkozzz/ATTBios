/* ATBB v2 library. No ECU write commands are implemented or implied. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const allowed = ['30400-K50A-T02','30400-K96-V01','30400-K97A-U01','30400-K97G-N01','30400-K97G-N31','30400-K97F-T01'];
const SAMPLE = {code:'30400-K97F-T01',binName:'30400-K97F-T01.bin',binUrl:'ecu-library/30400-K97F-T01.bin',binHash:'9675900f6bfb8f80b56f3d3fac20bac8c892810dd236905c5011de8fc7df508c',xdfName:'PCX150-30400-K97F-T01unlock.xdf',xdfUrl:'ecu-library/PCX150-30400-K97F-T01unlock.xdf',xdfHash:'52442c2750d000f2c87fb194aba8c38b6cffbc4ab1714cdda81905a0cba2e6d3'};
const LOCKED_XDF = '574bf0403ec18b83e51f19ca6d481ab2e044476b83d8c827b65046a4fff39e7d';
const SEED_KEY = 'atbb-v2-sample-seeded';
const MAX_FILE = 16 * 1024 * 1024;
let db, records = [], selected, lastData = null, lastAt = 0, editing = null, filter = '';
const message = (text, tone = '') => { const el = $('tune-message'); el.textContent = text; el.dataset.tone = tone; };
const size = n => `${n.toLocaleString()} bytes · ${(n / 1024).toFixed(2)} KiB`;
const when = t => t ? new Date(t).toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'}) : '—';
const store = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch {} } };
function tx(mode, action) {
 return new Promise((resolve,reject) => {
  const transaction = db.transaction('files',mode);
  const request = action(transaction.objectStore('files'));
  transaction.oncomplete = () => resolve(request.result);
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('บันทึกไฟล์ไม่สำเร็จ'));
 });
}
async function digest(buffer) {
 if (!globalThis.crypto?.subtle) throw new Error('ต้องเปิดผ่าน localhost หรือ HTTPS เพื่อคำนวณ SHA-256');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function record(code,binName,bin,xdfName,xdf,extra={}) {
 const hash = await digest(bin), xdfHash = await digest(xdf), now = Date.now();
 return {id:`${code}:${hash}:${xdfHash}`,code,binName,bin,xdfName,xdf,hash,xdfHash,label:'',note:'',createdAt:now,updatedAt:now,...extra};
}
const profileMatch = r => r?.code === SAMPLE.code && (r.hash === SAMPLE.binHash || r.baseHash === SAMPLE.binHash) && r.xdfHash === SAMPLE.xdfHash;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function row(parent,label,value,mono=false) {
 const p = el('p','tune-kv'); p.append(el('span','',label), el(mono ? 'code' : 'b','',value)); parent.append(p);
}
function updateLink() {
 const live = lastData?.ecuOk === true && Date.now()-lastAt < 3000;
 const code = live && typeof lastData.boxCode === 'string' ? lastData.boxCode.trim().toUpperCase() : '';
 $('tune-ecu').textContent = code || (live ? 'เชื่อมต่อแล้ว · เฟิร์มแวร์ยังไม่ส่งรหัส ECU' : 'ยังไม่ได้รับรหัส ECU');
 $('tune-link').textContent = live ? 'ได้รับข้อมูลสด · ไม่ได้ยืนยันสิทธิ์เขียน' : 'ยังไม่เชื่อมต่อ / ข้อมูลหมดอายุ';
 $('tune-live-state').textContent = live ? 'LIVE' : 'ไม่มีข้อมูลสด';
 $('tune-live-state').classList.toggle('on', live);
 $('tune-match').textContent = !live || !code ? 'ยังไม่ยืนยัน' : code !== selected?.code ? 'รหัส ECU ไม่ตรงกับชุดไฟล์' : 'รหัสตรง · ยังไม่ยืนยันเวอร์ชันเฟิร์มแวร์';
 for (const key of ['rpm','tps','batt','inj','igt','afr']) {
  const value = lastData?.[key];
  $('tune-value-'+key).textContent = live && typeof value==='number' && Number.isFinite(value) ? String(value) : '—';
 }
}
function definitions(buffer) {
 const bytes = new Uint8Array(buffer);
 // Only identify text XML. Binary/protected formats remain unsupported.
 const text = bytes[0]===255 && bytes[1]===254 ? new TextDecoder('utf-16le').decode(buffer) : new TextDecoder().decode(buffer);
 if (!text.trimStart().replace(/^﻿/,'').startsWith('<')) return {error:'XDF นี้เป็นข้อมูลไบนารีหรือรูปแบบที่ยังไม่รองรับ เก็บไฟล์ได้ แต่ยังเปิดตารางหรือแก้แมปไม่ได้'};
 const doc = new DOMParser().parseFromString(text,'application/xml');
 if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'XDFFORMAT') return {error:'ยังไม่รองรับโครงสร้าง XDF นี้'};
 return {tables:[...doc.querySelectorAll('XDFTABLE,XDFCONSTANT,XDFFLAG')].map(el=>({name:el.querySelector('title')?.textContent || 'ไม่มีชื่อ',kind:el.tagName,addresses:[...el.querySelectorAll('EMBEDDEDDATA')].map(d=>d.getAttribute('mmedaddress')).filter(Boolean)}))};
}
function renderList() {
 const list = $('tune-library'); list.replaceChildren();
 const q = filter.trim().toLowerCase();
 const shown = records.filter(r => !q || [r.code,r.label,r.binName,r.xdfName,r.note,r.hash.slice(0,10)].join(' ').toLowerCase().includes(q));
 $('tune-count').textContent = records.length;
 $('tune-empty').hidden = records.length > 0;
 for (const r of shown) {
  const item = el('div','tune-item'); item.setAttribute('role','option'); item.dataset.id = r.id;
  item.setAttribute('aria-selected', String(r === selected)); item.tabIndex = 0;
  const main = el('button','tune-item-main'); main.type = 'button';
  const top = el('span','tune-item-top'); top.append(el('strong','',r.code));
  if (r.status === 'ready') top.append(el('em','tune-chip flash','⚡ รอแฟลช'));
  if (profileMatch(r)) top.append(el('em','tune-chip ok','โปรไฟล์ตรง'));
  else if (r.xdfHash === LOCKED_XDF) top.append(el('em','tune-chip warn','XDF ล็อก'));
  main.append(top);
  if (r.label) main.append(el('span','tune-item-label',r.label));
  main.append(el('span','tune-item-files',`${r.binName} · ${r.xdfName}`));
  main.append(el('span','tune-item-meta',`${(r.bin.byteLength/1024).toFixed(0)} KiB · ${r.hash.slice(0,10)} · แก้ไข ${when(r.updatedAt)}`));
  main.onclick = () => select(r.id);
  const tools = el('span','tune-item-tools');
  const edit = el('button','tune-icon','✎'); edit.type='button'; edit.title='แก้ไข / อัปเดตไฟล์'; edit.setAttribute('aria-label',`แก้ไข ${r.code}`); edit.onclick = () => openDialog(r);
  const del = el('button','tune-icon danger','🗑'); del.type='button'; del.title='ลบชุดไฟล์'; del.setAttribute('aria-label',`ลบ ${r.code}`); del.onclick = () => remove(r);
  tools.append(edit,del); item.append(main,tools);
  item.onkeydown = e => { if (e.target===item && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); select(r.id); } };
  list.append(item);
 }
 if (records.length && !shown.length) list.append(el('p','tune-empty','ไม่พบชุดไฟล์ที่ค้นหา'));
}
function render() {
 $('tune-files').replaceChildren(); $('tune-tables').replaceChildren(); $('tune-hex').textContent='';
 for (const id of ['tune-original','tune-xdf','tune-edit','tune-edit-file','tune-delete-file']) $(id).disabled = !selected;
 renderList();
 if (!selected) { $('tune-detail-heading').textContent='—'; $('tune-definition').textContent='เพิ่มชุดไฟล์เพื่อเริ่ม'; $('tune-files').append(el('p','tune-note','ยังไม่ได้เลือกชุดไฟล์')); updateLink(); return; }
 const r=selected, files=$('tune-files');
 window.dispatchEvent(new CustomEvent("atbb:file-selected",{detail:r}));
 $('tune-detail-heading').textContent = r.label ? `${r.code} · ${r.label}` : r.code;
 row(files,'รุ่นที่ระบุในคลัง',`${r.code} · Shindengen / PCX150`);
 row(files,'BIN',`${r.binName} · ${size(r.bin.byteLength)}`);
 row(files,'SHA-256 BIN',r.hash,true);
 row(files,'XDF',`${r.xdfName} · ${size(r.xdf.byteLength)}`);
 row(files,'SHA-256 XDF',r.xdfHash,true);
 if (r.baseHash) { const parent = records.find(x=>x.id===r.parentId); row(files,'แก้จาก',`${parent ? (parent.label||parent.code)+' · '+parent.binName : 'ไฟล์ต้นทาง (ถูกลบจากคลังแล้ว)'} · ต่างจากต้นฉบับ ${(r.baseDiffOffsets||[]).length.toLocaleString()} bytes`); row(files,'สถานะแฟลช', r.status==='ready' ? 'รอแฟลช · checksum ยังไม่ได้คำนวณ (ยังห้ามแฟลชด้วยเครื่องมืออื่น)' : '—'); }
 row(files,'เพิ่มเมื่อ / แก้ล่าสุด',`${when(r.createdAt)} · ${when(r.updatedAt)}`);
 if (r.note) row(files,'โน้ต',r.note);
 row(files,'สถานะไฟล์','ยังไม่ยืนยันว่าเป็นไฟล์โรงงาน · checksum และการจับคู่ ECU ยังไม่ผ่านการตรวจสอบ');
 const data = new Uint8Array(r.bin), lines=[];
 for(let i=0;i<Math.min(128,data.length);i+=16) lines.push(i.toString(16).padStart(6,'0')+'  '+[...data.slice(i,i+16)].map(v=>v.toString(16).padStart(2,'0')).join(' '));
 $('tune-hex').textContent=lines.join('\n');
 const def=definitions(r.xdf);
 if(r.xdfHash===LOCKED_XDF) def.error='XDF ไบนารีนี้เปิดได้ใน TunerPro 6 แต่ล็อกคุณสมบัตินิยามด้วยรหัสผ่าน ATBB ยังอ่านตำแหน่งและสูตรของตารางไม่ได้';
 $('tune-definition').textContent = def.error || `พบ ${def.tables.length} รายการใน XML · กดเปิด Workspace เพื่อใช้ตารางที่โปรไฟล์รองรับ การเขียน ECU ยังไม่พร้อม`;
 if(def.tables) for(const t of def.tables) $('tune-tables').append(el('p','',`${t.name} · ${t.kind} · ${t.addresses.join(', ') || 'ไม่มี address'}`));
 updateLink();
}
function select(id) { selected = records.find(r=>r.id===id) || selected; render(); }
async function refresh(id) {
 records=await tx('readonly',s=>s.getAll());
 records.sort((a,b)=>a.code.localeCompare(b.code) || (b.updatedAt||0)-(a.updatedAt||0));
 selected=records.find(r=>r.id===id)||records.find(r=>r.id===selected?.id)||records.find(profileMatch)||records[0];
 render(); updateStorage();
}
function download(buffer,name) {
 const url=URL.createObjectURL(new Blob([buffer],{type:'application/octet-stream'}));
 const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function fileCard(k, r) {
 const box = $('tune-'+k+'-current'); box.replaceChildren();
 if (!r) { box.append(el('p','tune-slot-none','ยังไม่มีไฟล์ · เลือกไฟล์ด้านล่าง')); return; }
 const buffer = k==='bin' ? r.bin : r.xdf, name = k==='bin' ? r.binName : r.xdfName, hash = k==='bin' ? r.hash : r.xdfHash, modified = k==='bin' ? r.binModified : r.xdfModified;
 const info = el('div','tune-slot-file');
 info.append(el('strong','',`✔ ${name}`), el('span','',`${size(buffer.byteLength)} · SHA-256 ${hash.slice(0,16)}…`), el('span','',`เก็บในคลังเมื่อ ${when(r.updatedAt||r.createdAt)}${modified ? ' · ไฟล์ต้นทางแก้ไขเมื่อ '+when(modified) : ''}`));
 const dl = el('button','tune-btn tune-btn-ghost','⤓ ดาวน์โหลด'); dl.type='button'; dl.onclick=()=>download(buffer,name);
 box.append(info, dl);
}
function showSlot(k, r) {
 fileCard(k, r);
 const K = k.toUpperCase();
 $('tune-'+k+'-pick-label').textContent = r ? `เปลี่ยนเป็นไฟล์ ${K} ใหม่ (ไม่บังคับ · เว้นว่าง = ใช้ไฟล์เดิม)` : `เลือกไฟล์ ${K}`;
 const picked = $('tune-'+k+'-picked'); picked.hidden = true; picked.textContent = '';
}
function showPicked(k) {
 const f = $('tune-'+k+'-input').files[0], picked = $('tune-'+k+'-picked');
 picked.hidden = !f;
 picked.textContent = f ? `${editing ? 'จะแทนที่ด้วย' : 'เลือกแล้ว'}: ${f.name} · ${size(f.size)}` : '';
}
async function updateStorage() {
 const out = $('tune-storage'); if (!out) return;
 let text = `เก็บในเบราว์เซอร์นี้ (IndexedDB ของ ${location.host || 'ไฟล์ในเครื่อง'}) · ${records.length} ชุด`;
 try {
  if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); text += ` · ใช้ ${(e.usage/1048576).toFixed(1)} MB`; }
  if (navigator.storage?.persisted) text += (await navigator.storage.persisted()) ? ' · ล็อกไม่ให้เบราว์เซอร์ลบอัตโนมัติแล้ว' : ' · เบราว์เซอร์อาจลบเมื่อพื้นที่เต็ม ควรเก็บไฟล์ต้นฉบับไว้ด้วย';
 } catch {}
 out.textContent = text;
}
function openDialog(r=null) {
 editing = r; $('tune-form').reset(); $('tune-import-error').textContent='';
 $('tune-dialog-title').textContent = r ? 'แก้ไข / อัปเดตชุดไฟล์' : 'เพิ่มชุดไฟล์';
 $('tune-submit').textContent = r ? 'บันทึกการแก้ไข' : 'เก็บเข้าคลัง';
 $('tune-code').value = r?.code || '';
 $('tune-label').value = r?.label || '';
 $('tune-note-input').value = r?.note || '';
 for (const k of ['bin','xdf']) showSlot(k, r);
 $('tune-dialog-hint').textContent = r ? 'เว้นช่องไฟล์ว่างไว้เพื่อใช้ไฟล์เดิม · ถ้าเปลี่ยน BIN ฉบับร่างที่บันทึกไว้ของชุดนี้จะถูกล้าง' : 'เก็บไว้ในเบราว์เซอร์เครื่องนี้ ควรเก็บไฟล์ต้นฉบับแยกไว้ด้วย';
 $('tune-dialog').showModal();
}
function confirmDialog(text) {
 return new Promise(resolve => {
  const d = $('tune-confirm'); $('tune-confirm-text').textContent = text; d.returnValue = '';
  d.addEventListener('close', () => resolve(d.returnValue === 'ok'), {once:true});
  d.showModal();
 });
}
async function remove(r) {
 if (!r) return;
 if (!await confirmDialog(`ลบ ${r.code}${r.label ? ' · '+r.label : ''} (${r.binName} + ${r.xdfName}) ออกจากคลังในเครื่องนี้? ฉบับร่างที่บันทึกไว้ของชุดนี้จะถูกลบด้วย ไม่มีผลกับ ECU หรือไฟล์ใน ESP32`)) return;
 try {
  await tx('readwrite',s=>s.delete(r.id));
  if (r.code===SAMPLE.code && r.xdfHash===SAMPLE.xdfHash) store.set(SEED_KEY,'1');
  window.dispatchEvent(new CustomEvent('atbb:file-removed',{detail:{id:r.id}}));
  if (selected?.id===r.id) selected = null;
  await refresh(); message(`ลบ ${r.code} ออกจากคลังแล้ว`, 'ok');
  if (!selected) window.dispatchEvent(new CustomEvent('atbb:file-cleared'));
 } catch (error) { message(error.message, 'warn'); }
}
async function readFile(input, ext) {
 const f = input.files[0]; if (!f) return null;
 if (!f.name.toLowerCase().endsWith(ext)) throw new Error(`ไฟล์ต้องเป็น ${ext}`);
 if (f.size===0 || f.size>MAX_FILE) throw new Error('ไฟล์ต้องไม่ว่าง และมีขนาดไม่เกิน 16 MiB ต่อไฟล์');
 return {name:f.name, modified:f.lastModified||0, buffer:await f.arrayBuffer()};
}
async function seedSample(force=false) {
 if (!force && (store.get(SEED_KEY) || records.some(r=>r.code===SAMPLE.code && r.xdfHash===SAMPLE.xdfHash))) return false;
 let responses;
 try { responses=await Promise.all([fetch(SAMPLE.binUrl),fetch(SAMPLE.xdfUrl)]); }
 catch { throw new Error('โหลดไฟล์ตัวอย่างไม่ได้ (เปิดหน้าผ่าน server/HTTPS ที่มีโฟลเดอร์ ecu-library) · เพิ่มไฟล์เองผ่านปุ่ม “เพิ่มชุด BIN + XDF” ได้'); }
 if(responses.some(r=>!r.ok)) throw new Error('ไม่พบไฟล์ตัวอย่างบน server · เพิ่มไฟล์ผ่านปุ่ม “เพิ่มชุด BIN + XDF” ได้');
 const [bin,xdf]=await Promise.all(responses.map(r=>r.arrayBuffer()));
 if(await digest(bin)!==SAMPLE.binHash||await digest(xdf)!==SAMPLE.xdfHash) throw new Error('ไฟล์ตัวอย่างไม่ตรงกับต้นฉบับ');
 const r=await record(SAMPLE.code,SAMPLE.binName,bin,SAMPLE.xdfName,xdf,{label:'ไฟล์ตัวอย่าง (XDF ปลดล็อก)'});
 await tx('readwrite',s=>s.put(r)); store.set(SEED_KEY,'1'); await refresh(r.id); return true;
}
const linked=()=>window.ATBBTuneLink?.connected()===true||(lastData?.ecuOk===true&&Date.now()-lastAt<3000);
// เชื่อมอยู่แล้ว → ไม่เปิดหน้าเชื่อมต่อซ้ำ (จะตัดการเชื่อมต่อให้กดปุ่ม BT ด้านบน)
$('tune-connect').onclick=()=>{if(linked()){message('เชื่อมต่อ ESP32 อยู่แล้ว · ข้อมูลสดกำลังเข้า · ถ้าจะตัดการเชื่อมต่อ กดปุ่ม BT ด้านบน','ok');return;}$('btn-bluetooth')?.click();};
function updateConnectButton(){const b=$('tune-connect'),on=linked();b.textContent=on?'✓ เชื่อมต่อแล้ว':'CONNECT / เชื่อมต่อ';b.classList.toggle('is-linked',on);}
setInterval(updateConnectButton,1000);
$('tune-import').disabled=true;
$('tune-import').onclick=()=>openDialog(null);
$('tune-edit-file').onclick=()=>{if(selected)openDialog(selected);};
$('tune-delete-file').onclick=()=>remove(selected);
$('tune-close').onclick=()=>$('tune-dialog').close();
$('tune-search').oninput=e=>{filter=e.target.value;renderList();};
$('tune-restore-sample').onclick=async()=>{try{if(await seedSample(true))message('เพิ่มไฟล์ตัวอย่างแล้ว','ok');}catch(error){message(error.message,'warn');}};
$('tune-original').onclick=()=>{if(selected)download(selected.bin,selected.binName);};
$('tune-xdf').onclick=()=>{if(selected)download(selected.xdf,selected.xdfName);};
$('tune-form').onsubmit=async e=>{
 e.preventDefault();const submit=$('tune-submit');submit.disabled=true;$('tune-import-error').textContent='';
 try {
  const code=$('tune-code').value.trim().toUpperCase(),label=$('tune-label').value.trim().slice(0,60),note=$('tune-note-input').value.trim().slice(0,500);
  if(!allowed.includes(code)) throw new Error('รุ่นนี้ยังอยู่นอกขอบเขต 6 หมายเลข ECU ที่กำหนด: '+allowed.join(', '));
  const bin=await readFile($('tune-bin-input'),'.bin'),xdf=await readFile($('tune-xdf-input'),'.xdf');
  if(!editing){
   if(!bin||!xdf) throw new Error('เลือกไฟล์ BIN และ XDF ให้ครบ');
   const r=await record(code,bin.name,bin.buffer,xdf.name,xdf.buffer,{label,note,binModified:bin.modified,xdfModified:xdf.modified});
   if(records.some(x=>x.code===r.code&&x.hash===r.hash&&x.xdfHash===r.xdfHash)) throw new Error('มีชุดไฟล์นี้ในคลังแล้ว (BIN + XDF + รหัสเดียวกัน)');
   await tx('readwrite',s=>s.put(r));await refresh(r.id);$('tune-dialog').close();message('เก็บชุดไฟล์ในคลังแล้ว · การแก้ไฟล์เป็นออฟไลน์ ยังไม่ยืนยัน ECU ในรถ','ok');
  } else {
   const old=editing,next={...old,code,label,note,updatedAt:Date.now()};
   if(bin){next.bin=bin.buffer;next.binName=bin.name;next.binModified=bin.modified;next.hash=await digest(bin.buffer);}
   if(xdf){next.xdf=xdf.buffer;next.xdfName=xdf.name;next.xdfModified=xdf.modified;next.xdfHash=await digest(xdf.buffer);}
   if(records.some(x=>x.id!==old.id&&x.code===next.code&&x.hash===next.hash&&x.xdfHash===next.xdfHash)) throw new Error('มีชุดไฟล์ที่เหมือนกันนี้อยู่ในคลังแล้ว');
   const binChanged=next.hash!==old.hash||next.xdfHash!==old.xdfHash||next.code!==old.code;
   await tx('readwrite',s=>s.put(next));
   if(binChanged)window.dispatchEvent(new CustomEvent('atbb:file-removed',{detail:{id:old.id}}));
   editing=null;await refresh(next.id);$('tune-dialog').close();
   message(binChanged?'อัปเดตไฟล์แล้ว · ฉบับร่างเดิมของชุดนี้ถูกล้างเพราะไฟล์เปลี่ยน':'บันทึกการแก้ไขข้อมูลชุดไฟล์แล้ว','ok');
  }
 } catch(error) { $('tune-import-error').textContent=error.message; }
 finally {submit.disabled=false;}
};
window.addEventListener('atbb:save-derived', async e => {
 const {parent,bin,label,tag,changed,baseDiffOffsets,resolve,reject} = e.detail;
 try {
  const base = parent.binName.replace(/\.bin$/i,'').replace(/-tuned-\d{8}-\d{4}$/,'');
  const r = await record(parent.code, `${base}-tuned-${tag}.bin`, bin, parent.xdfName, parent.xdf.slice(0), {
   label, note:`แก้จาก ${parent.binName} · ครั้งนี้ ${changed} bytes`, baseHash: parent.baseHash || parent.hash, parentId: parent.id,
   baseDiffOffsets, status:'ready', binModified: Date.now(), xdfModified: parent.xdfModified || 0 });
  const dup = records.find(x=>x.code===r.code&&x.hash===r.hash&&x.xdfHash===r.xdfHash);
  if (dup) throw new Error(`มีไฟล์ที่ค่าเหมือนกันนี้อยู่แล้วในคลัง: ${dup.label || dup.binName}`);
  await tx('readwrite',s=>s.put(r)); await refresh(r.id);
  message(`บันทึก ${r.binName} เข้าคลังแล้ว · ป้าย “รอแฟลช” · ต้นฉบับ ${parent.binName} ยังอยู่ครบ`,'ok');
  resolve(r);
 } catch (error) { reject(error); }
});
$('tune-dialog').addEventListener('close',()=>{editing=null;});
$('tune-bin-input').onchange=()=>showPicked('bin');$('tune-xdf-input').onchange=()=>showPicked('xdf');
for(const [key,label] of [['rpm','RPM'],['tps','TPS %'],['batt','แบต V'],['inj','หัวฉีด ms'],['igt','จุดระเบิด °'],['afr','AFR ~']]) {
 const box=document.createElement('article'),small=document.createElement('small'),value=document.createElement('strong');small.textContent=label;value.id='tune-value-'+key;value.textContent='—';box.append(small,value);$('tune-live').append(box);
}
window.addEventListener('sg:kline',e=>{
 lastData=e.detail;lastAt=Date.now();updateLink();
});
setInterval(updateLink,1000);
(async()=>{
 try {
  db=await new Promise((resolve,reject)=>{const r=indexedDB.open('atbb-v2-ecu-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{ if(navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); }catch{}
  await refresh();$('tune-import').disabled=false;
  try { await seedSample(false); }
  catch(error){ message(error.message,'warn'); return; }
  message(records.length?'คลังไฟล์พร้อม · เลือก แก้ไข อัปเดต หรือลบชุดไฟล์ได้ · ยังไม่เปิดเขียน ECU':'คลังว่าง · เพิ่มชุด BIN + XDF เพื่อเริ่ม');
 }catch(error){message(error.message,'warn');}
})();
})();
