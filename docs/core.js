/* ============================================================
   Simple Touch manual core, shared by index.html (library) and editor.html (designer).

   Slot positions, the label box layout (phone: boxes on the controls,
   desktop: side columns with leader lines), modifiers / secondary view,
   black-and-white print style, faceplates and the manual file format are
   adapted from Fabio Bartali's Simple Touch Manual Designer (build 40).
   Reference label sets (Synthux / libDaisy / Pd), fonts, control table,
   Markdown notes, share links and PNG export come from this repo's
   label library and editor.

   Pages set three globals before calling render functions:
     doc     the manual data (firmware, labels, modifiers, faceplate, …)
     V       view settings (theme, layout, reference set, focus)
     design  label styling (sizes, colours per theme)
   ============================================================ */

const PANEL_URL = 'assets/panel_blank.svg';
const BUILD = '2';

/* ============================================================
   SLOTS: panel units of the drawing (0 0 1080 1598.24)
   ============================================================ */
const PANEL_BOX = {x:70, y:75, w:940, h:1475};
const DEVICE = {x:93.67, y:97.61, w:894.14, h:1429.88, r:25.9};   // the device outline, a hair outside its stroke
const DESK = {colW:460, gap:36, maxLine:400};   // maxLine: widest single line before line 2 wraps
const LIMITS = {line:20, line2:24, midi:40, name:40, author:60, version:16, desc:300, notes:8000};
const MOD_MAX = 4;
const TOP_PLATE_EDGE = 942.5;   // bottom edge of the top faceplate (pads start below it)
const PAD_TOP_CLEAR = 31;       // phone: minimum space between that edge and the P00–P02 labels
const TOP_PADS_BOTTOM = 236;    // phone: P10 / P11 labels start below their pads (which end at y 232)
const KNOB_R = 34;              // knob radius on the drawing; phone knob labels hang just below it
const SLOTS = [
  {id:'P10', kind:'mod',   x:448.4, y:169.7, minTop:TOP_PADS_BOTTOM},
  {id:'P11', kind:'mod',   x:647.1, y:169.7, minTop:TOP_PADS_BOTTOM},
  {id:'S36', kind:'fader', x:152.3, y:739.7, lockX:true, name:'left fader'},
  {id:'S30', kind:'knob',  x:287.39,y:800.66},
  {id:'S31', kind:'knob',  x:287.39,y:611.53},
  {id:'S32', kind:'knob',  x:457.21,y:611.53},
  {id:'S33', kind:'knob',  x:629.43,y:611.53},
  {id:'S34', kind:'knob',  x:800.08,y:611.53},
  {id:'S35', kind:'knob',  x:800.08,y:800.66},
  {id:'S37', kind:'fader', x:928.7, y:739.7, lockX:true, name:'right fader'},
  {id:'P00', kind:'pad', x:323.6, y:1010.5, minTop:TOP_PLATE_EDGE+PAD_TOP_CLEAR},
  {id:'P01', kind:'pad', x:560.0, y:995.7, minTop:TOP_PLATE_EDGE+PAD_TOP_CLEAR},
  {id:'P02', kind:'pad', x:706.5, y:1013.4, minTop:TOP_PLATE_EDGE+PAD_TOP_CLEAR},
  {id:'P03', kind:'pad', x:180.1, y:1277.9},
  {id:'P04', kind:'pad', x:359.9, y:1226.2},
  {id:'P05', kind:'pad', x:525.2, y:1270.5},
  {id:'P06', kind:'pad', x:710.9, y:1258.7},
  {id:'P07', kind:'pad', x:916.8, y:1328.2},
  {id:'P08', kind:'pad', x:384.6, y:1447.9},
  {id:'P09', kind:'pad', x:700.7, y:1452.3},
  {id:'S09_S10', label:'S09/S10', kind:'switch', x:433.2, y:1044.0, name:'left switch'},
  {id:'S07_S08', label:'S07/S08', kind:'switch', x:590.7, y:1117.0, name:'right switch'},
  {id:'IN',  kind:'jack', x:152.8, y:283.8, name:'input jack'},
  {id:'OUT', kind:'jack', x:152.8, y:454.8, name:'output jack'},
  {id:'LED', kind:'led',  x:829.0, y:305.0, name:'Seed LED'},   // the user LED beside the Seed's USB port
];
const SLOT = Object.fromEntries(SLOTS.map(s=>[s.id,s]));
const lab = s => s.label||s.id;
const NO_LINE2 = ['P00','P01','P02','IN','OUT'];   // pads: modifier text takes line 2; jacks: one line
const MODDABLE = ['mod','knob','fader','pad'];
const COMBO_MAX = 3;   // controls held together as one modifier
const LABEL_KEY = /^(main|main_2|m_[PS]\d\d(\+[PS]\d\d){0,2}|midi)$/;   // what a label holds; m_P10+P11 is a combo's column
const TABLE_ORDER = ['S30','S31','S32','S33','S34','S35','S36','S37','S09_S10','S07_S08','IN','OUT','LED','P00','P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11'];
const KIND_NAME = {mod:'pad', knob:'knob', fader:'fader', pad:'pad', switch:'switch', jack:'jack', led:'LED'};

/* ============================================================
   REFERENCE LABEL SETS: [name, sub] per slot
   ============================================================ */
const REF_SETS = {
  sx: { label:'Synthux', names:{
    S30:['S30','pot 0'], S31:['S31','pot 1'], S32:['S32','pot 2'], S33:['S33','pot 3'], S34:['S34','pot 4'], S35:['S35','pot 5'],
    S36:['S36','fader left'], S37:['S37','fader right'], S09_S10:['S09-S10'], S07_S08:['S08-S07'],
    IN:['audio in 1 · 2'], OUT:['audio out 1 · 2'], LED:['LED'],
    P00:['P0'], P01:['P1'], P02:['P2'], P03:['P3'], P04:['P4'], P05:['P5'], P06:['P6'], P07:['P7'], P08:['P8'], P09:['P9'], P10:['P10'], P11:['P11'] } },
  ld: { label:'libDaisy', names:{
    S30:['A0 · D15','S30'], S31:['A1 · D16','S31'], S32:['A2 · D17','S32'], S33:['A3 · D18','S33'], S34:['A4 · D19','S34'], S35:['A5 · D20','S35'],
    S36:['A6 · D21','S36'], S37:['A7 · D22','S37'], S09_S10:['D8-D9','Switch3'], S07_S08:['D7-D6','Switch3'],
    IN:['in[0] · in[1]','pins 16 · 17'], OUT:['out[0] · out[1]','pins 18 · 19'], LED:['SetLed()','onboard'],
    P00:['P0'], P01:['P1'], P02:['P2'], P03:['P3'], P04:['P4'], P05:['P5'], P06:['P6'], P07:['P7'], P08:['P8'], P09:['P9'], P10:['P10'], P11:['P11'] } },
  pd: { label:'Pd / Plugdata', names:{
    S30:['knob1'], S31:['knob2'], S32:['knob3'], S33:['knob4'], S34:['knob5'], S35:['knob6'],
    S36:['faderleft'], S37:['faderright'], S09_S10:['sw1','1 · 0 · 2'], S07_S08:['sw2','1 · 0 · 2'],
    IN:['adc~','audio in'], OUT:['dac~','audio out'], LED:['daisyled'],
    P00:['touch_ch0'], P01:['touch_ch1'], P02:['touch_ch2'], P03:['touch_ch3'], P04:['touch_ch4'], P05:['touch_ch5'],
    P06:['touch_ch6'], P07:['touch_ch7'], P08:['touch_ch8'], P09:['touch_ch9'], P10:['touch_ch10'], P11:['touch_ch11'] } },
};
const refOf = id => (V.ref && REF_SETS[V.ref] && REF_SETS[V.ref].names[id]) || null;

/* ============================================================
   DESIGN TOKENS: per theme, per layout
   ============================================================ */
const MODS_DEF = { m1:'#D63A24', m2:'#2F63D6', m3:'#6B7A1E', m4:'#E3A21A' };
const MODS_BRIGHT = { m1:'#ffd23f', m2:'#7fd1ff', m3:'#b8f28b', m4:'#ff9ad5' };   // readable on red, green and dark chips
const INK_DARK  = { bg:'#1a1918', fg:'#f3f2f2', muted:'rgba(243,242,242,.7)', rule:'rgba(243,242,242,.4)', hair:'rgba(243,242,242,.15)' };
const INK_LIGHT = { bg:'#f3f2f2', fg:'#201e1d', muted:'#5b5856', rule:'#201e1d', hair:'rgba(32,30,29,.2)' };
const chips = (box, pad, padText, ref, mods=MODS_BRIGHT) => ({ mw:2, ow:0, box, text:'#ffffff', line:box, ref, padBox:pad, padText, ...mods });
/* Per theme: label colours per layout, the drawing's colours (panel) and the page around it (page, ui).
   Panel keys: frame (around the device), bg (background / pads), top (top plate), strip (Seed window),
   line, ctlline / ctl (control outlines / fill), shape (pad gaps, dark parts), mid, sw (switches),
   tex / texop (pad texture), fp (faceplate art), leader, ink (legend text). Missing keys follow bg / line. */
const THEME_DEFAULT = {
  light: { ui:'light', page:INK_LIGHT,
    phone: chips('#ec3013','#201e1d','#ffffff','#ffd9d1'), desktop: chips('#ec3013','#201e1d','#ffffff','#ffd9d1'),
    panel: { drawing:'simple', frame:'#f3f2f2', bg:'#bab6b6', border:'#201e1d', top:'#201e1d', strip:'#d7d3d3', pad:'#f8f4f4', padtop:'#f8f4f4', shape:'#201e1d', ctlline:'#f3f2f2', mid:'#7d7979', jack:'#9b9797', sw:'#ec3013', line:'#201e1d', led:'#ec3013', fp:'#f3f2f2', leader:'#7d7979', ink:'#201e1d' } },
  dark: { ui:'dark', page:INK_DARK,
    phone: chips('#ec3013','#201e1d','#ffffff','#ffd9d1'), desktop: chips('#ec3013','#201e1d','#ffffff','#ffd9d1'),
    panel: { drawing:'simple', frame:'#1a1918', bg:'#605d5d', border:'#9b9797', top:'#0b0a0a', strip:'#d7d3d3', pad:'#f8f4f4', padtop:'#f8f4f4', shape:'#201e1d', ctlline:'#f3f2f2', mid:'#7d7979', jack:'#9b9797', sw:'#ec3013', line:'#201e1d', led:'#ec3013', fp:'#f3f2f2', leader:'#9b9797', ink:'#f3f2f2' } },
  vis: { ui:'vis', page:{...INK_DARK, bg:'#141414'},
    phone: chips('#0a7d50','#2b2219','#e3bb67','#b9e6d2',{...MODS_BRIGHT, m3:'#ff9ad5', m4:'#ffffff'}), desktop: chips('#0a7d50','#2b2219','#e3bb67','#b9e6d2',{...MODS_BRIGHT, m3:'#ff9ad5', m4:'#ffffff'}),
    panel: { drawing:'simple', round:1, frame:'#141414', bg:'#4e4c4c', top:'#000000', strip:'#d9a441', pad:'#e3bb67', padtop:'#c9b48e', shape:'#4e4c4c', padw:13, ctlline:'#ffffff', ctl:'#1c1c1c', ctlw:6.5, mid:'#555555', jack:'#555555', sw:'#b3201c', line:'#ffffff', led:'#e08a3c', fp:'#d9a441', leader:'#ffe8bd', ink:'#f3f2f2' } },
  panel: { ui:'dark', page:{...INK_DARK, bg:'#222221'},
    phone:   { mw:1.5, ow:1, box:'#232323', text:'#d6d6d6', line:'#d6d6d6', ref:'#8f8d8b', ...MODS_DEF },
    desktop: { mw:2,   ow:0, box:'#232323', text:'#d6d6d6', line:'#000000', ref:'#8f8d8b', ...MODS_DEF },
    panel:   { bg:'#222221', line:'#ffffff', shape:'#060606', mid:'#666665', fp:'#ffffff', leader:'#ffffff', ink:'#ffffff' } },
  gold: { ui:'gold', page:{...INK_DARK, bg:'#141414'},
    phone:   { mw:1.5, ow:1, box:'#141414', text:'#f3f2f2', line:'#d9a441', ref:'#d9a441', ...MODS_DEF },
    desktop: { mw:2,   ow:1, box:'#141414', text:'#f3f2f2', line:'#d9a441', ref:'#d9a441', ...MODS_DEF },
    panel:   { bg:'#141414', line:'#d9a441', shape:'#060606', mid:'#7a6236', fp:'#d9a441', leader:'#d9a441', ink:'#f3f2f2' } },
  print: { ui:'light', page:{ bg:'#ffffff', fg:'#1c1c1b', muted:'#5b5856', rule:'#1c1c1b', hair:'rgba(28,28,27,.2)' },
    phone:   { mw:1.5, ow:1, box:'#ffffff', text:'#1c1c1b', line:'#1c1c1b', ref:'#7d7979', ...MODS_DEF },
    desktop: { mw:2,   ow:1, box:'#ffffff', text:'#1c1c1b', line:'#1c1c1b', ref:'#7d7979', ...MODS_DEF },
    panel:   { bg:'#ffffff', line:'#1c1c1b', shape:'#1c1c1b', mid:'#8a8a87', fp:'#1c1c1b', leader:'#1c1c1b', ink:'#1c1c1b' } },
};
const THEME_NAMES = [['light','Light'],['dark','Dark'],['vis','Visualiser'],['panel','Synthux panel'],['gold','Synthux gold'],['print','Synthux light']];
const DESIGN_V = 2;
const DESIGN_DEFAULT = {
  v: DESIGN_V,
  size1:28, size2:23, size3:null, padX:14, padY:10, radius:10, gap:8, weight:400,
  modStyle:'outline',    // modifier label in secondary view: outline | filled | hold | double
  multiMod:'divided',    // control with 2+ modifiers (secondary view): divided | separate
  boxOpacity:1,          // label box fill, 0 = no box
  leaderW:2.5,           // desktop leader lines, panel units (the dot at the control grows with it)
  fx:'none', fxColor:'#000000', fxSize:6,   // label effect: none | shadow | glow
  caps:{phone:false, desktop:false},   // the labels on the drawing in capitals, per layout; what was typed stays as typed
  names:{phone:{place:'label',size:null,x:0,y:0}, desktop:{place:'label',size:null,x:0,y:0}},   // the control names (P1, S36) per layout: in the text labels or on the drawing
  fonts:{},              // a part's own font, {family, url, weight}: line1, line2, names, faceplate. Missing: the label font
  themes: THEME_DEFAULT,
};
const DESIGN_KEYS = ['size1','size2','size3','padX','padY','radius','gap','weight','modStyle','multiMod','boxOpacity','fx','fxColor','fxSize','leaderW'];
const cloneDesign = d => structuredClone(d);
/* Before version 2 the themes were dark (now 'panel'), light (now 'print') and gold */
const OLD_THEME = { dark:'panel', light:'print' };
const migrateTheme = th => OLD_THEME[th] || th;
const LAYOUTS = ['phone','desktop'];
/* from any file, so only plain values pass */
function namesOf(n){
  const num=(v,lo,hi)=> typeof v==='number' && Number.isFinite(v)? Math.min(hi,Math.max(lo,v)) : 0;
  return Object.fromEntries(LAYOUTS.map(m=>{ const o=n?.[m]||{}; return [m,{place:o.place==='drawing'?'drawing':'label', size:num(o.size,8,60)||null, x:num(o.x,-200,200), y:num(o.y,-200,200)}]; }));
}
/* one setting for both layouts in older files */
const capsOf=c=>Object.fromEntries(LAYOUTS.map(m=>[m, typeof c==='boolean'? c : c?.[m]===true]));
/* Accepts this format ({themes}) and Fabio's ({phone, desktop, light, panel}) */
function mergeDesign(d){
  const out = cloneDesign(DESIGN_DEFAULT);
  if(!d || typeof d!=='object') return out;
  for(const k of DESIGN_KEYS) if(k in d) out[k]=d[k];
  out.names=namesOf(d.names); out.caps=capsOf(d.caps); out.fonts=fontsOf(d.fonts);
  let themes = d.themes;
  if(themes && d.v!==DESIGN_V) themes = { panel:themes.dark, print:themes.light, gold:themes.gold };
  if(themes){ for(const th in out.themes) for(const p of ['phone','desktop','panel']) Object.assign(out.themes[th][p], (themes[th]||{})[p]||{}); }
  else {
    Object.assign(out.themes.panel.phone, d.phone||{}); Object.assign(out.themes.panel.desktop, d.desktop||{});
    if(d.light){ Object.assign(out.themes.print.phone, d.light.phone||{}); Object.assign(out.themes.print.desktop, d.light.desktop||{}); }
    if(d.panel){ Object.assign(out.themes.panel.panel, d.panel.dark||{}); Object.assign(out.themes.print.panel, d.panel.light||{}); }
  }
  return out;
}
/* the drawing's colours as CSS custom properties (see assets/panel_blank.svg) */
const PVARS = { bg:'pbg', line:'pline', shape:'pshape', mid:'pmid', fp:'pfp', top:'ptop', strip:'pstrip', ctl:'pctl', ctlline:'pctlline', tex:'ptex', texop:'ptexop', sw:'psw', swop:'pswop', led:'pled' };
const panelVarMap = th => { const q=design.themes[th].panel, m={}; for(const [k,v] of Object.entries(PVARS)) if(q[k]!=null && q[k]!=='') m[v]=String(q[k]); return m; };
/* bake var(--x, fallback) into plain values (nested fallbacks too), for standalone SVGs */
function resolveVars(svg, m){ let prev; do{ prev=svg; svg=svg.replace(/var\(--([a-z]+),([^()]*)\)/g,(x,k,f)=> m[k] ?? f.trim()); }while(svg!==prev); return svg; }

const T = { font:"'Archivo', system-ui, sans-serif" };
let design = cloneDesign(DESIGN_DEFAULT);
let part = 'main', curPart = 'main', bw = false;
let ownStyles = true;   // extra labels in their own style: the library's own themes leave it out, as they do the creator's font
let soloMod = null;   // while playing: the modifier held or tapped; the main view then shows what it does
function applyDesign(d=design){
  for(const k of ['size1','size2','padX','padY','radius','gap','weight']) T[k]=d[k];
  T.size3 = d.size3 || Math.round(T.size2*0.72);   // reference captions: their own size, or line 2's
  T.lh1 = Math.round(T.size1*1.19); T.lh2 = Math.round(T.size2*1.18); T.lh3 = Math.round(T.size3*1.25);
}
const SZ = n => T['size'+n], LH = n => T['lh'+n];
const szOf = l => l.px||SZ(l.size), lhOf = l => l.px? Math.round(l.px*(l.size===1? 1.19 : 1.18)) : LH(l.size);   // px: an extra label's own size
const palOf = (mode, th=V.theme) => design.themes[th][mode];
function usePalette(mode, th=V.theme){
  const p=palOf(mode,th), q=design.themes[th].panel;
  T.size3=design.names[mode].size||design.size3||Math.round(T.size2*0.72); T.lh3=Math.round(T.size3*1.25);   // the control names: per layout
  T.layout=mode; T.caps=!!design.caps[mode]; T.fpl=p.fpl||'';   // fpl: the faceplate labels' colour, if the layout has its own
  T.outline=p.mw; T.boxOutline=p.ow; T.box=p.box; T.text=p.text; T.line=p.line; T.ref=p.ref;
  T.mods = bw? [p.text,p.text,p.text,p.text] : [p.m1,p.m2,p.m3,p.m4];
  T.padBox=p.padBox||null; T.padText=p.padText||null;   // pads can have their own chip colour
  T.boxOp= bw? 1 : (design.boxOpacity ?? 1);
  T.theme=th; T.bg=q.frame||q.bg; T.leader=q.leader; T.ink=q.ink;
  T.panelVars=Object.entries(panelVarMap(th)).map(([k,v])=>`--${k}:${v}`).join(';');
}
applyDesign();

/* ============================================================
   DATA
   ============================================================ */
const FW_FIELDS = ['name','author','version','description','notes'];
function emptyDoc(){ return {firmware:{name:'',author:'',version:'',description:'',notes:'',repo:'',authorUrl:''}, labels:{},modifiers:[], combos:[], faceplate:'', faceplateRef:'', faceplateFile:'', look:null, customs:[], offsets:{phone:{},desktop:{}}, modTypes:{}, fpStyle:{}, emulator:null, modes:null, device:null, oled:null, fpDesktop:null, fpLabels:null}; }
function normalise(d){
  const s = emptyDoc();
  s.firmware = {...s.firmware, ...(d.firmware||{})};
  s.labels = structuredClone(d.labels||{});
  s.faceplate = d.faceplate||''; s.faceplateRef = d.faceplateRef||'';
  if(FP_PATH.test(s.faceplate)){ s.faceplateFile=s.faceplate; s.faceplate=''; }   // a label file names its faceplate's file
  else if(typeof d.faceplateFile==='string' && FP_PATH.test(d.faceplateFile)) s.faceplateFile=d.faceplateFile;
  s.customs = Array.isArray(d.customs)? d.customs.filter(c=>c&&typeof c==='object').map(c=>{ const {style,...o}=structuredClone(c), st=customStyleOf(style); return st? {...o,style:st} : o; }) : [];
  s.offsets = {phone:{...((d.offsets||{}).phone||{})}, desktop:{...((d.offsets||{}).desktop||{})}};
  s.modTypes = {...(d.modTypes||{})};
  s.fpStyle = {...(d.fpStyle||{})};
  s.emulator = emulatorOf(d.emulator, (d.firmware||{}).repo);
  s.modes = cleanModes(d.modes);
  s.device = d.device && typeof d.device==='object' && !Array.isArray(d.device)? structuredClone(d.device) : null;   // settings and presets: checked when drawn (parseDevice, device-panel.js)
  s.oled = oledOf(d.oled);
  s.fpDesktop = fpDesktopOf(d.fpDesktop);
  s.fpLabels = fpLabelsOf(d.fpLabels);
  s.combos = Array.isArray(d.combos)? [...new Set(d.combos.filter(comboOk))] : [];
  if(Array.isArray(d.modifiers)) s.modifiers=d.modifiers.slice(0,MOD_MAX);
  else {   // older files: P10 and P11 were the fixed modifiers
    s.modifiers=['P10','P11'];
    for(const o of Object.values(s.labels)){ if(o.p10){o.m_P10=o.p10;} if(o.p11){o.m_P11=o.p11;} delete o.p10; delete o.p11; }
  }
  return s;
}
/* A faceplate kept as a file in the firmware's repository, at a plain relative path: an SVG, or the image itself
   when the faceplate is an uploaded image (it is wrapped in an SVG here; its placement is in fpStyle either way) */
const FP_PATH=/^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\.(svg|png|jpe?g|webp|gif|avif)$/i;
const FP_DEFAULT_FILE='img/faceplate.svg', FP_DESKTOP_FILE='img/faceplate-desktop.svg';
const FP_IMAGE_EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'};
function fpImage(svg=doc.faceplate){   // the image inside an uploaded image's wrapper: {mime, ext, b64}, else null
  if(!svg || svg.length<100 || !/<image\b/.test(svg)) return null;
  const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement, kids=[...root.children];
  if(kids.length!==1 || kids[0].localName!=='image') return null;
  const m=/^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/.exec(kids[0].getAttribute('href')||kids[0].getAttribute('xlink:href')||'');
  return m && {mime:m[1], ext:FP_IMAGE_EXT[m[1]], b64:m[2].replace(/\s+/g,'')};
}
const fpPathOf=(path, fallback, svg)=>{ const im=fpImage(svg); return (FP_PATH.test(path||'')? path : fallback).replace(/\.[a-z]+$/i, '.'+(im? im.ext : 'svg')); };
const fpFile=()=>fpPathOf(doc.faceplateFile, FP_DEFAULT_FILE, doc.faceplate);
const fpDeskFile=()=>fpPathOf(doc.fpDesktop?.file, FP_DESKTOP_FILE, doc.fpDesktop?.faceplate);
/* the faceplate as the file it is saved as: {name, data (text or bytes), type} */
function fpFileData(svg=doc.faceplate, path=fpFile()){
  const im=fpImage(svg), name=path.split('/').pop();
  if(!im) return {name, data:svg, type:'image/svg+xml'};
  const bin=atob(im.b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  return {name, data:u8, type:im.mime};
}
/* A creator's look from a label file (design, font, theme), for the library's Creator theme. Files come from anywhere,
   so only plain values pass: numbers, colours, known words. The font is a Google Fonts family name. */
const SAFE_COLOUR=/^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*){2,3}\)|transparent|none|[a-z]{3,20})$/i;
const SAFE_WORD={modStyle:['outline','filled','hold','double'], multiMod:['divided','separate'], fx:['none','shadow','glow'], drawing:['synthux','simple'], ui:['light','dark','vis','gold']};
function safeDesign(d){
  const def=cloneDesign(DESIGN_DEFAULT), out=mergeDesign(d);
  const ok=(k,v,dv)=> SAFE_WORD[k]? SAFE_WORD[k].includes(v)
    : k==='size3'? v===null || (typeof v==='number' && Number.isFinite(v) && v>0 && v<=200)
    : typeof dv==='boolean'? typeof v==='boolean'
    : typeof dv==='number'? typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=1000
    : typeof v==='string' && SAFE_COLOUR.test(v.trim());
  for(const k of DESIGN_KEYS) if(!ok(k,out[k],def[k])) out[k]=def[k];
  out.fonts=fontsOf(out.fonts,true);
  for(const th in out.themes) for(const part of ['phone','desktop','panel']){
    const o=out.themes[th][part], dflt=def.themes[th][part];
    for(const k of Object.keys(o)){
      const v=o[k];
      if(SAFE_WORD[k]? SAFE_WORD[k].includes(v) : typeof v==='number'? Number.isFinite(v) && Math.abs(v)<=1000 : typeof v==='string' && SAFE_COLOUR.test(v.trim())) continue;
      if(k in dflt) o[k]=dflt[k]; else delete o[k];
    }
  }
  return out;
}
const GOOGLE_FAMILY=/^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/;
/* Own fonts and extra-label styles end up in SVG attributes, so only plain values pass. strict (a label file shown in the
   library): Google Fonts only, as for the creator's main font. */
const FONT_ROLES=['line1','line2','names','faceplate'], FONT_WEIGHTS=[400,500,600,700], CSS_FAMILY=/^[^"'<>&;{}\\]{1,80}$/;
function fontSpecOf(o, strict){
  if(!o || typeof o!=='object') return null;
  const out={}, google=/^https:\/\/fonts\.googleapis\.com\//;
  if(strict? GOOGLE_FAMILY.test(o.family||'') && (!o.url || google.test(o.url)) : CSS_FAMILY.test(o.family||'')){
    out.family=o.family; if(!strict && /^https?:\/\//.test(o.url||'')) out.url=o.url; }
  if(FONT_WEIGHTS.includes(o.weight)) out.weight=o.weight;
  return Object.keys(out).length? out : null;
}
function fontsOf(o, strict){ const out={}; for(const k of FONT_ROLES){ const f=fontSpecOf(o?.[k],strict); if(f) out[k]=f; } return out; }
/* an extra label's style: {family, url, weight, size1, size2, text, box, line, lineW}; what is missing follows the theme */
function customStyleOf(o, strict){
  if(!o || typeof o!=='object') return null;
  const out={...fontSpecOf(o,strict)}, num=(v,lo,hi)=>typeof v==='number' && Number.isFinite(v) && v>=lo && v<=hi;
  for(const k of ['size1','size2']) if(num(o[k],8,120)) out[k]=o[k];
  if(num(o.lineW,0,20)) out.lineW=o.lineW;
  for(const k of ['text','box','line']) if(typeof o[k]==='string' && SAFE_COLOUR.test(o[k].trim())) out[k]=o[k].trim();
  return Object.keys(out).length? out : null;
}
function lookOf(d){
  if(!d || typeof d.design!=='object' || !d.design || !('size1' in d.design)) return null;
  const theme= d.view && THEME_NAMES.some(t=>t[0]===d.view.theme)? d.view.theme : 'panel';
  const f=d.font||{}, google= !f.url || /^https:\/\/fonts\.googleapis\.com\//.test(f.url);
  const out=safeDesign(d.design);
  if(d.view && REF_SETS[d.view.ref]) out.nameSet=d.view.ref;   // the names a layout puts on the drawing; the library doesn't pick a set for a creator's look
  return {design:out, theme, font: google && GOOGLE_FAMILY.test(f.family||'')? f.family : 'Archivo'};
}
/* placement of a faceplate from a file: plain numbers and known words only */
const FP_BLENDS=['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'];
function safeFpStyle(o){
  const n=(v,lo,hi)=>typeof v==='number' && Number.isFinite(v)? Math.min(hi,Math.max(lo,v)) : undefined;
  if(!o || typeof o!=='object') return {};
  const out={};
  if(['panel','top'].includes(o.area)) out.area=o.area;
  if(FP_BLENDS.includes(o.blend)) out.blend=o.blend;
  for(const [k,lo,hi] of [['opacity',0,1],['scale',0.05,20],['x',-5000,5000],['y',-5000,5000],['ratio',0.01,100]]){ const v=n(o[k],lo,hi); if(v!==undefined) out[k]=v; }
  if(typeof o.stretch==='boolean') out.stretch=o.stretch;
  return out;
}
/* The desktop layout's own faceplate: art 'same' (the phone's art), 'own' or 'none' (the blank panel), each with its own
   placement. In a label file its art is a path, as the main faceplate's is. Null: the desktop follows the phone. */
function fpDesktopOf(o){
  if(!o || typeof o!=='object') return null;
  const art=['same','own','none'].includes(o.art)? o.art : 'same', out={art, faceplate:'', file:'', style:safeFpStyle(o.style)};
  if(art!=='own') return out;
  const f=typeof o.faceplate==='string'? o.faceplate : '';
  if(FP_PATH.test(f)) out.file=f; else { out.faceplate=f; if(typeof o.file==='string' && FP_PATH.test(o.file)) out.file=o.file; }
  return out;
}
/* Text that belongs to the faceplate (no box): per layout whether it shows ('off', 'with' or 'instead' of the label boxes)
   and its size; shared, the text a control has instead of its line 1 ("-" for none). Turned and moved as offsets, key f:<id>. */
const FPL_SHOW=['off','with','instead'], FPL_SIZE=24;
function fpLabelsOf(o){
  if(!o || typeof o!=='object') return null;
  const by=m=>{ const p=o[m]||{}, z=p.size; return {show:FPL_SHOW.includes(p.show)? p.show : 'with', size:typeof z==='number' && Number.isFinite(z)? Math.round(Math.min(60,Math.max(8,z))) : FPL_SIZE}; };
  const text={}; for(const [id,v] of Object.entries(o.text&&typeof o.text==='object'? o.text : {})) if(SLOT[id] && typeof v==='string' && v.trim()) text[id]=v.slice(0,LIMITS.line);
  return {on:o.on!==false, phone:by('phone'), desktop:by('desktop'), text};
}
/* The manual file (Fabio's simple-touch-manual/3), plus this editor's extras */
function cleanData(){
  const labels={};
  for(const [id,o] of Object.entries(doc.labels)){
    const c={}; for(const [k,v] of Object.entries(o)) if(v&&v.trim()) c[k]=v.trim();
    if(Object.keys(c).length) labels[id]=c;
  }
  // Fabio's five firmware fields are always written; this editor's extras (repo, authorUrl) only when filled in
  const fw={}; for(const [k,v] of Object.entries(doc.firmware)){ const t=String(v||'').trim(); if(t||FW_FIELDS.includes(k)) fw[k]=t; }
  const out={format:'simple-touch-manual/3', firmware:fw, labels, modifiers:mods().filter(m=>!isCombo(m))};
  if(mods().some(isCombo)) out.combos=mods().filter(isCombo);   // next to modifiers, so readers of the format that don't know combos skip them
  if(doc.faceplate) out.faceplate=doc.faceplate;
  if(doc.faceplate && !doc.faceplateRef && doc.faceplateFile) out.faceplateFile=doc.faceplateFile;
  if(doc.faceplateRef) out.faceplateRef=doc.faceplateRef;
  if(doc.faceplate && Object.keys(doc.fpStyle||{}).length) out.fpStyle=doc.fpStyle;
  if(doc.customs.length) out.customs=doc.customs;
  const mt=Object.fromEntries(mods().filter(isToggle).map(m=>[m,'toggle'])); if(Object.keys(mt).length) out.modTypes=mt;
  if(Object.keys(doc.offsets.phone).length||Object.keys(doc.offsets.desktop).length) out.offsets=doc.offsets;
  if(doc.emulator) out.emulator=doc.emulator;
  if(doc.device) out.device=doc.device;
  if(doc.oled) out.oled=doc.oled;
  if(doc.fpDesktop){ const q=doc.fpDesktop; out.fpDesktop={art:q.art, ...(q.art==='own'&&q.faceplate?{faceplate:q.faceplate}:{}), ...(q.art==='own'&&q.file?{file:q.file}:{}), style:{...q.style}}; }
  if(doc.fpLabels) out.fpLabels=structuredClone(doc.fpLabels);
  const md=cleanModes(doc.modes); if(md) out.modes=md;
  return out;
}
/* The optional OLED on the drawing, in panel units: the designer's placement per layout (doc.oled: {rows, phone:{x,y,w},
   desktop:{x,y,w}}), a layout without its own following the other, else the top plate's free corner. A display of
   128 pixels by rows (32 or 64), so the width sets the height. An older file's {x, y, w, rows} goes for both layouts. */
const OLED_HOME = {x:270, y:330, w:240, rows:64};
const oledRowsOf = device => { const r=device?.live?.oled?.rows; return r===32||r===64? r : 0; };
function oledOf(o){
  if(!o || typeof o!=='object') return null;
  const num=(v,lo,hi)=> typeof v==='number' && Number.isFinite(v)? Math.round(Math.min(hi,Math.max(lo,v))) : null;
  const rows= o.rows===32? 32 : 64;
  const one=p=>{ if(!p || typeof p!=='object') return null; const w=num(p.w,60,800); if(w===null) return null;
    const x=num(p.x,0,ARTBOARD.w-w), y=num(p.y,0,ARTBOARD.h-w*rows/128); return x===null||y===null? null : {x,y,w}; };
  const phone=one(o.phone)||one(o), desktop=one(o.desktop);
  return phone||desktop? {rows, ...(phone?{phone}:{}), ...(desktop?{desktop}:{})} : null;
}
/* where it is drawn for a display of that many rows (0: as placed); another height keeps the same middle */
function oledBox(rows, layout=V.layout){
  const q=doc.oled, o=(q && (q[layout]||q.phone||q.desktop))||OLED_HOME, was=q?.rows||OLED_HOME.rows, h=o.w*(rows||was)/128;
  return {x:o.x, y:o.y+(o.w*was/128-h)/2, w:o.w, h};
}
/* Modes: a switch whose positions change what the controls do, e.g. a playmode switch.
   {switch:'S07_S08', list:[{pos:'up', name:'Seq', labels:{S31:{main:'Tempo'}}}, …]}
   `labels` stays the print set: what goes on a printed panel, as wide as fits every mode, and all that
   readers of simple-touch-manual/3 see. A mode keeps only what differs from it; "-" means nothing in that
   mode. Positions without a name aren't modes. From any file, so only plain values pass. */
const MODE_POS = {S07_S08:['up','centre','down'], S09_S10:['left','centre','right']};
function cleanModes(m){
  if(!m || typeof m!=='object' || !MODE_POS[m.switch] || !Array.isArray(m.list)) return null;
  const str=(v,n)=>typeof v==='string'? v.slice(0,n).trim() : '', list=[];
  for(const x of m.list){
    if(!x || typeof x!=='object' || !MODE_POS[m.switch].includes(x.pos) || list.some(y=>y.pos===x.pos) || !str(x.name,LIMITS.line)) continue;
    const labels={};
    for(const [id,o] of Object.entries(x.labels||{})){
      if(!SLOT[id] || !o || typeof o!=='object') continue;
      const c={}; for(const [k,v] of Object.entries(o)){ const t=LABEL_KEY.test(k) && str(v, k==='main'? LIMITS.line : k==='midi'? LIMITS.midi : LIMITS.line2); if(t) c[k]=t; }
      if(Object.keys(c).length) labels[id]=c;
    }
    list.push({pos:x.pos, name:str(x.name,LIMITS.line), labels});
  }
  list.sort((a,b)=>MODE_POS[m.switch].indexOf(a.pos)-MODE_POS[m.switch].indexOf(b.pos));
  return list.length? {switch:m.switch, list} : null;
}
const modeList = () => (doc.modes && MODE_POS[doc.modes.switch]? doc.modes.list.filter(m=>m.name&&m.name.trim()) : []);
const curMode = () => V.mode? modeList().find(m=>m.pos===V.mode)||null : null;
/* draw or read with another mode for a moment ('' = the print set) */
function withMode(pos, fn){ const keep=V.mode; V.mode=pos; try{ return fn(); } finally{ V.mode=keep; } }

/* Starting points: labels checked against each firmware's repo (README and UI code).
   The Touch FX and Touch String faceplates are Synthux artwork, supplied via Fabio Bartali.
   They stay out of the repository until cleared (.gitignore): where examples/faceplates/
   has them they are shown, elsewhere the panel's blank faceplate is. */
const EXAMPLES = {
  blank:       { label:'Blank' },
  touchbass:   { label:'TouchBass',       file:'examples/touchbass.json',   repo:'https://github.com/Synthux-Academy/TouchBass' },
  touchfx:     { label:'Touch FX',        file:'examples/touchfx.json',     repo:'https://github.com/Synthux-Academy/TouchFX', faceplateFile:'examples/faceplates/touchfx.svg' },
  touchstring: { label:'Touch String',    file:'examples/touchstring.json', repo:'https://github.com/Synthux-Academy/TouchString', faceplateFile:'examples/faceplates/touchstring.svg' },
  audreytouch: { label:'Audrey II Touch', file:'examples/audreytouch.json', repo:'https://github.com/Synthux-Academy/AudreyTouch' },
  touchbloop:  { label:'TouchBloop',      file:'examples/touchbloop.json',  repo:'https://github.com/Synthux-Academy/TouchBloop' },
};
const exampleCache = {};
async function loadExample(key){
  const ex = EXAMPLES[key]; if(!ex) throw new Error('unknown example '+key);
  if(ex.data) return normalise(ex.data);
  if(!ex.file) return emptyDoc();
  if(!exampleCache[key]) exampleCache[key] = Promise.all([
    fetch(ex.file).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); }),
    ex.faceplateFile ? fetch(ex.faceplateFile).then(r=> r.ok ? r.text() : '').catch(()=>'') : '',
  ]).then(([d, fp])=> fp && !d.faceplate ? {...d, faceplate:fp} : d);
  const raw = await exampleCache[key];
  const d = normalise(ex.repo && !(raw.firmware||{}).repo ? {...raw, firmware:{...raw.firmware, repo:ex.repo}} : raw);
  if(d.faceplate){ d.faceplate = sanitizeFaceplate(d.faceplate); d.faceplateRef = key; }
  return d;
}
/* An example's faceplate is stored as a reference (faceplateRef) in links and in this browser */
async function resolveFaceplate(d){
  if(d.faceplateRef && !d.faceplate && EXAMPLES[d.faceplateRef] && EXAMPLES[d.faceplateRef].file){
    try{ d.faceplate = (await loadExample(d.faceplateRef)).faceplate; }catch(e){ d.faceplateRef=''; }
  }
  return d;
}

/* Repository links (GitHub or Codeberg); the community directory itself is in community.js */
const REPO_RE = /^https:\/\/(github\.com|codeberg\.org)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const normRepo = url => String(url||'').trim().replace(/\/+$/,'').replace(/\.git$/,'');
const repoShort = url =>String(url||'').replace(/^https:\/\/(github\.com|codeberg\.org)\//,'');

/* A browser build of the firmware (simple-touch-web), as its author approved it in the label file:
   {wasm, abi, sha256, embed:'allowed'|'link-only', url?, oled?}. 'allowed' lets the library play it;
   otherwise it only links to the author's page (url). The build must come from the firmware's own
   repository or its owner's Pages, and sha256 pins it. Anything else is dropped. */
const EMULATOR_ABI = 'simple-touch-web/1';
function emulatorOf(e, repo){
  if(!e || typeof e!=='object') return null;
  const url=safeHttps(typeof e.url==='string'? e.url.trim() : '');
  let embed= e.embed==='allowed' && e.abi===EMULATOR_ABI && /^[0-9a-f]{64}$/i.test(e.sha256||'') && buildHosted(e.wasm, repo);
  if(!embed && !url) return null;
  const out= embed? {wasm:e.wasm, abi:e.abi, sha256:e.sha256.toLowerCase(), embed:'allowed'} : {embed:'link-only'};
  if(url) out.url=url;
  if(embed && e.oled===true) out.oled=true;
  return out;
}
/* raw files and Pages of the same repository: GitHub (raw.githubusercontent.com, owner.github.io) or Codeberg */
function buildHosted(wasm, repo){
  const m=String(normRepo(repo)).match(/^https:\/\/(github\.com|codeberg\.org)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if(!m || typeof wasm!=='string' || !/^https:\/\/[^\s"'<>?#]+\.wasm$/.test(wasm) || wasm.includes('/../')) return false;
  const [,host,owner,name]=m, lo=owner.toLowerCase();
  const roots= host==='github.com'? [`https://raw.githubusercontent.com/${owner}/${name}/`, `https://${lo}.github.io/`]
    : [`https://codeberg.org/${owner}/${name}/raw/`, `https://${lo}.codeberg.page/`];
  return roots.some(r=>wasm.toLowerCase().startsWith(r.toLowerCase()));
}
const safeHttps = url => /^https:\/\/[^\s"'<>]+$/.test(url||'') ? url : '';

/* a label as drawn: the mode's own (V.mode), else the print set's */
/* "-" in a field means no text. A mode's own value wins over the print set's. */
const rawVal = (id,k) => { const o=curMode()?.labels[id], v=o&&o[k]; return v&&v.trim()? v : (doc.labels[id]||{})[k]||''; };
const val = (id,k) => { const v=rawVal(id,k); return v.trim()==='-'? '' : v; };
/* Line 1 is "-": the control is left out of the main view, with its reference name and its name on the drawing */
const isOff = id => rawVal(id,'main').trim()==='-';
const has = (id,k) => val(id,k).trim()!=='';
const slotName = id => has(id,'main')? val(id,'main').trim() : (SLOT[id]?lab(SLOT[id]):id);

/* ============================================================
   LINES PER SLOT  →  [{text,color,size}]   size 1 | 2 | 3 (reference caption)
   ============================================================ */
/* A modifier is one control ("P10") or a combo, controls held together ("P10+P11", doc.combos). A combo is a
   modifier like any other: its own column (m_P10+P11), colour and legend line. Its controls need not be modifiers
   themselves (in TouchSpore P10 and P11 alone are taps), and a control can be both. */
const modParts = m => String(m).split('+');
const isCombo = m => modParts(m).length>1;
const comboOk = m => { const p=modParts(m); return typeof m==='string' && p.length>1 && p.length<=COMBO_MAX && new Set(p).size===p.length && p.every(id=>SLOT[id] && MODDABLE.includes(SLOT[id].kind)); };
const comboId = ids => [...ids].sort((a,b)=>SLOTS.indexOf(SLOT[a])-SLOTS.indexOf(SLOT[b])).join('+');
const mods = () => [...(doc.modifiers||[]).filter(id=>SLOT[id]), ...(doc.combos||[]).filter(comboOk)].slice(0,MOD_MAX);
const modIndex = id => mods().indexOf(id);
const modColor = id => T.mods[modIndex(id)] || T.text;
const isMod = id => modIndex(id) >= 0;
const inMod = (m,id) => modParts(m).includes(id);
const isModPart = id => mods().some(m=>inMod(m,id));
const modLab = m => modParts(m).map(p=>lab(SLOT[p])).join(' + ');     // P10 + P11
const modName = m => modParts(m).map(slotName).join(' + ');           // what the controls are called
/* A modifier is held by default; a 'toggle' modifier is tapped to switch the other controls into its mode */
const isToggle = id => ((doc.modTypes||{})[id]==='toggle');
/* the modifier a control is drawn as: the one in use while playing; in the secondary view its own, else a combo it is part of */
const modFor = id => {
  if(curPart==='main') return soloMod && inMod(soloMod,id)? soloMod : null;
  if(isMod(id) && usesMod(id)) return id;
  return mods().find(m=>isCombo(m) && inMod(m,id) && usesMod(m)) || (isMod(id)? id : null);
};

function slotLines(s, mode='phone'){
  const pad=T.padBox && (s.kind==='pad'||s.kind==='mod'), keep=[T.box,T.text];
  if(pad){ T.box=T.padBox; T.text=T.padText; }
  try{
    let L=slotLines0(s,mode);
    if(curPart==='main') L=withRef(s,L,mode);
    for(const l of L) l.text=capsT(l.text);
    const mine=modFor(s.id);
    if(L.length && mine){ L.modBox=modColor(mine); L.modIdx=modIndex(mine); }
    if(pad) L.pal={box:T.box, text:T.text};
    return L;
  } finally { [T.box,T.text]=keep; }
}
/* box fill: the theme's (or a pad's own) colour, at the label opacity */
const fillAttr=(lines,col)=>`fill="${col||lines?.ownBox||(lines&&lines.pal?lines.pal.box:T.box)}"${T.boxOp<1 && !lines?.ownBox?` fill-opacity="${T.boxOp}"`:''}`;
/* Reference names (V.refMode): 'empty' = an unlabelled control shows its reference name,
   'caption' = a labelled control gets the reference name as a small first line, 'both' = both */
function withRef(s,L,mode){
  const r=refOf(s.id); if(!r || namesOn(mode)) return L;
  if(!L.length){
    if(V.refMode==='caption' || isOff(s.id)) return L;
    const R=[];
    if(mode==='desktop' && r[1] && measure(capsT(r[0]+' '+r[1]),T.size1,sectionFont('names'))<=DESK.maxLine) R.push({text:r[0]+' · '+r[1],color:T.text,size:1,role:'names'});
    else { R.push({text:r[0],color:T.text,size:1,role:'names'}); if(r[1]) R.push({text:r[1],color:T.ref,size:2,role:'names'}); }
    return R;
  }
  if(V.refMode!=='empty') L.unshift({text:r[0],color:T.ref,size:3});
  return L;
}
/* A value step written as a trailing "+" or "-" is shown as an arrow: "Tempo +" -> "Tempo ↑" */
const arrows=t=>t.trim().replace(/\s\+$/,' \u2191').replace(/\s[-\u2212\u2013]$/,' \u2193');
function slotLines0(s, mode='phone'){
  const L=[]; const add=(text,color,n)=>{ text=arrows(text); if(text) L.push({text,color,size:n}); };
  const mine = curPart!=='main' ? modFor(s.id) : null, own = mine ? modColor(mine) : T.text;
  const a=arrows(val(s.id,'main')), b=NO_LINE2.includes(s.id)?'':arrows(val(s.id,'main_2'));
  // main view with a modifier in use (Play): the modifier shows its name, the controls it changes what they do with it
  if(curPart==='main' && soloMod && isMod(soloMod)){
    if(inMod(soloMod,s.id)){ add(a||slotName(s.id),modColor(soloMod),1); return L; }
    if(MODDABLE.includes(s.kind) && has(s.id,'m_'+soloMod)){ add(val(s.id,'m_'+soloMod),modColor(soloMod),1); return L; }
  }
  if(curPart==='main' && isOff(s.id)) return L;
  // main view: a modifier with no function of its own (only its name, e.g. "P10") is left out
  if(curPart==='main' && isModPart(s.id) && (!a || a===lab(SLOT[s.id])) && !b) return L;
  if(curPart==='second'){
    // secondary: a modifier in use shows its name; other controls show only what the modifiers do
    const tag=i=>{ if(L.length) L.at(-1).mk=i; };
    if(mine && usesMod(mine)){ add(a||slotName(s.id),own,1); tag(modIndex(mine)); }
    if(MODDABLE.includes(s.kind))
      for(const m of mods()) if(!inMod(m,s.id) && has(s.id,'m_'+m)){ add(val(s.id,'m_'+m),modColor(m),1); tag(modIndex(m)); }
    const mks=[...new Set(L.map(l=>l.mk))];
    L.mods= mks.filter(i=>i!==undefined);
    L.split= splitOn() && mks.length>1;
    return L;
  }
  if(mode==='desktop' && a && b && sameFont(sectionFont('line1'),sectionFont('line2')) && measure(capsT(a+' '+b),T.size1,sectionFont('line1'))<=DESK.maxLine) add(a+' '+b,own,1);   // two fonts stay two lines
  else { add(a,own,1); add(b,own,2); }
  if(curPart==='main' || !MODDABLE.includes(s.kind)) return L;
  for(const m of mods()) if(!inMod(m,s.id) && has(s.id,'m_'+m)) add(val(s.id,'m_'+m),modColor(m),2);
  return L;
}
const ownStyle = c => (ownStyles && c.style) || {};
const paintOn = () => !bw && T.theme!=='print';   // Synthux light (also the Print export) and B&W keep an extra label's font and size, not its colours
function customLines(c){
  const q=ownStyle(c), L=[], color=(paintOn() && q.text)||T.text;
  const add=(t,size,px)=>{ t=(t||'').trim(); if(t) L.push({text:capsT(t),color,size,px,family:q.family,weight:q.weight}); };
  add(c.text,1,q.size1); add(c.sub,2,q.size2);
  if(paintOn() && q.box) L.ownBox=q.box;
  return L;
}
function customBoxStyle(c){
  const q=ownStyle(c), col=paintOn() && q.line, sw=q.lineW ?? (col && !(T.boxOutline>0)? 2 : T.boxOutline);
  return sw>0? {stroke:col||T.line, sw} : {};
}
const boxStyle = s => { const m=s && modFor(s.id); return m ? {stroke:modColor(m),sw:T.outline} : (T.boxOutline>0?{stroke:T.line,sw:T.boxOutline}:{}); };
const usesMod = m => SLOTS.some(s=>!inMod(m,s.id) && has(s.id,'m_'+m));
const hasSecondary = () => mods().some(usesMod);
const splitOn = () => curPart==='second' && mods().filter(usesMod).length>1;
const bwSec = () => bw && curPart==='second';
/* Black-and-white secondary view:
   modifier = filled box; controls it changes = open box.
   modifier 1 solid line, 2 dashed, 3 dotted, 4 dash-dot (the modifier box carries it as an inner line). */
const DASHES=[null,[4,3],[0.01,2.6],[6,2.5,0.01,2.5]];
function dashAttr(i){ if(!(i>0) || !DASHES[i]) return ''; const k=T.size1/12;
  return ` stroke-dasharray="${DASHES[i].map(v=>(v*k).toFixed(2)).join(' ')}"${DASHES[i].includes(0.01)?' stroke-linecap="round"':''}`; }
const bwLine=()=>Math.max(T.boxOutline||0,1)*1.3;
function bwRect(x,y,w,h,mod,idx){
  const sw=bwLine();
  if(mod){ let s=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${T.radius}" fill="${T.text}"/>`;
    if(idx>0){ const d=Math.max(4,T.size1*0.16); s+=`<rect x="${(x+d).toFixed(1)}" y="${(y+d).toFixed(1)}" width="${(w-2*d).toFixed(1)}" height="${(h-2*d).toFixed(1)}" rx="${Math.max(2,T.radius-d*0.6).toFixed(1)}" fill="none" stroke="${T.box}" stroke-width="${(sw*0.9).toFixed(2)}"${dashAttr(idx)}/>`; }
    return s; }
  return `<rect x="${(x+sw/2).toFixed(1)}" y="${(y+sw/2).toFixed(1)}" width="${(w-sw).toFixed(1)}" height="${(h-sw).toFixed(1)}" rx="${T.radius}" fill="${T.box}" stroke="${T.text}" stroke-width="${sw.toFixed(2)}"${dashAttr(idx)}/>`;
}

/* ============================================================
   MEASURE + BOX
   ============================================================ */
const ctx=document.createElement('canvas').getContext('2d');
const capsT=t=> T.caps? t.toUpperCase() : t;
/* {css, weight} of a part of a label (design.fonts), or of one line, which may have an extra label's own font */
const LINE_ROLE={1:'line1',2:'line2',3:'names'};
const sectionFont=role=>{ const f=design.fonts[role]||{}; return {css:f.family? `'${f.family}', ${T.font}` : T.font, weight:f.weight||T.weight}; };
const lineFont=l=>{ const s=sectionFont(l.role||LINE_ROLE[l.size]); return {css:l.family? `'${l.family}', ${T.font}` : s.css, weight:l.weight||s.weight}; };
const sameFont=(a,b)=>a.css===b.css && a.weight===b.weight;
const fontAttrs=f=>(f.css!==T.font? ` font-family="${escAttr(f.css)}"` : '')+(f.weight!==T.weight? ` font-weight="${f.weight}"` : '');   // on top of the label layer's
const measure=(t,size,f={css:T.font,weight:T.weight})=>{ ctx.font=`${f.weight} ${size}px ${f.css}`; return ctx.measureText(t).width; };
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escAttr=t=>esc(t).replace(/"/g,'&quot;');
function groupsOf(lines){ const g=[]; for(const l of lines){ const last=g.at(-1); if(last&&last.mk===l.mk) last.lines.push(l); else g.push({mk:l.mk,lines:[l]}); } return g; }
const subGap=()=>Math.max(4,T.gap*0.6);
const linesH=ls=>ls.reduce((s,l)=>s+lhOf(l),0);
function boxSize(lines){
  if(lines.split){
    const gs=groupsOf(lines); let w=0;
    lines.forEach(l=>{ w=Math.max(w,measure(l.text,szOf(l),lineFont(l))); });
    const h=gs.reduce((s,g)=>s+linesH(g.lines)+2*T.padY,0)+((design.multiMod==='separate'&&!bwSec())?subGap()*(gs.length-1):0);
    return {w:Math.ceil(w)+2*T.padX, h};
  }
  let w=0,h=0; lines.forEach(l=>{ w=Math.max(w,measure(l.text,szOf(l),lineFont(l))); h+=lhOf(l); });
  const cap=holdCap(lines);
  if(cap) w=Math.max(w,measure(capText(lines),cap.size)-2*T.padX);
  return {w:Math.ceil(w)+2*T.padX, h:h+2*T.padY+(cap?cap.h:0)};
}
const capText=lines=> capsT(isToggle(mods()[lines.modIdx])? 'Tap' : 'Hold');
const modStyle=()=>design.modStyle||'outline';
const holdCap=lines=> lines.modBox && !lines.split && !bwSec() && modStyle()==='hold' ? {size:T.size2*0.8, h:T.size2*1.15} : null;
/* a colour as [r, g, b, a] (a from 0 to 1): #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() or rgba(); null if it is none of those */
function parseColour(v){
  const t=String(v||'').trim(), h=/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
  if(h){ const x=h[1].length<6? [...h[1]].map(c=>c+c).join('') : h[1], n=i=>parseInt(x.slice(i,i+2),16); return [n(0),n(2),n(4), x.length===8? n(6)/255 : 1]; }
  const m=/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i.exec(t);
  if(!m) return null;
  const c=x=>Math.min(255,Math.round(+x));
  return [c(m[1]),c(m[2]),c(m[3]), m[4]===undefined? 1 : Math.min(1,+m[4]/(m[5]?100:1))];
}
/* stored as hex, with two more digits when see-through: var() fallbacks can't hold the brackets of rgba() (resolveVars) */
const colourHex=([r,g,b,a])=>'#'+[r,g,b,...(a<1?[Math.round(a*255)]:[])].map(x=>x.toString(16).padStart(2,'0')).join('');
function onColour(col){ const p=parseColour(col); if(!p) return '#ffffff';
  const c=p.slice(0,3).map(v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2] > 0.4 ? '#1c1c1b' : '#ffffff'; }
const textEl=(l,tx,cy,align,fill)=>{ const sz=szOf(l), lh=lhOf(l);
  return `<text x="${tx.toFixed(1)}" y="${(cy+lh/2+sz*0.35).toFixed(1)}" font-size="${sz}"${fontAttrs(lineFont(l))} text-anchor="${align}" fill="${fill}">${esc(l.text)}</text>`; };
/* x,y = top-left of box; align start|middle|end within box */
function boxSVG(lines,x,y,w,h,align='middle',style={}){
  const tx= align==='start'? x+T.padX : align==='end'? x+w-T.padX : x+w/2;
  const sw=style.stroke&&style.sw>0?style.sw:0, st=sw?` stroke="${style.stroke}" stroke-width="${sw}"`:'';
  if(lines.split) return splitBoxSVG(lines,x,y,w,align,tx,sw,st);
  if(bwSec() && lines.mods && lines.mods.length){
    const idx=lines.mods[0], ink=lines.modBox? onColour(T.text) : null;
    let out=bwRect(x,y,w,h,!!lines.modBox,idx), cy=y+T.padY;
    for(const l of lines){ out+=textEl(l,tx,cy,align,ink||l.color); cy+=lhOf(l); }
    return out;
  }
  const ms= lines.modBox && !bwSec() ? modStyle() : '', mc=lines.modBox;
  let out='', ink=null;
  if(ms==='hold'){
    const cap=holdCap(lines);
    out+=`<text x="${tx.toFixed(1)}" y="${(y+cap.h*0.72).toFixed(1)}" font-size="${cap.size.toFixed(1)}" text-anchor="${align}" fill="${mc}">${capText(lines)}</text>`;
    y+=cap.h; h-=cap.h;
  }
  if(ms==='filled'){ ink=onColour(mc); out+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="${T.radius}" fill="${mc}"/>`; }
  else out+=`<rect x="${(x+sw/2).toFixed(1)}" y="${(y+sw/2).toFixed(1)}" width="${w-sw}" height="${h-sw}" rx="${T.radius}" ${fillAttr(lines)}${st}/>`;
  if(ms==='double'){ const d=Math.max(4,(sw||1)*3), iw=Math.max(sw*0.8,0.8);
    out+=`<rect x="${(x+d).toFixed(1)}" y="${(y+d).toFixed(1)}" width="${(w-2*d).toFixed(1)}" height="${(h-2*d).toFixed(1)}" rx="${Math.max(2,T.radius-d*0.6).toFixed(1)}" fill="none" stroke="${mc}" stroke-width="${iw.toFixed(2)}"/>`; }
  let cy=y+T.padY;
  for(const l of lines){ out+=textEl(l,tx,cy,align,ink||l.color); cy+=lhOf(l); }
  return out;
}
/* Black and white, control with 2+ modifiers: one box of stacked sections, each with its
   modifier's line pattern; a shared edge is drawn once; only the outer corners are rounded. */
const isModIdx=(i,lines)=>lines.modIdx===i;
function bwSection(x,y,w,h,mod,idx,first,last){
  const sw=bwLine(), r=T.radius, rt=first?r:0, rb=last?r:0, f=v=>v.toFixed(1);
  const closed=(x0,y0,x1,y1)=>`M${f(x0+rt)},${f(y0)} H${f(x1-rt)} A${rt},${rt} 0 0 1 ${f(x1)},${f(y0+rt)} V${f(y1-rb)} A${rb},${rb} 0 0 1 ${f(x1-rb)},${f(y1)} H${f(x0+rb)} A${rb},${rb} 0 0 1 ${f(x0)},${f(y1-rb)} V${f(y0+rt)} A${rt},${rt} 0 0 1 ${f(x0+rt)},${f(y0)} Z`;
  const fill=`<path d="${closed(x,y,x+w,y+h)}" fill="${mod?T.text:T.box}"/>`;
  if(mod) return {fill, stroke:''};
  const x0=x+sw/2, x1=x+w-sw/2, y0=y+(first?sw/2:0), y1=y+h-(last?sw/2:0);
  const d= first ? closed(x0,y0,x1,y1)
    : `M${f(x1)},${f(y0)} V${f(y1-rb)} A${rb},${rb} 0 0 1 ${f(x1-rb)},${f(y1)} H${f(x0+rb)} A${rb},${rb} 0 0 1 ${f(x0)},${f(y1-rb)} V${f(y0)}`;
  return {fill, stroke:`<path d="${d}" fill="none" stroke="${T.text}" stroke-width="${sw.toFixed(2)}"${dashAttr(idx)}/>`};
}
/* A control with 2+ modifiers: 'divided' = one box with a thin line between sections; 'separate' = stacked boxes */
function splitBoxSVG(lines,x,y,w,align,tx,sw,st){
  const gs=groupsOf(lines), mono=bwSec(), sep=design.multiMod==='separate'&&!mono;
  let fills='', strokes='';
  const total=gs.reduce((s,g)=>s+linesH(g.lines)+2*T.padY,0)+(sep?subGap()*(gs.length-1):0);
  let out= (sep||mono)? '' : `<rect x="${(x+sw/2).toFixed(1)}" y="${(y+sw/2).toFixed(1)}" width="${w-sw}" height="${total-sw}" rx="${T.radius}" ${fillAttr(lines)}${st}/>`;
  let yy=y;
  gs.forEach((g,k)=>{
    const hh=linesH(g.lines)+2*T.padY;
    if(mono){ const s=bwSection(x,yy,w,hh,!!(lines.modBox&&isModIdx(g.mk,lines)),g.mk,k===0,k===gs.length-1); fills+=s.fill; strokes+=s.stroke; }
    else if(sep) out+=`<rect x="${(x+sw/2).toFixed(1)}" y="${(yy+sw/2).toFixed(1)}" width="${w-sw}" height="${hh-sw}" rx="${T.radius}" ${fillAttr(lines)}${st}/>`;
    else if(k>0) out+=`<line x1="${x.toFixed(1)}" y1="${yy.toFixed(1)}" x2="${(x+w).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${T.text}" stroke-opacity=".45" stroke-width="${(T.size1*0.03).toFixed(2)}"/>`;
    let cy=yy+T.padY;
    for(const l of g.lines){
      const filled= mono && lines.modBox && isModIdx(g.mk,lines);
      out+=textEl(l,tx,cy,align,filled?onColour(T.text):l.color); cy+=lhOf(l);
    }
    yy+=hh+(sep?subGap():0);
  });
  return fills+strokes+out;
}
/* Legend, one group per modifier:  [Function] = [Modifier] + pad/knob */
const DEVICE_LEFT = 94.67;   // left edge of the faceplate outline
function legendSVG(left, top, maxW){
  if(curPart==='main') return {svg:'',text:'',h:0};
  const groups=[];
  const txt=t=>({t, w:measure(t,T.size1,sectionFont('line1'))});
  const box=(text,color,style,mb,mi)=>{ const l=[{text:capsT(text),color,size:1}]; if(mb) l.modBox=mb; if(mi!==undefined) l.mods=[mi]; return {box:l, ...boxSize(l), style}; };
  const sp=T.size1*0.35, gGap=T.size1*2, gw=g=>g.reduce((s,p)=>s+p.w,0)+sp*(g.length-1);
  for(const m of mods()){
    if(!usesMod(m)) continue;
    const col=modColor(m), i=modIndex(m), parts=modParts(m), kind=SLOT[parts[0]].kind;
    const rest=kind==='mod'||kind==='pad'?'pad/knob':'pad';
    const held=names=>names.flatMap((n,k)=>[...(k?[txt('+')]:[]), box(n,col,{stroke:col,sw:T.outline},col,i)]);
    const group=names=>isToggle(m)
      ? [box('Function',col,{},null,i), txt('= tap'), ...held(names), txt(', then '+rest)]
      : [box('Function',col,{},null,i), txt('='), ...held(names), txt('+ '+rest)];
    const g=group(parts.map(p=>has(p,'main')?val(p,'main').trim():lab(SLOT[p])));
    groups.push(isCombo(m) && gw(g)>maxW? group(parts.map(p=>lab(SLOT[p]))) : g);   // several long names don't fit on a line: P10 + P11
  }
  if(!groups.length) return {svg:'',text:'',h:0};
  groups.forEach(g=>{ g.w=gw(g); g.h=Math.max(...g.filter(p=>p.box).map(p=>p.h)); });
  const lines=[[]]; let lw=0;
  for(const g of groups){ const add=(lines.at(-1).length?gGap:0)+g.w;
    if(lines.at(-1).length && lw+add>maxW){ lines.push([g]); lw=g.w; } else { lines.at(-1).push(g); lw+=add; } }
  let svg='', text='', y=top;   // text: the words between the boxes, kept out of the label effect
  for(const line of lines){
    const lh=Math.max(...line.map(g=>g.h)); let x=left;
    for(const g of line){
      const base=y+lh/2+T.size1*0.35;
      for(const p of g){
        if(p.box) svg+=boxSVG(p.box,x,y+(lh-p.h)/2,p.w,p.h,'middle',p.style);
        else text+=`<text x="${x.toFixed(1)}" y="${base.toFixed(1)}" font-size="${T.size1}"${fontAttrs(sectionFont('line1'))} fill="${T.ink}">${esc(p.t)}</text>`;
        x+=p.w+sp;
      }
      x+=gGap-sp;
    }
    y+=lh+T.gap*2;
  }
  return {svg,text,h:y-top-T.gap*2};
}
const hl=s=> s?`<circle cx="${s.x}" cy="${s.y}" r="${s.kind==='pad'?66:50}" fill="none" stroke="#B8925A" stroke-width="6" stroke-dasharray="12 8"/>`:'';
const fontAttr=()=>`font-family="${T.font.replace(/"/g,"'")}" font-weight="${T.weight}"`;
/* drop shadow or glow behind the labels (one filter on the label layer) */
function fxDef(){
  const fx=design.fx; if(!fx || fx==='none' || bw) return {def:'',attr:''};
  const id='fx'+(++clipSeq), k=design.fxSize||6, c=design.fxColor||'#000000';
  const body= fx==='glow'
    ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${(k*0.35).toFixed(1)}" result="d"/><feGaussianBlur in="d" stdDeviation="${k}" result="b"/><feFlood flood-color="${c}"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>`
    : `<feDropShadow dx="0" dy="${(k*0.4).toFixed(1)}" stdDeviation="${k}" flood-color="${c}" flood-opacity=".75"/>`;
  return {def:`<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">${body}</filter>`, attr:` filter="url(#${id})"`};
}
let clipSeq=0;
/* The drawing: background, panel art, faceplate. Kept apart from the labels so the
   PNG export can turn it into a single image. */
function artSVG(x0,y0,x1,y1){
  const id='pc'+(++clipSeq), q=design.themes[T.theme].panel, simple=q.drawing==='simple';
  const parts= simple? simpleArt(q) : {base:'<use href="#panelBase" xlink:href="#panelBase"/>', ctl:'<use href="#panelCtl" xlink:href="#panelCtl"/>'};
  return `<rect x="${(x0-2).toFixed(1)}" y="${(y0-2).toFixed(1)}" width="${(x1-x0+4).toFixed(1)}" height="${(y1-y0+4).toFixed(1)}" fill="${T.bg}"/>`
    +`<clipPath id="${id}"><rect x="${DEVICE.x}" y="${DEVICE.y}" width="${DEVICE.w}" height="${DEVICE.h}" rx="${simple?0:DEVICE.r}"/></clipPath>`
    +`<g clip-path="url(#${id})">${parts.base}${fpUse()}${parts.ctl}</g>`;
}
/* The simplified drawing (Light / Dark / Visualiser in the label editor), in panel units.
   Pads come from the label editor's 825 × 1277 sketch, fitted to the device outline; the controls
   sit on the slot positions so labels line up. Returns the part under the faceplate and the controls. */
/* the simplified drawing's top plate (its Seed window cut out), for "Top plate only" faceplates */
const FP_TOP_SIMPLE='<clipPath id="fpTopSimple"><polygon points="101.8,185.7 514,185.7 654.2,457 981.5,457 981.5,948.2 101.8,948.2"/></clipPath>';
const SIMPLE_PADS = {
  top:  ['255,12 440,12 432,70 268,72','452,12 640,12 628,72 460,70'],
  row:  ['150,770 335,770 345,895 175,905','345,770 500,770 480,900 360,895','510,770 680,770 690,900 490,905'],
  play: ['15,930 160,915 165,1265 15,1265','175,905 325,905 330,1140 185,1145','340,905 440,920 445,1265 335,1265','455,915 690,910 690,1145 455,1140',
         '700,925 815,915 815,1265 700,1265','120,1160 325,1155 330,1265 110,1265','460,1155 690,1160 690,1265 460,1265'],
};
function simpleArt(q){
  const D={x:94.67, y:98.61, w:892.14, h:1427.88}, sx=D.w/825, sy=D.h/1277, f=v=>(+v).toFixed(1);
  const X=v=>D.x+v*D.w, Y=v=>D.y+v*D.h, pts=list=>list.split(' ').map(p=>{ const [a,b]=p.split(','); return f(D.x+a*sx)+','+f(D.y+b*sy); }).join(' ');
  const none=c=>!c||c==='none', fill=c=> none(c)? 'none' : c;
  const pad=q.pad||'#f8f4f4', padTop=q.padtop||pad, padLine=q.shape||'#201e1d', pw=q.padw||3.2;
  const lw=q.ctlw||4.4, swl=q.line||'#201e1d', r=q.round? 13 : 0;
  const device=`<rect x="${D.x}" y="${D.y}" width="${D.w}" height="${D.h}" fill="${fill(q.bg)}"${none(q.border)?'':` stroke="${q.border}" stroke-width="4.4"`}/>`;
  let top=`<rect x="${f(X(.008))}" y="${f(Y(.061))}" width="${f(.986*D.w)}" height="${f(.534*D.h)}" rx="${r}" fill="${fill(q.top)}"/>`;
  { const x0=X(.47), y0=Y(.061), w=.524*D.w, h=.19*D.h;   // Seed window, the slanted light area top right
    top+=`<polygon points="${f(x0+.4*w)},${f(y0)} ${f(x0+w)},${f(y0)} ${f(x0+w)},${f(y0+h)} ${f(x0+.3*w)},${f(y0+h)} ${f(x0)},${f(y0)}" fill="${fill(q.strip)}"/>`; }
  const pads=`<g stroke="${padLine}" stroke-width="${pw}" stroke-linejoin="round">`
    + SIMPLE_PADS.top.map(p=>`<polygon points="${pts(p)}" fill="${pad}"/>`).join('')
    + SIMPLE_PADS.row.map(p=>`<polygon points="${pts(p)}" fill="${padTop}"/>`).join('')
    + SIMPLE_PADS.play.map(p=>`<polygon points="${pts(p)}" fill="${pad}"/>`).join('') + '</g>';
  let ctl='';
  for(const id of ['IN','OUT']){ const s=SLOT[id]; ctl+=`<circle cx="${s.x}" cy="${s.y}" r="31" fill="${fill(q.jack||q.mid)}"/>`; }
  for(const id of ['S36','S37']){ const s=SLOT[id]; ctl+=`<rect x="${f(s.x-16)}" y="601" width="32" height="277" rx="${q.round?16:0}" fill="${fill(q.mid)}"/>`; }
  for(const s of SLOTS.filter(s=>s.kind==='knob')) ctl+=`<circle cx="${s.x}" cy="${s.y}" r="${f(38-lw/2)}" fill="${fill(q.ctl)}" stroke="${q.ctlline||'#f3f2f2'}" stroke-width="${lw}"/>`;
  { const a=SLOT.S09_S10, b=SLOT.S07_S08;
    ctl+=`<rect x="${f(a.x-49)}" y="${f(a.y-18.5)}" width="98" height="37" transform="rotate(-4 ${a.x} ${a.y})" fill="${fill(q.sw)}" stroke="${swl}" stroke-width="4.4"/>`;
    ctl+=`<rect x="${f(b.x-20)}" y="${f(b.y-47)}" width="40" height="94" transform="rotate(25 ${b.x} ${b.y})" fill="${fill(q.sw)}" stroke="${swl}" stroke-width="4.4"/>`; }
  ctl+=`<rect x="${USB_RECT[0]+2}" y="${USB_RECT[1]+2}" width="${USB_RECT[2]-4}" height="${USB_RECT[3]-4}" fill="${fill(q.jack||q.mid)}"/>`;   // the Seed's USB port
  { const l=SLOT.LED; ctl+=`<rect x="${l.x-12}" y="${l.y-8}" width="24" height="16" fill="${fill(q.led)}" stroke="${swl}" stroke-width="${q.round?2.2:4.4}"/>`; }
  return {base:device+top+pads, ctl, device, top, pads};
}
const boxG=(key,inner)=>`<g data-key="${escAttr(key)}">${inner}</g>`;
const userOffset=(layout,id)=>((doc.offsets||{})[layout]||{})[id];
/* A label can be turned by quarter turns, per layout (r in its offsets, clockwise). The layout sees the turned box: a
   quarter turn swaps its sides, so columns and pushing apart keep working. {w,h} as placed, {bw,bh} as drawn. */
const ROTS=[0,90,180,270];
const rotOf=(layout,id)=>{ const r=userOffset(layout,id)?.r; return ROTS.includes(r)? r : 0; };
function turnedSize(lines, layout, key){ const {w,h}=boxSize(lines), r=rotOf(layout,key), q=r%180!==0; return {w:q?h:w, h:q?w:h, bw:w, bh:h, r}; }
function placedBox(o, align, style){
  if(!o.r) return boxSVG(o.lines,o.x,o.y,o.w,o.h,align,style);
  const cx=o.x+o.w/2, cy=o.y+o.h/2;
  return `<g transform="rotate(${o.r} ${cx.toFixed(1)} ${cy.toFixed(1)})">${boxSVG(o.lines,cx-o.bw/2,cy-o.bh/2,o.bw,o.bh,'middle',style)}</g>`;
}
/* The control names on the drawing itself (design.names), on the main view: inside a knob, above a fader, beside the
   rest. Each can be dragged (offsets, key n:<id>). With a halo in the background colour, so they read on any drawing. */
const namesOn=mode=>design.names[mode].place==='drawing';
const nameOf=id=>REF_SETS[V.ref||design.nameSet]?.names[id]?.[0]||'';
function nameSpot(s,mode,sz,box){
  if(s.kind==='knob') return {x:s.x, y:s.y};
  if(s.kind==='fader') return {x:s.x, y:601-sz*0.9};
  if(mode==='phone' && box) return {x:box.x+box.w/2, y:box.y-sz*0.75};   // a label box covers the control
  if(s.kind==='jack') return {x:s.x, y:s.y+35+sz*0.8};
  if(s.kind==='switch') return {x:s.x, y:s.y-(s.id==='S07_S08'? 47 : 19)-sz*0.8};
  if(s.kind==='led') return {x:s.x, y:s.y-8-sz*0.8};
  return {x:s.x, y:s.y+(mode==='desktop'? 12+sz*0.7 : 0)};   // desktop: under the leader's dot
}
function namesSVG(mode, boxOf){
  if(curPart!=='main' || !namesOn(mode)) return '';
  const n=design.names[mode], sz=T.size3, f=v=>v.toFixed(1);
  return SLOTS.map(s=>{ const t=nameOf(s.id); if(!t || isOff(s.id)) return '';
    const p=nameSpot(s,mode,sz,boxOf&&boxOf(s.id)), d=userOffset(mode,'n:'+s.id)||{x:0,y:0}, cx=p.x+n.x+d.x, cy=p.y+n.y+d.y, r=rotOf(mode,'n:'+s.id);
    return boxG('n:'+s.id,`<text x="${f(cx)}" y="${f(cy+sz*0.35)}"${r?` transform="rotate(${r} ${f(cx)} ${f(cy)})"`:''} font-size="${sz}"${fontAttrs(sectionFont('names'))} text-anchor="middle" fill="${T.ink}" stroke="${T.bg}" stroke-width="${f(Math.max(2,sz*0.25))}" stroke-linejoin="round" paint-order="stroke">${esc(capsT(t))}</text>`); }).join('');
}

/* The faceplate labels (doc.fpLabels): text on the panel itself, like print on the hardware. It follows the print set,
   because a faceplate does not change with a mode. Above the knobs, below the faders, where the label boxes leave room. */
const fplOn=mode=>{ const q=doc.fpLabels; return q && q.on && q[mode].show!=='off'? q[mode].show : ''; };
const fplText=id=>{ const t=doc.fpLabels?.text[id] ?? (doc.labels[id]||{}).main ?? ''; return t.trim()==='-'? '' : arrows(t); };
/* 'instead': the faceplate says it, so the box goes. Not while a modifier is in use or a mode has its own text. */
const fplHidesBox=(mode,id)=> curPart==='main' && fplOn(mode)==='instead' && !soloMod && !!fplText(id) && !curMode()?.labels[id];
function fplSpot(s,mode,sz){
  if(s.kind==='knob') return {x:s.x, y:s.y-44-sz*0.5};
  if(s.kind==='fader') return {x:s.x, y:886+sz*0.5};
  if(s.kind==='jack') return {x:s.x, y:s.y-37-sz*0.5};
  if(s.kind==='switch') return {x:s.x, y:s.y+(s.id==='S07_S08'? 55 : 27)+sz*0.5};
  if(s.kind==='led') return {x:s.x, y:s.y+14+sz*0.5};
  return {x:s.x, y:s.y-(mode==='phone'? 46 : 14)-sz*0.5};   // pads: clear of the box or the leader's dot on them
}
let fplForce = false;   // the Labels button's Faceplate view (play.js): draws them on a layout set to off too
function fpLabelsSVG(mode){
  if(!fplOn(mode) && !(fplForce && doc.fpLabels?.on)) return '';
  const sz=doc.fpLabels[mode].size, q=design.themes[T.theme].panel, f=v=>v.toFixed(1);
  // on the simplified drawing the pads and the Seed window are light where the top plate is dark
  const ink=s=>T.fpl || (q.drawing==='simple' && !['knob','fader','jack'].includes(s.kind)? q.shape : q.fp) || T.ink;
  return SLOTS.map(s=>{ const t=fplText(s.id); if(!t) return '';
    const key='f:'+s.id, p=fplSpot(s,mode,sz), d=userOffset(mode,key)||{x:0,y:0}, cx=p.x+d.x, cy=p.y+d.y, r=rotOf(mode,key);
    return boxG(key,`<text x="${f(cx)}" y="${f(cy+sz*0.35)}"${r?` transform="rotate(${r} ${f(cx)} ${f(cy)})"`:''} font-size="${sz}"${fontAttrs(sectionFont('faceplate'))} text-anchor="middle" fill="${ink(s)}">${esc(capsT(t))}</text>`); }).join('');
}

/* ============================================================
   PHONE: boxes on top of the controls
   Each box is anchored with its centre on its control. Overlapping boxes push
   each other apart along the shortest direction; a spring pulls every box back
   to its control. Dragged boxes keep the user's nudge on top of that.
   ============================================================ */
function layoutPhone(){
  const items=[];
  for(const s of SLOTS){
    if(fplHidesBox('phone',s.id)) continue;
    const lines=slotLines(s); if(!lines.length) continue;
    // knobs: the box hangs just below the knob and is never pushed up onto it;
    // faders: the box sits on the fader's centre, between the two rows of knob labels
    const t=turnedSize(lines,'phone',s.id), {h}=t, below=s.kind==='knob'? s.y+KNOB_R+T.gap : null;
    const ay= below!=null? below+h/2 : (s.ly??s.y);
    items.push({s,lines,...t,ax:s.x,ay,cx:s.x,cy:ay,lock:!!s.lockX,minCy:below!=null? ay : s.minTop!=null?s.minTop+h/2:-Infinity});
  }
  const G=T.gap, N=400;
  for(let it=0;it<N;it++){
    for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
      const a=items[i], b=items[j];
      const dx=b.cx-a.cx, dy=b.cy-a.cy;
      const ox=(a.w+b.w)/2+G-Math.abs(dx), oy=(a.h+b.h)/2+G-Math.abs(dy);
      if(ox<=0||oy<=0) continue;
      const alongX = ox<oy && !(a.lock&&b.lock);
      if(alongX){
        const s=Math.sign(dx)||Math.sign(b.ax-a.ax)||1;
        const fa=a.lock?0:b.lock?1:.5, fb=1-fa;           // a locked box doesn't move sideways
        a.cx-=s*ox*fa; b.cx+=s*ox*fb;
      } else { const s=Math.sign(dy)||Math.sign(b.ay-a.ay)||1; a.cy-=s*oy/2; b.cy+=s*oy/2; }
    }
    const k=0.12*(1-it/N);
    for(const o of items){ o.cx = o.lock? o.ax : o.cx+(o.ax-o.cx)*k; o.cy+=(o.ay-o.cy)*k; o.cy=Math.max(o.cy,o.minCy); }
  }
  for(const o of items){ const d=userOffset('phone',o.s.id); if(d){ o.cx+=d.x; o.cy+=d.y; } }
  if(curPart==='main') for(const c of doc.customs||[]){
    const lines=customLines(c); if(!lines.length) continue;
    items.push({s:{id:'c'+c.id,kind:'custom',x:c.x,y:c.y},lines,...turnedSize(lines,'phone','c'+c.id),cx:c.x,cy:c.y,custom:c});
  }
  const warns={};
  for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
    const a=items[i],b=items[j];
    if(Math.abs(b.cx-a.cx)<(a.w+b.w)/2-1 && Math.abs(b.cy-a.cy)<(a.h+b.h)/2-1){ warns[a.s.id]=true; warns[b.s.id]=true; }
  }
  items.forEach(o=>{o.x=o.cx-o.w/2; o.y=o.cy-o.h/2;});
  return {items,warns};
}
/* Main and secondary share one frame, so switching between them doesn't jump */
function frameOf(build,th,pt){
  if(!hasSecondary()) return null;
  const keep=curPart, pts=['main','second'];
  const b1=pts.map(p=>build(true,th,p,null).bounds);
  const f={x0:Math.min(...b1.map(b=>b.x0)), y0:Math.min(...b1.map(b=>b.y0)), x1:Math.max(...b1.map(b=>b.x1)), y1c:Math.max(...b1.map(b=>b.y1c)), yEnd:-Infinity};
  f.yEnd=Math.max(...pts.map(p=>build(true,th,p,f).bounds.yEnd));
  curPart=keep;
  return f;
}
/* Returns {vb, art, over, th, panelVars, warns, bounds}; svgOf() joins it into one <svg> */
function buildPhone(forExport,th=V.theme,pt=part,frame){
  if(frame===undefined) frame=frameOf(buildPhone,th,pt);
  curPart=pt; usePalette('phone',th); wantFonts();
  const {items,warns}=layoutPhone();
  let g=items.map(o=>boxG(o.s.id,placedBox(o,'middle',o.custom? customBoxStyle(o.custom) : boxStyle(o.s)))).join('');
  const named=namesSVG('phone',id=>items.find(o=>o.s.id===id));
  let x0=PANEL_BOX.x, y0=PANEL_BOX.y, x1=PANEL_BOX.x+PANEL_BOX.w, y1=PANEL_BOX.y+PANEL_BOX.h;
  for(const o of items){ x0=Math.min(x0,o.x-12); x1=Math.max(x1,o.x+o.w+12); y0=Math.min(y0,o.y-12); y1=Math.max(y1,o.y+o.h+12); }
  if(frame){ ({x0,y0,x1}=frame); y1=frame.y1c; }
  const bounds={x0,y0,x1,y1c:y1};
  let legendText='';
  { const Lg=legendSVG(DEVICE_LEFT, y1+24, x1-12-DEVICE_LEFT); if(Lg.h){ g+=Lg.svg; legendText=Lg.text; y1+=Lg.h+44; } }
  bounds.yEnd=y1; if(frame && frame.yEnd>y1) y1=frame.yEnd;
  return {warns, bounds, th, part:pt, panelVars:T.panelVars,
    vb:`${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1-x0).toFixed(1)} ${(y1-y0).toFixed(1)}`,
    art:artSVG(x0,y0,x1,y1),
    over:(f=>`<g class="fplabels" ${fontAttr()}>${fpLabelsSVG('phone')}</g>${f.def}${forExport?'':hl(SLOT[V.focusId])}<g ${fontAttr()}${f.attr}>${g}</g><g ${fontAttr()}>${legendText}${named}</g>`)(fxDef())};
}

/* ============================================================
   DESKTOP: boxes in side columns with leader lines
   ============================================================ */
/* Physical parts on the panel that leader lines must not cross (panel units).
   Pads are left out: they fill the whole lower half. */
const OBSTACLES = (()=>{
  const o={};
  for(const s of SLOTS){
    if(s.kind==='knob') o[s.id]=[s.x-33,s.y-33,s.x+33,s.y+33];
    if(s.kind==='jack') o[s.id]=[s.x-28,s.y-28,s.x+28,s.y+28];
  }
  o.S36=[138.4,601.3,166.2,878.2]; o.S37=[914.8,601.3,942.6,878.2];
  o.S09_S10=[387.2,1027.2,479.1,1060.8]; o.S07_S08=[551.7,1069.5,629.7,1164.5];
  o.USB=[858,325,902,391]; o.LED=[816,297,842,313];
  return o;
})();
const OB_MARGIN=12;

function buildDesktop(forExport,th=V.theme,pt=part,frame){
  if(frame===undefined) frame=frameOf(buildDesktop,th,pt);
  curPart=pt; usePalette('desktop',th); wantFonts();
  const L=PANEL_BOX.x, R=PANEL_BOX.x+PANEL_BOX.w, lx=L-DESK.gap, rx=R+DESK.gap;
  const gap=Math.max(T.gap,12);
  const side={L:[],R:[]}, topRow=[];
  for(const s of SLOTS){
    if(fplHidesBox('desktop',s.id)) continue;
    const lines=slotLines(s,'desktop'); if(!lines.length) continue;
    const o={s,lines,...turnedSize(lines,'desktop',s.id)};
    if(s.id==='P10'||s.id==='P11') topRow.push(o); else side[s.x<540?'L':'R'].push(o);
  }

  // where may this label's leader run? returns sorted free y-intervals for the box centre
  function freeY(o,k){
    const s=o.s, m=OB_MARGIN;
    let lo=PANEL_BOX.y+o.h/2, hi=PANEL_BOX.y+PANEL_BOX.h-o.h/2;
    const blocked=[];
    for(const [id,b] of Object.entries(OBSTACLES)){
      if(id===s.id) continue;
      const [x0,y0,x1,y1]=b;
      // vertical part runs along the control's x
      if(s.x>x0-m && s.x<x1+m){ if(y0>s.y) hi=Math.min(hi,y0-m); else if(y1<s.y) lo=Math.max(lo,y1+m); }
      // horizontal part runs from the control out to the side
      const onPath = k==='L' ? x0<s.x : x1>s.x;
      if(onPath) blocked.push([y0-m,y1+m]);
    }
    let free=[[lo,hi]];
    for(const [a,b] of blocked){
      free=free.flatMap(([p,q])=> b<=p||a>=q ? [[p,q]] : [ ...(a>p?[[p,a]]:[]), ...(b<q?[[b,q]]:[]) ]);
    }
    return free.filter(([p,q])=>q>=p);
  }
  const nearest=(free,y)=>{ let best=null,d=1e9; for(const [p,q] of free){ const c=Math.max(p,Math.min(y,q)); if(Math.abs(c-y)<d){d=Math.abs(c-y);best=c;} } return best; };
  const project=(free,y)=>{ const n=nearest(free,y); return n===null?y:n; };
  // labels keep their top-to-bottom order; neighbours push each other apart,
  // every label stays in a spot where its leader is free, and drifts back to its control
  function place(b){
    b.forEach(o=>o.cy=o.t);
    const N=300;
    for(let it=0;it<N;it++){
      for(let i=0;i<b.length-1;i++){
        const a=b[i], c=b[i+1], need=(a.h+c.h)/2+gap, d=c.cy-a.cy;
        if(d<need){ const p=need-d; a.cy-=p/2; c.cy+=p/2; }
      }
      const k=0.1*(1-it/N);
      b.forEach(o=>{ o.cy+= (o.t-o.cy)*k; o.cy=project(o.free,o.cy); });
    }
    // final pass: boxes never overlap. When a column is too full, boxes leave their
    // preferred spot (and may run past the panel edge) rather than sit on top of each other.
    const need=(a,c)=>(a.h+c.h)/2+gap, top=PANEL_BOX.y, bottom=PANEL_BOX.y+PANEL_BOX.h;
    for(let i=1;i<b.length;i++) b[i].cy=Math.max(b[i].cy, b[i-1].cy+need(b[i-1],b[i]));
    if(b.length && b.at(-1).cy+b.at(-1).h/2>bottom){
      b.at(-1).cy=bottom-b.at(-1).h/2;
      for(let i=b.length-2;i>=0;i--) b[i].cy=Math.min(b[i].cy, b[i+1].cy-need(b[i],b[i+1]));
      if(b[0].cy-b[0].h/2<top){ b[0].cy=Math.max(b[0].cy, top+b[0].h/2);
        for(let i=1;i<b.length;i++) b[i].cy=Math.max(b[i].cy, b[i-1].cy+need(b[i-1],b[i])); }
    }
    b.forEach(o=>{ o.y=o.cy-o.h/2; });
  }
  const path=(o,k)=>[[o.s.x,o.s.y],[o.s.x,o.cy],[k==='L'?o.x+o.w:o.x,o.cy]];
  const segX=(p,q,r,s)=>{ const h1=p[1]===q[1], h2=r[1]===s[1]; if(h1===h2) return false;
    const [H1,H2,V1,V2]=h1?[p,q,r,s]:[r,s,p,q]; const y=H1[1], x=V1[0];
    return x>Math.min(H1[0],H2[0])+1 && x<Math.max(H1[0],H2[0])-1 && y>Math.min(V1[1],V2[1])+1 && y<Math.max(V1[1],V2[1])-1; };

  const maxW={L:0,R:0};
  for(const k of ['L','R']){
    const b=side[k];
    b.forEach(o=>{ o.free=freeY(o,k); o.t=nearest(o.free,o.s.y); });
    b.sort((a,c)=>a.t-c.t || (k==='L'? a.s.x-c.s.x : c.s.x-a.s.x));
    maxW[k]=Math.max(0,...b.map(o=>o.w));
    const setX=()=>b.forEach(o=>{ o.x = k==='L' ? lx-maxW.L : rx+maxW.R-o.w; });
    place(b); setX();
    // untangle: when two leaders cross, swap their order and lay out again
    const crossing=(a,c)=>{ const A=path(a,k), C=path(c,k); for(let u=0;u<2;u++) for(let v=0;v<2;v++) if(segX(A[u],A[u+1],C[v],C[v+1])) return true; return false; };
    for(let p=0;p<12;p++){ let sw=false;
      outer: for(let i=0;i<b.length;i++) for(let j=i+1;j<b.length;j++){
        if(crossing(b[i],b[j])){ const x=b[i]; b[i]=b[j]; b[j]=x; place(b); sw=true; break outer; }
      }
      if(!sw) break;
    }
    b.forEach(o=>{ const d=userOffset('desktop',o.s.id); if(d){ o.x+=d.x; o.cy+=d.y; } o.y=o.cy-o.h/2; });
  }

  // P10 / P11: straight above their pads, above the panel
  const panelTop=98.6, topGap=34;
  topRow.forEach(o=>{ o.cx=o.s.x; });
  if(topRow.length===2){ const [a,b]=topRow.sort((p,q)=>p.s.x-q.s.x); const need=(a.w+b.w)/2+gap-(b.cx-a.cx); if(need>0){ a.cx-=need/2; b.cx+=need/2; } }
  topRow.forEach(o=>{ const d=userOffset('desktop',o.s.id); o.x=o.cx-o.w/2+(d?d.x:0); o.y=panelTop-topGap-o.h+(d?d.y:0); });

  // a knob with its name inside: the leader starts at the rim
  const named=namesSVG('desktop');
  const rim=(o,k)=>{ const a=path(o,k), s=o.s, dy=o.cy-s.y; if(!named || s.kind!=='knob' || !nameOf(s.id)) return a;
    if(Math.abs(dy)>=KNOB_R) a[0]=[s.x, s.y+Math.sign(dy)*KNOB_R];
    else { const x=s.x+(k==='L'?-1:1)*Math.sqrt(KNOB_R*KNOB_R-dy*dy); a[0]=a[1]=[x,o.cy]; }
    return a; };
  let lines='',boxes='';
  const lw=design.leaderW??2.5, dot=s=>`<circle cx="${s.x}" cy="${s.y}" r="${Math.max(4,lw*2.8).toFixed(1)}" fill="${T.leader}"/>`;
  for(const k of ['L','R']) for(const o of side[k]){
    const a=rim(o,k), pts=a.map(p=>p.map(v=>(+v).toFixed(1)).join(',')).join(' ');
    lines+=`<g data-lead="${o.s.id}"><polyline points="${pts}" fill="none" stroke="${T.leader}" stroke-opacity=".6" stroke-width="${lw}"/>${dot({x:a[0][0],y:a[0][1]})}</g>`;   // data-lead: hidden with the label (Labels button)
    boxes+=boxG(o.s.id,placedBox(o,k==='L'?'start':'end',boxStyle(o.s)));
  }
  for(const o of topRow){
    const bx=o.x+o.w/2, by=o.y+o.h;
    const pts = Math.abs(bx-o.s.x)<1 ? `${o.s.x},${o.s.y} ${o.s.x},${by}` : `${o.s.x},${o.s.y} ${o.s.x},${(by+o.s.y)/2} ${bx},${(by+o.s.y)/2} ${bx},${by}`;
    lines+=`<g data-lead="${o.s.id}"><polyline points="${pts}" fill="none" stroke="${T.leader}" stroke-opacity=".6" stroke-width="${lw}"/>${dot(o.s)}</g>`;
    boxes+=boxG(o.s.id,placedBox(o,'middle',boxStyle(o.s)));
  }
  if(curPart==='main') for(const c of doc.customs||[]){
    const cl=customLines(c); if(!cl.length) continue;
    const t=turnedSize(cl,'desktop','c'+c.id); boxes+=boxG('c'+c.id,placedBox({lines:cl,...t,x:c.x-t.w/2,y:c.y-t.h/2},'middle',customBoxStyle(c)));
  }
  const pad=24;
  let x0=lx-maxW.L-pad, x1=rx+maxW.R+pad;
  const all=[...side.L,...side.R];
  let y0=Math.min(PANEL_BOX.y, ...topRow.map(o=>o.y-pad), ...all.map(o=>o.y-pad));
  let y1=Math.max(PANEL_BOX.y+PANEL_BOX.h, ...all.map(o=>o.y+o.h+pad));
  for(const o of all){ x0=Math.min(x0,o.x-pad); x1=Math.max(x1,o.x+o.w+pad); }
  if(frame){ ({x0,y0,x1}=frame); y1=frame.y1c; }
  const bounds={x0,y0,x1,y1c:y1};
  let legendText='';
  { const Lg=legendSVG(DEVICE_LEFT, y1+32, x1-pad-DEVICE_LEFT); if(Lg.h){ boxes+=Lg.svg; legendText=Lg.text; y1+=Lg.h+56; } }
  bounds.yEnd=y1; if(frame && frame.yEnd>y1) y1=frame.yEnd;
  return {warns:{}, bounds, th, part:pt, panelVars:T.panelVars,
    vb:`${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1-x0).toFixed(1)} ${(y1-y0).toFixed(1)}`,
    art:artSVG(x0,y0,x1,y1),
    over:(f=>`<g class="fplabels" ${fontAttr()}>${fpLabelsSVG('desktop')}</g>${f.def}${forExport?'':hl(SLOT[V.focusId])}${lines}<g ${fontAttr()}${f.attr}>${boxes}</g><g ${fontAttr()}>${legendText}${named}</g>`)(fxDef())};
}
const buildFor = layout => layout==='desktop'? buildDesktop : buildPhone;
const svgLabel = () => (doc.firmware.name||'Simple Touch')+' controls';
function svgOf(r){
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${r.vb}" role="img" aria-label="${escAttr(svgLabel())}" style="${r.panelVars}">${r.art}<g class="over">${r.over}</g></svg>`;
}

/* ============================================================
   PANEL ART + CUSTOM FACEPLATE
   The faceplate is an SVG on the same artboard as the panel (0 0 1080 1598.24),
   drawn on top of the blank base panel.
   ============================================================ */
/* the drawing has the Seed's USB port but not its LED, so the LED is added to the controls layer */
const USB_RECT=[858.81,323.95,45.08,69.42];
const LED_RECT=`<rect id="st-LED" x="${829-11}" y="${305-7}" width="22" height="14" rx="2" style="fill:var(--pled,var(--pline,#fff)); stroke:var(--pline,#fff); stroke-width:1px; vector-effect:non-scaling-stroke;"/>`;
let panelSrc='', panelBaseSrc='', panelCtlSrc='', topPlateD='', fpMarkup='', fpMsg='', fpDeskMarkup='', fpDeskMsg='';
function ensureDefs(){
  if(document.getElementById('stDefs')) return;
  const d=document.createElement('div');
  d.innerHTML='<svg id="stDefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs><g id="panelBase"></g><g id="faceplateArt"></g><g id="faceplateArtDesktop"></g><g id="panelCtl"></g><clipPath id="fpTop"><path id="fpTopPath"/></clipPath>'+FP_TOP_SIMPLE+fpHoles(false)+fpHoles(true)+'</defs></svg>';
  document.body.prepend(d.firstChild);
}
/* one top-level layer of the drawing: st-Black_BG, st-Faceplate_BOTTOM, st-Layer_2, st-Faceplate_TOP, st-Knobs_Faders_Jacks */
const LAYERS=['st-Black_BG','st-Faceplate_BOTTOM','st-Layer_2','st-Faceplate_TOP','st-Knobs_Faders_Jacks'];
function panelLayer(id){ const a=panelSrc.indexOf(`<g id="${id}"`), i=LAYERS.indexOf(id), next=LAYERS[i+1];
  return a<0? '' : panelSrc.slice(a, next? panelSrc.indexOf(`<g id="${next}"`) : panelSrc.length); }
async function loadPanelArt(){
  ensureDefs();
  const t=await (await fetch(PANEL_URL)).text();
  const a=t.indexOf('>', t.indexOf('<g id="panelArt"'))+1, b=t.lastIndexOf('</g>');
  panelSrc=t.slice(a,b);
  const k=panelSrc.indexOf('<g id="st-Knobs_Faders_Jacks"');
  panelBaseSrc=panelSrc.slice(0,k); panelCtlSrc=panelSrc.slice(k)+LED_RECT;
  document.getElementById('panelBase').innerHTML=panelBaseSrc;
  document.getElementById('panelCtl').innerHTML=panelCtlSrc;
  topPlateD=(/<path d="([^"]+)"/.exec(panelLayer('st-Faceplate_TOP'))||[])[1]||'';
  document.getElementById('fpTopPath').setAttribute('d',topPlateD);
  await document.fonts.load(`${T.weight} 32px ${T.font}`).catch(()=>{});   // boxes are measured with the label font
}
const PANEL_VB=[0,0,1080,1598.24];
/* Faceplate placement (doc.fpStyle): area 'panel' | 'top' (clipped to the top plate), blend mode, opacity,
   and for artwork that isn't made on the template: scale, x, y (panel units) and stretch to the panel. */
const FP_DEFAULT = { area:'panel', blend:'normal', opacity:1, scale:1, x:0, y:0, stretch:false, ratio:null };
const fpStyle = () => ({...FP_DEFAULT, ...(doc.fpStyle||{})});
function fpTransform(f){
  const cx=ARTBOARD.w/2, cy=ARTBOARD.h/2, h=f.ratio? ARTBOARD.w/f.ratio : ARTBOARD.h, sy=f.stretch? ARTBOARD.h/h : 1;
  if(f.scale===1 && sy===1 && !f.x && !f.y) return '';
  return `translate(${(cx+f.x).toFixed(1)} ${(cy+f.y).toFixed(1)}) scale(${f.scale.toFixed(3)} ${(f.scale*sy).toFixed(3)}) translate(${-cx} ${(-cy).toFixed(2)})`;
}
/* The faceplate stays out of the knobs, faders and jacks: a mask with their shapes cut out, per drawing */
function fpHoles(simple){
  const k=simple? 38 : 32.03, j=simple? 31 : 27.01, w=simple? 32 : 27.85, y=simple? 601 : 601.27, h=simple? 277 : 276.91, r=simple? 0 : 13.92;
  return `<mask id="fpHoles${simple?'Simple':''}" maskUnits="userSpaceOnUse" x="0" y="0" width="${ARTBOARD.w}" height="${ARTBOARD.h}"><rect width="${ARTBOARD.w}" height="${ARTBOARD.h}" fill="#fff"/>`
    + SLOTS.filter(s=>s.kind==='knob').map(s=>`<circle cx="${s.x}" cy="${s.y}" r="${k}"/>`).join('')
    + ['IN','OUT'].map(id=>`<circle cx="${SLOT[id].x}" cy="${SLOT[id].y}" r="${j}"/>`).join('')
    + ['S36','S37'].map(id=>`<rect x="${(SLOT[id].x-w/2).toFixed(2)}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`).join('')
    + '</mask>';
}
/* a layout's faceplate: which art and where, or null for the blank panel */
function fpOf(layout){
  const q=doc.fpDesktop, main=doc.faceplate? 'faceplateArt' : '';
  if(layout!=='desktop' || !q) return main? {id:main, style:fpStyle()} : null;
  const id= q.art==='own'? (q.faceplate? 'faceplateArtDesktop' : '') : q.art==='same'? main : '';
  return id? {id, style:{...FP_DEFAULT, ...q.style}} : null;
}
const fpUse=()=>{ const u=fpOf(T.layout); if(!u) return ''; const f=u.style, tr=fpTransform(f);
  const st=[f.opacity<1?`opacity:${f.opacity}`:'', f.blend!=='normal'?`mix-blend-mode:${f.blend}`:''].filter(Boolean).join(';');
  const simple= design.themes[T.theme].panel.drawing==='simple', top= simple? 'fpTopSimple' : 'fpTop';
  return `<g${st?` style="${st}"`:''}${f.area==='top'?` clip-path="url(#${top})"`:''} mask="url(#fpHoles${simple?'Simple':''})"><use href="#${u.id}" xlink:href="#${u.id}"${tr?` transform="${tr}"`:''}/></g>`; };
function sanitizeFaceplate(text){
  const d=new DOMParser().parseFromString(text,'image/svg+xml');
  if(d.querySelector('parsererror')) throw new Error('this is not a valid SVG file');
  const svg=d.documentElement; if(svg.nodeName.toLowerCase()!=='svg') throw new Error('this is not an SVG file');
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove());
  // guide layers from the template (TEMPLATE_outline, TEMPLATE_controls, …) are dropped
  let guides=0;
  svg.querySelectorAll('*').forEach(n=>{ const name=n.getAttribute('id')||n.getAttribute('data-name')||n.getAttribute('inkscape:label')||'';
    if(/^TEMPLATE/i.test(name) && n.isConnected){ n.remove(); guides++; } });
  sanitizeFaceplate.guides=guides;
  svg.querySelectorAll('*').forEach(n=>{ for(const a of [...n.attributes]){
    if(/^on/i.test(a.name)) n.removeAttribute(a.name);
    if(/href$/i.test(a.name) && !/^(#|data:image\/)/i.test(a.value)) n.removeAttribute(a.name);
  }});
  return new XMLSerializer().serializeToString(svg);
}
/* Faceplate colours follow the theme: white art uses "Faceplate art",
   #222221 uses the background, black uses "Panel dark parts". Other colours stay as drawn. */
const FP_MAP=[[/^(#fff|#ffffff|white)$/i,'--pfp','#fff'],[/^#222221$/i,'--pbg','#222221'],[/^(#060606|#000|#000000|black)$/i,'--pshape','#060606']];
function fpVar(c){ c=(c||'').trim(); for(const [re,v,f] of FP_MAP) if(re.test(c)) return `var(${v},${f})`; return null; }
function recolourFaceplate(svg){
  svg.querySelectorAll('*').forEach(n=>{ for(const a of ['fill','stroke']){
    const v=fpVar(n.getAttribute(a)); if(!v) continue;
    n.removeAttribute(a); n.setAttribute('style',`${a}:${v};`+(n.getAttribute('style')||''));
  }});
}
const recolourCSS=s=>s.replace(/((?:fill|stroke)\s*:\s*)(#[0-9a-f]{3,6}|white|black)\b/gi,(m,p,c)=>{ const v=fpVar(c); return v? p+v : m; });
function faceplateMarkup(clean){
  const d=new DOMParser().parseFromString(clean,'image/svg+xml'), svg=d.documentElement;
  recolourFaceplate(svg);
  const vb=(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  let inner=[...svg.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('');
  // keep ids from clashing with the base panel
  const ids=[...svg.querySelectorAll('[id]')].map(n=>n.id);
  for(const id of ids){ const e=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    inner=inner.replace(new RegExp(`id="${e}"`,'g'),`id="fp-${id}"`).replace(new RegExp(`url\\(#${e}\\)`,'g'),`url(#fp-${id})`).replace(new RegExp(`href="#${e}"`,'g'),`href="#fp-${id}"`); }
  inner=recolourCSS(inner.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,''));
  const same = vb.length===4 && vb.every((v,i)=>Math.abs(v-PANEL_VB[i])<0.5);
  fpMsg = same ? 'Faceplate loaded.'+(sanitizeFaceplate.guides?' Template guide layers left out.':'') : `Artboard is ${vb.length===4?vb.join(' '):'unknown'}, not 0 0 1080 1598.24. It is stretched to the panel, so check the alignment.`;
  return same ? inner : `<svg x="0" y="0" width="1080" height="1598.24" viewBox="${vb.length===4?vb.join(' '):PANEL_VB.join(' ')}" preserveAspectRatio="none">${inner}</svg>`;
}
function setFaceplate(clean, ref='', style=null){
  ensureDefs();
  doc.faceplate=clean||''; doc.faceplateRef=clean? ref : '';
  if(style) doc.fpStyle=style; else if(!clean) doc.fpStyle={};
  fpMarkup = doc.faceplate ? faceplateMarkup(doc.faceplate) : '';
  if(!doc.faceplate) fpMsg='';
  document.getElementById('faceplateArt').innerHTML = fpMarkup;
  setFpDesktop();
}
/* the desktop layout's own art, put where the drawing can use it (every load goes through setFaceplate) */
function setFpDesktop(){
  ensureDefs();
  const art=doc.fpDesktop?.art==='own'? doc.fpDesktop.faceplate : '', keep=fpMsg;
  fpDeskMarkup= art? faceplateMarkup(art) : ''; fpDeskMsg= art? fpMsg : ''; fpMsg=keep;
  document.getElementById('faceplateArtDesktop').innerHTML = fpDeskMarkup;
}
const bakeColours=(svg,th)=>resolveVars(svg, panelVarMap(th));
const panelDefs=()=>`<g id="panelBase">${panelBaseSrc}</g><g id="panelCtl">${panelCtlSrc}</g><clipPath id="fpTop"><path d="${topPlateD}"/></clipPath>${FP_TOP_SIMPLE}${fpHoles(false)}${fpHoles(true)}`+(doc.faceplate?`<g id="faceplateArt">${fpMarkup}</g>`:'')+(fpDeskMarkup?`<g id="faceplateArtDesktop">${fpDeskMarkup}</g>`:'');
/* Standalone SVG of the drawing alone (colours baked in), used as an <img> in the PNG export */
function artImageSVG(r){
  return bakeColours(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${r.vb}"><defs>${panelDefs()}</defs>${r.art}</svg>`, r.th);
}
const svgDataURL=s=>'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(s)));

/* An image faceplate (PNG / JPG / WebP / GIF / AVIF) is wrapped in an SVG on the panel's artboard, so it is stored,
   saved and opened exactly like an SVG faceplate. Large images are scaled down to 2× the artboard, except GIFs: the canvas would keep only their first frame. */
const ARTBOARD={w:1080, h:1598.24};
async function imageFaceplate(file){
  const url=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsDataURL(file); });
  const img=new Image(); img.src=url; await img.decode();
  const w=img.naturalWidth, h=img.naturalHeight, maxW=ARTBOARD.w*2;
  let src=url;
  if(w>maxW && file.type!=='image/gif'){ const c=document.createElement('canvas'); c.width=maxW; c.height=Math.round(h*maxW/w);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height); src=c.toDataURL(file.type==='image/jpeg'?'image/jpeg':'image/png',.9); }
  const off=Math.abs((w/h)/(ARTBOARD.w/ARTBOARD.h)-1)>0.01;
  const ih=ARTBOARD.w*h/w;
  return { ratio:w/h, svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARTBOARD.w} ${ARTBOARD.h}"><image href="${src}" x="0" y="${((ARTBOARD.h-ih)/2).toFixed(2)}" width="${ARTBOARD.w}" height="${ih.toFixed(2)}" preserveAspectRatio="none"/></svg>`,
    msg: off? `Image loaded (${w} × ${h}). It keeps its shape and fills the panel width; move, scale or stretch it below.` : `Image loaded (${w} × ${h}).` };
}
/* Faceplate template, on the same artboard, in the selected theme's drawing and colours.
   Guide layers are called TEMPLATE_… and are left out on upload; draw in ARTWORK.
   The PNG version has the controls highlighted, so you can see what will be covered. */
function templateSVG(png, th=V.theme){
  const q=design.themes[th].panel, simple=q.drawing==='simple';
  const bake=t=>resolveVars(t, panelVarMap(th));
  const lines=t=> png? t.replace(/; vector-effect:non-scaling-stroke/g,'').replace(/stroke-width:(\.75|1|1\.75)px/g,(m,w)=>`stroke-width:${({'.75':'.8','1':'1.2','1.75':'2'})[w]}px`) : t;
  const L=(id,label,body,extra='')=>`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${label}"${extra}>${body}</g>`;
  const inner=s=>s.replace(/^<g id="[^"]+">/,'').replace(/<\/g>$/,'');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="${ARTBOARD.w}" height="${ARTBOARD.h}" viewBox="0 0 ${ARTBOARD.w} ${ARTBOARD.h}">
<!-- Simple Touch faceplate template. Draw in the ARTWORK layer. Layers called TEMPLATE_… are guides: they are left out when you upload this file. Artboard 1080 × 1598.24; for images use 1080 × 1598 px or 2160 × 3196 px. Panel drawing (c) Roey Tsemah / Synthux Academy. -->
${png? '<style>#TEMPLATE_controls *{fill:#ec3013 !important;fill-opacity:.3 !important}</style>' : ''}
${simple? (a=>[
  L('TEMPLATE_background','TEMPLATE_background (page and device)',`<rect x="0" y="0" width="${ARTBOARD.w}" height="${ARTBOARD.h}" fill="${q.frame||q.bg}"/>`+a.device,' sodipodi:insensitive="true"'),
  L('TEMPLATE_pads','TEMPLATE_pads (touch pads)',a.pads,' sodipodi:insensitive="true"'),
  L('TEMPLATE_outline','TEMPLATE_outline (top plate and Seed window)',a.top,' sodipodi:insensitive="true"'),
  L('ARTWORK','ARTWORK',''),
  L('TEMPLATE_controls','TEMPLATE_controls (jacks, knobs, faders, switches, LED: always drawn on top)',a.ctl,' sodipodi:insensitive="true"')].join('\n'))(simpleArt(q)) : [
  L('TEMPLATE_background','TEMPLATE_background',inner(bake(panelLayer('st-Black_BG'))),' sodipodi:insensitive="true"'),
  L('TEMPLATE_pads','TEMPLATE_pads (touch pads and device edge)',lines(inner(bake(panelLayer('st-Faceplate_BOTTOM')))),' sodipodi:insensitive="true"'),
  L('TEMPLATE_outline','TEMPLATE_outline (top plate and Seed window)',lines(inner(bake(panelLayer('st-Faceplate_TOP')))+inner(bake(panelLayer('st-Layer_2')))),' sodipodi:insensitive="true"'),
  L('ARTWORK','ARTWORK',''),
  L('TEMPLATE_controls','TEMPLATE_controls (jacks, knobs, faders: always drawn on top)',lines(inner(bake(panelLayer('st-Knobs_Faders_Jacks')))),' sodipodi:insensitive="true"')].join('\n')}
</svg>`;
}
const templateName=ext=>`simple-touch-faceplate-template-${V.theme}${ext}`;
function downloadTemplateSVG(){ downloadText(templateName('.svg'), templateSVG(false), 'image/svg+xml'); }
async function downloadTemplatePNG(){
  const img=new Image(); img.src=svgDataURL(templateSVG(true)); await img.decode();
  const c=document.createElement('canvas'); c.width=ARTBOARD.w*2; c.height=Math.round(ARTBOARD.h*2);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  download(templateName('-2160x3196.png'), c.toDataURL('image/png'));
}

/* ============================================================
   FONTS: Google Fonts by name, or any CSS URL (Adobe Fonts project links work too)
   ============================================================ */
const FONTS = ['Archivo','Space Grotesk','IBM Plex Sans','IBM Plex Mono','JetBrains Mono','Barlow Condensed','Oswald','Work Sans','DM Sans','DM Mono','Inter Tight','Rubik','Chakra Petch','Share Tech Mono'];
const EXTRA_FONTS = ['Orbitron','Syne','Rajdhani','Azeret Mono','Silkscreen','Press Start 2P','VT323','Audiowide','Saira Condensed','Major Mono Display','Fira Code','Michroma'];
const fontHref = f => 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;500;600;700&display=swap';
function normalizeFontName(s) {
  const t = s.trim().replace(/\+/g, ' ').replace(/\s+/g, ' ');
  return /[A-Z]/.test(t) ? t : t.replace(/\b[a-z]/g, c => c.toUpperCase());
}
function parseFontInput(raw, famInput) {
  let s = (raw || '').trim();
  if (!s) return { family: 'Archivo', url: null, needFamily: false };
  const hrefM = s.match(/href=["']([^"']+)["']/i) || s.match(/url\(["']?([^"')]+)["']?\)/i);
  if (hrefM) s = hrefM[1].trim();
  if (/^https?:\/\//i.test(s)) {
    const specM = s.match(/fonts\.google\.com\/specimen\/([^/?#]+)/i);
    if (specM) { const fam = normalizeFontName(decodeURIComponent(specM[1])); return { family: fam, url: fontHref(fam), needFamily: false }; }
    const gfM = s.match(/family=([^&:;#]+)/i);
    if (gfM) { const fam = normalizeFontName(decodeURIComponent(gfM[1])); return { family: fam, url: s, needFamily: false }; }
    const fam = (famInput || '').trim() || s.split('/').pop().replace(/\.(css|woff2?|ttf|otf).*$/i, '').replace(/[-_]+/g, ' ') || 'Custom Font';
    return { family: fam, url: s, needFamily: true };
  }
  const fam = normalizeFontName(s);
  return { family: fam, url: fontHref(fam), needFamily: false };
}
/* One promise per stylesheet, so a second request (e.g. "Use font" right after the preview in the
   font dialog) waits for the same load instead of resolving before the font is there. Resolves once
   the label weight of the family is usable. */
const fontSheets = {};
function ensureFontLoaded(family, url, weight) {
  if (!family || family === 'Archivo') return Promise.resolve();
  const href = url || fontHref(family);
  if (!fontSheets[href]) fontSheets[href] = new Promise(res => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.crossOrigin = 'anonymous';
    l.onload = l.onerror = res; l.href = href;
    document.head.appendChild(l);
  });
  return fontSheets[href].then(() => document.fonts.load(`${weight||T.weight||400} 32px '${family}'`)).catch(() => {});
}
/* Label boxes are measured with the label font; whenever a font face finishes loading
   (another weight, a slow network, a font set by a saved file), the page draws again. */
let onFontsLoaded = null, fontsTimer = null;
document.fonts.addEventListener('loadingdone', () => { clearTimeout(fontsTimer); fontsTimer = setTimeout(() => onFontsLoaded && onFontsLoaded(), 50); });
function setLabelFont(family){ T.font = `'${family||'Archivo'}', 'Archivo', system-ui, sans-serif`; }
const labelFontHref = (family, url) => url || (family && family!=='Archivo' ? fontHref(family) : null);
/* The fonts of label parts and extra labels. Each is asked for once; the page draws again on loadingdone. */
const usedFonts = () => [...Object.values(design.fonts), ...(ownStyles? (doc.customs||[]).map(c=>c.style||{}) : [])].filter(f=>f.family);
const fontsAsked = new Set();
function wantFonts(){ for(const f of usedFonts()){ const k=[f.family,f.url,f.weight].join('|'); if(!fontsAsked.has(k)){ fontsAsked.add(k); ensureFontLoaded(f.family,f.url,f.weight); } } }

/* ============================================================
   MARKDOWN: # headings, **bold**, *em*, `code`, [links](url), - / 1. lists, | tables |, ---
   ============================================================ */
function mdInline(s){
  return esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g,'$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|[^)\s:]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md2html(src){
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
  const out=[];
  for(const block of (src||'').replace(/\r/g,'').split(/\n\s*\n/)){
    const L=block.split('\n').map(l=>l.trimEnd()).filter(l=>l.trim()); if(!L.length) continue;
    let i=0;
    while(i<L.length){
      const l=L[i]; let m;
      if((m=l.match(/^(#{1,3})\s+(.*)/))){ const n=Math.min(3,m[1].length+1); out.push(`<h${n}>${mdInline(m[2])}</h${n}>`); i++; continue; }
      if(/^---+$/.test(l)){ out.push('<hr>'); i++; continue; }
      if(/^\s*\|/.test(l)){
        const rows=[]; while(i<L.length&&/^\s*\|/.test(L[i])) rows.push(L[i++]);
        const body=rows.filter((r,j)=>!(j===1&&/^[\s|:\-]+$/.test(r)));
        const [head,...rest]=body;
        out.push(`<div class="tw"><table><thead><tr>${cells(head).map(c=>`<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r=>`<tr>${cells(r).map(c=>`<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if(/^\s*([-*]|\d+\.)\s/.test(l)){
        const tag=/^\s*\d/.test(l)?'ol':'ul', it=[];
        while(i<L.length&&/^\s*([-*]|\d+\.)\s/.test(L[i])) it.push(L[i++].replace(/^\s*([-*]|\d+\.)\s+/,''));
        out.push(`<${tag}>${it.map(x=>`<li>${mdInline(x)}</li>`).join('')}</${tag}>`); continue;
      }
      const p=[]; while(i<L.length&&!/^(#{1,3}\s|---+$|\s*\||\s*([-*]|\d+\.)\s)/.test(L[i])) p.push(L[i++].trim());
      out.push(`<p>${mdInline(p.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/* ============================================================
   CONTROL TABLE: control | reference name | function | + each modifier
   ============================================================ */
/* A control's MIDI, as its label file writes it: "CC 20", "note 36 ch 10 · CC 31", "CC 30 ≥ 64", "CC 21 = 3".
   Parts are split on · , or ;. Channels count from 1; no channel = any. A range after a CC number
   narrows it to those values. Returns [{cc|note, ch, lo, hi}]; what it cannot read, it leaves out. */
const NOTE_PC={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
function midiMap(text){
  const out=[];
  for(const part of String(text||'').split(/[·,;]/)){
    const chm=part.match(/\bch(?:annel)?\s*(\d{1,2})\b/i), ch= chm && chm[1]>=1 && chm[1]<=16 ? chm[1]-1 : null;
    const cc=part.match(/\bcc\s*(\d{1,3})(?:\s*(<=|>=|≤|≥|<|>|=)\s*(\d{1,3}))?/i);
    if(cc && cc[1]<128){
      const v=+cc[3], lo={'>=':v,'≥':v,'>':v+1,'=':v}[cc[2]], hi={'<=':v,'≤':v,'<':v-1,'=':v}[cc[2]];
      out.push({cc:+cc[1], ch, lo:lo??0, hi:hi??127});
      continue;
    }
    const n=part.match(/\bnote\s*(?:(\d{1,3})\b|([a-g])([#♯b♭]?)(-?\d)\b)/i);
    if(n){
      const num= n[1]!==undefined? +n[1] : NOTE_PC[n[2].toLowerCase()] + ({'#':1,'♯':1,'b':-1,'♭':-1}[n[3]]||0) + 12*(+n[4]+1);
      if(num>=0 && num<128) out.push({note:num, ch});
    }
  }
  return out;
}
function tableHTML(blank){
  const ms=mods().filter(usesMod), refLabel=V.ref&&REF_SETS[V.ref]? REF_SETS[V.ref].label : '';
  const midi=!blank && TABLE_ORDER.some(id=>val(id,'midi').trim());
  const head=`<tr><th>Control</th>${refLabel?`<th>${esc(refLabel)}</th>`:''}<th>Function</th>${blank?'':ms.map(m=>`<th class="m" style="color:var(--m${modIndex(m)+1})">${isToggle(m)?'after ':'+ '}${esc(modName(m))}</th>`).join('')}${midi?'<th class="midi">MIDI</th>':''}</tr>`;
  const rows=TABLE_ORDER.map(id=>{
    const s=SLOT[id], r=refOf(id), mi=midi? val(id,'midi').trim() : '';
    const fn=blank? '' : [val(id,'main'),NO_LINE2.includes(id)?'':val(id,'main_2')].map(x=>x.trim()).filter(Boolean).join(' · ');
    const mc=blank? '' : ms.map(m=>`<td>${inMod(m,id)?'<em>modifier</em>':esc(val(id,'m_'+m))}</td>`).join('');
    if(!blank && !fn && !mc.replace(/<td><\/td>/g,'') && (!r || isOff(id)) && !mi) return '';
    return `<tr data-id="${id}"${blank?' class="blank"':''}><td><b>${esc(lab(s))}</b> <span class="k">${KIND_NAME[s.kind]}</span></td>${refLabel?`<td>${r?esc(r[0]):''}</td>`:''}<td>${esc(fn)}</td>${mc}${midi?`<td class="midi">${mi.split(/\s*·\s*/).map(x=>`<span>${esc(x)}</span>`).join(' · ')}</td>`:''}</tr>`;
  }).join('');
  return `<table class="ctab"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

/* Several modes side by side (the export sheet): a column per mode, the function and, smaller, what the modifiers do */
function modesTableHTML(list){
  const ms=mods().filter(usesMod), name=p=> p? modeList().find(m=>m.pos===p)?.name||p : 'All modes';
  const cells=id=>list.map(p=>withMode(p,()=>{
    const fn=[val(id,'main'),NO_LINE2.includes(id)?'':val(id,'main_2')].map(x=>x.trim()).filter(Boolean).join(' · ');
    const mm=ms.filter(m=>!inMod(m,id) && val(id,'m_'+m).trim()).map(m=>`<span class="k" style="display:block;color:var(--m${modIndex(m)+1})">${isToggle(m)?'after ':'+ '}${esc(modName(m))}: ${esc(val(id,'m_'+m))}</span>`).join('');
    return fn||mm? `${esc(fn)}${mm}` : '';
  }));
  const rows=TABLE_ORDER.map(id=>{ const c=cells(id); if(c.every(x=>!x)) return '';
    return `<tr data-id="${id}"><td><b>${esc(lab(SLOT[id]))}</b> <span class="k">${KIND_NAME[SLOT[id].kind]}</span></td>${c.map(x=>`<td>${x}</td>`).join('')}</tr>`; }).join('');
  return `<table class="ctab"><thead><tr><th>Control</th>${list.map(p=>`<th>${esc(name(p))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================================================
   SHARE LINKS: deflate + base64url in ?s=
   ============================================================ */
const toB64Url = u8 => { let bin=''; for(let i=0;i<u8.length;i++) bin+=String.fromCharCode(u8[i]); return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
const fromB64Url = str => { const b64=str.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((str.length+3)%4); const bin=atob(b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; };
async function encodeShareState(obj){
  const bytes=new TextEncoder().encode(JSON.stringify(obj));
  if(typeof CompressionStream!=='undefined'){
    const cs=new CompressionStream('deflate-raw'); const w=cs.writable.getWriter(); w.write(bytes); w.close();
    return '1.'+toB64Url(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
  }
  return '0.'+toB64Url(bytes);
}
async function decodeShareState(str){
  const [ver,data]=str.includes('.')? str.split('.',2) : ['1',str];
  const bytes=fromB64Url(data);
  if(ver==='1' && typeof DecompressionStream!=='undefined'){
    const ds=new DecompressionStream('deflate-raw'); const w=ds.writable.getWriter(); w.write(bytes); w.close();
    return JSON.parse(new TextDecoder().decode(await new Response(ds.readable).arrayBuffer()));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* The designer's current state in this browser, as a label file shows it: ?preview in the library and the web app */
const DESIGNER_KEY = 'simpleTouchManual.v1';
async function designerPreview(){
  let s=null; try{ s=JSON.parse(localStorage.getItem(DESIGNER_KEY)||'null'); }catch(e){}
  if(!s || !s.doc) return null;
  const d=await resolveFaceplate(normalise(s.doc)), u=s.UI||{};
  d.look=lookOf({design:s.design, view:s.V, font:{family:u.font, url:u.fontUrl}});
  try{ if(d.faceplate) d.faceplate=sanitizeFaceplate(d.faceplate); }catch(e){ d.faceplate=''; }
  try{ if(d.fpDesktop?.faceplate) d.fpDesktop.faceplate=sanitizeFaceplate(d.fpDesktop.faceplate); }catch(e){ d.fpDesktop.faceplate=''; }
  return {doc:d, ref:(s.V||{}).ref||'', refMode:(s.V||{}).refMode||'both'};
}

/* ============================================================
   EXPORT: PNG (via html-to-image) and the standalone manual page
   ============================================================ */
const slug=()=>(doc.firmware.name||'simple-touch').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'simple-touch';
function download(name,href){ const a=document.createElement('a'); a.href=href; a.download=name; document.body.append(a); a.click(); setTimeout(()=>{ if(href.startsWith('blob:')) URL.revokeObjectURL(href); a.remove(); },500); }
const downloadText=(name,text,type)=>download(name,URL.createObjectURL(new Blob([text],{type})));
/* A .zip of a few files, stored without compression (the PNG is compressed already) */
const CRC_TABLE=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c= c&1? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
const crc32=u8=>{ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC_TABLE[(c^u8[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
function zipBlob(files){   // [{name, data: string | Uint8Array}]
  const enc=new TextEncoder(), local=[], central=[], d=new Date();
  const time=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), date=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  let off=0;
  for(const f of files){
    const name=enc.encode(f.name), data= typeof f.data==='string'? enc.encode(f.data) : f.data, crc=crc32(data);
    const h=new DataView(new ArrayBuffer(30)), c=new DataView(new ArrayBuffer(46));
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true);   // version 2.0, UTF-8 names
    h.setUint16(10,time,true); h.setUint16(12,date,true); h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true);
    c.setUint16(12,time,true); c.setUint16(14,date,true); c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,off,true);
    local.push(h,name,data); central.push(c,name);
    off+=30+name.length+data.length;
  }
  const size=central.reduce((s,x)=>s+x.byteLength,0), e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,size,true); e.setUint32(16,off,true);
  return new Blob([...local,...central,e],{type:'application/zip'});
}
const pageInk = th => ({...INK_DARK, ...(design.themes[th].page||{}), ...(design.themes[th].panel.frame? {bg:design.themes[th].panel.frame} : {})});
const DOC_CSS = `
.md{font-size:15px;line-height:1.55}
.md h2{font:800 24px/1.15 var(--font-heading,Archivo,sans-serif);margin:1.1em 0 .4em}
.md h3{font:800 18px/1.2 var(--font-heading,Archivo,sans-serif);margin:1em 0 .35em}
.md > :first-child{margin-top:0}
.md p,.md ul,.md ol{margin:0 0 .8em}
.md ul,.md ol{padding-left:1.3em}
.md li{margin:.15em 0}
.md hr{border:0;border-top:2px solid currentColor;margin:1em 0}
.md code{font:13px ui-monospace,Menlo,monospace}
.md .tw{overflow-x:auto;margin:0 0 1em}
.md table,.ctab{border-collapse:collapse;width:100%;font-size:14px;line-height:1.3}
.md th,.md td,.ctab th,.ctab td{text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid var(--hair);vertical-align:top}
.md th,.ctab th{border-bottom:1px solid var(--rule);font-weight:700}
.ctab .k{font-size:12px;color:var(--muted);font-weight:400}
.ctab tr.blank td{height:30px}
.ctab td.midi{font-family:ui-monospace,Menlo,monospace;font-size:.85em}
.ctab td.midi span{white-space:nowrap}`;
document.head.insertAdjacentHTML('beforeend',`<style>${DOC_CSS}</style>`);

/* Export minimap: a thumbnail of the PNG sheet in the export theme's colours. Click the table or the
   notes to switch them in or out, the panel for the panel alone. opts: {th, table, notes, notesOk, parts, stacked, onPanel, onTable, onNotes} */
function minimap(o){
  const q=design.themes[o.th].panel, ink=pageInk(o.th), face=q.top||q.bg, pad=q.pad||q.shape||q.line;
  const panel=()=>`<span class="mm-dev" style="background:${q.bg};border-color:${ink.fg}"><i style="background:${face}"></i><b style="color:${ink.fg}">PANEL</b><span class="mm-pads">${'<i></i>'.repeat(4).replace(/<i>/g,`<i style="background:${pad}">`)}</span></span>`;
  const el=document.createElement('div'); el.className='mm';
  el.innerHTML=`<span class="cap">Preview</span>
    <div class="mm-sheet" style="background:${ink.bg};color:${ink.fg};border-color:${ink.fg}">
      <div class="mm-top">
        <button type="button" class="mm-panels${o.stacked?' stacked':''}" title="Panel only">${panel().repeat(o.parts||1)}</button>
        <button type="button" class="mm-table${o.table?' on':''}" title="${o.table?'Leave out':'Add'} the table"><b>TABLE</b><span>${'<i></i>'.repeat(5)}</span></button>
      </div>
      <button type="button" class="mm-notes${o.notes?' on':''}"${o.notesOk===false?' disabled':''} title="${o.notesOk===false?'No notes for this one':(o.notes?'Leave out':'Add')+' the notes'}"><b>NOTES</b><span>${'<i></i>'.repeat(4)}</span></button>
    </div>
    <span class="mm-cap">${['Panel',o.table&&'Table',o.notes&&'Notes'].filter(Boolean).join(' + ')}</span>`;
  el.querySelector('.mm-panels').onclick=o.onPanel; el.querySelector('.mm-table').onclick=o.onTable; el.querySelector('.mm-notes').onclick=o.onNotes;
  return el;
}

/* Export preview: the PNG sheet (title, drawing(s), table, notes) at its real size in a modal.
   Free size: drag the handle beside the drawing to set its width. A4 / Letter: the sheet is the page,
   and the arrangement that gives the biggest drawings is picked by trying each one on the sheet:
   panels side by side or stacked, the table beside or below them. Notes go underneath. */
const PAPER = { a4:{w:794, h:1123, pt:[595.28,841.89], label:'A4', css:'A4'}, letter:{w:816, h:1056, pt:[612,792], label:'Letter', css:'letter'} };   // CSS px at 96 dpi, PDF points
/* Sheet spacing and text size sliders: [key, label, min, max, step, CSS variable]. null keeps the sheet's own default */
const XSLIDERS = [['pad','Margin',0,64,1,'--xpad'], ['fgap','Panel gap',-120,80,1,'--xfgap'], ['tgap','Table gap',0,80,1,'--xtgap'], ['fs','Text size',8,20,0.5,'--xfs']];
const XDEFAULTS = { free:{pad:32, fgap:16, tgap:40, fs:14}, paper:{pad:28, fgap:16, tgap:24, fs:12} };
/* A PDF with one full-page JPEG per page. pages: [{jpeg: Uint8Array, px:[w,h], pt:[w,h]}] */
function pdfBlob(pages){
  const enc=new TextEncoder(), parts=[], offs=[]; let len=0;
  const put=x=>{ const b= typeof x==='string'? enc.encode(x) : x; parts.push(b); len+=b.length; };
  const obj=(n,dict,stream)=>{ offs[n]=len; put(`${n} 0 obj\n${dict}\n`); if(stream){ put('stream\n'); put(stream); put('\nendstream\n'); } put('endobj\n'); };
  put('%PDF-1.4\n%âãÏÓ\n');
  obj(1,'<</Type/Catalog/Pages 2 0 R>>');
  obj(2,`<</Type/Pages/Kids[${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}]/Count ${pages.length}>>`);
  pages.forEach((p,i)=>{ const o=3+i*3, [W,H]=p.pt.map(v=>v.toFixed(2)), draw=`q ${W} 0 0 ${H} 0 0 cm /Im Do Q`;
    obj(o,`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im ${o+1} 0 R>>>>/Contents ${o+2} 0 R>>`);
    obj(o+1,`<</Type/XObject/Subtype/Image/Width ${p.px[0]}/Height ${p.px[1]}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${p.jpeg.length}>>`, p.jpeg);
    obj(o+2,`<</Length ${draw.length}>>`, draw);
  });
  const xref=len, size=offs.length;
  put(`xref\n0 ${size}\n0000000000 65535 f\r\n`+offs.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n\r\n').join(''));
  put(`trailer\n<</Size ${size}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}
function exportStamp(){
  const d=new Date(), fw=doc.firmware, date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return ['Exported '+date, [fw.name||'Simple Touch', fw.version&&'v'+fw.version].filter(Boolean).join(' '), 'Simple Touch manual designer build '+BUILD].join(' · ');
}
/* Notes on an export sheet in two columns made of whole blocks (heading, list, table), so a table is
   never split and a heading never sits alone at the bottom of a column. Rebalanced on every layout. */
function balanceNotes(el){
  if(!el || el.offsetParent===null) return;
  let A=el.querySelector(':scope > .ncol'), B=A&&A.nextElementSibling;
  if(!A){ A=document.createElement('div'); B=document.createElement('div'); A.className=B.className='ncol'; A.append(...el.childNodes); el.append(A,B); }
  A.append(...B.childNodes);
  const h=e=>e.getBoundingClientRect().height;
  for(let last=A.lastElementChild; last && A.children.length>1; last=A.lastElementChild){
    if(h(B)+h(last) >= h(A)) break;
    B.prepend(last);
  }
  while(A.lastElementChild && /^H[23]$/.test(A.lastElementChild.tagName) && A.children.length>1) B.prepend(A.lastElementChild);
}
/* cfg: layout, stacked, include {table, notes}, look 'color' | 'print', notesOk (false hides the notes option),
   tableNotesOnly (the library: notes only together with the table), content(include, look) → {parts, th, tableHtml,
   withNotes, fileBase}, onChange(include, look) to keep the choice on the page */
let xModes=null;   // the export's modes: their order and which are on (kept while the page is open)
function openExportPreview(cfg){
  if(!window.htmlToImage){ alert('html-to-image did not load, so PNG export is not available.'); return; }
  const layout=cfg.layout, stacked=!!cfg.stacked, inc={table:false, notes:false, ...(cfg.include||{})};
  // modes (doc.modes): which go on the sheet and in which order, the current one to start with
  const ML=modeList(), names={'':'All modes', ...Object.fromEntries(ML.map(m=>[m.pos,m.name]))};
  if(ML.length){ const all=Object.keys(names), keep=(xModes?.order||[]).filter(p=>all.includes(p));
    xModes={order:[...keep, ...all.filter(p=>!keep.includes(p))], on:new Set([...(xModes?.on||[])].filter(p=>all.includes(p)))};
    if(!xModes.on.size) xModes.on.add(curMode()?.pos||''); }
  const chosen=()=> ML.length? xModes.order.filter(p=>xModes.on.has(p)) : [null];
  const inMode=(p,f)=> p===null? f() : withMode(p,f);
  const slugOf=t=>t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  let look=cfg.look||'color';
  const KEY='stManual.exportW.'+layout, DEF= layout==='desktop'? 760 : 480, OPT_KEY='stManual.exportOpts';
  let figW=DEF; try{ figW=+localStorage.getItem(KEY)||DEF; }catch(e){}
  const opt={paper:'free', orient:'portrait', stamp:true, pad:null, fgap:null, tgap:null, fs:null, cols:'auto'}; try{ Object.assign(opt, JSON.parse(localStorage.getItem(OPT_KEY))||{}); }catch(e){}
  const fw=doc.firmware, dlg=document.createElement('dialog');
  dlg.className='xprev';
  dlg.innerHTML=`<div class="xbar"><div data-mm></div>
      <div class="xopts">
        <div class="xrow"><span class="cap">Export preview</span><div class="seg" data-look></div>
          <div class="seg" data-paper></div><div class="seg" data-orient></div>
          <label class="xchk"><input type="checkbox" data-stamp> Date and version</label>
          <span class="sp"></span><div class="xacts"><span class="status" data-busy></span>
          <button type="button" class="primary" data-png>Download PNG</button><button type="button" data-pdf>Download PDF</button><button type="button" data-print>Print…</button><button type="button" data-close>Close</button></div></div>
        <div class="xrow" data-sliders>${XSLIDERS.map(([k,l,min,max,step])=>`<label class="xsl"><span>${l}</span><input type="range" data-sl="${k}" min="${min}" max="${max}" step="${step}"><output></output></label>`).join('')}
          <button type="button" data-slreset>Reset sizes</button></div>
        <div class="xrow" data-arr></div>
        <div class="xrow"><span class="hint" data-size></span></div>
      </div></div>
    <div class="xscroll"></div>`;
  const q=sel=>dlg.querySelector(sel);
  let ink, th, notes, fileBase, page2, PG=[], perMode=1;
  // the drawings' sheets: one, or a page per mode. Each: {sheet, body, figBox, grip, figEls, wrapEls, figs, tableHtml, notesEl, cols}
  const split=()=> ML.length && opt.split==='each' && chosen().length>1;
  // (re)build the sheets for the current include / look / modes: the drawings of each mode in turn, a caption on each
  function fill(){
    const sel=chosen(), c=inMode(sel[0], ()=>cfg.content({...inc}, look)), keepBW=bw, each=split();
    th=c.th; notes= c.withNotes && (fw.notes||'').trim(); perMode=c.parts.length;
    fileBase=c.fileBase+(!ML.length? '' : sel.length>1? '-modes' : sel[0]? '-'+slugOf(names[sel[0]]) : '');
    ink=pageInk(th);
    const groups= each? sel.map(p=>[p]) : [sel], caps= ML.length && !each && !(sel.length===1 && sel[0]==='');
    const tableOf=g=> !inc.table? '' : g.length>1? modesTableHTML(g) : inMode(g[0], ()=>cfg.content({...inc}, look).tableHtml||'');
    const figsOf=g=>g.flatMap(p=>inMode(p,()=>c.parts.map(pt=>{ const r=buildFor(layout)(true,th,pt), [,, vw, vh]=r.vb.split(' ').map(Number); return {r, vw, vh, img:svgDataURL(artImageSVG(r)), cap: caps? names[p] : ''}; })));
    const style=`background:${ink.bg};color:${ink.fg};--hair:${ink.hair};--rule:${ink.rule};--muted:${ink.muted}`;
    const built=groups.map((g,gi)=>{ const figs=figsOf(g), tableHtml=tableOf(g), last=gi===groups.length-1;
      return {figs, tableHtml, html:`<div class="xsheet" style="${style}">
      <h1 class="xh1">${esc(fw.name||'Simple Touch')}${each? ' · '+esc(names[g[0]]) : ''}</h1>
      ${fw.description && gi===0?`<p class="xdesc">${esc(fw.description)}</p>`:''}
      <div class="xbody">
        <div class="xfigs">${figs.map(f=>`<div class="xfig">${f.cap?`<div class="xcap">${esc(f.cap)}</div>`:''}<div data-fig style="position:relative;flex:none"><img src="${f.img}" alt="" style="position:absolute;inset:0;width:100%;height:100%;display:block"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.r.vb}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${f.r.over}</svg></div></div>`).join('')}
          <div class="xgrip" title="Drag to resize the drawing · double-click to reset"><span></span></div></div>
        ${tableHtml?`<div class="xtable">${tableHtml}</div>`:''}
      </div>
      ${notes && last?`<div class="md xnotes" style="border-top:2px solid ${ink.rule}">${md2html(fw.notes)}</div>`:''}
      <p class="xfoot" style="color:${ink.muted}">Simple Touch panel drawing © Roey Tsemah (Synthux Academy), adapted via Fabio Bartali.${groups.length>1? ` Page ${gi+1} of ${groups.length}.` : ''}<span data-stampline></span></p>
    </div>`}; });
    bw=keepBW;
    q('.xscroll').innerHTML=built.map(x=>x.html).join('')+`
    ${notes?`<div class="xsheet paper xpage2" hidden style="${style}">
      <h1 class="xh1">${esc(fw.name||'Simple Touch')} · notes</h1>
      <div class="md xnotes2">${md2html(fw.notes)}</div>
      <p class="xfoot" style="color:${ink.muted}">Notes<span data-stampline></span></p></div>`:''}`;
    page2=q('.xpage2');
    PG=[...dlg.querySelectorAll('.xsheet:not(.xpage2)')].map((sheet,i)=>({sheet, body:sheet.querySelector('.xbody'), figBox:sheet.querySelector('.xfigs'), grip:sheet.querySelector('.xgrip'),
      figEls:[...sheet.querySelectorAll('[data-fig]')], wrapEls:[...sheet.querySelectorAll('.xfig')], notesEl:sheet.querySelector('.xnotes'), figs:built[i].figs, tableHtml:built[i].tableHtml, cols:1}));
    for(const pg of PG){
      for(let i=1;i<=4;i++) pg.sheet.style.setProperty('--m'+i, palOf('phone',th)['m'+i]);
      pg.grip.addEventListener('pointerdown',e=>{ e.preventDefault(); const x0=e.clientX, w0=figW, n=pg.cols;
        const move=ev=>{ figW=w0+(ev.clientX-x0)/n; lay(); };
        const up=()=>{ removeEventListener('pointermove',move); removeEventListener('pointerup',up); save(); };
        addEventListener('pointermove',move); addEventListener('pointerup',up); });
      pg.grip.addEventListener('dblclick',()=>{ figW=DEF; lay(); save(); });
    }
  }
  // what goes on the sheet: the minimap (click the table or the notes) and colour / print
  function options(){
    const changed=()=>{ cfg.onChange && cfg.onChange({...inc}, look); options(); fill(); lay(); };
    const pairT=cfg.tableNotesOnly;   // notes only come with the table
    q('[data-mm]').replaceChildren(minimap({th: look==='print'?'print':(cfg.theme||V.theme), table:inc.table, notes:inc.notes, notesOk:cfg.notesOk,
      parts:(cfg.parts||1)*(split()? 1 : chosen().length), stacked,
      onPanel:()=>{ inc.table=false; inc.notes=false; changed(); },
      onTable:()=>{ inc.table=!inc.table; if(pairT && !inc.table) inc.notes=false; changed(); },
      onNotes:()=>{ inc.notes=!inc.notes; if(pairT && inc.notes) inc.table=true; changed(); }}));
    const L=q('[data-look]'); L.innerHTML='';
    for(const [v,l] of [['color','Colour'],['print','Print']]){ const b=document.createElement('button'); b.type='button'; b.textContent=l;
      b.setAttribute('aria-pressed',String(look===v)); b.onclick=()=>{ if(look!==v){ look=v; changed(); } }; L.append(b); }
    // the modes on the sheet (on or off, ‹ › to move one), one sheet or a page each, and how many drawings per row
    const A=q('[data-arr]'); A.innerHTML='';
    const mk=(tag,props,...kids)=>{ const e=Object.assign(document.createElement(tag),props); e.append(...kids); return e; };
    const segOf=(items,on,pick)=>{ const S=mk('div',{className:'seg'});
      for(const [v,l] of items){ const b=mk('button',{type:'button',textContent:l}); b.setAttribute('aria-pressed',String(on(v))); b.onclick=()=>pick(v); S.append(b); }
      return S; };
    if(ML.length){ A.append(mk('span',{className:'cap',textContent:'Modes'}));
      xModes.order.forEach((p,i)=>{ const on=xModes.on.has(p), box=mk('span',{className:'xmode'+(on?' on':'')});
        const cb=mk('input',{type:'checkbox',checked:on,title:on?'Leave out':'Add'});
        cb.onchange=()=>{ if(cb.checked) xModes.on.add(p); else if(xModes.on.size>1) xModes.on.delete(p); changed(); };
        const mv=d=>{ const o=xModes.order, j=i+d; if(j<0||j>=o.length) return; [o[i],o[j]]=[o[j],o[i]]; changed(); };
        box.append(mk('label',{},cb,' '+names[p]), mk('button',{type:'button',textContent:'‹',title:'Earlier',disabled:i===0,onclick:()=>mv(-1)}), mk('button',{type:'button',textContent:'›',title:'Later',disabled:i===xModes.order.length-1,onclick:()=>mv(1)}));
        A.append(box); });
      A.append(mk('button',{type:'button',textContent:'All',title:'Every mode',onclick:()=>{ xModes.order.forEach(p=>xModes.on.add(p)); changed(); }}));
      if(chosen().length>1) A.append(segOf([['one','One sheet'],['each','A page per mode']], v=>(opt.split||'one')===v, v=>{ opt.split=v; save(); changed(); }));
    }
    const n=(cfg.parts||1)*(split()? 1 : chosen().length);
    if(n>1) A.append(mk('span',{className:'cap',textContent:'Per row'}),
      segOf([['auto','Auto'],...[1,2,3,4].filter(k=>k<=n).map(k=>[k,String(k)])], v=>String(opt.cols)===String(v), v=>{ opt.cols=v; save(); options(); lay(); }));
    A.hidden=!A.children.length;
  }
  const save=()=>{ try{ localStorage.setItem(OPT_KEY,JSON.stringify(opt)); localStorage.setItem(KEY,String(Math.round(figW))); }catch(e){} };
  const setW=(pg,w)=>{ pg.figEls.forEach((el,i)=>{ el.style.width=w.toFixed(1)+'px'; el.style.height=(w*pg.figs[i].vh/pg.figs[i].vw).toFixed(1)+'px'; }); };
  // the drawings in rows of k (a row is a flex row, so the panel gap can be negative)
  const arrange=(pg,k,tab)=>{ pg.cols=Math.max(1,Math.min(k,pg.wrapEls.length));
    const old=[...pg.figBox.querySelectorAll(':scope > .xfrow')], rows=[];
    for(let i=0;i<pg.wrapEls.length;i+=pg.cols){ const r=document.createElement('div'); r.className='xfrow'; r.append(...pg.wrapEls.slice(i,i+pg.cols)); rows.push(r); }
    old.forEach(r=>r.remove()); pg.figBox.prepend(...rows); pg.body.dataset.table=tab; };
  const fixedCols=()=> opt.cols==='auto'? null : +opt.cols;
  // the sliders' values as CSS variables on every sheet, and the sliders showing what the sheets use
  const sizes=()=>{ const D=XDEFAULTS[opt.paper==='free'?'free':'paper'];
    for(const [k,,,,,v] of XSLIDERS){ for(const el of [...PG.map(g=>g.sheet),page2]) if(el){ if(opt[k]==null) el.style.removeProperty(v); else el.style.setProperty(v,opt[k]+'px'); }
      const r=q(`[data-sl="${k}"]`), val=opt[k]??D[k]; r.value=val; r.nextElementSibling.textContent=val+' px'; } };
  const page=()=>{ const P=PAPER[opt.paper]; return opt.orient==='landscape'? {...P, w:P.h, h:P.w} : P; };
  const fits=(pg,P)=>pg.sheet.scrollHeight<=P.h+0.5 && pg.sheet.scrollWidth<=P.w+0.5 && pg.body.scrollWidth<=pg.body.clientWidth+0.5;
  const sizeText=(pg,w,extra='')=>`Drawing ${Math.round(w)} × ${Math.round(w*pg.figs[0].vh/pg.figs[0].vw)} px${extra}`;
  function lay(){
    dlg.querySelectorAll('[data-stampline]').forEach(e=>{ e.textContent= opt.stamp? exportStamp() : ''; });
    sizes();
    const free=opt.paper==='free', many=PG.length>1? ` · ${PG.length} pages` : '';
    if(page2) page2.hidden=true;
    if(free){
      figW=Math.round(Math.max(240,Math.min(1600,figW)));
      for(const pg of PG){ pg.sheet.classList.remove('paper'); pg.grip.hidden=false; if(pg.notesEl) pg.notesEl.style.display='';
        pg.sheet.style.width=''; pg.sheet.style.height='';
        arrange(pg, fixedCols() ?? (stacked? 1 : !split() && chosen().length>1? perMode : pg.figs.length), 'side');
        setW(pg,figW); balanceNotes(pg.notesEl); }
      q('[data-size]').textContent=sizeText(PG[0],figW,many+' · drag the handle beside it, double-click to reset');
      return;
    }
    const P=page(); let moved=false, cut=false, first=null;
    for(const pg of PG){
      pg.sheet.classList.add('paper'); pg.grip.hidden=true; if(pg.notesEl) pg.notesEl.style.display='';
      pg.sheet.style.width=P.w+'px'; pg.sheet.style.height='auto'; balanceNotes(pg.notesEl);
      const dirs= fixedCols()? [fixedCols()] : pg.figs.map((_,i)=>i+1), tabs= pg.tableHtml? ['side','below'] : ['side'];
      const search=()=>{ let best=null;
        for(const d of dirs) for(const t of tabs){
          arrange(pg,d,t); let lo=60, hi=1600;
          while(hi-lo>1){ const m=(lo+hi)/2; setW(pg,m); if(fits(pg,P)) lo=m; else hi=m; }
          setW(pg,lo); if(fits(pg,P) && (!best || lo>best.w+2)) best={d,t,w:lo};
        }
        return best; };
      // notes too long for the page: they move to a page of their own and the drawings get the whole page
      let best=search();
      if(!best && pg.notesEl){ pg.notesEl.style.display='none'; moved=true; best=search(); }
      if(!best){ best={d:dirs.at(-1), t:tabs.at(-1), w:60}; cut=true; }
      arrange(pg,best.d,best.t); setW(pg,best.w); pg.sheet.style.height=P.h+'px';
      first ||= {pg, best};
    }
    if(moved){ page2.hidden=false; page2.style.width=P.w+'px'; page2.style.height=P.h+'px'; balanceNotes(q('.xnotes2'));
      cut= cut || page2.scrollHeight>P.h+0.5; }
    const {pg, best}=first, n=pg.figs.length;
    const how=[n>1&&(pg.cols===1?'panels stacked':pg.cols>=n?'panels side by side':`${pg.cols} per row`), pg.tableHtml&&(best.t==='side'?'table beside':'table below')].filter(Boolean).join(', ');
    q('[data-size]').textContent=sizeText(pg,best.w,` · ${P.label} ${opt.orient}${how?' · '+how:''}${many}${moved?' · notes on a page of their own':''}${cut?' · does not all fit':''}`);
  }
  const seg=(el,items,key)=>{ el.innerHTML=''; for(const [v,l] of items){ const b=document.createElement('button'); b.type='button'; b.textContent=l;
    b.setAttribute('aria-pressed',String(opt[key]===v)); b.disabled= key==='orient' && opt.paper==='free'; b.onclick=()=>{ opt[key]=v; bars(); lay(); save(); }; el.append(b); } };
  const bars=()=>{ seg(q('[data-paper]'),[['free','Free size'],['a4','A4'],['letter','Letter']],'paper'); seg(q('[data-orient]'),[['portrait','Portrait'],['landscape','Landscape']],'orient'); };
  q('[data-stamp]').checked=opt.stamp; q('[data-stamp]').onchange=e=>{ opt.stamp=e.target.checked; lay(); save(); };
  let raf=0; const relay=()=>{ if(!raf) raf=requestAnimationFrame(()=>{ raf=0; lay(); }); };   // one layout per frame while dragging
  dlg.querySelectorAll('[data-sl]').forEach(r=>{ r.oninput=()=>{ opt[r.dataset.sl]=+r.value; relay(); }; r.onchange=save; });
  q('[data-slreset]').onclick=()=>{ for(const [k] of XSLIDERS) opt[k]=null; lay(); save(); };
  q('[data-close]').onclick=()=>dlg.close();
  dlg.addEventListener('close',()=>dlg.remove());
  const render=async(jpeg)=>{   // one image per page: [{url, w, h}] with w, h in CSS px
    PG.forEach(g=>g.grip.hidden=true);
    try{
      await Promise.all([...dlg.querySelectorAll('.xsheet img')].map(i=>i.decode().catch(()=>{})));
      await document.fonts.ready;
      const paper=opt.paper!=='free', P=paper? page() : null, out=[];
      for(const el of [...PG.map(g=>g.sheet), ...(page2&&!page2.hidden? [page2] : [])]){
        const w=paper? P.w : el.scrollWidth, h=paper? P.h : el.scrollHeight;
        // margin reset: the sheet is centred in the dialog, and that computed margin would shift the image
        const o={pixelRatio:paper?3:2, width:w, height:h, backgroundColor:ink.bg, style:{margin:'0',boxShadow:'none'}};
        out.push({url: await (jpeg? window.htmlToImage.toJpeg(el,{...o, quality:0.95}) : window.htmlToImage.toPng(el,o)), w, h});
      }
      return out;
    } finally { PG.forEach(g=>g.grip.hidden=opt.paper!=='free'); }
  };
  const busy=t=>{ q('[data-busy]').textContent=t; };
  const baseName=()=>fileBase+(opt.paper!=='free'?`-${opt.paper}-${opt.orient}`:'');
  q('[data-png]').onclick=async()=>{
    busy('Rendering…');
    try{ const pages=await render(), base=baseName();
      pages.forEach((p,i)=>download(base+(pages.length>1?`-page${i+1}`:'')+'.png', p.url)); busy(''); }
    catch(err){ console.error(err); busy('PNG export failed: '+err.message); }
  };
  // PDF: the same page images, one per PDF page, at the paper size (free size: the sheet's size at 96 dpi)
  q('[data-pdf]').onclick=async()=>{
    busy('Rendering…');
    try{
      const pages=await render(true), paper=opt.paper!=='free', pt= paper&&PAPER[opt.paper].pt;
      const out=await Promise.all(pages.map(async p=>{ const img=new Image(); img.src=p.url; await img.decode();
        const bin=atob(p.url.slice(p.url.indexOf(',')+1));
        return {jpeg:Uint8Array.from(bin,c=>c.charCodeAt(0)), px:[img.naturalWidth,img.naturalHeight],
          pt: paper? (opt.orient==='landscape'? [pt[1],pt[0]] : pt) : [p.w*0.75, p.h*0.75]}; }));
      download(baseName()+'.pdf', URL.createObjectURL(pdfBlob(out))); busy('');
    }catch(err){ console.error(err); busy('PDF export failed: '+err.message); }
  };
  // Print: the page is rendered as one image and printed on its own, so the browser can't split or scale it oddly
  q('[data-print]').onclick=async()=>{
    const win=open('','_blank'); if(!win){ busy('The browser blocked the print window. Allow pop-ups, or download the PNG.'); return; }
    win.document.write('<!doctype html><title>Preparing…</title><p style="font:14px sans-serif">Preparing the page…</p>');
    busy('Rendering…');
    try{
      const pages=await render(), paper=opt.paper!=='free', P=paper? page() : null;
      win.document.open();
      win.document.write(`<!doctype html><html><head><title>${esc(fileBase)}</title><style>@page{size:${paper?`${P.css} ${opt.orient}`:'auto'};margin:${paper?'0':'10mm'}}html,body{margin:0}img{display:block;break-after:page;${paper?'width:100vw;height:100vh;object-fit:contain':'width:100%;height:auto'}}img:last-child{break-after:auto}</style></head><body>${pages.map(p=>`<img src="${p.url}" alt="">`).join('')}</body></html>`);
      win.document.close();
      Promise.all([...win.document.images].map(i=>i.complete? 0 : new Promise(r=>i.onload=r))).then(()=>{ win.focus(); win.print(); });
      busy('');
    }catch(err){ console.error(err); busy('Print failed: '+err.message); win.close(); }
  };
  document.body.append(dlg); dlg.showModal(); options(); fill(); bars(); lay();
}

/* Just the drawings (main, and secondary beside it) as one PNG data URL, e.g. for a README.
   Drawn off screen the way the export sheet draws them, so labels keep their web font. */
async function panelPNG({th, layout, parts}){
  if(!window.htmlToImage) throw new Error('html-to-image did not load');
  const ink=pageInk(th), W= layout==='desktop'? 640 : 440, keepBW=bw;
  const figs=parts.map(p=>{ const r=buildFor(layout)(true,th,p), [,, vw, vh]=r.vb.split(' ').map(Number); return {r, vw, vh, img:svgDataURL(artImageSVG(r))}; });
  bw=keepBW;
  const box=document.createElement('div');
  box.style.cssText=`position:fixed;left:-20000px;top:0;display:flex;gap:28px;padding:28px;background:${ink.bg}`;
  for(let i=1;i<=MOD_MAX;i++) box.style.setProperty('--m'+i, palOf('phone',th)['m'+i]);
  box.innerHTML=figs.map(f=>`<div style="position:relative;flex:none;width:${W}px;height:${(W*f.vh/f.vw).toFixed(1)}px"><img src="${f.img}" alt="" style="position:absolute;inset:0;width:100%;height:100%;display:block"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.r.vb}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${f.r.over}</svg></div>`).join('');
  document.body.append(box);
  try{
    await Promise.all([...box.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})));
    await document.fonts.ready;
    return await window.htmlToImage.toPng(box,{pixelRatio:2, backgroundColor:ink.bg, style:{position:'static', left:'0'}});
  } finally { box.remove(); }
}

/* Standalone manual page: phone layout on small screens, desktop layout on wide screens,
   main / secondary toggle, light / dark toggle, prints in light with a B&W secondary view */
function manualHTML({font, fontUrl, withTable}){
  const d=cleanData(), fw=d.firmware, sec=hasSecondary(), parts= sec? ['main','second'] : ['main'];
  const screenTh= V.theme==='print'? 'panel' : V.theme, themes=[screenTh,'print'];
  // with modes: the drawings and the table once per mode (md-0 is the print set), a button each; printing gives a page per mode
  const ml=modeList(), modes=[{pos:'',name:'All modes'}, ...ml], cur=Math.max(0, modes.findIndex(m=>m.pos===(curMode()?.pos||'')));
  const cap=m=> ml.length? `<figcaption class="mname">${esc(m.name)}${m.pos? ` · ${esc(slotName(doc.modes.switch))} ${esc(m.pos)}` : ''}</figcaption>` : '';
  const figs=[]; const keepBW=bw; bw=false;
  modes.forEach((m,i)=>withMode(m.pos,()=>{
    for(const th of themes) for(const pt of parts){
      const cls=`${th==='print'?'t-light':'t-dark'} v-${pt} md-${i}`;
      figs.push(`<figure class="phone ${cls}">${cap(m)}${svgOf(buildPhone(true,th,pt))}</figure>`);
      figs.push(`<figure class="desktop ${cls}">${cap(m)}${svgOf(buildDesktop(true,th,pt))}</figure>`);
    }
  }));
  if(sec){ bw=true;   // black-and-white print version of the secondary view
    figs.push(`<figure class="desktop t-light v-second bw md-0">${svgOf(withMode('',()=>buildDesktop(true,'print','second')))}</figure>`);
  }
  bw=keepBW;
  const tables= withTable? modes.map((m,i)=>`<section class="md-${i}">${withMode(m.pos,()=>tableHTML(false))}</section>`).join('\n') : '';
  const modeCss= ml.length? modes.map((m,i)=>`html:not(.md-${i}) .md-${i}`).join(',')+'{display:none!important}' : '';
  const dk=pageInk(screenTh), lt=pageInk('print'), fHrefs=[...new Set([labelFontHref(font,fontUrl), ...usedFonts().map(f=>labelFontHref(f.family,f.url))].filter(Boolean))];
  const modVars=[1,2,3,4].map(i=>`--m${i}:${palOf('phone',screenTh)['m'+i]}`).join(';');
  const html=`<!DOCTYPE html>
<html lang="en" class="${V.theme==='print'?'light':''} md-${cur}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Simple Touch Manual Designer (build ${BUILD}), after Fabio Bartali's Manual Designer">
<title>${esc(fw.name||'Simple Touch')} manual</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap">
${fHrefs.map(h=>`<link rel="stylesheet" href="${escAttr(h)}">`).join('\n')}
<style>
*{box-sizing:border-box}
html{--bg:${dk.bg};--fg:${dk.fg};--muted:${dk.muted};--rule:${dk.rule};--hair:${dk.hair};${modVars}}
html.light{--bg:${lt.bg};--fg:${lt.fg};--muted:${lt.muted};--rule:${lt.rule};--hair:${lt.hair}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 Archivo,system-ui,sans-serif}
main{max-width:1500px;margin:0 auto;padding:24px 16px 48px}
header{max-width:760px;margin:0 auto 12px}
h1{font:800 36px/1.05 Archivo,sans-serif;margin:0 0 6px}
.by{color:var(--muted);font-size:14px;margin:0 0 8px}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:760px;margin:0 auto 8px}
.tools .sp{flex:1}
button{font:600 13px Archivo,sans-serif;padding:6px 12px;border:2px solid var(--fg);background:transparent;color:var(--fg);cursor:pointer;border-radius:0}
.seg{display:flex}.seg button+button{margin-left:-2px}
button[aria-pressed=true]{background:var(--fg);color:var(--bg)}
figure{margin:0 auto;padding:8px 0 24px}
figure > svg{display:block;width:100%;height:auto;max-height:calc(100vh - 40px)}
.phone{max-width:560px}.desktop{display:none;max-width:1500px}
html:not(.light) .t-light, html.light .t-dark, html:not(.sec) .v-second, html.sec .v-main, figure.bw{display:none!important}
${modeCss}
.mname{display:block;font:700 14px Archivo,sans-serif;color:var(--muted);margin:0 0 6px}
@media (min-width:880px){.phone{display:none}.desktop{display:block}}
section{max-width:760px;margin:0 auto 32px}
${DOC_CSS}
footer{max-width:760px;margin:0 auto;font-size:12px;color:var(--muted);border-top:1px solid var(--hair);padding-top:12px}
footer a{color:inherit}
@media print{
  html,html.light{--bg:#fff;--fg:#1c1c1b;--muted:#5b5856;--rule:#1c1c1b;--hair:rgba(28,28,27,.2)}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .tools{display:none}
  figure{display:none!important;padding:0}
  figure.desktop.t-light.v-main,figure.desktop.t-light.bw{display:block!important;break-after:page}
  figure > svg{max-height:250mm}
}
</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${panelDefs()}</defs></svg>
<main>
<header><h1>${esc(fw.name||'Simple Touch')}</h1>${fw.author||fw.version?`<p class="by">${esc([fw.author,fw.version&&'v'+fw.version].filter(Boolean).join(' · '))}</p>`:''}${fw.description?`<p>${esc(fw.description)}</p>`:''}${REPO_RE.test(normRepo(fw.repo))?`<p><a href="${escAttr(normRepo(fw.repo))}">${esc(repoShort(normRepo(fw.repo)))}</a></p>`:''}</header>
<div class="tools">${ml.length?`<div class="seg" role="group" aria-label="Mode">${modes.map((m,i)=>`<button type="button" data-mode="${i}" aria-pressed="${i===cur}">${esc(m.name)}</button>`).join('')}</div>`:''}${sec?'<div class="seg" role="group" aria-label="Functions"><button type="button" data-part="main" aria-pressed="true">Main functions</button><button type="button" data-part="second" aria-pressed="false">Secondary functions</button></div>':''}<span class="sp"></span><button type="button" id="themeBtn"></button><button type="button" onclick="print()">Print</button></div>
${figs.join('\n')}
${tables}
${(fw.notes||'').trim()?`<section class="md">${md2html(fw.notes)}</section>`:''}
<footer>Simple Touch panel drawing © Roey Tsemah (<a href="https://synthux.academy">Synthux Academy</a>), adapted via Fabio Bartali's <a href="https://bartali.nl/touch-fx-manual.html">Touch FX manual</a>. Made with the <a href="https://jonwaterschoot.github.io/simple-touch-labels/editor.html">Simple Touch manual designer</a>.<br>${esc(exportStamp())}</footer>
</main>
<script>
(function(){
  var h=document.documentElement, b=document.getElementById('themeBtn');
  function set(light){ h.classList.toggle('light',light); b.textContent=light?'Screen version':'Print version'; }
  var q=new URLSearchParams(location.search).get('theme'); set(q? q==='light' : h.classList.contains('light'));
  b.onclick=function(){ set(!h.classList.contains('light')); };
  var parts=document.querySelectorAll('[data-part]');
  parts.forEach(function(x){ x.onclick=function(){ var p=x.getAttribute('data-part'); h.classList.toggle('sec',p==='second');
    parts.forEach(function(y){ y.setAttribute('aria-pressed',String(y===x)); }); }; });
  var modes=document.querySelectorAll('[data-mode]');
  modes.forEach(function(x){ x.onclick=function(){ modes.forEach(function(y){ h.classList.remove('md-'+y.getAttribute('data-mode')); y.setAttribute('aria-pressed',String(y===x)); });
    h.classList.add('md-'+x.getAttribute('data-mode')); }; });
})();
<\/script>
<script type="application/json" id="manual-data">${JSON.stringify({...d,faceplate:undefined,fpDesktop:d.fpDesktop&&{...d.fpDesktop,faceplate:undefined}}).replace(/</g,'\\u003c')}<\/script>
</body></html>`;
  return html;
}

/* A short text behind an i button, in a dialog of its own. html is trusted: escape what comes from a repository. */
function openInfo(title, html){
  const d=document.createElement('dialog');
  d.innerHTML=`<form method="dialog" class="modal"><div class="mhead"><span>${esc(title)}</span><button class="tight">Close</button></div><div class="infobody">${html}</div></form>`;
  d.onclose=()=>d.remove();
  document.body.append(d); d.showModal();
}
