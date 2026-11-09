/* ============================================================
   COMMUNITY: the Synthux community directory and the firmware repositories it lists.
   Everything read here is other people's text. It only reaches the page escaped
   (labels, notes and excerpts); a creator's faceplate SVG is cleaned (sanitizeFaceplate) and their look
   passes as plain values only (lookOf, safeFpStyle).
   Needs core.js (SLOT, LIMITS, NO_LINE2, emptyDoc, normalise, REPO_RE, safeHttps, lookOf, sanitizeFaceplate).
   ============================================================ */
const COMMUNITY = {
  list: 'https://synthux-academy.github.io/community-instruments/projects.json',
  repo: 'https://github.com/Synthux-Academy/community-instruments',
  page: 'https://synthux-academy.github.io/community-instruments/',
};
/* the file a firmware repository can carry, at its root, for the library to show */
const LABEL_FILE = 'simple-touch-labels.json';

let directoryReq = null;
/* every entry, all platforms (the designer checks new entries against these) */
function loadDirectory(){
  return directoryReq ||= fetch(COMMUNITY.list).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(d=>(Array.isArray(d.projects)? d.projects : [])
      .filter(p=>p && typeof p.id==='string' && typeof p.name==='string' && REPO_RE.test(p.repo||''))
      .sort((a,b)=>a.name.localeCompare(b.name)))
    .catch(e=>{ directoryReq=null; throw e; });
}
/* Simple Touch entries, without those already in EXAMPLES (matched by repo) */
const loadCommunity = () => loadDirectory().then(list=>list.filter(p=>p.platform==='touch' && !Object.values(EXAMPLES).some(e=>e.repo===p.repo)));
/* A directory entry as a manual with no labels yet */
function communityDoc(p){
  const d=emptyDoc(), a=p.author||{};
  Object.assign(d.firmware, {name:String(p.name).slice(0,LIMITS.name), author:String(a.name||'').slice(0,LIMITS.author),
    description:String(p.description||'').slice(0,LIMITS.desc), repo:p.repo, authorUrl:safeHttps(a.url)});
  return d;
}

/* ============================================================
   FILES IN A REPOSITORY: default branch, GitHub (raw) or Codeberg (API, which sends CORS)
   ============================================================ */
const MAX_FILE = 400000, MAX_FACEPLATE = 8000000;   // a faceplate SVG can hold an image
const repoParts = url => { const m=String(url).match(/^https:\/\/(github\.com|codeberg\.org)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/); return m && {host:m[1], owner:m[2], name:m[3]}; };
async function repoFile(repo, path, max=MAX_FILE){
  const r=repoParts(repo); if(!r) return null;
  const p=path.split('/').filter(s=>s && s!=='.' && s!=='..').map(encodeURIComponent).join('/');
  const gh=r.host==='github.com';
  const raw= gh? `https://raw.githubusercontent.com/${r.owner}/${r.name}/HEAD/${p}` : `https://codeberg.org/api/v1/repos/${r.owner}/${r.name}/raw/${p}`;
  try{
    const res=await fetch(raw); if(!res.ok) return null;
    const text=await res.text(); if(text.length>max) return null;
    return {path:decodeURIComponent(p), text, url: gh? `${repo}/blob/HEAD/${p}` : `${repo}/src/branch/HEAD/${p}`};
  }catch(e){ return null; }
}
/* A faceplate file named by a label file: an SVG as it is, an image wrapped as an upload is (imageFaceplate) */
async function repoFaceplate(repo, path){
  if(!FP_PATH.test(path||'')) return null;
  if(/\.svg$/i.test(path)){ const f=await repoFile(repo, path, MAX_FACEPLATE); return f && f.text; }
  const r=repoParts(repo); if(!r) return null;
  const p=path.split('/').map(encodeURIComponent).join('/');
  return faceplateAt(r.host==='github.com'? `https://raw.githubusercontent.com/${r.owner}/${r.name}/HEAD/${p}` : `https://codeberg.org/api/v1/repos/${r.owner}/${r.name}/raw/${p}`, path);
}
/* the faceplate file at url; its path says whether it is an SVG or an image */
async function faceplateAt(url, path){
  if(!FP_PATH.test(path||'')) return null;
  try{
    const res=await fetch(url); if(!res.ok) return null;
    const blob=await res.blob(); if(blob.size>MAX_FACEPLATE) return null;
    if(/\.svg$/i.test(path)) return await blob.text();
    const ext=path.split('.').pop().toLowerCase(), type={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif'}[ext];
    return (await imageFaceplate(new Blob([blob],{type}))).svg;
  }catch(e){ return null; }
}
async function repoReadme(repo){
  for(const n of ['README.md','readme.md','Readme.md']){ const f=await repoFile(repo,n); if(f) return f; }
  return null;
}
/* relative links to Markdown files that look like the manual, going by the link's text, its path and the words
   before it in the same clause of the line (Creek: "**Firmware and manual**: [daisy/README.md](daisy/README.md)";
   "Manual: [a.html](a.html) · Report: [REPORT.md](REPORT.md)" is two clauses, so the report doesn't count) */
function manualLinks(md){
  const out=[];
  for(const m of md.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)){
    const [,text,href]=m, before=md.slice(md.lastIndexOf('\n',m.index)+1, m.index).split(/\s[·|]\s|[.;]\s/).pop();
    const path=href.split('#')[0];
    if(!path || /^[a-z][a-z0-9+.-]*:|^\//i.test(path) || !/\.md$/i.test(path) || !/manual|controls|usage|guide/i.test(text+' '+path+' '+before)) continue;
    let resolved; try{ resolved=decodeURIComponent(new URL(path,'https://r/').pathname.slice(1)); }catch(e){ continue; }
    if(!/^readme\.md$/i.test(resolved) && !out.includes(resolved)) out.push(resolved);
  }
  return out.slice(0,2);
}

/* A label file from a repository: only the label data, as strings of the usual lengths,
   and a browser build only if it comes from that same repository (emulatorOf) */
function labelFileDoc(d, repo){
  if(!d || typeof d!=='object' || !d.labels || !d.firmware) return null;
  const s=normalise(d), str=(v,n)=>typeof v==='string'? v.slice(0,n) : '';
  const labels={};
  for(const [id,o] of Object.entries(s.labels||{})){
    if(!SLOT[id] || !o || typeof o!=='object') continue;
    const c={}; for(const [k,v] of Object.entries(o)) if(LABEL_KEY.test(k)) c[k]=str(v, k==='main'? LIMITS.line : k==='midi'? LIMITS.midi : LIMITS.line2);
    labels[id]=c;
  }
  const fw={}; for(const [k,n] of Object.entries({name:LIMITS.name,author:LIMITS.author,version:LIMITS.version,description:LIMITS.desc,notes:LIMITS.notes,repo:200,authorUrl:200})) fw[k]=str(s.firmware[k],n);
  const num=v=>Number.isFinite(v)? v : 0;
  const offs=o=>Object.fromEntries(Object.entries(o||{}).filter(([k,v])=>v&&typeof v==='object').map(([k,v])=>[k,{x:num(v.x),y:num(v.y),...(ROTS.includes(v.r)&&v.r?{r:v.r}:{})}]));
  return {...emptyDoc(), firmware:{...emptyDoc().firmware,...fw}, labels,
    modifiers:(s.modifiers||[]).filter(id=>SLOT[id]), combos:s.combos, modTypes:Object.fromEntries(Object.entries(s.modTypes||{}).filter(([k,v])=>SLOT[k]&&v==='toggle')),
    customs:(s.customs||[]).filter(c=>c&&typeof c==='object').map(c=>({id:num(c.id), text:str(c.text,LIMITS.line), sub:str(c.sub,LIMITS.line2), x:num(c.x), y:num(c.y), style:customStyleOf(c.style,true)||undefined})),
    offsets:{phone:offs(s.offsets.phone), desktop:offs(s.offsets.desktop)}, emulator:emulatorOf(d.emulator, repo), modes:s.modes, device:s.device, oled:s.oled,
    // the creator's look, and their faceplate: a file in the repository (read by readRepoNow) or, in older files, the SVG itself
    look:lookOf(d), faceplateFile:s.faceplateFile, faceplate: typeof s.faceplate==='string' && s.faceplate.trim().startsWith('<')? s.faceplate : '',
    fpStyle:safeFpStyle(d.fpStyle), fpDesktop:s.fpDesktop, fpLabels:s.fpLabels};
}

/* What the library and designer show for a directory entry, in this order:
   1. the repository's simple-touch-labels.json, made by its creator in the designer
   2. labels a script reads from its README (and a linked manual)
   3. the entry alone, with blank labels */
const repoReads = {};
const readRepo = p => repoReads[p.repo] ||= readRepoNow(p).catch(()=>({doc:communityDoc(p), source:'none', files:[]}));
/* A label file's text as a doc, with its faceplate read by faceplate(path) and cleaned; null if it isn't one */
async function labelDocOf(text, repo, faceplate){
  let d=null; try{ d=labelFileDoc(JSON.parse(text), repo); }catch(e){}
  if(!d) return null;
  if(d.faceplateFile) d.faceplate=await faceplate(d.faceplateFile) || '';
  try{ if(d.faceplate) d.faceplate=sanitizeFaceplate(d.faceplate); }catch(e){ d.faceplate=''; }
  const q=d.fpDesktop;   // the desktop layout's own art, if it has any
  if(q?.file && !q.faceplate) q.faceplate=await faceplate(q.file) || '';
  try{ if(q?.faceplate) q.faceplate=sanitizeFaceplate(q.faceplate); }catch(e){ q.faceplate=''; }
  return d;
}
async function readRepoNow(p){
  const base=communityDoc(p);
  const lf=await repoFile(p.repo, LABEL_FILE);
  if(lf){
    const d=await labelDocOf(lf.text, p.repo, path=>repoFaceplate(p.repo, path));
    if(d){
      for(const k of ['name','author','description','repo','authorUrl']) if(!d.firmware[k].trim()) d.firmware[k]=base.firmware[k];
      return {doc:d, source:'file', files:[lf]};
    }
  }
  const rd=await readmeLabels(p.repo);
  if(!rd) return {doc:base, source:'none', files:[]};
  const {files, ex}=rd;
  if(!ex.found.length) return {doc:base, source:'none', files};
  base.labels=ex.labels; base.modifiers=ex.modifiers; base.combos=ex.combos; base.modes=modesFrom(ex);
  return {doc:base, source:'readme', files, found:ex.found, modes:ex.modes};
}

/* a repository's README and the manual it links to, and the labels a script reads from them; null without a README */
async function readmeLabels(repo){
  const rd=await repoReadme(repo); if(!rd) return null;
  const files=[rd];
  for(const path of manualLinks(rd.text)){ const f=await repoFile(repo,path); if(f) files.push(f); }
  return {files, ex:extractLabels(files)};
}

/* ============================================================
   README EXTRACTION: control names as READMEs write them → labels.
   Reads, best first: table rows (| S30 | **Cutoff** |), modifier pairs (P11 + S30 – Delay time,
   or **Width** (P10 + S30)), lines that start with a control (- **P01** - Throw a stone),
   headings (### Switch A — transport), then bold controls in sentences (**S32** harmonics).
   Modes: a heading that names a switch position (### Basic Pitch (SW2 Down)) starts a section for that
   mode, up to the next heading of its level. Labels from one mode never mix with another's: labelsOf()
   fills a panel from one mode (the first, by default) and what's outside every mode section.
   A guess all the same, and it never reads code blocks.
   ============================================================ */
const PAD = n => 'P'+String(n).padStart(2,'0');
/* Synthux names (S30, P03, S07-S08), short pads (P3), Pd names (knob1, faderleft, sw1) and plain words */
/* case-sensitive on purpose: "Switch A" is a control, "switch a voice" is not */
const CTRL_RE = /\b(?:P(?<pad>1[01]|0?\d)|S(?<pot>3[0-7])|S0?(?<sw>7|8|9|10)(?:\s*[-/]\s*S0?(?:7|8|9|10))?|[Kk]nob\s?(?<knob>[1-6])|[Ff]ader\s?(?<fd1>[Ll]eft|[Rr]ight)|(?<fd2>[Ll]eft|[Rr]ight)\s(?:[Ff]ader|[Ss]lider)|(?:SW|sw|[Ss]witch)\s?(?<swn>[12AB])|(?<swd>[Ll]eft|[Rr]ight)\s(?:[Ss]witch|[Tt]oggle))\b/g;
const RANGE_RE = /\bP(1[01]|0?\d)\s*(?:–|—|-|\.{2,3}|…|to)\s*P(1[01]|0?\d)\b/g;
function ctrlOf(g){
  if(g.pad) return PAD(+g.pad);
  if(g.pot) return 'S'+g.pot;
  if(g.sw) return +g.sw<=8? 'S07_S08' : 'S09_S10';
  if(g.knob) return 'S'+(29+ +g.knob);
  const fd=g.fd1||g.fd2; if(fd) return /left/i.test(fd)? 'S36' : 'S37';
  if(g.swn) return /[1a]/i.test(g.swn)? 'S09_S10' : 'S07_S08';   // switch A / SW1 is the left one (S09/S10)
  if(g.swd) return /left/i.test(g.swd)? 'S09_S10' : 'S07_S08';
}
const tokens = s => [...s.matchAll(CTRL_RE)].map(m=>({id:ctrlOf(m.groups), i:m.index, j:m.index+m[0].length}));
const isPad = id => /^P\d\d$/.test(id);
/* Markdown down to lines: no code blocks, images or HTML; links become their text; bold stays */
const plainMd = md => md.replace(/\r/g,'').replace(/```[\s\S]*?```/g,'').replace(/<!--[\s\S]*?-->/g,'')
  .replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/<[^>]+>/g,' ').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/`/g,'').replace(/__([^_\n]+)__/g,'**$1**');
const STOP = /^(to|and|or|the|a|an|is|are|while|then|with|for|in|on|at|of|by|as|left|right|up|down|centre|center|middle|press|hold|tap|turn|see|it|this|that|you|same|also|only)\b/i;
const GESTURE = /^(press|hold|tap|double[ -]?tap|long[ -]?press|turn|touch|-|—|–)$/i;
const capFirst = t => t.charAt(0).toUpperCase()+t.slice(1);
/* the label at the start of a description: bold text, or the first phrase */
function labelFrom(rest, maxWords=6){
  // without the closing ** of a bold control name, and the separator after it
  let r=rest.replace(/^\*\*(?=\s|[^*A-Za-z0-9]|$)/,'').replace(/^[\s:|·\-–—=→>),]+/,'');
  const b=r.match(/^\*\*([^*]{1,40})\*\*/);
  let t= b? b[1] : r.replace(/\*+/g,'').split(/\s[-–—|·]\s|[:;(|]|[.,](?:\s|$)/)[0];
  t=t.replace(/\*+/g,'').replace(/\s+/g,' ').trim().replace(/[.,:;]$/,'');
  if(t.length<2 || t.length>40 || !/^[A-Za-z0-9]/.test(t) || !/[A-Za-z]/.test(t) || STOP.test(t) || tokens(t).length || t.split(' ').length>maxWords) return '';
  return capFirst(t);
}
/* after a control, a label is set off: bold, or after a separator ("S31 **Scale**", "P01 - Throw a stone", "P10 + S30 | Drive") */
const setOff = s => /^\s*(?:\([^)]{0,20}\)\s*)?(?:\*\*[^*\s]|[-–—:·=→|]\s*)/.test(s.replace(/^\*\*(?=\s|[^*A-Za-z0-9]|$)/,''));
/* split a label over line 1 and line 2 at a word boundary */
function fitWords(t, max){
  if(t.length<=max) return [t,''];
  const w=t.split(' '); let a='';
  while(w.length && (a+' '+w[0]).trim().length<=max) a=(a+' '+w.shift()).trim();
  return a? [a, w.join(' ')] : [t.slice(0,max), ''];
}
/* "Basic Pitch (SW2 Down)" → {id:'S07_S08', pos:'down', name:'Basic Pitch'}: a heading for one switch position */
const POS_RE = /^\s*[:=]?\s*(up|down|cent(?:re|er)|middle|left|right)\b/i;
function modeOf(text){
  for(const t of tokens(text)){
    if(!/^S\d\d_S\d\d$/.test(t.id) || !/\([^)]*$/.test(text.slice(0,t.i))) continue;
    const p=text.slice(t.j).match(POS_RE); if(!p) continue;
    const name=text.slice(0,text.lastIndexOf('(',t.i)).replace(/\*+/g,'').replace(/[\s:—–-]+$/,'').trim();
    if(name) return {id:t.id, pos:/^(cent|mid)/i.test(p[1])? 'centre' : p[1].toLowerCase(), name:name.slice(0,LIMITS.line)};
  }
  return null;
}
function extractLabels(files){
  const best={}, modSeen=[], modes=[]; let seq=0;
  for(const f of files){
    let mode=null;   // the mode section this line is in: {level, key}
    for(const line of plainMd(f.text).split('\n')){
      const raw=line.trim(); if(!raw) continue;
      const excerpt=raw.length>160? raw.slice(0,157)+'…' : raw;
      const hd=raw.match(/^(#{1,6})\s/);
      if(hd){
        if(mode && hd[1].length<=mode.level) mode=null;
        const m=modeOf(raw.slice(hd[0].length));
        if(m){ const key=m.id+':'+m.pos; if(!modes.some(x=>x.key===key)) modes.push({key,...m}); mode={level:hd[1].length, key}; }
      }
      const put=(id,key,text,tier)=>{
        if(!SLOT[id] || !text || key==='m_'+id) return;
        const md=mode? mode.key : '', k=id+'|'+key+'|'+md, o=best[k]; if(o && o.tier<=tier) return;
        best[k]={id,key,text,tier,mode:md,n:seq++,file:f.path,url:f.url,line:excerpt};
        if(key.startsWith('m_') && !modSeen.includes(key.slice(2))) modSeen.push(key.slice(2));
      };
      const tk=tokens(raw);
      if(!tk.length) continue;
      // modifier pairs anywhere: "P11 + S30 – Delay time", "P11 + right fader (S37) - Cutoff", "**Width** (P10 + S30)"
      for(let n=0;n<tk.length-1;n++){
        const a=tk[n], b=tk[n+1];
        if(!isPad(a.id) || a.id===b.id || !/^\s*\*{0,2}\s*\+\s*\*{0,2}\s*$/.test(raw.slice(a.j,b.i))) continue;
        let end=b.j; const c=tk[n+2];
        // pads held together: "P10 + P11 + S36 – Volume", "P10 + P11 hold, move S36 | Volume", "**Volume** (P10 + P11 + S36)"
        if(c && isPad(b.id) && c.id!==a.id && c.id!==b.id && /^\s*(?:\*{0,2}\s*\+\s*\*{0,2}|hold(?:ing)?\s*,?\s*(?:and\s+)?(?:move|turn|touch|tap|press)?)\s*$/i.test(raw.slice(b.j,c.i))){
          const d=tk[n+3], tail=d && d.id===c.id && /^\s*\(\s*$/.test(raw.slice(c.j,d.i))? d.j+1 : c.j;   // "right fader (S37)"
          let t= setOff(raw.slice(tail))? labelFrom(raw.slice(tail)) : '';
          if(!t){ const m=raw.slice(0,a.i).match(/\*\*([^*]{1,40})\*\*\s*\(\s*(?:hold\s+)?$/i); if(m) t=labelFrom('**'+m[1]+'**'); }
          put(c.id,'m_'+comboId([a.id,b.id]),t,raw.startsWith('|')? 1 : 2);
          n++; continue;
        }
        // "P0 + P10 / P11 | Root semitone down / up": two pairs, a name each
        if(c && isPad(b.id) && isPad(c.id) && c.id!==a.id && /^\s*\/\s*$/.test(raw.slice(b.j,c.i)) && !/^\s*\+/.test(raw.slice(c.j))){
          const [x,y]=twoNames(raw.slice(c.j)), tier=raw.startsWith('|')? 1 : 2;
          put(b.id,'m_'+a.id,x,tier); put(c.id,'m_'+a.id,y,tier); n++; continue;
        }
        if(c && c.id===b.id && /^\s*\(\s*$/.test(raw.slice(b.j,c.i))) end=c.j+1;   // "right fader (S37)"
        let t= setOff(raw.slice(end))? labelFrom(raw.slice(end)) : '';
        if(!t){ const m=raw.slice(0,a.i).match(/\*\*([^*]{1,40})\*\*\s*\(\s*(?:hold\s+)?$/i); if(m) t=labelFrom('**'+m[1]+'**'); }
        put(b.id,'m_'+a.id,t,raw.startsWith('|')? 1 : 2);
      }
      if(raw.startsWith('|')) tableRow(raw,put);
      else if(/^#{1,6}\s/.test(raw)) heading(raw,put);
      else if(!subjectLine(raw.replace(/^(?:[-*+>]|\d+[.)])\s+/,''),put)) prose(raw,put);
    }
  }
  // modes on one switch only (the one with the most); sections for another switch count as outside every mode
  const sw=Object.entries(modes.reduce((c,m)=>(c[m.id]=(c[m.id]||0)+1, c),{})).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const ms=modes.filter(m=>m.id===sw), found=Object.values(best);
  for(const b of found) if(b.mode && !ms.some(m=>m.key===b.mode)) b.mode='';
  const order=TABLE_ORDER.concat(SLOTS.map(s=>s.id)), mi=k=>ms.findIndex(m=>m.key===k);
  found.sort((x,y)=>order.indexOf(x.id)-order.indexOf(y.id) || (x.key==='main'? -1 : y.key==='main'? 1 : x.key.localeCompare(y.key)) || mi(x.mode)-mi(y.mode));
  const ex={found, modes:ms, modSeen, mode:ms[0]?.key||''};
  return {...ex, ...labelsOf(ex, ex.mode)};
}
/* the modes a script read, as a doc's modes (cleanModes, core.js): where the modes differ, each keeps its own
   label; where they agree, the print set (the first mode's, from extractLabels) holds it alone */
function modesFrom(ex){
  if(ex.modes.length<2) return null;
  const per=ex.modes.map(m=>labelsOf(ex,m.key).labels), keys=new Set();
  for(const l of per) for(const [id,o] of Object.entries(l)) for(const k of Object.keys(o)) keys.add(id+'|'+k);
  const list=ex.modes.map(m=>({pos:m.pos, name:m.name, labels:{}}));
  for(const ik of keys){
    const [id,k]=ik.split('|'), vs=per.map(l=>(l[id]||{})[k]||'');
    if(!vs.every(v=>v===vs[0])) vs.forEach((v,i)=>{ if(v) (list[i].labels[id] ||= {})[k]=v; });
  }
  return cleanModes({switch:ex.modes[0].id, list});
}
/* the panel for one mode: its own labels first, then what's outside every mode; best tier, then first seen */
function labelsOf(ex, mode){
  const pick={};
  for(const f of ex.found){
    if(f.mode && f.mode!==mode) continue;
    const k=f.id+'|'+f.key, o=pick[k];
    if(!o || (!!f.mode!==!!o.mode? !!f.mode : f.tier<o.tier || (f.tier===o.tier && f.n<o.n))) pick[k]=f;
  }
  const labels={}, used=new Set();
  for(const b of Object.values(pick)){
    const o=labels[b.id] ||= {};
    if(b.key==='main'){ const [l1,l2]=fitWords(b.text,LIMITS.line); o.main=l1; if(l2 && !NO_LINE2.includes(b.id)) o.main_2=fitWords(l2,LIMITS.line2)[0]; }
    else { o[b.key]=fitWords(b.text,LIMITS.line2)[0]; used.add(b.key.slice(2)); }
  }
  return {labels, modifiers:ex.modSeen.filter(id=>SLOT[id] && used.has(id)).slice(0,MOD_MAX), combos:ex.modSeen.filter(id=>comboOk(id) && used.has(id))};
}
/* | S30 | **Main** — mix level |, | P03 | Press | **Saturation** burst |, | 22 | S31 **Scale** | */
function tableRow(raw, put){
  const cells=raw.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
  if(cells.every(c=>/^[\s:-]*$/.test(c))) return;
  for(let k=0;k<cells.length;k++){
    const c=cells[k].replace(/^\*\*(?=\S)/,''), t=tokens(c);
    if(!t.length || t[0].i>0) continue;
    const next=()=>cells.slice(k+1).find(x=>x && !GESTURE.test(x) && !/^[\d\s.,%–-]+$/.test(x))||'';
    // | P3–P9 | Play notes |: a range, one name for all or one per pad
    const rg=[...c.matchAll(RANGE_RE)][0];
    if(rg && rg.index===0 && !c.slice(rg[0].length).trim()){ rangeList(+rg[1],+rg[2],next(),put,1); return; }
    // | P10 / P11 | Octave down / up |: two pads, a name each
    if(t.length===2 && isPad(t[0].id) && isPad(t[1].id) && /^\s*\/\s*$/.test(c.slice(t[0].j,t[1].i)) && !c.slice(t[1].j).trim()){
      const [a,b]=twoNames(next()); put(t[0].id,'main',a,1); put(t[1].id,'main',b,1);
      return;
    }
    if(t.some(x=>x.id!==t[0].id) || /^\s*\+/.test(c.slice(t[0].j))) return;   // a pair or a range ("P2 + pad"), not a name
    const own= setOff(c.slice(t[0].j))? labelFrom(c.slice(t[0].j)) : '';   // "S31 **Scale**", not "P10 alone"
    put(t[0].id,'main',own||labelFrom(next(),8),1);
    return;
  }
}
/* ### Switch A (left) — transport, ### Polyrhythmic Grid Shift — Switch A */
function heading(raw, put){
  const text=raw.replace(/^#+\s*/,''), t=tokens(text);
  if(!t.length || t.some(x=>x.id!==t[0].id) || /\([^)]*$/.test(text.slice(0,t[0].i))) return;   // not "### Basic Pitch (SW2 Down)": a mode
  const rest=(text.slice(0,t[0].i)+' '+text.slice(t[0].j)).replace(/\([^)]{0,20}\)/g,' ').replace(/^[\s:—–-]+|[\s:—–-]+$/g,'');
  put(t[0].id,'main',labelFrom(rest),3);
}
/* a line that starts with a control (or a pad range): "**P01** - Throw a stone", "S36 (left) **Level** | …" */
function subjectLine(body, put){
  const lead=body.replace(/^\*\*/,'');
  const rg=[...lead.matchAll(RANGE_RE)][0];
  if(rg && rg.index===0){ rangeList(+rg[1],+rg[2],lead.slice(rg[0].length),put,2); return true; }
  const t=tokens(lead); if(!t.length || t[0].i>0) return false;
  // a list entry ("- **P10** - Freeze", "- P03 Kick"), not a sentence ("Switch B selects one of three scenes")
  const after=lead.slice(t[0].j); if(!setOff(after) && after.trim().split(/\s+/).length>3) return false;
  // several "**P03** - Quiet trickle | **P04** - Rocky creek" on one line
  const segs=body.split(/\s\|\s/), many=segs.length>1 && segs.every(s=>{ const x=tokens(s.replace(/^\s*\*\*/,'')); return x.length && x[0].i===0; });
  for(const seg of many? segs : [body]){
    const s=seg.trim().replace(/^\*\*/,''), x=tokens(s)[0];
    const rest=s.slice(x.j).replace(/^\*\*/,'').replace(/^\s*\([^)]{0,20}\)/,'');
    put(x.id,'main',labelFrom(rest),2);
    // "… | Hold P10: **Width**": the same control with a modifier
    if(!many) for(const m of rest.matchAll(/\bhold\s+P(1[01]|0?\d)\s*[:\-–—]\s*/gi)) put(x.id,'m_'+PAD(+m[1]),labelFrom(rest.slice(m.index+m[0].length)),2);
  }
  return true;
}
/* "Octave down / up" → Octave down, Octave up; "Drum pitch −1 / +1 semitone" → Drum pitch −1, Drum pitch +1 semitone;
   "Previous / next kick preset" → Previous kick preset, Next kick preset */
function twoNames(text){
  const [a='',b='']=text.replace(/^[\s|:—–-]+/,'').split(/\s\|\s|\s[–—]\s/)[0].split(/\s+\/\s+/).map(s=>s.trim());
  if(!a || !b) return ['',''];
  const wa=a.split(' '), wb=b.split(' ');
  if(wa.length===1 && wb.length>1 && /^[A-Za-z]/.test(b)) return [labelFrom([a,...wb.slice(1)].join(' ')), labelFrom(b)];
  const lone=wb.length===1 || !/^[A-Za-z]/.test(b);
  return [labelFrom(a), labelFrom(lone && wa.length>1? [...wa.slice(0,-1),b].join(' ') : b)];
}
/* P03–P09 followed by as many names as pads ("kick, snare, …", "Play drums: kick / snare / cl. hat / …"),
   or one name for all of them */
function rangeList(a, b, rest, put, tier, listOnly=false){
  if(b<=a || b-a>11) return;
  const ids=[]; for(let n=a;n<=b;n++) ids.push(PAD(n));
  for(const r of [rest.replace(/^[^:]{1,30}:\s*/,''), rest]){
    const items=r.replace(/^\*\*/,'').replace(/^[\s:—–-]+/,'').replace(/\.\s*$/,'').split(/,\s*|\s+\/\s+|\s+and\s+/).map(s=>s.trim());
    // a name each, abbreviations kept ("cl. hat")
    const name=s=>labelFrom(s.replace(/\.(?=\s)/g,''))? capFirst(s.replace(/\*+/g,'').trim()) : '';
    if(items.length===ids.length && items.every(s=>s && s.split(' ').length<=4)){ ids.forEach((id,n)=>put(id,'main',name(items[n]),tier)); return; }
  }
  if(!listOnly){ const t=labelFrom(rest); if(t) ids.forEach(id=>put(id,'main',t,tier)); }
}
/* sentences: "**S32** harmonics, **S33** timbre", "Turn **S31** for tempo", "the musical pads **P3–P9** — kick, snare, …" */
function prose(raw, put){
  for(const m of raw.matchAll(/\*\*([^*]{1,24})\*\*\s+(?:for\s+|sets?\s+(?:the\s+)?)?([A-Za-z][\w'↔/ -]{1,30}?)(?=\s*(?:[,.;:)]|$)|\s(?:and|while|then|to)\s)/g)){
    const t=tokens(m[1]);
    if(t.length!==1 || t[0].i>0 || t[0].j<m[1].trim().length) continue;
    put(t[0].id,'main',labelFrom(m[2],3),4);
  }
  for(const m of raw.matchAll(RANGE_RE)) rangeList(+m[1],+m[2],raw.slice(m.index+m[0].length),put,3,true);
}

/* ============================================================
   README: a repository's own README.md, under its manual in the library, drawn as GitHub draws it.
   Markdown by marked, cleaned by DOMPurify (no scripts, styles, forms or event handlers; ids get
   user-content- in front, as on GitHub, so they never clash with the page's). Relative images point
   at the repository's raw files and relative links at its pages. A video link on a line of its own
   becomes a player, a YouTube link an embed, a ```mermaid block its drawing. The libraries load from
   jsDelivr, pinned by hash, when a README is first opened; mermaid only for one with a flowchart.
   ============================================================ */
const README_LIBS = {
  marked:    ['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',        'sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi'],
  DOMPurify: ['https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js', 'sha384-+VfUPEb0PdtChMwmBcBmykRMDd+v6D/oFmB3rZM/puCMDYcIvF968OimRh4KQY9a'],
  mermaid:   ['https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js',  'sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I'],
};
const libReqs = {};
function loadLib(name){
  return libReqs[name] ||= new Promise((ok,no)=>{
    const [src,integrity]=README_LIBS[name], s=document.createElement('script');
    Object.assign(s,{src, integrity, crossOrigin:'anonymous'});
    s.onload=()=> window[name]? ok(window[name]) : no(new Error(name+' did not load'));
    s.onerror=()=>{ delete libReqs[name]; s.remove(); no(new Error(name+' could not be loaded')); };
    document.head.append(s);
  });
}
const readmeReqs = {};
const readmeOf = repo => readmeReqs[repo] ||= repoReadme(repo).then(f=>{ if(!f) delete readmeReqs[repo]; return f; });

/* where a README's relative paths point: raw (images, videos) and page (links) */
function repoBases(repo){
  const r=repoParts(repo); if(!r) return null;
  return r.host==='github.com'
    ? {raw:`https://raw.githubusercontent.com/${r.owner}/${r.name}/HEAD/`, page:`${repo}/blob/HEAD/`}
    : {raw:`https://codeberg.org/api/v1/repos/${r.owner}/${r.name}/raw/`, page:`${repo}/src/branch/HEAD/`};
}
/* an http(s) URL against a base, else '' (DOMPurify has already taken out javascript: and the like) */
function absUrl(u, base){
  try{ const x=new URL(String(u).trim(), base); return /^https?:$/.test(x.protocol)? x.href : ''; }catch(e){ return ''; }
}
/* a file to show: github.com/<owner>/<repo>/blob/<ref>/<path> is the page around it, the file itself is raw */
const rawFile = u => u.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^?#]+)(?:\?raw=true)?$/, 'https://raw.githubusercontent.com/$1/$2/$3');
const VIDEO_RE = /^https:\/\/(?:github\.com\/user-attachments\/assets\/[0-9a-f-]{36}|[^\s?#]+\.(?:mp4|m4v|mov|webm)(?:[?#]\S*)?)$/i;
const YOUTUBE_RE = /^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i;
const ALERTS = {NOTE:'Note', TIP:'Tip', IMPORTANT:'Important', WARNING:'Warning', CAUTION:'Caution'};
/* a heading's anchor, as GitHub makes it */
const slugOf = t => t.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu,'').replace(/ /g,'-');
let chartCount = 0;

/* README text → a fragment to put in the page. dark picks the flowcharts' colours. */
async function readmeFragment(md, repo, dark){
  const [marked, purify]=await Promise.all([loadLib('marked'), loadLib('DOMPurify')]);
  const B=repoBases(repo);
  const frag=purify.sanitize(marked.parse(md,{gfm:true}), {RETURN_DOM_FRAGMENT:true, SANITIZE_NAMED_PROPS:true,
    FORBID_TAGS:['style','form','button','textarea','select','option'], FORBID_ATTR:['style']});
  const make=(tag,attrs)=>Object.assign(document.createElement(tag),attrs);
  // headings get GitHub's anchors, so the README's own #links work
  const seen={};
  for(const h of frag.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    const s=slugOf(h.textContent), n=seen[s]=(seen[s]??-1)+1;
    if(!h.id) h.id='user-content-'+s+(n? '-'+n : '');
  }
  for(const a of frag.querySelectorAll('a[href]')){
    const h=a.getAttribute('href');
    if(h.startsWith('#')){ a.setAttribute('href', h.startsWith('#user-content-')? h : '#user-content-'+h.slice(1).toLowerCase()); continue; }
    const u=/^mailto:/i.test(h)? h : absUrl(h, B.page);
    if(!u){ a.removeAttribute('href'); continue; }
    Object.assign(a,{href:u, target:'_blank', rel:'noopener noreferrer'});
  }
  for(const el of frag.querySelectorAll('img[src], video[src], source[src], video[poster]')){
    for(const k of ['src','poster']) if(el.hasAttribute(k)){ const u=absUrl(el.getAttribute(k), B.raw); u? el.setAttribute(k, rawFile(u)) : el.removeAttribute(k); }
  }
  for(const el of frag.querySelectorAll('[srcset]')){
    el.setAttribute('srcset', el.getAttribute('srcset').split(',').map(c=>{ const [u,...w]=c.trim().split(/\s+/), x=absUrl(u, B.raw); return x && [rawFile(x),...w].join(' '); }).filter(Boolean).join(', '));
  }
  for(const im of frag.querySelectorAll('img')){ im.loading='lazy'; im.referrerPolicy='no-referrer'; }
  for(const v of frag.querySelectorAll('video')){ v.controls=true; v.preload='metadata'; v.playsInline=true; }
  for(const i of frag.querySelectorAll('input')){ if(i.type==='checkbox') i.disabled=true; else i.remove(); }   // task lists
  // a link alone on its line: a video plays here, a YouTube video is embedded
  for(const p of frag.querySelectorAll('p')){
    const a=p.firstElementChild;
    if(!a || a.tagName!=='A' || p.childElementCount!==1 || p.textContent.trim()!==a.textContent.trim()) continue;
    const u=a.href, yt=u.match(YOUTUBE_RE);
    if(VIDEO_RE.test(u)) p.replaceWith(make('video',{src:u, controls:true, preload:'metadata', playsInline:true}));
    else if(yt){
      const box=make('div',{className:'rm-yt'});
      box.append(make('iframe',{src:`https://www.youtube-nocookie.com/embed/${yt[1]}`, title:a.textContent.trim()||'YouTube video', loading:'lazy',
        allow:'encrypted-media; picture-in-picture; fullscreen', allowFullscreen:true, referrerPolicy:'strict-origin-when-cross-origin'}));
      p.replaceWith(box);
    }
  }
  // > [!NOTE] and the other GitHub alerts
  for(const q of frag.querySelectorAll('blockquote')){
    const p=q.firstElementChild, t=p && p.tagName==='P' && p.firstChild, m=t && t.nodeType===3 && t.data.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
    if(!m) continue;
    t.data=t.data.slice(m[0].length); if(t.data==='' && t.nextSibling && t.nextSibling.nodeName==='BR') t.nextSibling.remove();
    if(!p.textContent.trim() && !p.querySelector('img')) p.remove();
    const k=m[1].toUpperCase();
    q.className='rm-alert rm-'+k.toLowerCase(); q.prepend(make('p',{className:'rm-alert-title', textContent:ALERTS[k]}));
  }
  for(const t of frag.querySelectorAll('table')){ const w=make('div',{className:'tw'}); t.replaceWith(w); w.append(t); }
  // flowcharts: strict mermaid (no scripts or links in labels); a chart it can't read stays as its text
  const charts=[...frag.querySelectorAll('pre > code.language-mermaid')];
  if(charts.length){
    const mermaid=await loadLib('mermaid');
    mermaid.initialize({startOnLoad:false, securityLevel:'strict', suppressErrorRendering:true, theme: dark? 'dark' : 'default', fontFamily:'Archivo, system-ui, sans-serif'});
    for(const code of charts){
      const id='rm-mermaid-'+(chartCount++);   // unique on the page: each chart's CSS is scoped to its id
      try{ const {svg}=await mermaid.render(id, code.textContent); const d=make('div',{className:'rm-mermaid'}); d.innerHTML=svg; code.parentElement.replaceWith(d); }
      catch(e){ const x=document.getElementById(id); if(x) x.remove(); }
    }
  }
  return frag;
}

/* The page's README section (<details id="readme"> with #readmeName and #readmeBody), collapsed under the manual.
   Read and drawn when opened, again when the repository changes or the page turns light or dark while it is open. */
const RM = {repo:'', drawn:''};
function readmeSection(repo){
  const d=document.getElementById('readme'); if(!d) return;
  if(!d.dataset.bound){ d.dataset.bound='1'; d.addEventListener('toggle',()=>{ if(d.open) drawReadme(); }); }
  RM.repo= repo||''; d.hidden=!RM.repo;
  document.getElementById('readmeName').textContent= RM.repo? repoShort(RM.repo) : '';
  if(d.open) drawReadme();
}
async function drawReadme(){
  const repo=RM.repo, dark=!document.body.classList.contains('ui-light'), key=repo+'|'+dark;
  if(!repo || RM.drawn===key) return;
  RM.drawn=key;
  const box=document.getElementById('readmeBody'), gone=()=>RM.drawn!==key;
  if(box.dataset.repo!==repo){ box.dataset.repo=''; box.innerHTML='<p class="hint">Reading the README…</p>'; }
  const f=await readmeOf(repo); if(gone()) return;
  if(!f){ RM.drawn=''; box.innerHTML=`<p class="hint">No README.md in <a href="${escAttr(repo)}" target="_blank">${esc(repoShort(repo))}</a>.</p>`; return; }
  const src=`<p class="hint rm-src">The README of <a href="${escAttr(f.url)}" target="_blank" rel="noopener">${esc(repoShort(repo))}</a>, as it is on its default branch. Images and videos load from where it points to.</p>`;
  try{
    const frag=await readmeFragment(f.text, repo, dark); if(gone()) return;
    const body=document.createElement('div'); body.className='md rm'; body.append(frag);
    box.innerHTML=src; box.append(body); box.dataset.repo=repo;
  }catch(e){ if(gone()) return; RM.drawn=''; box.innerHTML=src+`<p class="hint">It could not be drawn here (${esc(e.message)}). <a href="${escAttr(f.url)}" target="_blank" rel="noopener">Read it in the repository</a>.</p>`; }
}
