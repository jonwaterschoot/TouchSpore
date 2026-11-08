# Roadmap

Settings that survive a reboot, an optional OLED, a two-way MIDI link to the web manual, and a listing in the Simple Touch library and the Synthux community directory. Updated 2026-11-08.

Related repos: [simple-touch-labels](https://github.com/jonwaterschoot/simple-touch-labels) (library, designer, player), [simple-touch-web](https://github.com/jonwaterschoot/simple-touch-web) (firmware in the browser), [TouchVink](https://github.com/jonwaterschoot/TouchVink) (OLED, SysEx telemetry and its own web manual, the reference for this work).

## Budget

### Flash (measured 2026-11-08)

Built with the Daisy Toolchain against the pinned libDaisy (text + data of the release build).

| Build | Flash used | Free of 131,072 B |
|---|---|---|
| Before Phase 0 | 118,736 B | 12,336 B |
| Phase 0 (SPI stub + `-Os` on control code) | 108,596 B | 22,476 B |
| + MPR121 repeated-start fix | 107,868 B | 23,204 B |
| + OLED: DMA driver, Font_6x8, screen | 120,308 B | 10,764 B |
| + hidden volume, compressor change | 120,972 B | 10,100 B |
| + boot animation | 121,516 B | 9,556 B |
| + settings storage, scale and root gestures | 125,852 B | 5,220 B |
| + MIDI notes and knobs in, web manual link | 126,868 B | 4,204 B |
| + `Setup()` / `Loop()` split (today) | 126,876 B | 4,196 B |

The OLED added 12,440 B, more than the 5,096 B estimated from TouchVink's blocking driver. About 7 KB of it is libDaisy's interrupt-driven I2C HAL, which any I2C DMA transfer links in full (slave modes included). Font_6x8 is 1.5 KB, our driver and screen about 2.5 KB.

Settings storage and the scale and root gestures added 4,336 B. The MIDI link added 1,016 B (estimated 1.7–2.7 KB): libDaisy's parser and SysEx packing were already linked.

If it gets too tight:

- **I2C DMA by register (~6 KB back, estimated).** Drive DMA1 and I2C1 for the OLED directly and poll for completion in `Oled::WaitIdle()`. The HAL's I2C interrupt code then drops out of the link. The MPR121 keeps the blocking HAL calls.
- **`BOOT_SRAM`.** See below.

Where the savings come from:

- **SPI stub (−8,052 B).** libDaisy's `System::Init()` calls `dsy_spi_global_init()`, which links all of the SPI HAL. TouchSpore uses no SPI. An empty `extern "C" void dsy_spi_global_init() {}` in our own sources replaces the library's, and the linker then drops `spi.o`. UART can't be dropped the same way: libDaisy's logger needs `uart.o` (multiple definition error).
- **`-Os` on control code (−2,112 B).** TouchVink's trick: `OPT = -Os` per object for UI, touch, sequencer and main. `engine.cpp` and `fx.cpp` (the audio callback) stay at `-O2`.

Fallback if it still doesn't fit: `APP_TYPE = BOOT_SRAM` (code runs from 480 KB of SRAM). It needs the Daisy bootloader flashed first, and its linker script puts `.bss` in the 128 KB DTCM, so the engine's 418 KB (mostly `ReverbSc`) would have to move to SDRAM. Expect a CPU cost for the reverb. Only if needed.

### RAM

SRAM is 92.5 % used (485 KB of 512 KB), almost all of it `spore::Engine` (418 KB). The OLED adds about 1 KB (frame buffer + dirty-page shadow), storage and telemetry under 200 B. SDRAM holds the delay lines (750 KB of 64 MB).

### CPU

Measured 2026-11-08 (`make DEBUG=1`, serial log every 2 s):

| State | Audio avg | Audio max | Longest main-loop pass |
|---|---|---|---|
| Idle, autoplay off | 22 % | 23 % | 1.0 ms |
| Autoplay on, not touched | 42 % | 43 % | 1.6 ms |
| Playing, autoplay on | 49–63 % | 52–69 % | 1.3–2.7 ms |

Everything planned here runs in the main loop, and the audio callback gets no new work.

Main-loop timing does change, and several timings count loop passes (tap < 150 passes, recalibrate 625 passes, ~250 Hz):

- **OLED.** One 128-byte page takes ~3.3 ms of bus time at 400 kHz, and a blocking transfer stretches with the audio load (the audio interrupt preempts it). With passes up to 2.7 ms, a full page per pass overruns the 4 ms period. So `Oled::Service()` starts one changed 64-column half page (~1.7 ms) by I2C DMA right after the touch read, and the transfer runs during the rest of the pass and the wait. The next touch read waits for it (`Oled::WaitIdle()`).
- **Settings save.** `PersistentStorage::Save()` erases a 4 KB QSPI sector (45 ms typical, 300 ms max) and blocks the main loop for that time. Audio keeps running (code runs from internal flash), but pads and knobs pause. Save only when a volume or scale gesture ends.
- **USB SysEx.** With no app reading the port, every failed TX burns ~100 µs (see `tx_retry_count` in `ui/spore_ui.cpp`). Stream telemetry only after the page has asked for it.

### OLED and touch sensing

On the bus there's no conflict: the SSD1306 sits on I2C1 at 0x3C next to the MPR121 at 0x5A, and both run from the main loop, so transfers take turns. Two code points:

- `OledScreen::Init()` must set 400 kHz. libDaisy's driver default is 1 MHz, which the MPR121 is not rated for. `Field` re-inits I2C1 at 400 kHz when reads fail, so the bus stays at 400 kHz after a recovery too.
- Probe 0x3C once at boot. With no screen fitted, skip all OLED work instead of sending NACKed transfers every pass.

Tested 2026-11-08 (step 3.6): no extra flickers. The SSD1306 runs a charge pump, and its supply current follows the number of lit pixels. With S37 low (firm touch, 40 counts) that won't matter. With S37 at the top the threshold drops below the pads' own noise, so extra rail noise would become flickers.

## Phase 0: room and a CPU number

- [x] 0.1 SPI stub in `common/spi_stub.cpp`. Flash 108,596 B (−10,140 B with 0.2), `spi.o` no longer linked.
- [x] 0.1b Hardware check for 0.1, 0.2 and 0.4: boots, audio, USB MIDI, pads, knobs, tap and recalibrate timing.
- [x] 0.2 `-Os` for `TouchSpore.o`, `spore_ui.o`, `field.o`, `knobs.o`, `switches.o`, `sequencer.o` in the Makefile. Listen for changes in the sequencer timing (it runs in the audio callback through `Engine::_Step`, so move it back to `-O2` if the load rises).
- [x] 0.3 Measure audio CPU (see CPU above). The log found the MPR121 being re-configured every second (fixed, see `Field::_ReadBurst`): `cpu.GetAvgCpuLoad()` / `GetMaxCpuLoad()` under the worst case (6 plinks, 4 pads, reverb/delay/chorus up, SW2 up, S37 at the top with clips). Log it over USB serial in a `DEBUG = 1` build and note it here.
- [x] 0.4 Fixed 4 ms loop period: wait until the next 4 ms tick instead of `System::Delay(4)` after the work, so OLED pages and saves don't stretch the pass-counted timings.
- [x] 0.5 Update the README's flash line.

## Phase 1: remember scale, root and volume

Scale and root come from the panel gestures or MIDI (CC 20, CC 21, Program Change, Note On ch 16). Volume, root and scale load from QSPI at boot.

- [x] 1.1 `Settings { version, root, scale, volume }` in `PersistentStorage` at QSPI offset 0x7F0000 (`ui/spore_settings.*`). Loaded before `engine.Init()`. Blank, foreign or out-of-range data loads as defaults.
- [x] 1.1b Hardware check (2026-11-08): values survive a power cycle, flicker after a save, audio doesn't drop during a save, A → B → A on the scale ends on A after a reboot. A saved quiet volume doesn't start loud, P02–P09 and P00 pick only with P10 + P11 held, holding P10 + P11 with hands near the pads picks nothing by itself, P00 taps step the root with a plink and a 0.6 s press gives C. Root and scale sent over MIDI survive a reboot.
- [x] 1.2 `Engine::Root()` / `Engine::Scale()` getters (the values in effect, after `_pending_*` is applied in the audio callback).
- [x] 1.3 Save when a volume, scale or root gesture ends, from the main loop (decided 2026-11-08: they are deliberate and happen outside playing). Root and scale sent over MIDI save 5 s after the last change (the web manual will set them this way). LED: fast flicker for 0.5 s when saved. libDaisy skips the cache invalidate for apps in internal flash, so `SettingsStore::Save` does it before each write.
- [x] 1.4 P10/P11 routing doesn't persist (decided 2026-11-08). Volume, scale and root do.
- [x] 1.5 `#ifndef SIMPLE_TOUCH_WEB` around storage: the browser board has no QSPI (see Phase 4).
- [x] 1.6 Panel gestures, with P10 + P11 held (fixed firm threshold, field notes muted). P02–P09: scale 0–7, one LED blink per pad position. P00: tap = root up a semitone, 0.6 s press = C, each change played on a plink. P01 stays free (hard to reach). Open until 2 s after the last pick with P10/P11 let go.
- [x] 1.7 README: volume, scale and root are saved, the gestures (P02 is natural minor, P00 taps reach D).

## Phase 2: MIDI link (read and write)

A connected device plays notes and sets knobs. The page sets root and scale, and reads root, scale, knobs, pads and switches. All of it runs at once on the one USB port.

| | In | Out (USB only unless noted) |
|---|---|---|
| Note On | Ch 1–15: plays that note on a plink. Ch 16: root | Generated notes: plinks ch 1, pads ch 2 (USB and TRS) |
| CC 20 | Root 0–11, any channel | Ch 16: root in effect |
| CC 21 | Scale 0–7, any channel | Ch 16: scale in effect |
| CC 22–29 | S30–S37, any channel, until the knob is moved | |
| Shared live frame | | `F0 7D 53 54 01 <SW1> <SW2> <pads lo7> <pads hi5> F7`, the "live labels" frame on the labels roadmap. Switches: 0 up, 1 centre, 2 down |
| TouchSpore frame | REQUEST `F0 7D 53 50 01 7E F7` | STATE `F0 7D 53 50 01 01 <S30–S37> <root> <scale> <routing> F7` ("SP"). Knobs 0–127, routing bit 0 = pads, bit 1 = plinks |

The CC echo goes out on every change, from any source, and lets the library read and write settings with no TouchSpore-specific code. The frames are for the mirror. They run for 10 s after each REQUEST (the page re-sends it every 3 s), at most every 33 ms per frame type. A REQUEST and the 500 ms heartbeat re-send the CCs and both frames. Knob values in STATE are the values in effect, so a knob held by MIDI reports the MIDI value. Pads report firm touches, independent of S37.

The firmware makes one telemetry send per pass and skips passes that sent notes, because the USB endpoint holds one transfer at a time and `SendMessage` can't report a drop.

- [ ] 2.1 Write the shared live frame spec with the labels repo (its roadmap lists it under "The shared standard", unwritten). The firmware sends the format in the table.
- [x] 2.2 Telemetry in `SporeUI::_SendLink`.
- [x] 2.3 CC echo on ch 16 for root and scale, whatever changed them (MIDI or panel gesture). Not at boot: no port is open yet, and the page asks with REQUEST.
- [x] 2.4 Routing over MIDI dropped (decided 2026-11-08): routing is a live panel toggle and isn't saved. STATE still reports it.
- [x] 2.5 Pads and knobs reach the page by SysEx only (decided 2026-11-08). MIDI out stays generated notes.
- [x] 2.6 README MIDI section: the full map, in and out.
- [x] 2.7 MIDI in: notes on ch 1–15 play plinks at their own pitch, and are not sent back out. CC 22–29 set S30–S37 until the knob moves past 2 %. CC 123 fixed (libDaisy delivers CC 120–127 as `ChannelMode`).
- [x] 2.8 Hardware check (2026-11-08): MIDI in and out work on the device, values come through, and changes survive a reboot.

## Phase 3: OLED (optional hardware)

128×32 SSD1306 on I2C1, D11 (SCL) / D12 (SDA), address 0x3C, as on TouchVink and TouchPlaited. Without a screen fitted nothing changes.

- [x] 3.1 Own driver instead of TouchVink's (`display/oled.*`): Font_6x8 only, dirty half pages by I2C DMA (see Main-loop timing).
- [x] 3.2 Probe 0x3C at boot, 400 kHz from `Field`. One half page per pass.
- [x] 3.3a One screen, Font_6x8 only (decided 2026-11-08). Row 0: last touched control and its value. Row 1: root and scale. Rows 2–3: one column per scale note (5 or 7), PL row flashes each plink note, PD row shows the chord tones. Right of the grid: last plink note, current chord. Note names use `#` (`C#`, `C#4`): Font_6x8 is ASCII only.
- [x] 3.3b Boot: `TOUCHSPORE` overgrown by branching hyphae (~1 s), held on screen while Field learns baselines, so the pads calibrate with the screen running.
- [x] 3.3 Screens, all from the same state struct as the telemetry (TouchVink does the same, so the screen and the page can't disagree):
  - boot: name and version
  - touched control: name + value in units (reverb %, delay %, highest note D5/D6/D7, sensitivity %)
  - scale and root on change, then "SAVED"
  - P10+P11 hold: progress bar to recalibrate, then "SMOOTH" or "RAW" (the LED blink codes stay)
  - P10/P11 tap: routing on/off
  - idle: scale, chord, an intensity bar
- [x] 3.4 Measure flash after each screen. Stop adding when free flash drops below 3 KB.
- [x] 3.5 The watchdog's freeze code stays LED-only: it runs in the audio callback and must not touch I2C.
- [x] 3.6 Touch test on hardware, S37 at the top (2026-11-08): no extra flickers or jitter with the screen fitted, static or redrawing, and no visible tearing. Tested with wires held onto the pads. Clips only fit the edge pads; for the others, tiny wires in the PCB pad holes. Retest with clips attached that way. If the screen adds flickers then: lower the contrast, turn the screen off after 30 s idle, recalibrate with the screen fitted.
- [x] 3.7 README: wiring, what each screen shows.

The browser build needs no OLED code of its own: simple-touch-web emulates the SSD1306 at register level and draws what the firmware sends. TouchVink's own web manual re-draws the screens in TypeScript (`oled-mini.ts`); that is not needed here.

## Phase 4: library and directory

The route from [guide.html](https://jonwaterschoot.github.io/simple-touch-labels/guide.html). Do this before Phase 5: the browser build lets the library test the MIDI link without hardware.

- [x] 4.1a MIT LICENSE, README License section with the DaisySP-LGPL note.
- [ ] 4.1b TouchString has no license file (nor do TouchBloop, TouchBass and TouchFX). Synthux uses MIT on AudreyTouch, Audrey II and Spotykach. Issue on TouchString asking for one. Once it is MIT, drop the TouchString exclusion from the README's License section.
- [x] 4.1c Make the repo public (2026-11-08).
- [x] 4.2 `make release VERSION=x.y.z` → `build/touchspore-vX.Y.Z.bin` (lowercase, versioned, as the directory asks). Release steps in the README, changes in [CHANGELOG.md](../CHANGELOG.md).
- [x] 4.3 First GitHub release (0.1.0, 2026-11-08).
- [x] 4.4 Directory entry from the designer (Firmware tab › Directory entry…), pull request to the community directory ([#10](https://github.com/Synthux-Academy/community-instruments/pull/10), in review).
- [ ] 4.5 Labels in the designer: every control, P10/P11 as modifiers, MIDI column (CC 20, 21, 22–29, 123, Program Change, notes), notes. Modes for SW2 if the labels differ per position. Repository kit → `simple-touch-labels.json` at the root, control map in `docs/`. The label file is written by hand. Open: check it in the designer (the P10 + P11 gestures are labelled under both modifiers, the format has no two-pad modifier), export the control map.
- [x] 4.6 `Setup()` / `Loop()` split with `ST_WEB_FIRMWARE(Setup, Loop)`. Keep storage, the SPI stub and `touch/syscalls.cpp` out of the browser build. The browser `Loop()` ends in `System::Delay(4)`: its clock advances only between passes, so the 4 ms spin would never end. ARM and wasm builds compile. Hardware check passed (2026-11-08). The browser build arms recalibrate after 10 s instead of 2.5 s, because reaching a third control with a mouse takes longer and an armed recalibration refuses the gestures.
- [x] 4.7 `node ../simple-touch-web/scripts/build.mjs ../TouchSpore`, then the smoke test (2026-11-08: 105 KB, boots, all 12 pads, OLED, MIDI out). Check the SDRAM delay lines and the `CpuLoadMeter` watchdog on the board.
- [x] 4.8 `.github/workflows/browser-build.yml` (simple-touch-web `@v1`). First run green (2026-11-08). A Windows build's hash differs from CI's: only the compiler version string in the `producers` section changes.
- [x] 4.9 Listen on the test bench, then approve the build (designer › Find builds › Use this build, `"oled": true` once Phase 3 ships). Approved 2026-11-08: `TouchSpore-5f3bb1a151d6.wasm`, gestures tested on the bench.

Known gap in the browser: the board's MPR121 is noise-free, with a fixed baseline of 720 and the proximity electrode at baseline. Strikes work. Flickers, the aura and the top half of S37 do nothing, because they live on noise. See 5.6.

## Phase 5: device link in the library (simple-touch-labels, simple-touch-web)

The library player today connects Web MIDI ports to the *browser build* (`play.js`: `midiFromPort` → `st.sendMidi`). It can't mirror or configure a *hardware* device. TouchVink's own web manual can, but only for TouchVink. The aim is a generic device link that any firmware gets by declaring it in its label file.

Original proposal for the `device` block in `simple-touch-labels.json`. The format that shipped is in [simple-touch-web's README](https://github.com/jonwaterschoot/simple-touch-web#settings-and-presets): `live` waits for 5.2b, each setting names a `widget`, and `presets` are added.

```json
"device": {
  "port": "TouchSpore",
  "live": "simple-touch-live/1",
  "settings": [
    { "id": "root",  "label": "Root",  "cc": 20, "channel": 16,
      "options": ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] },
    { "id": "scale", "label": "Scale", "cc": 21, "channel": 16,
      "options": ["Natural minor", "Dorian", "Minor pentatonic", "Phrygian",
                  "Major", "Lydian", "Major pentatonic", "Harmonic minor"] }
  ]
}
```

A setting writes by sending its CC and shows the value the device echoes back, so the device stays the one source of truth. The same code drives the browser build (`st.sendMidi`, `st.on('midi')`) and hardware (Web MIDI ports).

simple-touch-labels:

- [ ] 5.1 Spec: `device` (port name, live frame version, settings with `cc`, `channel`, `options` / `range` / `type`) in the label format spec, with a JSON Schema entry.
- [x] 5.2 Player and test bench: a source switch, Browser build ↔ Device. Device runs no firmware in the page, picks the Web MIDI in/out ports whose name contains `device.port`, sends REQUEST, and the panel reads and writes only the board. In Browser build mode one device cannot be both MIDI in and MIDI out.
- [ ] 5.2b Player: the drawing follows the live frame in Device mode (pads lit, levers, mode labels follow SW1/SW2).
- [x] 5.3 Player and test bench: a panel built from `device` by simple-touch-web's `web/device-panel.js`: `buttons` send on click, `select` has a Send button, `presets` send several messages. Nothing is highlighted until the first report. Ranges and toggles later.
- [ ] 5.4 Designer: edit `device.settings` in the Firmware tab, and fill it from the MIDI column where possible.
- [ ] 5.5 Later: firmware-specific readouts (intensity, chord, CPU) declared by byte offset in the firmware's own SysEx frame.

simple-touch-web:

- [x] 5.5b USB MIDI into the browser build: `MidiUsbTransport::RxActive()` always returned true, so `Listen()` never started receiving and MIDI in was dropped. Fixed in the board. Needs the `v1` tag moved before CI picks it up.
- [ ] 5.6 MPR121 noise model: per-electrode jitter and slow drift, and electrode 13 as the sum of all pads, so flickers and the aura run in the browser. Off by default, so existing builds keep their hashes and sound.
- [ ] 5.7 `PersistentStorage` backed by `localStorage` (already "Later" on the labels roadmap). Then TouchSpore's browser build remembers its scale too, and the `#ifndef` from 1.5 can go.

## Open questions

- Does the OLED add flickers at the top of S37 with clips attached? Not with held wires (3.6).
- Is one font enough for the screens, or does the value row need Font_11x18 (+3.4 KB)?
- Who keeps the `device` and live frame spec: this repo, simple-touch-labels or simple-touch-web? The labels roadmap is still waiting on Synthux about the shared label format.
