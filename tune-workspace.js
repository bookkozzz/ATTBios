(() => {
'use strict';
const $=id=>document.getElementById(id);
let profileMatched=false,lastStatus=null,file,profile,editor,currentEntry,loadSerial=0,lastLinked=false,liveData=null,queuedUpload=null,userPaused=false;
const draftDB = new Promise((resolve,reject)=>{const r=indexedDB.open('atbb-v2-tune-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
draftDB.catch(()=>{});
async function draftAction(mode,fn){const db=await draftDB;return new Promise((resolve,reject)=>{const t=db.transaction('drafts',mode),r=fn(t.objectStore('drafts'));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('บันทึกไม่สำเร็จ'));});}
const transfer=new ATBBTransfer.Client(bytes=>window.ATBBTuneLink?.write(bytes) ?? Promise.reject(Error('ระบบ BLE ยังไม่พร้อม')),{
 onProgress:(done,total)=>{$('tune-progress').value=done/total*100;$('tune-stage-state').textContent=`ส่งไฟล์ ${done.toLocaleString()} / ${total.toLocaleString()} bytes`;},
 onState:state=>{$('tune-stage-state').textContent=({UPLOADING:'กำลังส่งไฟล์ไป ESP32',VERIFYING:'ESP32 กำลังตรวจ SHA-256',PAUSED:'พักการส่ง · เชื่อมต่อแล้วกดส่งต่อ',STAGED_UNVERIFIED:'เก็บไฟล์ครบและ SHA-256 ตรง · ยังไม่ผ่านการตรวจความเข้ากันได้กับ ECU'})[state]||state;}
});
window.addEventListener('atbb:tune-reply',e=>transfer.receive(e.detail));
setInterval(()=>{const linked=window.ATBBTuneLink?.connected()===true;if(lastLinked&&!linked)transfer.disconnect();if(!lastLinked&&linked&&queuedUpload&&!transfer.busy&&!userPaused&&$('tune-auto-resume').checked){const payload=queuedUpload;queuedUpload=null;runUpload(payload);}lastLinked=linked;},250);
async function choose(record){
 if(file&&file.id!==record.id)queuedUpload=null;
 const serial=++loadSerial;file=record;editor=null;currentEntry=null;profile=null;marks=[];selection=new Set();
 $('tune-draft-state').textContent='';
 $('tune-editor-table').replaceChildren();$('tune-editor-note').textContent='กำลังตรวจโปรไฟล์';$('tune-tree').replaceChildren();
 try{
  let reference=window.ATBBProfiles?.['K97F-T01'];
  if(!reference){let response;try{response=await fetch('ecu-library/K97F-T01.profile.json');}catch{throw Error('โหลดรายการตาราง (profile) ไม่ได้ · ไฟล์ tune-profiles.js หายไป');}if(!response.ok)throw Error('โหลดรายการตารางไม่สำเร็จ');reference=await response.json();}
  reference=JSON.parse(JSON.stringify(reference));if(serial!==loadSerial)return;
  const matches=reference.code===record.code&&(reference.sourceSha256===record.hash||reference.sourceSha256===record.baseHash)&&reference.xdfSha256===record.xdfHash&&reference.romSize===record.bin.byteLength;
  profileMatched=matches;
  profile=matches?{...reference,sourceSha256:record.hash}:{...reference,code:record.code,sourceSha256:record.hash,romSize:record.bin.byteLength,entries:reference.entries.map(e=>({...e,verified:false,address:null})),flashVerified:false};
  editor=new ATBBTuneCore.Editor(record.bin,profile,record.hash);
  $('tune-editor-note').textContent=matches?'เปิดตารางจาก XDF ที่ปลดรหัสแล้ว · แก้ไฟล์ออฟไลน์ได้ ยังไม่พร้อมแฟลช ECU':'รายการอ้างอิงตามภาพ · ยังไม่มีโปรไฟล์ที่ยืนยันสำหรับชุดไฟล์นี้';
  try{
   const draft=await draftAction('readonly',store=>store.get(record.id));
   if(serial!==loadSerial)return;
   if(draft){
    if(draft.sourceSha256!==record.hash||draft.xdfSha256!==record.xdfHash||!Array.isArray(draft.cells)||draft.cells.length>32768)throw Error('ฉบับร่างไม่ตรงกับไฟล์');
    const restored=new ATBBTuneCore.Editor(record.bin,profile,record.hash);
    for(const cell of draft.cells)restored.write(cell.id,cell.row,cell.col,cell.value);
    editor=restored;$('tune-draft-state').textContent=`โหลดฉบับร่าง ${draft.cells.length} ช่อง · ต้นฉบับยังอยู่ครบ`;
   }
  }catch(error){$('tune-draft-state').textContent=error.message;}
  if(serial!==loadSerial)return;renderTree();updateChanges();
 }catch(e){if(serial===loadSerial)$('tune-editor-note').textContent=e.message;}
}
window.addEventListener('atbb:file-selected',e=>choose(e.detail));
window.addEventListener('atbb:file-removed',e=>{const id=e.detail?.id;if(!id)return;draftAction('readwrite',store=>store.delete(id)).catch(()=>{});if(file?.id===id&&!transfer.busy)queuedUpload=null;});
window.addEventListener('atbb:file-cleared',()=>{loadSerial++;file=null;editor=null;profile=null;currentEntry=null;queuedUpload=null;$('tune-workspace').hidden=true;$('tune-tree').replaceChildren();$('tune-editor-table').replaceChildren();$('tune-editor-note').textContent='';$('tune-draft-state').textContent='';updateChanges();});
// ชื่อภาษาไทย (แปลจากชื่อใน XDF) · ชื่ออังกฤษเดิมยังแสดงคู่กันเพื่อเทียบกับ TunerPro
const TH_NAMES={
 'TPS Table':'แกนคันเร่ง (TPS %)','MAP Table':'แกนแรงดันไอดี (MAP kPa)','RPM Table':'แกนรอบเครื่อง (RPM)',
 'MAP // RPM':'น้ำมัน/หัวฉีด · ไอดี × รอบ','TPS // RPM':'น้ำมัน/หัวฉีด · คันเร่ง × รอบ',
 'Ignition ::Fast-Idle':'องศาไฟ · เดินเบาเร่ง (Fast idle)','Ignition :: Idle':'องศาไฟ · เดินเบา',
 'Ignition :: Torque-1':'องศาไฟ · แรงบิด 1','Ignition :: Torque-2':'องศาไฟ · แรงบิด 2','Ignition :: Deceleration':'องศาไฟ · ผ่อนคันเร่ง/ลดความเร็ว',
 'Timing : Low':'องศาไฟ · รอบต่ำ','Throttle ::TPS':'ลิ้นเร่ง · ค่า TPS',
 'AF Ratio - CLOSE Loop':'เป้า AFR · ระบบปิด (Closed loop)','Lamda - Close Loop':'เป้า Lambda · ระบบปิด (Closed loop)',
 'DIAGNOSTIC TROUBLE CODES':'รหัสปัญหา (DTC)','Id':'รหัสกล่อง (ID)',
 'MAP Sensor Enable':'เปิดใช้ เซนเซอร์ MAP','ECT Sensor Enable':'เปิดใช้ เซนเซอร์อุณหภูมิเครื่อง','TP Sensor Enable':'เปิดใช้ เซนเซอร์คันเร่ง',
 'IAT Sensor Enable':'เปิดใช้ เซนเซอร์อุณหภูมิอากาศ','Velocity Sensor Enable':'เปิดใช้ เซนเซอร์ความเร็ว','Primary Injector Enable':'เปิดใช้ หัวฉีดหลัก',
 'Ignition Coil Enable':'เปิดใช้ คอยล์จุดระเบิด','O2 Sensor Enable':'เปิดใช้ เซนเซอร์ O2','IACV Enable':'เปิดใช้ วาล์วเดินเบา (IACV)',
 'Bank Angle Sensor Enable':'เปิดใช้ เซนเซอร์เอียงล้ม','ECM EEPROM Enable':'เปิดใช้ EEPROM กล่อง'};
function thName(entry){
 let th=TH_NAMES[entry.name]||'';const lim=/^Limiter-(\d)$/.exec(entry.name);if(lim)th=`ตัดรอบ (Rev limit) ชุด ${lim[1]}`;
 const same=profile.entries.filter(e=>e.name===entry.name);if(th&&same.length>1)th+=` #${same.indexOf(entry)+1}`;
 return th;
}
function renderTree(){
 $('tune-tree').replaceChildren();
 for(const [group,label] of [['Tables','ตาราง (Tables)'],['Flags','สวิตช์ (Flags)']]){
  const list=profile.entries.filter(e=>e.group===group);
  const details=document.createElement('details');details.open=group==='Tables';const summary=document.createElement('summary');summary.textContent=`${label} · ${list.length}`;details.append(summary);
  for(const entry of list){
   const button=document.createElement('button');button.type='button';button.dataset.entry=entry.id;button.dataset.name=entry.name;
   const th=thName(entry),main=document.createElement('span'),sub=document.createElement('small');main.className='tune-tree-th';sub.className='tune-tree-en';
   main.textContent=th||entry.name;sub.textContent=th?entry.name:'';button.append(main);if(th)button.append(sub);
   button.title=`${th?th+' · ':''}${entry.name} · ${entry.verified?(entry.readOnly?'อ่านอย่างเดียว':'แก้ได้'):'อ่านค่า raw อย่างเดียว'}`;
   if(entry.readOnly||!entry.verified)button.classList.add('ro');
   button.onclick=()=>selectEntry(entry);details.append(button);
  }
  $('tune-tree').append(details);
 }
}
function updateChanges(){
 const count=editor?.diff().length||0;$('tune-changes').textContent=count?`แก้ไข ${count} bytes · ยังไม่มีผลต่อ ECU`:'ยังไม่มีการแก้ไข';$('tune-undo').disabled=!editor?.undoStack.length;$('tune-draft').disabled=!count;$('tune-draft-bin').disabled=!count;$('tune-save-new').disabled=!count;$('tune-save-draft').disabled=!editor||!profile?.entries.some(e=>e.verified&&!e.readOnly);
}
let view='table',selection=new Set(),anchor=null,marks=[];const cam={yaw:-0.6,pitch:0.55,zoom:1};
const cellKey=(r,c)=>r+','+c;
const fmt=(e,v)=>String(Number(v.toFixed(Math.min(4,Math.max(0,e.decimals??2)))));
function tableValues(entry){const v=[];for(let r=0;r<entry.rows;r++){const row=[];for(let c=0;c<entry.cols;c++)row.push(editor.read(entry.id,r,c));v.push(row);}return v;}
function activeCell(){const td=$('tune-editor-table').querySelector('.tune-active-cell');return td?{r:+td.dataset.row,c:+td.dataset.col}:null;}
function paint(){
 const entry=currentEntry;if(!entry?.verified||!editor)return;
 let values;try{values=tableValues(entry);}catch{return;}
 const rg=ATBBTuneGraph.range(values);
 for(const td of $('tune-editor-table').querySelectorAll('td[data-row]')){const v=values[+td.dataset.row][+td.dataset.col];td.style.background=ATBBTuneGraph.tpHeat(ATBBTuneGraph.norm(v,rg));td.classList.toggle('tune-sel',selection.has(cellKey(td.dataset.row,td.dataset.col)));}
 $('tune-sel-info').textContent=selection.size?`เลือก ${selection.size} ช่อง`:'คลิกช่อง · Shift+คลิกเลือกช่วง';
 for(const b of document.querySelectorAll('[data-tune-op]'))b.disabled=!selection.size||entry.readOnly===true;
 $('tune-op-all').disabled=entry.readOnly===true;
 if(view==='graph')ATBBTuneGraph.draw($('tune-graph'),values,{rowAxis:entry.liveAxes?.rows||entry.rowAxis,colAxis:entry.liveAxes?.cols||entry.columnAxis,decimals:entry.decimals,cam,active:activeCell()});
}
function setView(next){view=next;$('tune-view-table').classList.toggle('on',view==='table');$('tune-view-graph').classList.toggle('on',view==='graph');$('tune-editor-table').hidden=view!=='table';$('tune-graph').hidden=view!=='graph';paint();}
function selectRange(r,c,extend){
 if(!extend||!anchor){selection=new Set([cellKey(r,c)]);anchor={r,c};}
 else{selection=new Set();for(let i=Math.min(anchor.r,r);i<=Math.max(anchor.r,r);i++)for(let j=Math.min(anchor.c,c);j<=Math.max(anchor.c,c);j++)selection.add(cellKey(i,j));}
 paint();
}
function applyOp(op){
 const entry=currentEntry;if(!entry||!selection.size||entry.readOnly)return;
 const step=Math.abs(entry.scale)*(entry.decimals===0&&Math.abs(entry.scale)<1?Math.round(1/Math.abs(entry.scale)):1);
 let fn=op,amount=step;
 if(op==='dec'){fn='offset';amount=-step;}else if(op==='inc'){fn='offset';}
 else{fn=$('tune-fn').value;amount=Number($('tune-fn-value').value);if(!fn.startsWith('interp')&&!Number.isFinite(amount)){$('tune-editor-note').textContent='Value ต้องเป็นตัวเลข';return;}}
 const cells=[...selection].map(k=>k.split(',').map(Number)),now=new Map(cells.map(([r,c])=>[cellKey(r,c),editor.read(entry.id,r,c)]));
 const target=new Map();
 if(fn.startsWith('interp')){
  // linear interpolation between the first and last selected cell of each row (↔) or column (↕)
  const groups=new Map();for(const [r,c] of cells){const g=fn==='interp-h'?r:c;if(!groups.has(g))groups.set(g,[]);groups.get(g).push([r,c]);}
  for(const list of groups.values()){list.sort((x,y)=>fn==='interp-h'?x[1]-y[1]:x[0]-y[0]);const a=now.get(cellKey(...list[0])),z=now.get(cellKey(...list.at(-1)));list.forEach(([r,c],i)=>target.set(cellKey(r,c),list.length<2?a:a+(z-a)*i/(list.length-1)));}
 }else for(const [r,c] of cells){const v=now.get(cellKey(r,c));target.set(cellKey(r,c),fn==='offset'?v+amount:fn==='pct'?v*(1+amount/100):amount);}
 marks.push(editor.undoStack.length);let errors=0,clamped=0;
 for(const [key,raw] of target){const [r,c]=key.split(',').map(Number);let next=Math.min(entry.max,Math.max(entry.min,raw));if(next!==raw)clamped++;
  if(Math.abs(next-now.get(key))<1e-12)continue;try{editor.write(entry.id,r,c,next);}catch{errors++;}}
 if(marks.at(-1)===editor.undoStack.length)marks.pop();
 renderValues();updateChanges();
 $('tune-editor-note').textContent=errors||clamped?`ปรับ ${target.size-errors} ช่อง · ชนขอบ ${entry.min}–${entry.max} ${clamped} ช่อง${errors?` · ปรับไม่ได้ ${errors}`:''}`:`ปรับ ${target.size} ช่องแล้ว`;
}
// TunerPro-style axes: tables whose XDF axis is only 0,1,2… take labels from the linked RPM / MAP / TPS breakpoint tables in the BIN
function indexAxis(labels,n){return !labels||labels.length!==n||labels.every((l,i)=>String(l).trim()===''||String(l).trim()===String(i));}
function breakpoints(name,n){
 const e=profile?.entries.find(x=>x.name===name&&x.verified);if(!e||e.rows!==n||e.cols!==1)return null;
 try{return Array.from({length:n},(_,i)=>fmt(e,editor.read(e.id,i,0)));}catch{return null;}
}
function axes(entry){
 let rows=entry.rowAxis,cols=entry.columnAxis,rowName=entry.rowLabel,colName=entry.columnLabel;
 if(indexAxis(rows,entry.rows)&&entry.rows===35){const v=breakpoints('RPM Table',35);if(v){rows=v;rowName='RPM';}}
 if(indexAxis(cols,entry.cols)&&entry.cols===25){const tps=/TPS|Throttle/i.test(entry.name),v=breakpoints(tps?'TPS Table':'MAP Table',25);if(v){cols=v;colName=tps?'TPS %':'MAP kPa';}}
 return {rows,cols,rowName,colName};
}
function renderValues(){
 const entry=currentEntry;
 for(const td of $('tune-editor-table').querySelectorAll('td[data-row]')){const r=+td.dataset.row,c=+td.dataset.col,input=td.firstChild,v=editor.read(entry.id,r,c);input.value=fmt(entry,v);const orig=new ATBBTuneCore.Editor(editor.original,profile,file.hash).read(entry.id,r,c);td.classList.toggle('modified',v!==orig);}
 paint();
}
function selectEntry(entry){
 currentEntry=entry;selection=new Set();anchor=null;{const th=thName(entry);$('tune-editor-title').textContent=th?`${th} · ${entry.name}`:entry.name;}$('tune-editor-table').replaceChildren();
 for(const button of $('tune-tree').querySelectorAll('button'))button.classList.toggle('selected',button.dataset.entry===entry.id);
 $('tune-table-tools').hidden=!entry.verified;
 if(!entry.verified){
  $('tune-graph').hidden=true;
  if(entry.group==='Flags'&&Number.isSafeInteger(entry.address)&&entry.address>=0&&entry.address<file.bin.byteLength){const raw=new Uint8Array(file.bin)[entry.address];$('tune-editor-note').textContent=`${entry.note} · address 0x${entry.address.toString(16)} · raw 0x${raw.toString(16).padStart(2,'0')} · mask ${entry.mask}`;}
  else $('tune-editor-note').textContent='ยังอ่านค่าไม่ได้: ไม่มี address / รูปแบบข้อมูล / สูตรแปลงค่าที่ผ่านการยืนยันในไฟล์นี้ รายการนี้อ้างอิงจากภาพ ไม่ใช่ค่าที่อ่านจาก ECU';
  return;
 }
 try{
  ATBBTuneCore.spec(entry,editor.buffer.byteLength);
  $('tune-editor-note').textContent=[`${entry.rows} × ${entry.cols}`,entry.unit,`address 0x${entry.address.toString(16)}`,entry.type,`ช่วงค่า ${entry.min}–${entry.max}`,entry.readOnly?'อ่านอย่างเดียว':''].filter(Boolean).join(' · ');
  const original=new ATBBTuneCore.Editor(editor.original,profile,file.hash);
  const ax=axes(entry);entry.liveAxes=ax;
  const table=document.createElement('table');table.className='tune-value-grid';const head=table.createTHead().insertRow();const label=document.createElement('th');label.className='tune-corner';label.textContent=`${ax.rowName||''} \\ ${ax.colName||''}`.trim();head.append(label);
  for(let c=0;c<entry.cols;c++){const th=document.createElement('th');th.textContent=ax.cols?.[c]??String(c);head.append(th);}
  const body=table.createTBody();
  for(let r=0;r<entry.rows;r++){
   const row=body.insertRow(),th=document.createElement('th');th.textContent=ax.rows?.[r]??String(r);row.append(th);
   for(let c=0;c<entry.cols;c++){
    const td=row.insertCell(),input=document.createElement('input');input.type='number';input.readOnly=entry.readOnly===true;input.min=entry.min;input.max=entry.max;input.step=Math.abs(entry.scale);const value=editor.read(entry.id,r,c);input.value=fmt(entry,value);input.setAttribute('aria-label',`${entry.name} แถว ${r+1} คอลัมน์ ${c+1}`);
    td.dataset.row=r;td.dataset.col=c;if(value!==original.read(entry.id,r,c))td.classList.add('modified');
    input.onfocus=()=>{if(!selection.has(cellKey(r,c))||selection.size<2)selectRange(r,c,false);};
    td.onmousedown=e=>{if(e.shiftKey){e.preventDefault();selectRange(r,c,true);}};
    input.onchange=()=>{try{if(!input.value.trim())throw Error('ต้องระบุค่า');marks.push(editor.undoStack.length);input.value=fmt(entry,editor.write(entry.id,r,c,Number(input.value)));input.setCustomValidity('');td.classList.add('modified');updateChanges();paint();}catch(error){if(marks.at(-1)===editor.undoStack.length)marks.pop();input.setCustomValidity(error.message);input.reportValidity();input.value=fmt(entry,editor.read(entry.id,r,c));}};td.append(input);
   }
  }
  $('tune-editor-table').append(table);markLiveCell();setView(view);applyFit();
 }catch(error){$('tune-editor-note').textContent=error.message;}
}
const layoutEl=document.querySelector('.tune-editor-layout');
const pref=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch{return null;}};
if(pref('atbb-tune-nav')==='closed')layoutEl.classList.add('nav-closed');
$('tune-nav-toggle').onclick=()=>{layoutEl.classList.toggle('nav-closed');pref('atbb-tune-nav',layoutEl.classList.contains('nav-closed')?'closed':'open');applyFit();if(view==='graph')paint();};
let fitOn=pref('atbb-tune-fit')==='on';
function applyFit(){
 const wrap=$('tune-editor-table'),table=wrap.querySelector('table');$('tune-fit').classList.toggle('on',fitOn);
 if(!table)return;table.style.zoom='';
 if(!fitOn)return;
 const z=Math.min(1,(wrap.clientWidth-4)/table.scrollWidth,(wrap.clientHeight-4)/table.scrollHeight);
 if(z>0&&z<1)table.style.zoom=String(Math.max(0.35,z));
}
$('tune-fit').onclick=()=>{fitOn=!fitOn;pref('atbb-tune-fit',fitOn?'on':'off');applyFit();};
window.addEventListener('resize',applyFit);
// ลากเลื่อนตารางได้อิสระ: ลากที่หัวแถว/หัวคอลัมน์ (หรือคลิกกลาง) · ทัชสกรีนเลื่อนได้ตามปกติ
{const wrap=$('tune-editor-table');let pan=null;
 wrap.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')return;if(!(e.target.closest('th')||e.button===1))return;e.preventDefault();pan={x:e.clientX,y:e.clientY,l:wrap.scrollLeft,t:wrap.scrollTop};wrap.classList.add('panning');wrap.setPointerCapture?.(e.pointerId);});
 wrap.addEventListener('pointermove',e=>{if(!pan)return;wrap.scrollLeft=pan.l-(e.clientX-pan.x);wrap.scrollTop=pan.t-(e.clientY-pan.y);});
 const end=()=>{pan=null;wrap.classList.remove('panning');};wrap.addEventListener('pointerup',end);wrap.addEventListener('pointercancel',end);}
$('tune-view-table').onclick=()=>setView('table');$('tune-view-graph').onclick=()=>setView('graph');
ATBBTuneGraph.attachOrbit($('tune-graph'),cam,()=>paint());
for(const b of document.querySelectorAll('[data-tune-op]'))b.onclick=()=>applyOp(b.dataset.tuneOp);
$('tune-op-all').onclick=()=>{const e=currentEntry;if(!e?.verified)return;selection=new Set();for(let r=0;r<e.rows;r++)for(let c=0;c<e.cols;c++)selection.add(cellKey(r,c));anchor={r:0,c:0};paint();};
window.addEventListener('resize',()=>{if(view==='graph')paint();});
$('tune-edit').onclick=()=>{if(!file)return;$('tune-workspace').hidden=false;$('tune-workspace').scrollIntoView({block:'start',behavior:'smooth'});if(window.ATBBTuneLink?.connected()!==true&&$('tune-live-state')?.textContent!=='LIVE')document.getElementById('btn-bluetooth')?.click();};
$('tune-editor-close').onclick=()=>{$('tune-workspace').hidden=true;};
$('tune-undo').onclick=()=>{if(!editor)return;const target=marks.length?marks.pop():editor.undoStack.length-1;while(editor.undoStack.length>Math.max(0,target))editor.undo();if(currentEntry)selectEntry(currentEntry);updateChanges();};
$('tune-draft').onclick=()=>{
 if(!editor?.diff().length)return;
 const payload={format:'ATBB-DRAFT-1',code:file.code,sourceSha256:file.hash,xdfSha256:file.xdfHash,checksumVerified:false,flashable:false,changes:editor.diff()};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=file.code+'.draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function markLiveCell(){
 const entry=currentEntry;if(!entry?.verified)return;
 const table=$('tune-editor-table');for(const cell of table.querySelectorAll('.tune-active-cell'))cell.classList.remove('tune-active-cell');
 if(!liveData?.ecuOk||Date.now()-liveData.at>3000)return;
 const nearest=(labels,value)=>{const values=labels?.map(Number);if(!Number.isFinite(value)||!values?.length||values.some(v=>!Number.isFinite(v)))return -1;return values.reduce((best,v,i)=>Math.abs(v-value)<Math.abs(values[best]-value)?i:best,0);};
 const ax=entry.liveAxes||{rows:entry.rowAxis,cols:entry.columnAxis,rowName:entry.rowLabel,colName:entry.columnLabel};
 const rowValue=/RPM/i.test(ax.rowName)?liveData.rpm:null;
 const colValue=/TPS/i.test(ax.colName)?liveData.tps:/MAP/i.test(ax.colName)?liveData.map:null;
 const row=nearest(ax.rows,rowValue),col=nearest(ax.cols,colValue);
 if(row>=0&&col>=0)table.querySelector(`td[data-row="${row}"][data-col="${col}"]`)?.classList.add('tune-active-cell');
 if(view==='graph')paint();
}
window.addEventListener('sg:kline',e=>{liveData={...e.detail,at:Date.now()};markLiveCell();});setInterval(markLiveCell,1000);
$('tune-save-draft').onclick=async()=>{
 if(!editor||!file)return;const captured=file,capturedEditor=editor;
 try{
  const original=new ATBBTuneCore.Editor(captured.bin,profile,captured.hash),cells=[];
  for(const entry of profile.entries.filter(e=>e.verified&&!e.readOnly))for(let row=0;row<entry.rows;row++)for(let col=0;col<entry.cols;col++){const value=capturedEditor.read(entry.id,row,col);if(value!==original.read(entry.id,row,col))cells.push({id:entry.id,row,col,value});}
  await draftAction('readwrite',store=>store.put({id:captured.id,sourceSha256:captured.hash,xdfSha256:captured.xdfHash,cells}));
  if(file===captured)$('tune-draft-state').textContent=`บันทึกฉบับร่าง ${cells.length} ช่องแล้ว · ยังไม่ได้เขียน ECU`;
 }catch(error){$('tune-draft-state').textContent=error.message;}
};
$('tune-save-new').onclick=async()=>{
 if(!editor||!file)return;const diff=editor.diff();if(!diff.length){$('tune-draft-state').textContent='ยังไม่มีการแก้ไข · แก้ค่าก่อนแล้วค่อยบันทึกเป็นไฟล์ใหม่';return;}
 const stamp=new Date(),pad=n=>String(n).padStart(2,'0'),tag=`${stamp.getFullYear()}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
 const label=prompt('ตั้งชื่อไฟล์ที่แก้ (แสดงในคลัง)',`${file.label?file.label.replace(/ · แก้.*$/,'')+' · ':''}แก้ ${tag}`);if(label===null)return;
 $('tune-save-new').disabled=true;
 try{
  const parent=file,bin=editor.buffer.slice(0),offsets=new Set(parent.baseDiffOffsets||[]);for(const d of diff)offsets.add(d.offset);
  const saved=await new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('atbb:save-derived',{detail:{parent,bin,label:label.trim().slice(0,60),tag,changed:diff.length,baseDiffOffsets:[...offsets].sort((a,b)=>a-b),resolve,reject}})));
  draftAction('readwrite',store=>store.delete(parent.id)).catch(()=>{});
  $('tune-draft-state').textContent=`บันทึกเป็นไฟล์ใหม่แล้ว: ${saved.binName} · เก็บในคลังพร้อมป้าย “รอแฟลช” · ต้นฉบับยังอยู่ครบ`;
 }catch(error){$('tune-draft-state').textContent=error.message;}
 finally{updateChanges();}
};
$('tune-draft-bin').onclick=()=>{
 if(!editor?.diff().length)return;
 const url=URL.createObjectURL(new Blob([editor.buffer],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=file.code+'.draft-NOT-FOR-FLASH.bin';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 $('tune-draft-state').textContent='ส่งออก BIN ฉบับร่าง · ยังไม่คำนวณ checksum ห้ามใช้แฟลช ECU';
};
function locked(value){for(const id of ['tune-stage','tune-stage-status','tune-stage-discard','tune-stage-format','tune-import','tune-edit','tune-edit-file','tune-delete-file','tune-undo','tune-save-draft','tune-draft','tune-draft-bin','tune-save-new'])$(id).disabled=value;for(const b of $('tune-library').querySelectorAll('button'))b.disabled=value;$('tune-library').classList.toggle('is-locked',value);for(const input of $('tune-editor-table').querySelectorAll('input'))input.disabled=value;if(!value)updateChanges();}
async function runUpload(payload){
 locked(true);
 try{await transfer.upload(payload);queuedUpload=null;}
 catch(error){
  if(/BLE|ACK|เชื่อมต่อ ESP32/.test(error.message)&&!userPaused)queuedUpload=payload;
  $('tune-stage-state').textContent=error.message;
 }finally{locked(false);}
}
$('tune-stage').onclick=async()=>{
 if(!file||transfer.busy)return;
 userPaused=false;queuedUpload=null;
 const selected=file,modified=!!editor?.diff().length,buffer=modified?editor.buffer.slice(0):selected.bin.slice(0);
 locked(true);
 try{const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');if(!modified&&actual!==selected.hash)throw Error('ไฟล์ในคลังเปลี่ยนแปลง ตรวจ hash ไม่ผ่าน');await runUpload({buffer,sha256:actual,code:selected.code});}
 catch(error){$('tune-stage-state').textContent=error.message;}finally{locked(false);}
};
$('tune-pause').onclick=()=>{userPaused=true;queuedUpload=null;transfer.pause();};
$('tune-stage-status').onclick=async()=>{
 locked(true);try{const s=await transfer.request('STATUS');lastStatus={...s,at:Date.now()};$('tune-stage-state').textContent=`${s.state} · ${s.offset||0}/${s.size||0} bytes · ${s.code||'ไม่มีชุดไฟล์'} · ECU write: ${s.ecuWrite===true?'รองรับ':'ยังไม่รองรับ'}`;}
 catch(error){$('tune-stage-state').textContent=error.message;}finally{locked(false);}
};
$('tune-stage-format').onclick=async()=>{
 queuedUpload=null;userPaused=true;
 if(!confirm('เตรียมพื้นที่ LittleFS ใน ESP32 ครั้งแรก? จะลบข้อมูลในพื้นที่ LittleFS ทั้งหมด ไม่แตะ ECU ใช้เมื่อสถานะ STORAGE_UNAVAILABLE เท่านั้น'))return;
 locked(true);try{await transfer.request('FORMAT_STORAGE',{confirm:'ERASE_LITTLEFS'});$('tune-stage-state').textContent='เตรียมพื้นที่ ESP32 แล้ว พร้อมรับไฟล์';}
 catch(error){$('tune-stage-state').textContent=error.message;}finally{locked(false);}
};
$('tune-stage-discard').onclick=async()=>{
 queuedUpload=null;userPaused=true;
 if(!confirm('ลบเฉพาะไฟล์พักใน ESP32? การดำเนินการนี้ไม่เขียนหรือลบข้อมูล ECU'))return;
 locked(true);try{const status=await transfer.request('STATUS');if(status.state==='EMPTY')throw Error('ไม่มีไฟล์พัก');await transfer.request('DISCARD',{job:status.job||''});$('tune-stage-state').textContent='ลบไฟล์พักใน ESP32 แล้ว';$('tune-progress').value=0;}
 catch(error){$('tune-stage-state').textContent=error.message;}finally{locked(false);}
};
const BLOCK=256,KLINE_BPS=1000;
function fmtTime(sec){return sec<60?`~${Math.max(1,Math.round(sec))} วินาที`:`~${(sec/60).toFixed(1)} นาที`;}
function pendingOffsets(){const set=new Set(file?.baseDiffOffsets||[]);for(const d of editor?.diff()||[])set.add(d.offset);return [...set];}
function flashState(){
 const live=liveData&&Date.now()-liveData.at<3000&&liveData.ecuOk===true;
 const diff=pendingOffsets(),blocks=new Set(diff.map(o=>Math.floor(o/BLOCK))).size;
 const size=file?.bin.byteLength||0;
 $('tune-est-fast').textContent=!file?'—':blocks?`${fmtTime(blocks*BLOCK*2/KLINE_BPS)} · ${blocks} บล็อก (${diff.length} bytes จากต้นฉบับ)`:'ยังไม่มีการแก้';
 $('tune-est-full').textContent=file?fmtTime(size*2/KLINE_BPS):'—';
 const checks=[
  [!!file&&profileMatched,'ไฟล์ BIN + XDF ตรงกับโปรไฟล์ที่ถอดตารางแล้ว',file?(profileMatched?'':'ชุดไฟล์นี้ไม่ตรงโปรไฟล์ K97F-T01 (ปลดล็อก)'):'ยังไม่ได้เลือกไฟล์'],
  [blocks>0||$('tune-flash').dataset.mode==='full','มีค่าที่แก้ไขแล้วรออัด',blocks?'':'ยังไม่ได้แก้ค่าใดๆ'],
  [live,'เชื่อมต่อกล่องอยู่ (ข้อมูลสด < 3 วินาที)',live?'':'กด CONNECT แล้วเปิดกุญแจ ON'],
  [live&&typeof liveData.boxCode==='string'&&liveData.boxCode.trim().toUpperCase()===file?.code,'รหัสกล่องจากรถตรงกับไฟล์',live?(liveData.boxCode?`กล่องส่งรหัส ${liveData.boxCode}`:'เฟิร์มแวร์ ESP32 ยังไม่อ่านรหัสกล่อง'):'รอเชื่อมต่อ'],
  [false,`เวอร์ชันเฟิร์มแวร์ในกล่องตรง (${profile?.firmware||'—'})`,'ยังไม่มีคำสั่งอ่านเวอร์ชันจากกล่อง'],
  [live&&liveData.rpm===0&&Number.isFinite(liveData.batt)&&liveData.batt>=12,'ดับเครื่อง และแบต ≥ 12.0 V',live?`RPM ${liveData.rpm} · แบต ${liveData.batt} V`:'รอข้อมูลสด'],
  [profile?.checksumVerified===true,'คำนวณ checksum ไฟล์ที่แก้ได้ถูกต้อง','สูตรใน XDF (0x18000–0x5FFFF → 0x5FFF8) ไม่ตรงกับ BIN ต้นฉบับ'],
  [profile?.flashVerified===true&&lastStatus?.ecuWrite===true,'โปรโตคอลแฟลชของกล่องผ่านการทดสอบ + ESP32 รองรับ','ยังไม่มีข้อมูลคำสั่งแฟลชกล่อง Shindengen รุ่นนี้'],
 ];
 const ul=$('tune-flash-checks');ul.replaceChildren();
 for(const [ok,label,why] of checks){const li=document.createElement('li');li.className=ok?'ok':'no';const b=document.createElement('b');b.textContent=(ok?'✔ ':'✖ ')+label;li.append(b);if(!ok&&why){const sp=document.createElement('span');sp.textContent=why;li.append(sp);}ul.append(li);}
 const ready=checks.every(c=>c[0]);
 $('tune-flash').disabled=!ready||transfer.busy;
 const passed=checks.filter(c=>c[0]).length,first=checks.find(c=>!c[0]);
 const safe=$('tune-safety');safe.dataset.state=ready?'ok':passed>=checks.length-3?'warn':'no';
 $('tune-safety-title').textContent=ready?'ปลอดภัย · พร้อมแฟลช':'ยังไม่ปลอดภัยสำหรับแฟลช';
 $('tune-safety-detail').textContent=ready?`ผ่านครบ ${checks.length} ข้อ · กดเพื่อไปที่ปุ่มอัด`:`ติดอยู่: ${first[1]}${first[2]?' — '+first[2]:''}`;
 $('tune-safety-count').textContent=`${passed}/${checks.length}`;
 const badge=$('tune-flash-badge');badge.textContent=ready?'พร้อมอัด':`ผ่าน ${checks.filter(c=>c[0]).length}/${checks.length}`;badge.className='tune-chip '+(ready?'ok':'warn');
}
for(const r of document.querySelectorAll('input[name="tune-flash-mode"]'))r.onchange=()=>{$('tune-flash').dataset.mode=r.value;flashState();};
$('tune-flash').onclick=async()=>{try{await transfer.request('FLASH',{mode:$('tune-flash').dataset.mode||'fast'});}catch(error){$('tune-stage-state').textContent=error.message;}};
setInterval(flashState,1000);$('tune-safety').onclick=()=>document.querySelector('.tune-flash')?.scrollIntoView({behavior:'smooth',block:'start'});window.addEventListener('atbb:file-selected',()=>setTimeout(flashState,300));
})();
