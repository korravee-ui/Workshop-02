import { db } from "./firebase-config.js";
import {
  collection, addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

var DAY_MS = 86400000;
var currentDate = new Date();

function fmtKey(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
var THAI_DOW = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
var THAI_MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function fmtLabel(d){
  return 'วัน'+THAI_DOW[d.getDay()]+'ที่ '+d.getDate()+' '+THAI_MON[d.getMonth()]+' '+(d.getFullYear()+543);
}

// ---- Mock email/calendar generator (deterministic per date) ----
// Replace this section with real Gmail/Google Calendar API calls when you're ready to connect live data.
var CAL_POOL = [
  {t:'09:00', title:'Daily standup ทีม Product', meta:'Google Meet · 15 นาที'},
  {t:'10:30', title:'รีวิวดีไซน์กับทีม UX', meta:'ห้องประชุม 3B · 45 นาที'},
  {t:'13:00', title:'1:1 กับหัวหน้างาน', meta:'Google Meet · 30 นาที'},
  {t:'14:30', title:'Sprint planning', meta:'ห้องประชุมใหญ่ · 1 ชม.'},
  {t:'16:00', title:'Client call: บริษัท ABC', meta:'Zoom · 30 นาที'},
  {t:'11:00', title:'สัมภาษณ์ผู้สมัครตำแหน่ง Backend', meta:'Google Meet · 45 นาที'},
  {t:'17:00', title:'Workshop: OKR ไตรมาสหน้า', meta:'ห้องประชุม 5A · 1 ชม.'}
];
var MAIL_POOL = [
  {t:'08:42', title:'สรุปยอดขายประจำสัปดาห์', meta:'จาก finance-report@company.com'},
  {t:'09:15', title:'RE: ขอเอกสารสัญญาฉบับล่าสุด', meta:'จาก legal@partner.co.th'},
  {t:'12:05', title:'แจ้งเตือน: ใบแจ้งหนี้ค้างชำระ', meta:'จาก billing@vendor.com'},
  {t:'13:40', title:'เชิญร่วมงานสัมมนา HR ประจำปี', meta:'จาก hr@company.com'},
  {t:'15:20', title:'ผลตอบรับจากลูกค้า: โปรเจกต์ X', meta:'จาก client.success@company.com'},
  {t:'16:45', title:'อัปเดตนโยบายทำงานที่บ้าน', meta:'จาก admin@company.com'}
];
function seedFor(dateKey){
  var s = 0;
  for(var i=0;i<dateKey.length;i++) s = (s*31 + dateKey.charCodeAt(i)) >>> 0;
  return s;
}
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function eventsFor(dateKey){
  var rng = mulberry32(seedFor(dateKey));
  var isWeekend = [0,6].indexOf(new Date(dateKey+'T00:00:00').getDay()) !== -1;
  var events = [];
  var calN = isWeekend ? Math.floor(rng()*2) : 2 + Math.floor(rng()*3);
  var mailN = 2 + Math.floor(rng()*3);
  var calShuffled = CAL_POOL.slice().sort(function(){ return rng()-0.5; });
  var mailShuffled = MAIL_POOL.slice().sort(function(){ return rng()-0.5; });
  for(var i=0;i<calN;i++) events.push(Object.assign({type:'cal'}, calShuffled[i]));
  for(var j=0;j<mailN;j++) events.push(Object.assign({type:'email'}, mailShuffled[j]));
  events.sort(function(a,b){ return a.t.localeCompare(b.t); });
  return events;
}

function renderTimeline(){
  var key = fmtKey(currentDate);
  document.getElementById('dateLabel').textContent = fmtLabel(currentDate);
  var events = eventsFor(key);
  var list = document.getElementById('timeline');
  document.getElementById('tlCount').textContent = events.length;
  list.innerHTML = '';
  if(events.length === 0){
    var li = document.createElement('li');
    li.className = 'tl-empty';
    li.textContent = 'ไม่มีนัดหมายหรืออีเมลสำคัญในวันนี้';
    list.appendChild(li);
    return;
  }
  events.forEach(function(ev){
    var li = document.createElement('li');
    li.className = 'tl-item ' + ev.type;
    li.innerHTML =
      '<div class="tl-time">'+ev.t+'</div>'+
      '<div class="tl-dot"></div>'+
      '<div class="tl-body">'+
        '<div class="tl-tag">'+(ev.type==='cal' ? 'นัดหมาย' : 'อีเมล')+'</div>'+
        '<div class="tl-title">'+escapeHtml(ev.title)+'</div>'+
        '<div class="tl-meta">'+escapeHtml(ev.meta)+'</div>'+
      '</div>';
    list.appendChild(li);
  });
}

function escapeHtml(s){
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---- Lifestyle log (persisted in Firestore, project: korworkshop-1cd5d) ----
var DEFAULT_CATS = [
  {id:'health', label:'สุขภาพ/ออกกำลังกาย', color:'#3f7d4f', icon:'run'},
  {id:'meal', label:'มื้ออาหาร', color:'#b5652e', icon:'meal'},
  {id:'mood', label:'อารมณ์/mood', color:'#8a5fb0', icon:'mood'},
  {id:'hobby', label:'งานอดิเรก', color:'#2b6ea6', icon:'hobby'}
];

// Icon set styled after activity-tracker apps (Garmin/Strava/Whoop): simple stroked glyphs, one per category.
var ICONS = {
  run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="4.5" r="1.6" fill="currentColor" stroke="none"/><path d="M9 20l2.2-4.8-2-1.9.7-4.3 3 2.6 3.3-1.2"/><path d="M8.5 15.5L5 17.5"/><path d="M13 10.5l3 1.3 2.5-1"/></svg>',
  meal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a2 2 0 0 0 4 0V3"/><path d="M8 10v11"/><path d="M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v8"/></svg>',
  mood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 10.5h.01M15.5 10.5h.01"/><path d="M8 15c1.2 1.2 2.6 1.8 4 1.8s2.8-.6 4-1.8"/></svg>',
  hobby: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z"/></svg>',
  generic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6c0 5.4-8.8 10.4-8.8 10.4S3.2 14 3.2 8.6a4.8 4.8 0 0 1 8.8-2.7 4.8 4.8 0 0 1 8.8 2.7z"/></svg>'
};
function iconFor(cat){ return ICONS[cat.icon] || ICONS.generic; }
function iconBadge(cat){
  return '<span class="icon-badge" style="background:'+cat.color+'">'+iconFor(cat)+'</span>';
}

var categoriesCol = collection(db, 'korravee_categories');
var entriesCol = collection(db, 'korravee_entries');

var customCategories = [];
var categories = DEFAULT_CATS.slice();
var entries = {}; // { 'YYYY-MM-DD': [ {id, cat, text}, ... ] }
var activeFilter = 'all';

function catById(id){ return categories.find(function(c){ return c.id===id; }); }

// Live sync: any change in Firestore (from this device or another) re-renders automatically.
onSnapshot(categoriesCol, function(snap){
  customCategories = snap.docs.map(function(d){
    var v = d.data();
    return {id:d.id, label:v.label, color:v.color, icon:v.icon || null};
  });
  categories = DEFAULT_CATS.concat(customCategories);
  renderChips();
  renderRings();
  renderLog();
}, function(err){ console.error('categories sync error', err); });

onSnapshot(query(entriesCol, orderBy('createdAt', 'asc')), function(snap){
  entries = {};
  snap.docs.forEach(function(d){
    var v = d.data();
    if(!entries[v.date]) entries[v.date] = [];
    entries[v.date].push({id:d.id, cat:v.cat, text:v.text});
  });
  renderRings();
  renderLog();
}, function(err){ console.error('entries sync error', err); });

function renderChips(){
  var wrap = document.getElementById('catChips');
  wrap.innerHTML = '';
  var all = document.createElement('button');
  all.className = 'chip';
  all.type = 'button';
  all.setAttribute('data-active', activeFilter==='all');
  all.textContent = 'ทั้งหมด';
  all.onclick = function(){ activeFilter='all'; renderChips(); renderLog(); };
  wrap.appendChild(all);
  categories.forEach(function(c){
    var b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.setAttribute('data-active', activeFilter===c.id);
    b.innerHTML = iconBadge(c)+escapeHtml(c.label);
    b.onclick = function(){ activeFilter=c.id; renderChips(); renderLog(); };
    wrap.appendChild(b);
  });

  var select = document.getElementById('logCat');
  var prevValue = select.value;
  select.innerHTML = '';
  categories.forEach(function(c){
    var o = document.createElement('option');
    o.value = c.id; o.textContent = c.label;
    select.appendChild(o);
  });
  var custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = '+ หมวดใหม่...';
  select.appendChild(custom);
  if(catById(prevValue)) select.value = prevValue;
}

document.getElementById('logCat').addEventListener('change', function(e){
  document.getElementById('customCatInput').style.display = e.target.value === '__custom__' ? 'inline-block' : 'none';
});

function renderRings(){
  var key = fmtKey(currentDate);
  var dayEntries = entries[key] || [];
  var total = dayEntries.length;
  document.getElementById('ringTotal').textContent = total;

  var counts = {};
  dayEntries.forEach(function(e){ counts[e.cat] = (counts[e.cat]||0) + 1; });
  var used = categories.filter(function(c){ return counts[c.id]; });

  var R = 50, CX = 60, CY = 60;
  var C = 2 * Math.PI * R;
  var svg = document.getElementById('ringSvg');
  var parts = ['<circle class="ring-track" cx="'+CX+'" cy="'+CY+'" r="'+R+'" stroke-width="10"></circle>'];
  var offset = 0;
  var gap = total > 1 ? 6 : 0;
  used.forEach(function(c){
    var frac = counts[c.id] / total;
    var len = Math.max(frac * C - gap, 0);
    parts.push('<circle cx="'+CX+'" cy="'+CY+'" r="'+R+'" stroke="'+c.color+'" stroke-width="10" ' +
      'stroke-dasharray="'+len+' '+(C-len)+'" stroke-dashoffset="'+(-offset)+'"></circle>');
    offset += frac * C;
  });
  svg.innerHTML = parts.join('');

  var legend = document.getElementById('ringLegend');
  legend.innerHTML = '';
  if(total === 0){
    var li = document.createElement('li');
    li.className = 'legend-empty';
    li.textContent = 'ยังไม่มีบันทึกวันนี้ — เริ่มบันทึกกิจกรรมของคุณด้านล่าง';
    legend.appendChild(li);
    return;
  }
  used.forEach(function(c){
    var li = document.createElement('li');
    li.innerHTML = iconBadge(c) + '<span class="legend-label">'+escapeHtml(c.label)+'</span>' +
      '<span class="legend-count">'+counts[c.id]+'</span>';
    legend.appendChild(li);
  });
}

function renderLog(){
  var key = fmtKey(currentDate);
  var list = document.getElementById('logList');
  var dayEntries = (entries[key] || []).slice().reverse();
  if(activeFilter !== 'all'){
    dayEntries = dayEntries.filter(function(e){ return e.cat === activeFilter; });
  }
  list.innerHTML = '';
  if(dayEntries.length === 0){
    var p = document.createElement('li');
    p.className = 'log-empty';
    p.textContent = 'ยังไม่มีบันทึกสำหรับวันนี้ — เริ่มเพิ่มด้านบนได้เลย';
    list.appendChild(p);
    return;
  }
  dayEntries.forEach(function(e){
    var cat = catById(e.cat) || {label:e.cat, color:'#888'};
    var li = document.createElement('li');
    li.className = 'log-entry';
    li.innerHTML =
      iconBadge(cat)+
      '<div class="body">'+
        '<div class="cat">'+escapeHtml(cat.label)+'</div>'+
        '<p class="text">'+escapeHtml(e.text)+'</p>'+
      '</div>'+
      '<button class="del" aria-label="ลบ" data-id="'+e.id+'">✕</button>';
    list.appendChild(li);
  });
  list.querySelectorAll('.del').forEach(function(btn){
    btn.onclick = function(){
      var id = btn.getAttribute('data-id');
      deleteDoc(doc(db, 'korravee_entries', id)).catch(function(err){
        console.error('delete entry failed', err);
      });
    };
  });
}

document.getElementById('addLog').addEventListener('click', function(){
  var addBtn = document.getElementById('addLog');
  var textEl = document.getElementById('logText');
  var text = textEl.value.trim();
  if(!text) return;
  var select = document.getElementById('logCat');
  var catId = select.value;

  function pushEntry(finalCatId){
    var key = fmtKey(currentDate);
    addBtn.disabled = true;
    addDoc(entriesCol, {date:key, cat:finalCatId, text:text, createdAt:serverTimestamp()})
      .then(function(){
        textEl.value = '';
      })
      .catch(function(err){ console.error('add entry failed', err); })
      .finally(function(){ addBtn.disabled = false; });
  }

  if(catId === '__custom__'){
    var name = document.getElementById('customCatInput').value.trim();
    if(!name) return;
    var palette = ['#3f7d4f','#b5652e','#8a5fb0','#2b6ea6','#c04848','#3a8a8a'];
    var color = palette[categories.length % palette.length];
    addBtn.disabled = true;
    addDoc(categoriesCol, {label:name, color:color, icon:null})
      .then(function(newCatRef){
        document.getElementById('customCatInput').value = '';
        pushEntry(newCatRef.id);
      })
      .catch(function(err){ console.error('add category failed', err); addBtn.disabled = false; });
  } else {
    pushEntry(catId);
  }
});

document.getElementById('prevDay').addEventListener('click', function(){
  currentDate = new Date(currentDate.getTime() - DAY_MS);
  renderTimeline(); renderRings(); renderLog();
});
document.getElementById('nextDay').addEventListener('click', function(){
  currentDate = new Date(currentDate.getTime() + DAY_MS);
  renderTimeline(); renderRings(); renderLog();
});
document.getElementById('todayBtn').addEventListener('click', function(){
  currentDate = new Date();
  renderTimeline(); renderRings(); renderLog();
});

renderChips();
renderTimeline();
renderRings();
renderLog();
