/** The local labeling page: plain HTML and JS, no network except this server. All text is inserted with textContent. */
export const LABEL_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Why: label a day</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:900px;padding:16px;color:#1b1b1f;background:#fafaf7}
h1{font-size:1.3rem}h2{font-size:1.1rem;margin-top:28px}
.banner{background:#fff3cd;border:1px solid #e0c36a;padding:8px 12px;border-radius:6px}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 12px;margin:8px 0}
.utt{display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-bottom:1px solid #eee}
.utt span.t{flex:1}.meta{color:#666;font-size:.85rem;min-width:70px}
button{font:inherit;padding:4px 10px;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer}
button.on{background:#1b1b1f;color:#fff}
input[type=text]{font:inherit;padding:4px 8px;width:70%}
.ok{color:#116611}.err{color:#a11}
</style></head><body>
<h1>Why: mark the real decisions of one day</h1>
<p class="banner">Local only. This page and the labels file stay on your computer (127.0.0.1, data/ folder). Nothing is uploaded.</p>
<p><label>Day <input id="day" type="date"></label> <button id="load">Load</button> <span id="status"></span></p>
<div id="app" hidden>
<h2>1. Why's decisions: real or not?</h2><div id="why"></div>
<h2>2. What you said that Why missed</h2>
<p>Click "Add" next to an utterance to propose it as a decision (edit the wording), or type your own.</p>
<div id="added"></div>
<p><input id="own" type="text" placeholder="A real decision Why missed"> <button id="addown">Add</button></p>
<h2>3. The utterances of the day</h2><div id="utts"></div>
<p><button id="save">Save labels</button> <span id="saved"></span></p>
</div>
<script>
const $=id=>document.getElementById(id);
let state={day:'',why:[],verdict:[],added:[]};
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
function renderWhy(){const box=$('why');box.replaceChildren();
 if(!state.why.length)box.append(el('p','','Why found no decisions for this day.'));
 state.why.forEach((w,i)=>{const c=el('div','card');c.append(el('div','',w));
  for(const v of ['real','not a decision']){const b=el('button',state.verdict[i]===v?'on':'',v);b.onclick=()=>{state.verdict[i]=v;renderWhy()};c.append(b,' ')}
  box.append(c)})}
function renderAdded(){const box=$('added');box.replaceChildren();
 state.added.forEach((a,i)=>{const c=el('div','card');const inp=el('input');inp.type='text';inp.value=a;inp.oninput=()=>{state.added[i]=inp.value};
  const rm=el('button','','Remove');rm.onclick=()=>{state.added.splice(i,1);renderAdded()};c.append(inp,' ',rm);box.append(c)})}
function renderUtts(sessions){const box=$('utts');box.replaceChildren();
 for(const s of sessions){box.append(el('h3','',new Date(s.startedAt).toLocaleTimeString()+' to '+new Date(s.endedAt).toLocaleTimeString()));
  for(const u of s.utterances){const r=el('div','utt');r.append(el('span','meta',(u.at?new Date(u.at).toLocaleTimeString():'')+' '+u.speaker),el('span','t',u.text));
   const b=el('button','','Add');b.onclick=()=>{state.added.push(u.text);renderAdded()};r.append(b);box.append(r)}}}
$('load').onclick=async()=>{const day=$('day').value;$('status').textContent='';
 const r=await fetch('/api/day?day='+encodeURIComponent(day));if(!r.ok){$('status').textContent='Could not load that day';$('status').className='err';return}
 const d=await r.json();state={day,why:d.why,verdict:d.why.map(w=>d.labels&&d.labels.confirmed.includes(w)?'real':d.labels&&d.labels.rejected.includes(w)?'not a decision':''),added:d.labels?d.labels.added.slice():[]};
 $('app').hidden=false;renderWhy();renderAdded();renderUtts(d.sessions);$('status').textContent=d.sessions.length+' sessions';$('status').className=''};
$('addown').onclick=()=>{const v=$('own').value.trim();if(v){state.added.push(v);$('own').value='';renderAdded()}};
$('save').onclick=async()=>{const open=state.verdict.filter(v=>!v).length;
 if(open){$('saved').textContent='Judge every Why decision first ('+open+' left)';$('saved').className='err';return}
 const body={day:state.day,confirmed:state.why.filter((w,i)=>state.verdict[i]==='real'),rejected:state.why.filter((w,i)=>state.verdict[i]==='not a decision'),added:state.added.map(a=>a.trim()).filter(Boolean)};
 const r=await fetch('/api/labels',{method:'POST',headers:{'content-type':'application/json','x-why-label':'1'},body:JSON.stringify(body)});
 $('saved').textContent=r.ok?'Saved. Now run: npm run accuracy -- --day '+state.day:'Could not save';$('saved').className=r.ok?'ok':'err'};
$('day').value=new Date().toISOString().slice(0,10);
</script></body></html>`;
