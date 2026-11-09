/* Upload to device: pulls a firmware's latest release, reads where the .bin runs from its vector table, and writes it
   over WebUSB with vendor/webdfu. Release downloads send no CORS header (notes.md), so the bytes come through proxy/.
   The Daisy bootloader is libDaisy's own build for the built-in USB port, with a 2-second wait. */
const DAISY_PROGRAMMER='https://flash.daisy.audio/';
const BOOTLOADER_FILE='vendor/libdaisy/dsy_bootloader_v6_4-intdfu-2000ms.bin';
/* the deployed proxy/firmware-proxy.js. Empty: the dialog links to Releases and takes a file from this computer. */
const FIRMWARE_PROXY='https://simple-touch-firmware.jonwtr.workers.dev/';
const ADDR_INTERNAL=0x08000000, ADDR_QSPI=0x90040000;

/* The first two words of a Cortex-M image: initial stack pointer, reset handler (odd: Thumb).
   libDaisy's linker scripts place the reset handler by APP_TYPE: BOOT_NONE in internal flash, BOOT_QSPI in QSPI from
   0x90040000, BOOT_SRAM in AXI SRAM (the bootloader copies it there from QSPI). Returns internal | qspi | sram | unknown. */
function firmwareKind(buf){
  if(buf.byteLength<8) return 'unknown';
  const v=new DataView(buf), sp=v.getUint32(0,true), reset=v.getUint32(4,true);
  const within=(n,a,b)=>n>=a && n<b;
  const stackInRam=within(sp,0x20000000,0x20020001) || within(sp,0x24000000,0x24080001) || within(sp,0x30000000,0x30048001) || within(sp,0x38000000,0x38010001);
  if(!stackInRam || !(reset&1)) return 'unknown';
  if(within(reset,0x08000000,0x08020000)) return 'internal';
  if(within(reset,0x90040000,0x90800000)) return 'qspi';
  if(within(reset,0x24000000,0x24080000)) return 'sram';
  return 'unknown';
}

/* The GitHub and Codeberg release APIs send CORS headers; only the files behind them don't.
   A .bin named bootloader is left out: it is installed once, not uploaded as the firmware. */
async function latestRelease(repo){
  const m=normRepo(repo).match(/^https:\/\/(github\.com|codeberg\.org)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if(!m) return null;
  const r=await fetch(m[1]==='github.com'? `https://api.github.com/repos/${m[2]}/${m[3]}/releases/latest` : `https://codeberg.org/api/v1/repos/${m[2]}/${m[3]}/releases/latest`);
  if(r.status===404) return null;
  if(!r.ok) throw new Error('release list '+r.status);
  const j=await r.json();
  return {tag:String(j.tag_name||''), assets:(j.assets||[]).filter(a=>/\.bin$/i.test(a.name) && !/bootloader/i.test(a.name))
    .map(a=>({name:a.name, size:a.size, url:a.browser_download_url, digest:a.digest||''}))};
}

/* a.digest is GitHub's sha256:<hex> of the asset (Codeberg gives none), so a proxy can't change the file unnoticed */
async function downloadFirmware(a){
  const r=await fetch(`${FIRMWARE_PROXY}?url=${encodeURIComponent(a.url)}`);
  if(!r.ok) throw new Error('download '+r.status);
  const bytes=await r.arrayBuffer();
  if(a.digest && crypto.subtle){
    const hex=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if('sha256:'+hex!==a.digest.toLowerCase()) throw new Error('checksum mismatch');
  }
  return bytes;
}

function flashAdvice(kind){
  const go='Press <b>Connect and flash</b> and choose the DFU device in the list.';
  if(kind==='internal') return {warn:false, html:`<p><b>Internal flash.</b> This firmware runs from the Daisy's internal flash (0x08000000) and does not use the Daisy bootloader.</p>
    <ol><li data-step="enter">Connect the Simple Touch with a USB data cable, then hold <b>BOOT</b>, tap <b>RESET</b>, let go of <b>BOOT</b>.</li><li data-step="flash">${go}</li></ol>
    <p>If this Daisy has the Daisy bootloader, this upload replaces it. A firmware that needs the bootloader won't start until the bootloader is installed again.</p>`};
  if(kind==='qspi'||kind==='sram') return {warn:true, html:`<p><b>Needs the Daisy bootloader.</b> ${kind==='qspi'? 'This firmware runs from QSPI flash' : 'This firmware is stored in QSPI flash and runs from SRAM'} (written to 0x90040000). It only starts through the Daisy bootloader, so the bootloader has to be on the Daisy first.</p>
    <ol><li data-step="boot">Once per Daisy, connect the Simple Touch with a USB data cable, then hold <b>BOOT</b>, tap <b>RESET</b>, let go of <b>BOOT</b>. Press <b>Install bootloader</b> and choose the DFU device in the list. This replaces the firmware in internal flash.</li>
    <li data-step="enter">Tap <b>RESET</b>, then press <b>BOOT</b> while the LED pulses slowly (about 2 seconds). The bootloader keeps waiting.</li>
    <li data-step="flash">${go}</li></ol>
    <p>More in the <a href="https://docs.daisy.audio/tutorials/_a7_Getting-Started-Daisy-Bootloader" target="_blank">Daisy bootloader docs ↗</a>.</p>`};
  return {warn:true, html:`<p><b>This file is not a Daisy firmware.</b> Its first bytes do not point to internal flash, QSPI flash or SRAM. Choose the firmware's <code>.bin</code> file.</p>`};
}

/* Interface names say which DFU the Daisy is in: the ROM lists internal flash, the Daisy bootloader lists QSPI.
   Both answer as 0483:df11, so the USB ID can't tell them apart. */
async function daisyInterface(usb, kind, installing){
  const list=dfu.findDeviceDfuInterfaces(usb);
  if(list.some(i=>i.name==null)){   // some systems don't report the names: read them from the device
    const t=new dfu.Device(usb,list[0]);
    await usb.open(); await usb.selectConfiguration(1);
    const names=await t.readInterfaceNames(); await t.close();
    for(const i of list) if(i.name==null) i.name=names[i.configuration.configurationValue][i.interface.interfaceNumber][i.alternate.alternateSetting];
  }
  const qspi=list.find(i=>/0x9000|0x9004/.test(i.name||'')), internal=list.find(i=>/0x08000000/.test(i.name||''));
  if(kind==='internal'){
    if(internal && !qspi) return internal;
    if(qspi && installing) throw Object.assign(new Error('The Daisy bootloader is already on this Daisy. Press Connect and flash.'), {note:true});
    throw new Error(qspi? 'The Daisy is in its bootloader, and this firmware goes to internal flash. Hold BOOT, tap RESET, let go of BOOT, then press Connect and flash again.' : 'This USB device has no internal flash to write to. Connect the Daisy in DFU mode.');
  }
  if(qspi) return qspi;
  throw new Error('The Daisy is in DFU mode, and this firmware needs the Daisy bootloader. Tap RESET, press BOOT while the LED pulses slowly, then press Connect and flash again. If the LED does not pulse, install the bootloader first.');
}

/* Erases, writes and restarts. A wrong mode throws before anything is erased. */
async function writeFirmware(bytes, kind, onStep, onProgress, installing=false){
  const usb=await navigator.usb.requestDevice({filters:[{vendorId:0x0483, productId:0xdf11}]});
  const settings=await daisyInterface(usb, kind, installing);
  const dev=new dfuse.Device(usb, settings);
  dev.logInfo=onStep; dev.logWarning=dev.logError=()=>{}; dev.logProgress=onProgress;
  const addr= kind==='internal'? ADDR_INTERNAL : ADDR_QSPI, seg=dev.getSegment(addr);
  if(!seg || !seg.writable) throw new Error('The Daisy does not list 0x'+addr.toString(16)+' as writable. Reconnect it and try again.');
  dev.startAddress=addr;
  await dev.open();
  try{
    let size=1024;
    const conf=dfu.parseConfigurationDescriptor(await dev.readConfigurationDescriptor(0));
    const func=conf.descriptors.find(x=>x.bDescriptorType===0x21 && 'bcdDFUVersion' in x);
    if(func && func.wTransferSize) size=func.wTransferSize;
    const st=await dev.getStatus(); if(st.state===dfu.dfuERROR) await dev.clearStatus();
    await dev.do_download(size, bytes, true);
  } finally { await dev.close(); }
}

/* resolves to null if the file is missing or is not a Daisy image, such as a host's HTML error page */
async function loadBootloader(){
  try{
    const r=await fetch(BOOTLOADER_FILE); if(!r.ok) return null;
    const bytes=await r.arrayBuffer();
    return firmwareKind(bytes)==='internal'? bytes : null;
  }catch(e){ return null; }
}

function openFlash({name='', repo=''}={}){
  const hasUsb=!!navigator.usb;
  const relUrl= repo? normRepo(repo)+'/releases/latest' : '';
  const d=document.createElement('dialog'); d.className='flash';
  d.innerHTML=`<form method="dialog" class="modal"><div class="mhead"><span>Upload to device${name? ' · '+esc(name) : ''}</span><button class="tight" id="fClose">Close</button></div>
    <p class="hint" id="fSrc"></p>
    <select id="fPick" aria-label="Firmware file" hidden></select>
    <details id="fLocal"><summary>Use a file from this computer</summary><input type="file" accept=".bin,application/octet-stream" aria-label="Firmware .bin file"></details>
    <section class="notice" id="fAdvice" hidden aria-live="polite"></section>
    ${hasUsb? '<div class="flashgo"><button type="button" id="fBoot" hidden title="Writes the Daisy bootloader to internal flash">Install bootloader</button><button type="button" class="primary" id="fGo" disabled>Connect and flash</button><progress id="fBar" max="1" value="0" hidden></progress><span class="status" id="fStatus" aria-live="polite"></span></div>'
      : '<p class="hint flashwarn">This browser has no WebUSB, so it can\'t reach the Daisy. Open this page over HTTPS in Chrome or Edge to upload.</p>'}
    <p class="hint">On Windows the first upload can need the <a href="https://docs.daisy.audio/tutorials/zadig" target="_blank">WinUSB driver ↗</a>. If the upload fails, try the <a href="${DAISY_PROGRAMMER}" target="_blank">Daisy Web Programmer ↗</a>.</p></form>`;
  const q=s=>d.querySelector(s), src=q('#fSrc'), pick=q('#fPick'), local=q('#fLocal'), box=q('#fAdvice'), boot=q('#fBoot'), go=q('#fGo'), bar=q('#fBar'), status=q('#fStatus'), close=q('#fClose');
  const relLink= relUrl? ` <a href="${escAttr(relUrl)}" target="_blank">Releases ↗</a>` : '';
  let fw=null, busy=false, loads=0, bootFile=null;
  const done=new Set();   // ticked steps of this dialog: boot | enter | flash
  const mark=()=>box.querySelectorAll('li[data-step]').forEach(li=>li.classList.toggle('done',done.has(li.dataset.step)));
  const say=(t,bad,ok)=>{ if(status){ status.textContent=t; status.classList.toggle('err',!!bad); status.classList.toggle('ok',!!ok); } };
  const ready=()=>{ if(go){ go.disabled= busy || !fw || fw.kind==='unknown'; boot.disabled=busy; } };
  function show(bytes, label){
    const kind=firmwareKind(bytes), a=flashAdvice(kind), needsBoot= kind==='qspi' || kind==='sram';
    fw={bytes, kind, label};
    box.hidden=false; box.classList.toggle('warn',a.warn); box.innerHTML=a.html;
    done.delete('enter'); done.delete('flash'); mark();   // another file: only the bootloader stays done
    if(bar) bar.hidden=true;
    if(boot) boot.hidden=!needsBoot;
    // fetched now: requestDevice only works just after the click, so the click can't wait for a download
    if(needsBoot && hasUsb && !bootFile) bootFile=loadBootloader();
    say(''); ready();
  }
  /* fall back to a file from this computer, with the reason */
  function manual(html){ src.innerHTML=html; local.open=true; }
  async function pull(rel, a){
    const n=++loads; fw=null; box.hidden=true; if(boot) boot.hidden=true; ready();
    const label=`${rel.tag} · ${a.name}`;
    src.textContent=`Downloading ${label}…`;
    try{
      const bytes=await downloadFirmware(a);
      if(n!==loads) return;
      src.textContent=`Latest release: ${label} (${Math.round(bytes.byteLength/1024)} KB)`;
      show(bytes, a.name);
    }catch(err){ if(n===loads) manual(`The latest release could not be downloaded (${esc(err.message)}). Download the <code>.bin</code> from${relLink}, then choose it below.`); }
  }
  q('input[type=file]').onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    loads++;   // a download still running no longer counts
    src.textContent=f.name; show(await f.arrayBuffer(), f.name);
  };
  /* A step is ticked only when its write finished. clear: steps this action makes stale, ticked again by add on success. */
  async function run(write, doneText, clear, add){
    busy=true; ready(); close.disabled=true; bar.hidden=false; bar.value=0; say('Choose the DFU device in the list.');
    clear.forEach(s=>done.delete(s)); mark();
    try{
      await write(t=>say(t), (sent,total)=>{ if(total) bar.value=sent/total; });
      add.forEach(s=>done.add(s));
      say('✓ '+doneText(), false, true);
    }catch(err){
      if(err && err.name==='NotFoundError') say('');   // the list was closed without choosing
      else if(err && err.note){ done.add('boot'); done.add('enter'); say('✓ '+err.message, false, true); }
      else say(String(err && err.message || err), true);
    }
    bar.hidden=true; mark();
    busy=false; close.disabled=false; ready();
  }
  if(go){
    go.onclick=()=>run((step,prog)=>writeFirmware(fw.bytes, fw.kind, step, prog), ()=>`Flashed ${fw.label}. The Daisy restarts by itself. If it does not, press RESET.`, ['enter','flash'], ['boot','enter','flash']);
    boot.onclick=()=>run(async(step,prog)=>{
      const bytes=await bootFile;
      if(!bytes) throw new Error('The bootloader file could not be loaded. Reload this page and try again, or install it with the Daisy Web Programmer.');
      await writeFirmware(bytes, 'internal', step, prog, true);
    }, ()=>`Bootloader installed. ${fw? fw.label : 'The firmware'} is not uploaded yet: do step 2, then press Connect and flash. Until then, a firmware already in QSPI flash can still start.`, ['boot','enter','flash'], ['boot']);
  }
  d.addEventListener('cancel',e=>{ if(busy) e.preventDefault(); });
  d.onclose=()=>d.remove();
  document.body.append(d); d.showModal();

  (async()=>{
    if(!repo) return manual('Choose the firmware\'s <code>.bin</code> below.');
    if(!FIRMWARE_PROXY) return manual(`Download the <code>.bin</code> from${relLink}, then choose it below.`);
    src.textContent='Reading the latest release…';
    let rel=null;
    try{ rel=await latestRelease(repo); }
    catch(err){ return manual(`The release list could not be read (${esc(err.message)}). Download the <code>.bin</code> from${relLink}, then choose it below.`); }
    if(!rel) return manual('This repository has no release. Choose a <code>.bin</code> below.');
    if(!rel.assets.length) return manual(`The latest release has no <code>.bin</code> file.${relLink} Choose one below.`);
    if(rel.assets.length>1){
      pick.replaceChildren(...rel.assets.map((a,i)=>new Option(a.name,i)));
      pick.hidden=false; pick.onchange=()=>pull(rel, rel.assets[+pick.value]);
    }
    pull(rel, rel.assets[0]);
  })();
}
