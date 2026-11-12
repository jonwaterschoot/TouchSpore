/* ============================================================
   PLAY: the firmware itself, in the browser, on the panel drawing.
   A firmware's label file can carry an approved browser build (doc.emulator,
   see emulatorOf in core.js), made with simple-touch-web. With embed 'allowed'
   the library plays it here: the knobs, faders, levers and pads of the drawing
   drive the firmware, its LED and OLED show on the panel, and a loop or the
   mic goes into its audio input. Otherwise only the author's page is linked.

   Needs core.js (SLOT, SLOTS, SIMPLE_PADS, esc, escAttr) and the runtime in
   vendor/simple-touch-web/ (ES modules, loaded on the first Play).
   The page calls Play.strip() and Play.attach(fig) on every render, and
   Play.reset() when another firmware is picked.
   ============================================================ */
const PLAY_RUNTIME = 'vendor/simple-touch-web/';
const PLAY_LOOPS = 'https://jonwaterschoot.github.io/simple-touch-web/demo/loops/';
/* Keyboard: pads by physical key (KeyboardEvent.code), so they sit in the same place on any layout.
   The layout only changes the key names shown. */
const PLAY_CODES = {10:'Digit3', 11:'Digit4', 0:'KeyW', 1:'KeyE', 2:'KeyR', 3:'KeyA', 4:'KeyS', 5:'KeyD', 6:'KeyF', 7:'KeyG', 8:'KeyX', 9:'KeyV'};
const PLAY_LAYOUTS = {
  qwerty: {label:'QWERTY', names:{}},
  azerty: {label:'AZERTY', names:{Digit3:'"', Digit4:"'", KeyW:'Z', KeyA:'Q'}},
};
const PLAY_KEY_ROWS = [[10,11],[0,1,2],[3,4,5,6,7],[8,9]];
const PLAY_KEYS_PREF = 'stManualLib.playKeys', PLAY_LOCK_PREF = 'stManualLib.playLock';
/* the levers on the drawing: centre, angle, and the contact at each end of their long side */
const PLAY_LEVERS = {
  S09_S10: {w:98, h:37, rot:-4, ends:['left','right']},
  S07_S08: {w:40, h:94, rot:25, ends:['up','down']},
};
const FADER_RUN = [861, 618];   // fader cap centre at 0 and at 1 (panel units)

const STAGE_LABELS = {all:'All labels', nopads:'No pad labels', faceplate:'Faceplate', clean:'No labels'};   // the Labels button's views, in order (page toolbar and full screen)

const Play = (()=>{
  const S = {
    state:'idle',   // idle | loading | running
    run:0,          // bumps on every start and stop, so a slow load can tell it was overtaken
    st:null, ctx:null, out:null, inGain:null,
    controls:{}, levers:{}, pads:{}, latched:new Set(),
    led:false, oled:null, oledUrl:'', boot:null, stopBoot:null,
    msg:'', err:false, loaded:0,
    input:'off', inputs:null, inputNode:null, inputStream:null, buffers:new Map(),
    volume:0.8, inLevel:1, oledOn:true, peak:0,
    mod:null, svg:null, keys:false,
    layout:'qwerty', layoutSet:false,
    panel:null,     // settings and presets from the label file's device block (device-panel.js)
    glow:{},        // pads that just played on the board, fading (0..1)
    source:'browser', link:null, follows:false,   // browser | device: the firmware in this page or a real board, never both, so MIDI cannot loop. follows: the drawing shows the board
    midi:null, midiIn:'', midiOut:'', runOut:0, last:{}, sysex:{}, mval:{}, midiPads:{}, ccOut:{},   // Web MIDI: access, chosen ports ('*' = all inputs); last message and SysEx per table row; last value per control; the firmware's last value per CC
    hot:new Set(), cool:{},   // table rows of the controls in use
    mode:null, held:[],       // the toggle modifier tapped last, the hold modifiers held: the labels follow them
    lock:matchMedia('(pointer: coarse)').matches, stage:false, sound:false, labels:'all',   // touch: scroll lock; full screen and its sound sheet; label view (STAGE_LABELS), in and out of full screen
  };
  try{ const k=localStorage.getItem(PLAY_KEYS_PREF); if(PLAY_LAYOUTS[k]){ S.layout=k; S.layoutSet=true; } }catch(e){}
  try{ const l=localStorage.getItem(PLAY_LOCK_PREF); if(l) S.lock= l==='1'; }catch(e){}
  const keyName=i=>{ const c=PLAY_CODES[i]; return PLAY_LAYOUTS[S.layout].names[c] || c.replace(/^(Key|Digit)/,''); };
  const reset0 = ()=>{
    for(const s of SLOTS) if(s.kind==='knob'||s.kind==='fader') S.controls[s.id]=0.5;
    S.levers={S09_S10:'centre', S07_S08:'centre'}; S.pads={};
  };
  reset0();
  const em = ()=> doc.emulator;
  const playable = ()=> !!(em() && em().embed==='allowed');
  const linkable = ()=> !!(doc.device && navigator.requestMIDIAccess);   // no Web MIDI in Safari
  const $p = id => document.getElementById(id);
  const showing = ()=> S.state!=='idle' || (S.source==='device' && S.follows);   // the drawing is live

  /* ---------------------------------------------------------- the strip above the drawing */
  function strip(){
    const box=$p('play'); if(!box) return;
    const e=em();
    box.hidden=!e && !linkable();
    if(!e && !linkable()){ dropDevice(); box.innerHTML=''; return; }
    const fw=doc.firmware, name=fw.name||'this firmware';
    if(!playable() && !linkable()){
      dropDevice();
      box.innerHTML=`<p><b>Play</b> ${esc(fw.author||'The author')} plays ${esc(name)} in the browser on their own page. <a href="${escAttr(e.url)}" target="_blank" rel="noopener">Open it ↗</a></p>`;
      return;
    }
    if(!box.querySelector('.pctl')) build(box);
    syncDevice();
    box.classList.toggle('src-device', S.source==='device');
    $p('playSrcRow').hidden=!(playable() && linkable());
    seg($p('playSrc'), [['browser','Play in browser'],['device','Connect to Simple Touch']], k=>S.source===k, setSource);
    if(!playable()){ fillMidi(); body(); return; }
    const on=S.state!=='idle';
    const go=$p('playGo');
    go.textContent= on? '■ Stop' : '▶ Play';
    go.className= on? '' : 'primary';
    go.setAttribute('aria-pressed',String(on));
    $p('playOled').closest('label').hidden=!e.oled;
    $p('playOled').checked=S.oledOn;
    $p('playMsg').textContent=S.msg; $p('playMsg').classList.toggle('err',S.err);
    seg($p('playKeys'), Object.entries(PLAY_LAYOUTS).map(([k,l])=>[k,l.label]), k=>S.layout===k, k=>{
      S.layout=k; S.layoutSet=true; try{ localStorage.setItem(PLAY_KEYS_PREF,k); }catch(err){} refresh(); });
    fillMidi(); body();
  }
  /* the text behind the i beside Play, written when opened so the key names follow the layout picked */
  function playHelp(){
    const e=em(), fw=doc.firmware, keys=PLAY_KEY_ROWS.map(r=>r.map(keyName).join(' ')).join(' · ');
    return `<ul>
      <li><b>Knobs and faders:</b> drag a knob up or down, click or drag a fader.</li>
      <li><b>Levers:</b> click or slide.</li>
      <li><b>Pads:</b> press higher up to press harder, and drag up or down while holding. Right-click keeps a pad held for a combo, right-click again lets go.</li>
      <li><b>Keys:</b> ${esc(keys)}</li>
      ${mods().length? '<li><b>Modifiers:</b> the labels show what a modifier does, while it is held or after a tap for a mode.</li>' : ''}
      ${navigator.standalone===false? '<li><b>iPhone:</b> Share › Add to Home Screen opens it full screen, without the browser\'s bars.</li>' : ''}
    </ul>
    <p class="hint">Browser build <code>${esc(e.sha256.slice(0,12))}</code>, approved by ${esc(fw.author||'its author')}. It runs in this page: the sound is the firmware's own.</p>`;
  }
  function build(box){
    box.innerHTML=`<div class="pctl" id="playSrcRow" hidden>
      <span class="cap">Mode</span><span class="seg" id="playSrc"></span>
    </div><div class="pgrid">
      <div class="pgroup pgo b-only">
        <div class="prow"><button type="button" id="playGo" class="primary">▶ Play</button><button type="button" id="playInfo" class="info" title="How to play" aria-label="How to play">i</button></div>
        <span class="status" id="playMsg" role="status"></span>
      </div>
      <div class="pgroup b-only"><span class="cap">Sound</span>
        <label><span>Input</span><select id="playIn" aria-label="Audio input"></select></label>
        <input type="file" id="playFile" accept="audio/*" hidden>
        <label><span>In level</span><input type="range" id="playInLevel" min="0" max="1.5" step="0.01"></label>
        <label><span>Volume</span><input type="range" id="playVol" min="0" max="1" step="0.01"><span class="pmeter" title="Output level"><i id="playMeter"></i></span></label>
      </div>
      <div class="pgroup b-only"><span class="cap">MIDI and keys</span>
        <label class="midi"><span>MIDI in</span><select id="playMidiIn" aria-label="MIDI input"></select></label>
        <label class="midi"><span>MIDI out</span><select id="playMidiOut" aria-label="MIDI output"></select></label>
        <div class="keys"><span>Keys</span><span class="seg" id="playKeys"></span></div>
      </div>
      <div class="pgroup"><span class="cap">View</span>
        <div class="prow"><button type="button" id="playLock" class="tight" title="Touches on the drawing never scroll the page">Lock scroll</button><button type="button" id="playStage" class="tight" title="The drawing alone, filling the screen">⛶ Full screen</button></div>
        <label class="chk b-only"><input type="checkbox" id="playOled"> OLED</label>
      </div>
    </div><div class="device d-only" id="playLink"></div><div class="device" id="playDevice" hidden></div>`;
    $p('playLock').onclick=()=>{ S.lock=!S.lock; try{ localStorage.setItem(PLAY_LOCK_PREF, S.lock?'1':'0'); }catch(err){} body(); };
    $p('playStage').onclick=()=>stage(!S.stage);
    $p('playGo').onclick=()=> S.state==='idle'? start() : stop();
    $p('playInfo').onclick=()=>openInfo('How to play', playHelp());
    $p('playVol').value=S.volume; $p('playVol').oninput=e=>{ S.volume=+e.target.value; if(S.out) S.out.gain.value=S.volume; };
    $p('playInLevel').value=S.inLevel; $p('playInLevel').oninput=e=>{ S.inLevel=+e.target.value; if(S.inGain) S.inGain.gain.value=S.inLevel; };
    $p('playOled').onchange=e=>{ S.oledOn=e.target.checked; if(S.state!=='idle'){ stop(); start(); } else refresh(); };
    $p('playIn').onchange=e=>{ const v=e.target.value; if(v==='file') $p('playFile').click(); else selectInput(v); };
    $p('playFile').onchange=e=>{ const f=e.target.files[0]; if(f){ S.file=f; selectInput('file'); } else $p('playIn').value=S.input; };
    $p('playMidiIn').onchange=e=>pickMidi('in', e.target.value);
    $p('playMidiOut').onchange=e=>pickMidi('out', e.target.value);
    box.querySelectorAll('label.midi').forEach(l=>l.hidden=!navigator.requestMIDIAccess);   // no Web MIDI (Safari)
    fillInputs();
    // the keyboard's own layout, where the browser tells (Chrome), until one is picked
    if(!S.layoutSet) navigator.keyboard?.getLayoutMap?.().then(m=>{ if(!S.layoutSet && (m.get('KeyQ')==='a' || m.get('KeyW')==='z')){ S.layout='azerty'; refresh(); } }).catch(()=>{});
  }
  /* ---------------------------------------------------------- the page around the drawing: no tap highlight or selection while
     playing, the scroll lock, and full screen (the real one where there is one, else the drawing over the page, as on iPhone) */
  function body(){
    const b=document.body, on=showing();
    b.classList.toggle('playing', on);
    b.classList.toggle('play-lock', on && S.lock);
    b.classList.toggle('play-stage', S.stage);
    b.classList.toggle('stage-sound', S.stage && S.sound);
    labelClasses();
    $p('playLock')?.setAttribute('aria-pressed', String(S.lock));
    $p('playStage')?.setAttribute('aria-pressed', String(S.stage));
    const bar=$p('stageBar'); if(!bar) return;
    bar.querySelector('[data-a="go"]').textContent= on? '■ Stop' : '▶ Play';
    bar.querySelector('[data-a="go"]').hidden= S.source==='device';   // a board plays by itself
    bar.querySelector('[data-a="sound"]').textContent= S.source==='device'? 'Settings' : 'Sound';
    bar.querySelector('[data-a="sound"]').setAttribute('aria-pressed', String(S.sound));
    bar.querySelector('[data-a="labels"]').textContent=STAGE_LABELS[labelView()];
  }
  function labelClasses(){
    const view=labelView();
    for(const k of ['nopads','faceplate','clean']) document.body.classList.toggle('lbl-'+k, view===k);
    const btn=$p('lblBtn'); if(btn) btn.textContent=STAGE_LABELS[view];
    figBar(view);
  }
  /* while the drawing is live, Labels and Full screen sit under it (as in full screen) and leave the toolbar and the Play box.
     The page writes #fig anew on every draw, so the bar is added back each time. */
  function figBar(view){
    const fig=$p('fig'), on=showing() && !S.stage;
    document.body.classList.toggle('fig-tools', on);
    let bar=fig?.querySelector(':scope > .figbar');
    if(!on){ bar?.remove(); return; }
    if(!fig) return;
    if(!bar){
      bar=document.createElement('div'); bar.className='figbar';
      bar.innerHTML=`<button type="button" data-a="labels" class="tight lbl" title="Switches which labels show on the drawing"></button><button type="button" data-a="stage" class="tight" title="The drawing alone, filling the screen">⛶ Full screen</button>`;
      bar.onclick=e=>{ const a=e.target.closest('button')?.dataset.a; if(a==='labels') nextLabels(); else if(a==='stage') stage(true); };
      fig.append(bar);
    }
    bar.querySelector('[data-a="labels"]').textContent=STAGE_LABELS[view];
  }
  /* Faceplate is offered when the file has faceplate labels, also on a layout that has them off */
  const labelViews=()=>Object.keys(STAGE_LABELS).filter(k=>k!=='faceplate' || (doc.fpLabels?.on && SLOTS.some(s=>fplText(s.id))));
  const labelView=()=>labelViews().includes(S.labels)? S.labels : 'all';
  function nextLabels(){
    const v=labelViews(); S.labels=v[(v.indexOf(labelView())+1)%v.length];
    const force=S.labels==='faceplate';
    if(force!==fplForce){ fplForce=force; if(S.svg) relabel(true); else refresh(); }   // while playing only the labels are drawn again, so held controls stay held
    body(); labelClasses();
  }
  function stage(on){
    S.stage=on; S.sound=false;
    let bar=$p('stageBar');
    if(on && !bar){
      bar=document.createElement('div'); bar.className='stagebar'; bar.id='stageBar';
      bar.innerHTML=`<button type="button" data-a="go"></button><button type="button" data-a="sound">Sound</button><button type="button" data-a="labels" title="Switches which labels show on the drawing"></button><button type="button" data-a="exit">Exit</button>`;
      bar.onclick=e=>{ const a=e.target.closest('button')?.dataset.a;
        if(a==='go') S.state==='idle'? start() : stop();
        else if(a==='sound'){ S.sound=!S.sound; body(); }
        else if(a==='labels') nextLabels();
        else if(a==='exit') stage(false); };
      document.body.append(bar);
    }
    if(!on) bar?.remove();
    const fs=document.fullscreenElement;
    if(on && !fs) document.documentElement.requestFullscreen?.().catch(()=>{});
    if(!on && fs) document.exitFullscreen?.().catch(()=>{});
    refresh();   // full screen shows one drawing
  }
  document.addEventListener('fullscreenchange',()=>{ if(!document.fullscreenElement && S.stage) stage(false); });   // Esc or back left it
  addEventListener('keydown',e=>{ if(e.key==='Escape' && S.stage && !document.fullscreenElement) stage(false); });
  async function loops(){
    if(S.inputs) return S.inputs;
    const local=/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    for(const base of [...(local? [new URL('../simple-touch-web/demo/loops/', location.href).href] : []), PLAY_LOOPS]){
      try{
        const r=await fetch(base+'loops.json'); if(!r.ok) continue;
        const list=await r.json();
        return S.inputs=list.filter(l=>l && typeof l.name==='string' && /^[\w.-]+$/.test(l.file||'')).map(l=>({id:'loop:'+l.file, name:l.name, url:base+l.file}));
      }catch(e){}
    }
    return S.inputs=[];
  }
  async function fillInputs(){
    const list=await loops(), sel=$p('playIn'); if(!sel) return;
    sel.replaceChildren(new Option('Off','off'), new Option('Mic','mic'), ...list.map(l=>new Option(l.name+' loop',l.id)), new Option('File…','file'));
    if(S.input==='file' && S.file) sel.insertBefore(new Option(S.file.name,'file:cur'), sel.lastChild);
    sel.value= S.input==='file'? 'file:cur' : S.input;
  }

  /* ---------------------------------------------------------- start and stop */
  function say(msg, err=false){ S.msg=msg; S.err=err; const m=$p('playMsg'); if(m){ m.textContent=msg; m.classList.toggle('err',err); } }
  async function start(){
    const e=em(); if(!e || e.embed!=='allowed' || S.state!=='idle' || S.source!=='browser') return;
    const run=++S.run;
    // made and resumed inside the click, so the browser lets it play
    const ctx=new AudioContext({sampleRate:48000, latencyHint:'interactive'});
    ctx.resume();
    S.ctx=ctx; S.state='loading'; say('Loading…'); refresh();
    try{
      const [{SimpleTouch}, oled]=await Promise.all([import('./'+PLAY_RUNTIME+'simple-touch.js'), import('./'+PLAY_RUNTIME+'oled.js')]);
      S.oledLib=oled;
      const st=await SimpleTouch.load(ctx, e.wasm, {sha256:e.sha256, oled:!!(e.oled && S.oledOn), controls:S.controls, switches:S.levers,
        onProgress:n=>{ if(run===S.run) say(`Loading… ${(n/1024).toFixed(0)} KB`); }});
      if(run!==S.run){ st.disconnect(); return; }
      S.st=st;
      // firmware → volume → limiter: a feedback patch can get loud
      S.out=new GainNode(ctx,{gain:S.volume});
      const limiter=new DynamicsCompressorNode(ctx,{threshold:-3, knee:0, ratio:20, attack:0.001, release:0.1});
      st.node.connect(S.out).connect(limiter).connect(ctx.destination);
      S.inGain=new GainNode(ctx,{gain:S.inLevel}); S.inGain.connect(st.node);
      st.on('led', m=>{ if(!S.stopBoot) setLed(m.on); });
      st.on('oled', m=>{ S.live=m; if(!S.stopBoot) showOled(m.ram, m.info); });
      st.on('meter', m=>{ S.peak=m.peak; const b=$p('playMeter'); if(b) b.style.width=Math.min(100,m.peak*100)+'%'; });
      st.on('error', m=>{ if(run===S.run){ stop(); say(m.message||'The firmware stopped.', true); } });
      st.on('midi', m=>midiFromFirmware(m.bytes));
      const ready=await st.ready;
      if(run!==S.run) return;
      S.state='running';
      say(`Playing · ${ready.sampleRate/1000} kHz, block ${ready.blockSize}`);
      S.stopBoot=oled.playBoot(ready.boot, f=>{ showOled(f.ram, f.info); setLed(!!f.led); },
        ()=>{ S.stopBoot=null; if(S.live) showOled(S.live.ram, S.live.info); });
      if(S.input!=='off') selectInput(S.input);
      S.panel?.ask();
      keys(true);
      if(doc.modes) V.mode=leverMode();
      refresh();
    }catch(err){
      if(run!==S.run) return;
      stop(); say(err.message||String(err), true);
    }
  }
  function stop(){
    S.run++;
    S.stopBoot?.(); S.stopBoot=null;
    stopInput();
    try{ S.st?.disconnect(); }catch(e){}
    S.ctx?.close().catch(()=>{});
    S.st=S.ctx=S.out=S.inGain=S.live=null;
    S.state='idle'; S.led=false; S.oled=null; S.oledUrl=''; S.oledShown=0; S.pads={}; S.latched.clear(); S.last={}; S.sysex={}; S.mval={}; S.midiPads={}; S.ccOut={}; S.runOut=0;
    S.mode=null; S.held=[]; soloMod=null;
    if(doc.modes) V.mode='';
    keys(false);
    say('');
    refresh();
  }
  /* another firmware: stop, and the controls back to the middle */
  function reset(){ if(S.state!=='idle') stop(); reset0(); S.msg=''; S.err=false; }
  /* what the page shows depends on the state: the button, and a single drawing while playing */
  function refresh(){ if(typeof update==='function') update(); }

  /* ---------------------------------------------------------- MIDI: Web MIDI ports to and from the firmware's USB MIDI */
  function fillMidi(){
    const fill=(sel, list, cur, all)=>{ if(!sel) return;
      const opts=[new Option('Off','')];
      if(!S.midi) opts.push(new Option('Connect…','connect'));
      else { if(all) opts.push(new Option('All inputs','*')); for(const p of list) opts.push(new Option(p.name||p.id, p.id)); }
      sel.replaceChildren(...opts); sel.value= [...sel.options].some(o=>o.value===cur)? cur : ''; };
    fill($p('playMidiIn'), S.midi? [...S.midi.inputs.values()] : [], S.midiIn, true);
    fill($p('playMidiOut'), S.midi? [...S.midi.outputs.values()] : [], S.midiOut, false);
  }
  async function pickMidi(dir, v){
    if(v==='connect'){
      try{
        S.midi=await navigator.requestMIDIAccess();
        S.midi.onstatechange=()=>{ fillMidi(); bindMidi(); };
        v= dir==='in'? '*' : ([...S.midi.outputs.keys()][0]||'');
      }catch(err){ v=''; say('MIDI: '+(err.message||'not allowed'), true); }
    }
    linkMod??=await import('./'+PLAY_RUNTIME+'device-link.js').catch(()=>null);
    // one device as both MIDI in and MIDI out would loop through the browser build; 'All inputs' just leaves it out (bindMidi)
    const other=S.midi && (dir==='in'? S.midi.outputs.get(S.midiOut) : S.midi.inputs.get(S.midiIn));
    const port=S.midi && (dir==='in'? S.midi.inputs.get(v) : S.midi.outputs.get(v));
    if(linkMod?.sameDevice(port, other)){ say(`${port.name} is already the MIDI ${dir==='in'?'out':'in'}. To control the board, choose Connect to Simple Touch.`, true); v=''; }
    if(dir==='in') S.midiIn=v; else S.midiOut=v;
    fillMidi(); bindMidi();
  }
  /* ---------------------------------------------------------- settings and presets: the source gets them, the browser build or the board */
  let deviceFor='null', deviceMod=null, linkMod=null;
  function deviceSend(bytes){
    if(S.source==='device') return !!S.link?.send(bytes);
    if(!S.st) return false;
    S.st.sendMidi(bytes);
    return true;
  }
  /* the strip is about to lose its controls */
  function dropDevice(){ deviceFor='null'; S.panel?.reset(); S.panel=null; S.link?.close(); S.link=null; S.source='browser'; }
  function setSource(next){
    if(next===S.source) return;
    S.source=next;
    S.panel?.reset();
    clearLive();
    if(next==='device'){ if(S.state!=='idle') stop(); say(''); S.link?.connect(); keys(S.follows); }
    else { S.link?.close(); keys(false); }
    bindMidi();
    refresh();
  }
  /* what the drawing showed of the board */
  function clearLive(){
    for(const i in S.midiPads){ delete S.midiPads[i]; drawPad(i); hot(padId(+i),false); }
    S.pads={}; S.glow={}; S.latched.clear(); S.held=[]; S.mode=null; soloMod=null; S.oled=null; S.oledUrl=''; S.oledShown=0;
  }
  const LIVE_HANDLERS={
    pads(mask){ for(let i=0;i<12;i++){ const on=!!(mask&(1<<i)), was=S.midiPads[i]!==undefined; if(on===was) continue;
      if(on) S.midiPads[i]=0.7; else delete S.midiPads[i];
      drawPad(i); hot(padId(i),on); modPad(padId(i),on); } },
    levers(pos){ for(const [id,p] of Object.entries(pos)){ if(S.levers[id]===p) continue; S.levers[id]=p; drawLever(id); flash(id); } follow(); },
    knob(id,v){ S.controls[id]=v; drawControl(id); },
    glow(i,v,hit){ if(v>0) S.glow[i]=v; else delete S.glow[i]; drawPad(i); if(hit) flash(padId(i)); },
    oled(ram,info){ showOled(ram,info); },
  };
  async function syncDevice(){
    const box=$p('playDevice'); if(!box) return;
    const key=JSON.stringify(doc.device||null); if(key===deviceFor) return;
    deviceFor=key; S.panel?.reset(); S.panel=null; S.link?.close(); S.link=null; S.follows=false; S.source= playable()? 'browser' : 'device';
    box.replaceChildren(); box.hidden=true; $p('playLink').replaceChildren();
    if(!doc.device) return;
    try{ [deviceMod, linkMod, S.oledLib]=await Promise.all([import('./'+PLAY_RUNTIME+'device-panel.js'), import('./'+PLAY_RUNTIME+'device-link.js'), import('./'+PLAY_RUNTIME+'oled.js')]); }catch(e){ return; }
    if(key!==deviceFor) return;   // another firmware came while this loaded
    const device=deviceMod.parseDevice(doc.device); if(!device) return;
    S.panel=deviceMod.mountDevicePanel(box, device, {send:deviceSend,
      idle:()=> S.source==='device'? 'Not sent: plug in the Simple Touch and choose its MIDI port.' : 'Not sent: press Play first, or choose Connect to Simple Touch.'});
    keyboards(box);
    S.link=linkMod.mountDeviceLink($p('playLink'), device, {onMidi:d=>S.panel?.midi(d), onChange:()=>{ S.panel?.reset(); S.panel?.ask(); }, live:LIVE_HANDLERS});
    S.follows=S.link.follows; S.oledRows=device.live?.oled?.rows||0;
    box.hidden=false;
    if(S.source==='device') refresh();
  }
  /* a setting with the 12 note names as buttons (a root note) is drawn as one octave of keys (ui.css .keyboard) */
  function keyboards(box){
    const NOTE_RE=/^([A-G])([#♯b♭]?)$/;
    for(const g of box.querySelectorAll('.device-choices')){
      const bs=[...g.querySelectorAll('button')];
      if(bs.length!==12 || !bs.every(b=>NOTE_RE.test(b.textContent.trim()))) continue;
      g.classList.add('keyboard');
      for(const b of bs){ b.title=b.textContent.trim(); if(NOTE_RE.exec(b.title)[2]) b.classList.add('k-black'); }
    }
  }
  function bindMidi(){
    if(!S.midi) return;
    const out=S.midi.outputs.get(S.midiOut);
    for(const p of S.midi.inputs.values())
      p.onmidimessage= S.source==='browser' && (S.midiIn==='*' || S.midiIn===p.id) && !linkMod?.sameDevice(p, out) ? midiFromPort : null;
  }
  function midiFromPort(e){
    const d=e.data; if(!d.length || d[0]===0xFE) return;   // active sensing: not worth the firmware's time
    if(!S.st) return;
    S.st.sendMidi(d);
    if(d[0]<0xF8) showMidi('MIDI_IN', d);   // clock and other real-time bytes would flash the row non-stop
    midiControls(d, 'in');
  }
  /* The firmware's MIDI arrives as the bytes it wrote per audio block; Web MIDI and the table want whole messages */
  function midiFromFirmware(bytes){
    const out=S.midi && S.midiOut ? S.midi.outputs.get(S.midiOut) : null;
    for(const m of midiMessages(bytes)){
      try{ out?.send(m); }catch(e){}
      S.panel?.midi(m);
      if(m[0]<0xF8) showMidi('MIDI_OUT', m);
      midiControls(m, 'out');
    }
  }
  const MIDI_DATA = s => s<0xC0? 2 : s<0xE0? 1 : s<0xF0? 2 : s===0xF2? 2 : (s===0xF1||s===0xF3)? 1 : 0;
  function midiMessages(b){
    const out=[]; let i=0;
    while(i<b.length){
      const x=b[i];
      if(x===0xF0){ let j=i+1; while(j<b.length && b[j]!==0xF7) j++; out.push(b.slice(i,j+1)); i=j+1; continue; }
      if(x>=0xF8){ out.push(b.slice(i,i+1)); i++; continue; }
      let status=S.runOut;
      if(x&0x80){ status=x; i++; S.runOut= x<0xF0? x : 0; }
      if(!status){ i++; continue; }
      const n=MIDI_DATA(status); if(i+n>b.length) break;
      out.push(Uint8Array.of(status, ...b.slice(i,i+n))); i+=n;
    }
    return out;
  }
  const NOTE=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  function midiText(m){
    const s=m[0], t=s&0xF0, ch=`ch ${(s&15)+1}`, note=n=>`${NOTE[n%12]}${Math.floor(n/12)-1} (${n})`;
    if(s===0xF0) return `SysEx · ${m.length} bytes`;
    if(t===0x90 && m[2]) return `${ch} · note on ${note(m[1])} · velocity ${m[2]}`;
    if(t===0x80 || t===0x90) return `${ch} · note off ${note(m[1])}`;
    if(t===0xB0) return `${ch} · CC ${m[1]} = ${m[2]}`;
    if(t===0xE0) return `${ch} · pitch bend ${((m[2]<<7)|m[1])-8192}`;
    if(t===0xC0) return `${ch} · program ${m[1]+1}`;
    if(t===0xD0) return `${ch} · pressure ${m[1]}`;
    if(t===0xA0) return `${ch} · key pressure ${note(m[1])} = ${m[2]}`;
    return [...m].map(x=>x.toString(16).padStart(2,'0')).join(' ');
  }
  /* the last channel message lights the row; SysEx (some firmware streams it for their own visualisers) is only noted beside it */
  let midiFrame=0;
  const midiLine=id=>[S.last[id], S.sysex[id]].filter(Boolean).join('  ·  ')||'·';
  function showMidi(id, m){
    if(m[0]===0xF0) S.sysex[id]=midiText(m); else { S.last[id]=midiText(m); flash(id); }
    repaintMidi();
  }
  function repaintMidi(){
    if(!midiFrame) midiFrame=requestAnimationFrame(()=>{ midiFrame=0;
      for(const k of ['MIDI_IN','MIDI_OUT']){ const c=document.querySelector(`#side tr[data-id="${k}"] [data-last]`); if(c) c.textContent=midiLine(k); }
      for(const id of mvDirty) paintMv(id); mvDirty.clear(); });
  }
  /* The controls this message is, by the label file's MIDI column (midiMap, core.js): their rows light and show the value */
  let midiRefs=null; const mvDirty=new Set();
  function midiControls(m, dir){
    const t=m[0]&0xF0, ch=m[0]&15;
    const v= t===0xB0? `${m[2]}` : t===0x90&&m[2]? `on ${m[2]}` : t===0x80||t===0x90? 'off' : t===0xA0? `pressure ${m[2]}` : null;
    if(dir==='in' && t===0xB0 && (m[1]===120 || m[1]===123)) for(const i in S.midiPads){ delete S.midiPads[i]; drawPad(i); hot(padId(+i),false); }   // all sound / notes off
    if(v===null) return;
    // firmware can repeat its state (TouchSpore: root and scale every 500 ms for 10 s after Play), so a CC out lights its control only when the value changes
    const ccKey=m[0]<<8|m[1], repeat= dir==='out' && t===0xB0 && (S.ccOut[ccKey]??m[2])===m[2];
    if(dir==='out' && t===0xB0) S.ccOut[ccKey]=m[2];
    midiRefs??=TABLE_ORDER.map(id=>[id, midiMap(val(id,'midi'))]).filter(r=>r[1].length);
    for(const [id,list] of midiRefs){
      const x=list.find(x=>(x.ch===null || x.ch===ch) && (t===0xB0? x.cc===m[1] && m[2]>=x.lo && m[2]<=x.hi : x.note===m[1]));
      if(!x) continue;
      S.mval[id]=`${dir} ${v}`; mvDirty.add(id); repaintMidi();
      // a note into a pad's note is that pad pressed (the firmware's own notes out are pads pressed here already)
      if(dir==='in' && x.note!==undefined && /^P\d\d$/.test(id)){
        const i=+id.slice(1);
        if(t===0x90 && m[2]) S.midiPads[i]=m[2]/127; else if(t===0xA0){ if(S.midiPads[i]!==undefined) S.midiPads[i]=m[2]/127; } else delete S.midiPads[i];
        drawPad(i); hot(id, S.midiPads[i]!==undefined);
      } else if(!repeat) flash(id);
    }
  }
  function paintMv(id){
    document.querySelectorAll(`#side tr[data-id="${id}"] td.midi`).forEach(td=>{
      const s=td.querySelector('.mv') || td.appendChild(Object.assign(document.createElement('span'), {className:'mv'}));
      s.textContent=S.mval[id]||''; });
  }

  /* ---------------------------------------------------------- the control table: MIDI rows, and the rows of the controls in use */
  function table(){
    const t=document.querySelector('#side .ctab'); if(!t || !t.tBodies[0]) return;
    t.querySelectorAll('tr.midirow').forEach(r=>r.remove());
    if(S.state!=='idle'){
      const cols=t.querySelector('thead tr')?.children.length||2;
      const row=(id,name)=>`<tr class="midirow" data-id="${id}"><td><b>${name}</b> <span class="k">USB</span></td><td colspan="${cols-1}" data-last>${esc(midiLine(id))}</td></tr>`;
      t.tBodies[0].insertAdjacentHTML('beforeend', row('MIDI_IN','MIDI in')+row('MIDI_OUT','MIDI out'));
    }
    document.querySelectorAll('#side tr.hot').forEach(r=>r.classList.remove('hot'));
    midiRefs=null;   // the labels may have changed
    for(const id in S.mval) paintMv(id);
    const side=document.getElementById('side');
    if(side && !side.dataset.hover){ side.dataset.hover='1';
      side.addEventListener('mouseover',e=>{ const r=e.target.closest('tr[data-id]'); setHover(r && SLOT[r.dataset.id]? r.dataset.id : null); });
      side.addEventListener('mouseleave',()=>setHover(null)); }
    const fig=document.getElementById('fig');
    if(fig && !fig.dataset.hover){ fig.dataset.hover='1';
      fig.addEventListener('pointerover',e=>setHover(pointed(e.target)));
      fig.addEventListener('pointerleave',()=>setHover(null)); }
    tagLabels();
  }
  /* after the labels were drawn again: which hide under "No pad labels", and the marks on them */
  function tagLabels(){
    labelClasses();
    document.querySelectorAll('#fig g[data-key], #fig g[data-lead]').forEach(g=>{ const k=SLOT[(g.dataset.key||g.dataset.lead).replace(/^[nf]:/,'')]?.kind; if(k==='pad'||k==='mod'||k==='switch') g.classList.add('padlabel'); });
    for(const id of S.hot) paintRow(id);
    const h=hovId; hovId=null; setHover(h);
  }
  /* A modifier in use: the drawing's labels show what it does (soloMod, core.js). A hold modifier while held,
     else the toggle tapped last. Only the labels are drawn again, so the controls being held stay held. */
  function relabel(force){
    const combo=mods().find(m=>isCombo(m) && modParts(m).every(p=>S.held.includes(p)));   // all of a combo's controls down beats any one of them
    const want= showing() && part==='main' ? (combo || S.held.filter(m=>isMod(m) && !isToggle(m)).at(-1) || S.mode) : null;
    if(want===soloMod && !force) return;
    soloMod=want;
    const over=S.svg?.querySelector(':scope > g.over'); if(!over) return;
    over.innerHTML=buildFor(V.layout)(true,V.theme,part,null).over;
    tagLabels();
  }
  /* a modifier pad pressed or let go; a toggle switches on release. Toggles are a set of modes (TouchVink's
     OSC / DIST), so tapping the one in use keeps it, unless it is the only toggle: then it switches off. */
  function modPad(id, down){
    if(!isModPart(id)) return;
    S.held=S.held.filter(m=>m!==id); if(down) S.held.push(id);   // a toggle too: it can be part of a combo
    if(isToggle(id) && !down) S.mode= S.mode===id && mods().filter(isToggle).length===1? null : id;
    relabel();
  }
  /* ---------------------------------------------------------- hover and use, shown together: on the drawing the control's own
     shape (light on hover, strong in use) and a glow on its label, in the table its row */
  let hovId=null;
  function shape(id){
    const s=SLOT[id], L=PLAY_LEVERS[id];
    if(/^P\d\d$/.test(id)){
      const polys= S.mod && S.polys || PAD_POLY[design.themes[V.theme].panel.drawing==='simple'? 'simple' : 'synthux'];
      return `<polygon points="${polys[+id.slice(1)].map(p=>p.map(f1).join(',')).join(' ')}"/>`;
    }
    if(s.kind==='fader') return `<rect x="${f1(s.x-15)}" y="601" width="30" height="277" rx="15"/>`;
    if(L) return `<rect x="${-L.w/2}" y="${-L.h/2}" width="${L.w}" height="${L.h}" rx="4" transform="translate(${s.x} ${s.y}) rotate(${L.rot})"/>`;
    if(s.kind==='led') return `<rect x="${s.x-12}" y="${s.y-8}" width="24" height="16"/>`;
    return `<circle cx="${s.x}" cy="${s.y}" r="${s.kind==='knob'? 34 : 28}"/>`;
  }
  const drawings=()=>[...document.querySelectorAll('#fig svg')].filter(svg=>!svg.parentElement.closest('svg'));
  function mark(id, cls, on){
    for(const svg of drawings()){
      svg.querySelectorAll(`g[data-for].${cls}`).forEach(g=>{ if(g.dataset.for===id) g.remove(); });
      svg.querySelectorAll(`g[data-key="${id}"]`).forEach(g=>g.classList.toggle(cls, on));
      // a pressed pad shows itself already
      if(!on || !SLOT[id] || (cls==='hl-use' && /^P\d\d$/.test(id) && (S.pads[+id.slice(1)]!==undefined || S.midiPads[+id.slice(1)]!==undefined || S.glow[+id.slice(1)]!==undefined))) continue;
      const html=`<g class="${cls}" data-for="${id}">${shape(id)}</g>`, at=svg.querySelector(':scope > g[clip-path]');
      if(at) at.insertAdjacentHTML('afterend', html); else svg.insertAdjacentHTML('beforeend', html);
    }
  }
  function setHover(id){
    if(hovId && hovId!==id){ mark(hovId,'hl-hover',false); document.querySelectorAll(`#side tr[data-id="${hovId}"]`).forEach(r=>r.classList.remove('hov')); }
    hovId=id; if(!id) return;
    mark(id,'hl-hover',true);
    document.querySelectorAll(`#side tr[data-id="${id}"]`).forEach(r=>r.classList.add('hov'));
  }
  /* what is under the pointer: a control (while playing) or a label */
  const pointed=t=>{ const e=t.closest?.('[data-knob],[data-fader],[data-lever],.playov .pad[data-pad],g[data-key]'); if(!e) return null;
    const id= e.dataset.knob || e.dataset.fader || e.dataset.lever || (e.dataset.pad!==undefined? padId(+e.dataset.pad) : e.dataset.key);
    return SLOT[id]? id : null; };
  function paintRow(id){ const on=S.hot.has(id); document.querySelectorAll(`#side tr[data-id="${id}"]`).forEach(r=>r.classList.toggle('hot',on)); mark(id,'hl-use',on); }
  /* a row lights while its control is held, and a moment after */
  function hot(id, on){
    clearTimeout(S.cool[id]);
    if(on){ S.hot.add(id); paintRow(id); }
    else S.cool[id]=setTimeout(()=>{ S.hot.delete(id); paintRow(id); }, 350);
  }
  const flash=id=>{ hot(id,true); hot(id,false); };

  /* ---------------------------------------------------------- audio in */
  function stopInput(){
    try{ S.inputNode?.disconnect(); S.inputNode?.stop?.(); }catch(e){}
    S.inputStream?.getTracks().forEach(t=>t.stop());
    S.inputNode=S.inputStream=null;
  }
  async function selectInput(id){
    if(id==='file:cur') id='file';
    S.input=id; fillInputs();
    if(!S.ctx || S.state==='idle') return;   // connected on Play
    stopInput();
    const want=S.run+':'+id;
    try{
      let node=null, stream=null;
      if(id==='mic'){
        stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
        node=S.ctx.createMediaStreamSource(stream);
      } else if(id==='file' || id.startsWith('loop:')){
        const loop=(S.inputs||[]).find(l=>l.id===id);
        const key= id==='file'? `file:${S.file.name}:${S.file.size}` : loop.url;
        if(!S.buffers.has(key)){
          if(id!=='file') say('Loading '+loop.name.toLowerCase()+' loop…');
          const bytes= id==='file'? await S.file.arrayBuffer() : await (await fetch(loop.url)).arrayBuffer();
          S.buffers.set(key, await S.ctx.decodeAudioData(bytes));
          if(S.state==='running') say('Playing');
        }
        node=new AudioBufferSourceNode(S.ctx,{buffer:S.buffers.get(key), loop:true}); node.start();
      }
      if(want!==S.run+':'+S.input || !S.inGain){ stream?.getTracks().forEach(t=>t.stop()); try{ node?.stop?.(); }catch(e){} return; }
      S.inputNode=node; S.inputStream=stream; node?.connect(S.inGain);
    }catch(err){ say('Audio in: '+(err.message||'could not load'), true); }
  }

  /* ---------------------------------------------------------- the drawing: controls, pads, LED, OLED */
  const f1=v=>(+v).toFixed(1);
  /* Each pad's outline, per drawing. The Synthux drawing's were traced from its pad art
     (assets/panel_blank.svg, without what the top plate covers); the simplified drawing's are its own. */
  const PAD_ART={
    P00:'282,956 452,956 452,995 488,1037 516,1089 510,1097 458,1104 438,1106 423,1094 407,1088 329,1082 310,1088 284,1118 278,1120 243,1019 295,982 296,978',
    P01:'470,956 628,956 615,977 611,996 601,1012 560,1077 552,1087 547,1087 526,1069 517,1046 474,999',
    P02:'641,956 735,956 791,1105 826,1176 823,1179 802,1164 737,1099 702,1077 675,1079 662,1089 652,1091 649,1024 641,992',
    P03:'209,1070 265,1112 277,1127 250,1194 246,1213 250,1295 270,1376 266,1385 249,1397 201,1411 172,1431 150,1441 132,1467 128,1494 122,1505 115,1505 108,1511 100,1508 95,1464 103,1401 96,1297 99,1226 97,1124 123,1183 127,1184 149,1171 190,1177 197,1166 202,1099',
    P04:'342,1100 384,1103 422,1114 439,1149 438,1177 448,1229 450,1277 447,1312 451,1332 401,1331 375,1344 294,1372 289,1367 287,1350 276,1326 269,1295 267,1225 277,1172 289,1135 316,1106',
    P05:'526,1107 533,1109 538,1121 522,1154 522,1161 578,1199 578,1236 600,1360 592,1407 575,1457 577,1504 570,1510 545,1512 530,1504 521,1489 516,1444 495,1396 496,1366 487,1353 472,1343 464,1321 464,1231 457,1197 453,1143 442,1127 442,1123 456,1118 520,1111',
    P06:'627,1015 632,1039 635,1100 640,1112 663,1113 687,1094 711,1100 776,1162 784,1180 794,1191 825,1195 840,1214 841,1229 833,1253 829,1335 823,1353 827,1387 835,1410 822,1410 806,1401 791,1388 741,1370 671,1366 648,1361 608,1333 597,1257 595,1186 590,1180 542,1157 539,1151',
    P07:'974,1121 981,1125 982,1173 973,1270 985,1450 979,1471 979,1499 973,1504 961,1496 957,1482 941,1456 932,1446 911,1437 885,1433 864,1420 850,1400 845,1382 845,1358 851,1333 849,1274 861,1217 847,1183 874,1166 927,1145',
    P08:'418,1348 453,1352 474,1364 475,1399 496,1446 500,1465 497,1488 505,1505 463,1509 323,1504 293,1504 260,1510 226,1507 221,1499 224,1482 207,1443 210,1432 274,1401 296,1396 330,1375 373,1359',
    P09:'618,1364 631,1368 653,1385 713,1382 744,1388 771,1399 811,1426 855,1436 871,1451 859,1478 862,1504 815,1502 722,1503 627,1511 603,1507 590,1487 590,1460',
    P10:'464,115 475,116 478,124 487,128 484,138 497,157 509,156 514,145 535,157 531,195 534,209 528,221 526,212 517,202 506,210 502,224 494,232 489,220 485,219 476,226 465,214 456,196 455,182 449,176 426,201 413,204 411,189 415,157 409,151 388,150 384,145 384,131 392,117 444,119',
    P11:'691,109 707,117 709,131 704,164 718,207 704,205 700,219 694,225 688,205 677,200 668,209 667,226 662,206 656,200 639,205 619,205 614,210 613,226 609,209 595,186 586,142 611,123 623,122 640,114 652,114 658,122 668,154 675,158 681,152 678,135 680,117',
  };
  const D={x:94.67, y:98.61, w:892.14, h:1427.88}, sx=D.w/825, sy=D.h/1277;   // as in simpleArt
  const PAD_POLY={simple:{}, synthux:{}};
  { const pts=list=>list.split(' ').map(p=>{ const [a,b]=p.split(','); return [D.x+a*sx, D.y+b*sy]; });
    SIMPLE_PADS.top.forEach((p,i)=>PAD_POLY.simple[10+i]=pts(p));
    SIMPLE_PADS.row.forEach((p,i)=>PAD_POLY.simple[i]=pts(p));
    SIMPLE_PADS.play.forEach((p,i)=>PAD_POLY.simple[3+i]=pts(p));
    for(const [id,list] of Object.entries(PAD_ART)) PAD_POLY.synthux[+id.slice(1)]=list.split(' ').map(p=>p.split(',').map(Number)); }
  const PAD_ORDER=[10,11,0,1,2,8,4,5,6,7,9,3];   // P03 after P08: where the simplified outlines overlap, it is P03
  const padId=i=>'P'+String(i).padStart(2,'0');
  /* The Synthux drawing's pad art, in the page once (#panelBase), gets an id per pad so a pressed
     pad can show its own lines (<use>, recoloured through --pline). In the drawing's order: */
  const ART_ORDER=[null,'P11','P01','P10','P02','P05','P09','P04','P07','P08','P06','P00','P03'];
  function tagPadArt(){
    if(document.getElementById('padArt-P03')) return true;
    const art=[...document.querySelectorAll('#panelBase #st-Faceplate_BOTTOM > g > path, #panelBase #st-Faceplate_BOTTOM > g > polygon')]
      .filter(e=>/fill:var\(--pline/.test(e.getAttribute('style')||''));
    if(art.length!==ART_ORDER.length) return false;
    art.forEach((e,k)=>{ if(ART_ORDER[k]) e.id='padArt-'+ART_ORDER[k]; });
    return true;
  }
  const polar=(cx,cy,r,deg)=>{ const a=deg*Math.PI/180; return [cx+r*Math.sin(a), cy-r*Math.cos(a)]; };
  const KNOB_SWEEP=150;   // degrees each side of straight up
  function arc(cx,cy,r,a0,a1){
    if(a1-a0<0.5) return '';
    const [x0,y0]=polar(cx,cy,r,a0), [x1,y1]=polar(cx,cy,r,a1);
    return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${f1(x1)} ${f1(y1)}`;
  }

  function attach(fig){
    S.svg=null; S.mod=null; labelClasses();   // the page set body's class anew
    if(!showing()) return;
    const svg=fig.querySelector('svg'); if(!svg) return;
    const art= design.themes[V.theme].panel.drawing!=='simple' && tagPadArt();
    S.polys= PAD_POLY[art? 'synthux' : 'simple'];
    const pts=i=>S.polys[i].map(p=>p.map(f1).join(',')).join(' ');
    // On the drawing, under the labels: the pressed pads, the LED and the OLED
    let u='<g class="playov under"><defs><radialGradient id="playGlow"><stop offset="0" stop-color="#ff4a2f" stop-opacity=".85"/><stop offset="1" stop-color="#ff4a2f" stop-opacity="0"/></radialGradient></defs>';
    for(const i of PAD_ORDER) u+=`<g data-padv="${i}"><polygon class="padfill" points="${pts(i)}"/>${art? `<use class="padart" href="#padArt-${padId(i)}"/>` : ''}</g>`;
    { const l=SLOT.LED; u+=`<g data-led><circle class="glow" cx="${l.x}" cy="${l.y}" r="26"/><rect class="lit" x="${l.x-11}" y="${l.y-7}" width="22" height="14" rx="2"/></g>`; }
    if(S.source==='device'? S.oledRows : em()?.oled && S.oledOn)
      u+='<g class="oled"><rect class="bezel" rx="8"/><image data-oled preserveAspectRatio="xMidYMid meet"/></g>';
    u+='</g>';
    // On top of everything: the controls' positions and the hit areas
    let g='<g class="playov">';
    for(const i of PAD_ORDER) g+=`<polygon class="pad" data-pad="${i}" points="${pts(i)}"><title>${padId(i)} · key ${esc(keyName(i))}</title></polygon>`;
    for(const s of SLOTS.filter(s=>s.kind==='knob'))
      g+=`<g data-knob="${s.id}"><path class="track" d="${arc(s.x,s.y,44,-KNOB_SWEEP,KNOB_SWEEP)}"/><path class="val"/><line class="ptr" x1="${s.x}" y1="${s.y}"/><circle class="hit knob" cx="${s.x}" cy="${s.y}" r="54"><title>${s.id} · drag up or down</title></circle></g>`;
    for(const s of SLOTS.filter(s=>s.kind==='fader'))
      g+=`<g data-fader="${s.id}"><rect class="val" x="${s.x-4}" width="8" rx="4"/><rect class="cap" x="${s.x-27}" width="54" height="24" rx="5"/><rect class="hit fader" x="${s.x-42}" y="${FADER_RUN[1]-30}" width="84" height="${FADER_RUN[0]-FADER_RUN[1]+60}"><title>${s.id}</title></rect></g>`;
    for(const [id,L] of Object.entries(PLAY_LEVERS)){ const s=SLOT[id], long=Math.max(L.w,L.h), horiz=L.w>L.h, third=long/3;
      g+=`<g data-lever="${id}" transform="translate(${s.x} ${s.y}) rotate(${L.rot})"><rect class="thumb" x="-13" y="-13" width="26" height="26" rx="6"/>`;
      [L.ends[0],'centre',L.ends[1]].forEach((pos,k)=>{ const a=-long/2+k*third-(k===0?10:0), len=third+(k!==1?10:0);
        g+= horiz? `<rect class="hit lever" data-pos="${pos}" x="${f1(a)}" y="${-L.h/2-10}" width="${f1(len)}" height="${L.h+20}"><title>${lab(s)}: ${pos}</title></rect>`
          : `<rect class="hit lever" data-pos="${pos}" x="${-L.w/2-10}" y="${f1(a)}" width="${L.w+20}" height="${f1(len)}"><title>${lab(s)}: ${pos}</title></rect>`; });
      g+='</g>'; }
    g+='</g>';
    const drawing=svg.querySelector(':scope > g[clip-path]');
    if(drawing) drawing.insertAdjacentHTML('afterend', u); else g=u+g;
    svg.insertAdjacentHTML('beforeend', g);
    S.svg=svg; S.mod=svg;
    for(const id of Object.keys(S.controls)) drawControl(id);
    for(const id of Object.keys(PLAY_LEVERS)) drawLever(id);
    for(const i of PAD_ORDER) drawPad(i);
    setLed(S.led);
    placeOled();
    if(S.oledUrl) S.mod.querySelector('[data-oled]')?.setAttribute('href',S.oledUrl);
    bind();
  }

  function drawControl(id){
    const s=SLOT[id], v=S.controls[id], g=S.mod?.querySelector(`[data-knob="${id}"],[data-fader="${id}"]`); if(!g) return;
    if(s.kind==='knob'){
      const a=-KNOB_SWEEP+v*2*KNOB_SWEEP, [x,y]=polar(s.x,s.y,33,a);
      g.querySelector('.val').setAttribute('d',arc(s.x,s.y,44,-KNOB_SWEEP,a));
      const p=g.querySelector('.ptr'); p.setAttribute('x2',f1(x)); p.setAttribute('y2',f1(y));
    } else {
      const y=FADER_RUN[0]+(FADER_RUN[1]-FADER_RUN[0])*v;
      g.querySelector('.cap').setAttribute('y',f1(y-12));
      const r=g.querySelector('.val'); r.setAttribute('y',f1(y)); r.setAttribute('height',f1(Math.max(0,FADER_RUN[0]+12-y)));
    }
  }
  function drawLever(id){
    const g=S.mod?.querySelector(`[data-lever="${id}"]`); if(!g) return;
    const L=PLAY_LEVERS[id], pos=S.levers[id], k=[L.ends[0],'centre',L.ends[1]].indexOf(pos)-1, d=k*Math.max(L.w,L.h)/3;
    const r=g.querySelector('.thumb'); r.setAttribute('x', f1((L.w>L.h? d : 0)-13)); r.setAttribute('y', f1((L.w>L.h? 0 : d)-13));
  }
  /* pressed: the outline, a fill and (on the Synthux drawing) the pad's own lines, stronger the harder it is pressed */
  function drawPad(i){
    const el=S.mod?.querySelector(`[data-pad="${i}"]`), v=S.mod?.querySelector(`[data-padv="${i}"]`); if(!el || !v) return;
    const held=S.pads[i]??S.midiPads[i], f= held===undefined? S.glow[i] : Math.max(held, S.glow[i]??0), on=f!==undefined, art=v.querySelector('.padart');
    el.classList.toggle('on', on);
    v.querySelector('.padfill').style.fillOpacity= on? ((art? 0.12 : 0.25)+(art? 0.25 : 0.5)*f).toFixed(2) : '';
    if(art) art.style.opacity= on? (0.5+0.5*f).toFixed(2) : '';
  }
  function setLed(on){ S.led=on; S.mod?.querySelector('[data-led]')?.classList.toggle('on',!!on); }
  /* the OLED's place and shape: the firmware's own rows once it has drawn, before that what the label file says */
  function placeOled(){
    const g=S.mod?.querySelector('g.oled'); if(!g) return;
    const o=oledBox(S.oledShown || (S.source==='device'? S.oledRows : 0));
    const put=(e,x,y,w,h)=>{ e.setAttribute('x',f1(x)); e.setAttribute('y',f1(y)); e.setAttribute('width',f1(w)); e.setAttribute('height',f1(h)); };
    put(g.querySelector('.bezel'), o.x-10, o.y-10, o.w+20, o.h+20);
    put(g.querySelector('[data-oled]'), o.x, o.y, o.w, o.h);
  }
  /* OLED frames come up to 60 times a second; the drawing takes the newest once per animation frame */
  let oledFrame=0;
  function showOled(ram, info){
    S.oled={ram:ram&&new Uint8Array(ram), info};
    if(oledFrame) return;
    oledFrame=requestAnimationFrame(()=>{
      oledFrame=0; if(!S.oled || !S.oledLib) return;
      const rows=S.oledLib.oledRows(S.oled.info), c=S.canvas ||= Object.assign(document.createElement('canvas'),{width:384});
      if(c.height!==384*rows/128) c.height=384*rows/128;
      if(rows!==S.oledShown){ S.oledShown=rows; placeOled(); }
      S.oledLib.drawOled(c, S.oled.ram, S.oled.info, {gap:0.18});
      S.oledUrl=c.toDataURL();
      S.mod?.querySelector('[data-oled]')?.setAttribute('href',S.oledUrl);
    });
  }

  /* ---------------------------------------------------------- input */
  const svgPoint=(el,e)=>{ const m=el.getScreenCTM(); if(!m) return {x:0,y:0}; return new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()); };
  const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
  function setControl(id,v){ v=clamp(v); if(v===S.controls[id]) return; S.controls[id]=v; drawControl(id); S.st?.setControl(id,v); if(S.source==='device') S.link?.knob(id,v); }
  function setLever(id,pos){ if(S.source==='device') return;   // a real lever only moves by hand
    S.levers[id]=pos; drawLever(id); flash(id); S.st?.setSwitch(id,pos); follow(); }
  /* the mode switch (doc.modes, core.js): the labels follow its lever while playing; a position that isn't a mode shows them all */
  const leverMode=()=>{ const sw=doc.modes?.switch; return showing() && sw && modeList().some(m=>m.pos===S.levers[sw])? S.levers[sw] : ''; };
  function follow(){
    if(!doc.modes || leverMode()===V.mode) return;
    V.mode=leverMode(); relabel(true);
    if(typeof onModeChange==='function') onModeChange();
  }
  function pad(i,down,force=0.5){ const was=S.pads[i]!==undefined;
    if(down) S.pads[i]=force; else { delete S.pads[i]; S.latched.delete(i); } drawPad(i); hot(padId(i),down); S.st?.setPad(i,down,force);
    if(S.source==='device') S.link?.pad(i,down,force);   // its modifier labels follow the board's own report
    else if(down!==was) modPad(padId(i),down); }
  /* Touch: a buzz the moment a control is taken, a light tick as its value runs (a firmer one at the ends),
     a clear click per lever position. Android vibrates for the time asked. iPhone has no vibrate, but Safari 18
     ticks when a switch is toggled from a touch, so a hidden one is toggled: one tick, whatever the length. */
  const buzz=(e,ms)=>{
    if(e.pointerType!=='touch') return;
    if(navigator.vibrate){ try{ navigator.vibrate(ms); }catch(err){} return; }
    const l=document.createElement('label'); l.ariaHidden='true'; l.style.display='none';
    l.innerHTML='<input type="checkbox" switch>'; document.head.append(l); l.click(); l.remove();
  };
  function tick(e,c,v,steps){ const k=Math.round(clamp(v)*steps); if(k===c.k) return;
    const now=performance.now(); if(c.k!==undefined && now-(c.t||0)>25){ buzz(e, k===0||k===steps? 15 : 4); c.t=now; }
    c.k=k; }
  function drag(el, onDown, onMove, onUp){
    // a long press is not the browser's: no context menu, and none of its own buzz a second in
    el.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
    el.addEventListener('contextmenu',e=>e.preventDefault());
    el.addEventListener('pointerdown',e=>{
      if(e.button>0) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const ctx=onDown(e)||{};
      const move=ev=>onMove?.(ev,ctx), up=ev=>{ el.removeEventListener('pointermove',move); el.removeEventListener('pointerup',up); el.removeEventListener('pointercancel',up); onUp?.(ev,ctx);
        setTimeout(()=>setHover(pointed(document.elementFromPoint(ev.clientX,ev.clientY)||document.body)));   // the hover the capture hid
      };
      el.addEventListener('pointermove',move); el.addEventListener('pointerup',up); el.addEventListener('pointercancel',up);
    });
  }
  function bind(){
    const m=S.mod;
    m.querySelectorAll('.playov .hit.knob').forEach(el=>{ const id=el.parentNode.dataset.knob;
      // 160 screen pixels for the whole turn, whatever the drawing's size; a double tap or click puts it in the middle
      let last=0;
      drag(el, e=>{ hot(id,true); buzz(e,12);
          if(e.timeStamp-last<300) setControl(id,0.5); last=e.timeStamp;
          return {y:e.clientY, v:S.controls[id], k:Math.round(S.controls[id]*32)}; },
        (e,c)=>{ setControl(id, c.v+(c.y-e.clientY)/160); tick(e,c,S.controls[id],32); }, ()=>hot(id,false));
      el.addEventListener('wheel',e=>{ e.preventDefault(); flash(id); setControl(id, S.controls[id]-Math.sign(e.deltaY)*0.02); },{passive:false});
    });
    m.querySelectorAll('.playov .hit.fader').forEach(el=>{ const id=el.parentNode.dataset.fader;
      const at=e=>{ const p=svgPoint(S.svg,e); setControl(id,(FADER_RUN[0]-p.y)/(FADER_RUN[0]-FADER_RUN[1])); };
      drag(el, e=>{ hot(id,true); buzz(e,12); at(e); return {k:Math.round(S.controls[id]*32)}; }, (e,c)=>{ at(e); tick(e,c,S.controls[id],32); }, ()=>hot(id,false));
      el.addEventListener('wheel',e=>{ e.preventDefault(); flash(id); setControl(id, S.controls[id]-Math.sign(e.deltaY)*0.02); },{passive:false});
    });
    // a lever: the third pressed, then sliding along it to the next position (a few units past the line, so it doesn't chatter)
    m.querySelectorAll('.playov .hit.lever').forEach(el=>{ const g=el.parentNode, id=g.dataset.lever, L=PLAY_LEVERS[id];
      const order=[L.ends[0],'centre',L.ends[1]], b=Math.max(L.w,L.h)/6;
      drag(el, e=>{ setLever(id, el.dataset.pos); buzz(e,25); }, e=>{
        const p=svgPoint(g,e), at= L.w>L.h? p.x : p.y, k= at<-b? 0 : at>b? 2 : 1, cur=order.indexOf(S.levers[id]);
        if(k===cur) return;
        const edge= k+cur===1? -b : k+cur===3? b : null;
        if(edge!==null && Math.abs(at-edge)<4) return;
        setLever(id, order[k]); buzz(e,25); });
    });
    m.querySelectorAll('.playov .pad').forEach(el=>{ const i=+el.dataset.pad, ys=S.polys[i].map(p=>p[1]), top=Math.min(...ys), h=Math.max(...ys)-top;
      // a pen's own pressure where there is one; else (mouse and touch alike) where the pad was hit
      // (top = hard, bottom = soft), then dragging up or down from there. A touch screen's "pressure" is
      // mostly the size of the finger, so it is not used.
      const force=(e,c)=> e.pointerType==='pen' && e.pressure>0 && e.pressure!==0.5? e.pressure : clamp(c.base+(c.y-e.clientY)/120);
      const hit=e=>({y:e.clientY, base:clamp(1-(svgPoint(S.svg,e).y-top)/h, 0.05, 1)});
      drag(el, e=>{ const c=hit(e), f=force(e,c);
          pad(i,true,f); buzz(e,12); c.k=Math.round(f*16); return c; },
        (e,c)=>{ const f=force(e,c); pad(i,true,f); tick(e,c,f,16); }, ()=>pad(i,false));
      // right-click: the pad stays held (a mouse can then play combos such as P2 + P11) until it is right-clicked again or played
      el.addEventListener('pointerdown',e=>{ if(e.button!==2) return; e.preventDefault();
        if(S.latched.has(i)) pad(i,false); else { pad(i,true,force(e,hit(e))); S.latched.add(i); } });
    });
  }
  const CODE_PAD=Object.fromEntries(Object.entries(PLAY_CODES).map(([i,c])=>[c,+i]));
  const typing=e=>e.target.closest && e.target.closest('input,select,textarea,[contenteditable]');
  const keyDown=e=>{ const i=CODE_PAD[e.code]; if(i===undefined || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return; e.preventDefault(); pad(i,true,0.6); };
  const keyUp=e=>{ const i=CODE_PAD[e.code]; if(i!==undefined && S.pads[i]!==undefined) pad(i,false); };
  function keys(on){
    if(on===S.keys) return; S.keys=on;
    const f= on? 'addEventListener' : 'removeEventListener';
    window[f]('keydown',keyDown); window[f]('keyup',keyUp);
  }

  return {
    strip, attach, table, reset, stop, nextLabels,
    get on(){ return showing(); },
    get stage(){ return S.stage; },
  };
})();
