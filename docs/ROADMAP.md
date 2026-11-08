# Roadmap

Settings that survive a reboot, an optional OLED, a two-way MIDI link to the web manual, and a listing in the Simple Touch library and the Synthux community directory. Updated 2026-11-08.

Related repos: [simple-touch-labels](https://github.com/jonwaterschoot/simple-touch-labels) (library, designer, player), [simple-touch-web](https://github.com/jonwaterschoot/simple-touch-web) (firmware in the browser), [TouchVink](https://github.com/jonwaterschoot/TouchVink) (OLED, SysEx telemetry and its own web manual, the reference for this work).

## Budget

### Flash (measured 2026-11-08)

Built with the Daisy Toolchain against the pinned libDaisy. The OLED rows link TouchVink's `display/oled_screen.cpp` and its dirty-page driver unchanged, apart from the font swap in the 1-font row.

| Build | Flash used | Free of 131,072 B |
|---|---|---|
| Today | 118,736 B | 12,336 B |
| Phase 0 savings (SPI stub + `-Os` on control code) | 108,604 B | 22,468 B |
| + settings storage (`PersistentStorage`) | +3,208 B | |
| + OLED, Font_6x8 only | +5,096 B | |
| + OLED, 3 fonts as TouchVink (6x8, 7x10, 11x18) | +10,472 B | |
| + telemetry frame (stub) | +~200 B | |
| Phase 0 + storage + OLED 1 font + telemetry stub | 117,084 B | 13,988 B |
| Phase 0 + storage + OLED 3 fonts + telemetry stub | 122,460 B | 8,612 B |

Not in those numbers yet: the OLED screens themselves (TouchVink's `oled_ui.cpp` + boot animation, estimated 4–7 KB) and the full SysEx parser and settings echo (estimated 1.5–2.5 KB). Expected end state with one font: 121–124 KB, so 4–7 KB free. With TouchVink's three fonts it would leave 0–4 KB, which is too tight.

Without Phase 0 the OLED does not fit at all (133,328 B, 1.7 % over).

Where the savings come from:

- **SPI stub (−8,052 B).** libDaisy's `System::Init()` calls `dsy_spi_global_init()`, which links all of the SPI HAL. TouchSpore uses no SPI. An empty `extern "C" void dsy_spi_global_init() {}` in our own sources replaces the library's, and the linker then drops `spi.o`. UART can't be dropped the same way: libDaisy's logger needs `uart.o` (multiple definition error).
- **`-Os` on control code (−2,112 B).** TouchVink's trick: `OPT = -Os` per object for UI, touch, sequencer and main. `engine.cpp` and `fx.cpp` (the audio callback) stay at `-O2`.

Fallback if it still doesn't fit: `APP_TYPE = BOOT_SRAM` (code runs from 480 KB of SRAM). It needs the Daisy bootloader flashed first, and its linker script puts `.bss` in the 128 KB DTCM, so the engine's 418 KB (mostly `ReverbSc`) would have to move to SDRAM. Expect a CPU cost for the reverb. Only if needed.

### RAM

SRAM is 92.5 % used (485 KB of 512 KB), almost all of it `spore::Engine` (418 KB). The OLED adds about 1 KB (frame buffer + dirty-page shadow), storage and telemetry under 200 B. SDRAM holds the delay lines (750 KB of 64 MB).

### CPU

Not measured on hardware yet. Everything planned here runs in the main loop, and the audio callback gets no new work. Step 0.3 measures the audio load so later DSP has a number to plan against.

Main-loop timing does change, and several timings count loop passes (tap < 150 passes, recalibrate 360 passes, ~250 Hz):

- **OLED.** One 128-byte page takes ~3 ms at 400 kHz, so a full 4-page redraw takes ~12 ms. The dirty-page driver only sends pages that changed. Cap it at one page per pass and 20 frames/s.
- **Settings save.** `PersistentStorage::Save()` erases a 4 KB QSPI sector (45 ms typical, 300 ms max) and blocks the main loop for that time. Audio keeps running (code runs from internal flash), but pads and knobs pause. Save 5 s after the last change, never on every change.
- **USB SysEx.** With no app reading the port, every failed TX burns ~100 µs (see `tx_retry_count` in `ui/spore_ui.cpp`). Stream telemetry only after the page has asked for it.

### OLED and touch sensing

On the bus there's no conflict: the SSD1306 sits on I2C1 at 0x3C next to the MPR121 at 0x5A, and both run from the main loop, so transfers take turns. Two code points:

- `OledScreen::Init()` must set 400 kHz. libDaisy's driver default is 1 MHz, which the MPR121 is not rated for. `Field` re-inits I2C1 at 400 kHz when reads fail, so the bus stays at 400 kHz after a recovery too.
- Probe 0x3C once at boot. With no screen fitted, skip all OLED work instead of sending NACKed transfers every pass.

Electrically it is untested. The SSD1306 runs a charge pump, and its supply current follows the number of lit pixels. With S37 low (firm touch, 40 counts) that won't matter. With S37 at the top the threshold drops below the pads' own noise, so extra rail noise becomes flickers. Test in step 3.6.

## Phase 0: room and a CPU number

- [ ] 0.1 SPI stub in `common/` with a comment saying why. Hardware check: boots, audio, USB MIDI, pads, knobs.
- [ ] 0.2 `-Os` for `TouchSpore.o`, `spore_ui.o`, `field.o`, `knobs.o`, `switches.o`, `sequencer.o` in the Makefile. Listen for changes in the sequencer timing (it runs in the audio callback through `Engine::_Step`, so move it back to `-O2` if the load rises).
- [ ] 0.3 Measure audio CPU: `cpu.GetAvgCpuLoad()` / `GetMaxCpuLoad()` under the worst case (6 plinks, 4 pads, reverb/delay/chorus up, SW2 up, S37 at the top with clips). Log it over USB serial in a `DEBUG = 1` build and note it here.
- [ ] 0.4 Fixed 4 ms loop period: wait until the next 4 ms tick instead of `System::Delay(4)` after the work, so OLED pages and saves don't stretch the pass-counted timings.
- [ ] 0.5 Update the README's flash line.

## Phase 1: remember scale and root

Today root and scale come only from MIDI (CC 20, CC 21, Program Change, Note On ch 16) and reset to D natural minor on every boot (`engine/scale.h` defaults).

- [ ] 1.1 `Settings { version, root, scale, to_pads, to_plinks }` in `PersistentStorage` at a fixed QSPI offset well above 0 (the Daisy bootloader keeps apps at 0x90040000). Load before `engine.Init()`.
- [ ] 1.2 `Engine::Root()` / `Engine::Scale()` getters (the values in effect, after `_pending_*` is applied in the audio callback).
- [ ] 1.3 Save 5 s after the last change, from the main loop. LED: 1 long blink when saved.
- [ ] 1.4 Decide whether P10/P11 routing persists too, or only root and scale.
- [ ] 1.5 `#ifndef SIMPLE_TOUCH_WEB` around storage: the browser board has no QSPI (see Phase 4).
- [ ] 1.6 Optional: a panel gesture for the scale, so a MIDI host isn't needed. For example, hold P10 and strike P00–P07 for scale 0–7. Conflicts with the P10 strike routing, so design it once the OLED can show the choice.
- [ ] 1.7 README: scale and root are saved, how to reset to D minor.

## Phase 2: MIDI link (read and write)

The firmware side of the web manual link. TouchVink's `midi/telemetry.*` is the template: full-state frames, rate-limited, with a heartbeat and a REQUEST from the page.

Proposed protocol, channel 16 as the control channel (it already sets the root by Note On):

| | In (page → device) | Out (device → page) |
|---|---|---|
| CC 20 ch 16 | Root 0–11 (as today, any channel) | Root in effect, on change and after REQUEST |
| CC 21 ch 16 | Scale 0–7 (as today, any channel) | Scale in effect, on change and after REQUEST |
| CC 24 / 25 ch 16 | P10 / P11 routing on (≥ 64) or off | Routing in effect |
| Shared live frame | | `F0 7D 53 54 01 <SW1> <SW2> <pads lo7> <pads hi5> F7`, the "live labels" frame on the labels roadmap |
| TouchSpore frame | REQUEST `F0 7D 53 50 01 7E F7` | STATE `F0 7D 53 50 01 01 …` ("SP"): S30–S37, root, scale, routing, intensity, aura, chord root, AFE profile, CPU avg/max, saved flag |

The CC echo lets the library read and write settings with no TouchSpore-specific code. The SysEx frames are for the mirror (pads, switches, knobs) and for readouts.

- [ ] 2.1 Write the shared live frame spec with the labels repo (its roadmap lists it under "The shared standard", unwritten). TouchSpore becomes its first sender after TouchPlaited, or the first if it ships first.
- [ ] 2.2 Telemetry module: STATE on change at most every 33 ms, heartbeat every 500 ms, only for 10 s after the last REQUEST (the page re-sends REQUEST every 3 s).
- [ ] 2.3 CC echo on ch 16 for root, scale and routing, whatever changed them (MIDI, panel gesture, boot load).
- [ ] 2.4 CC 24/25 handlers for routing.
- [ ] 2.5 Pads and knob moves as MIDI out, as TouchVink does (ch 10 notes 36–47, CC 22–29 for S30–S37)? Decide: TouchSpore already sends plinks on ch 1 and pads on ch 2.
- [ ] 2.6 README MIDI section: the full map, in and out.

## Phase 3: OLED (optional hardware)

128×32 SSD1306 on I2C1, D11 (SCL) / D12 (SDA), address 0x3C, as on TouchVink and TouchPlaited. Without a screen fitted nothing changes.

- [ ] 3.1 Port TouchVink's `display/oled_screen.*` and `oled_dirty_driver.h`. Start with Font_6x8 only. Add a larger font only if the budget allows after 3.3.
- [ ] 3.2 Probe 0x3C at boot. Init at 400 kHz. One page per pass, 20 frames/s max.
- [ ] 3.3 Screens, all from the same state struct as the telemetry (TouchVink does the same, so the screen and the page can't disagree):
  - boot: name and version
  - touched control: name + value in units (reverb %, delay %, highest note D5/D6/D7, sensitivity %)
  - scale and root on change, then "SAVED"
  - P10+P11 hold: progress bar to recalibrate, then "SMOOTH" or "RAW" (the LED blink codes stay)
  - P10/P11 tap: routing on/off
  - idle: scale, chord, an intensity bar
- [ ] 3.4 Measure flash after each screen. Stop adding when free flash drops below 3 KB.
- [ ] 3.5 The watchdog's freeze code stays LED-only: it runs in the audio callback and must not touch I2C.
- [ ] 3.6 Touch test on hardware, S37 at the top with clips: flicker rate with no screen, with the screen fitted and static, and while it redraws. If the screen adds flickers: lower the contrast, turn the screen off after 30 s idle, recalibrate with the screen fitted.
- [ ] 3.7 README: wiring, what each screen shows.

The browser build needs no OLED code of its own: simple-touch-web emulates the SSD1306 at register level and draws what the firmware sends. TouchVink's own web manual re-draws the screens in TypeScript (`oled-mini.ts`); that is not needed here.

## Phase 4: library and directory

The route from [guide.html](https://jonwaterschoot.github.io/simple-touch-labels/guide.html). Do this before Phase 5: the browser build lets the library test the MIDI link without hardware.

- [ ] 4.1 Make the repo public. Add a LICENSE (check TouchString's licence for the files credited from it). Note DaisySP-LGPL (`ReverbSc`) in the README as TouchVink does.
- [ ] 4.2 `make release VERSION=x.y.z` → `build/touchspore-vX.Y.Z.bin` (lowercase, versioned, as the directory asks). First GitHub release.
- [ ] 4.3 Directory entry from the designer (Firmware tab › Directory entry…), pull request to the community directory.
- [ ] 4.4 Labels in the designer: every control, P10/P11 as modifiers, MIDI column (CC 20, 21, 24, 25, 123, Program Change), notes. Modes for SW2 if the labels differ per position. Repository kit → `simple-touch-labels.json` at the root, control map in `docs/`.
- [ ] 4.5 `Setup()` / `Loop()` split with `ST_WEB_FIRMWARE(Setup, Loop)`. Keep storage and the SPI stub out of the browser build. Hardware check after.
- [ ] 4.6 `node ../simple-touch-web/scripts/build.mjs ../TouchSpore`, then the smoke test. Check the SDRAM delay lines and the `CpuLoadMeter` watchdog on the board.
- [ ] 4.7 `.github/workflows/browser-build.yml` (simple-touch-web `@v1`).
- [ ] 4.8 Listen on the test bench, then approve the build (designer › Find builds › Use this build, `"oled": true` once Phase 3 ships).

Known gap in the browser: the board's MPR121 is noise-free, with a fixed baseline of 720 and the proximity electrode at baseline. Strikes work. Flickers, the aura and the top half of S37 do nothing, because they live on noise. See 5.6.

## Phase 5: device link in the library (simple-touch-labels, simple-touch-web)

The library player today connects Web MIDI ports to the *browser build* (`play.js`: `midiFromPort` → `st.sendMidi`). It can't mirror or configure a *hardware* device. TouchVink's own web manual can, but only for TouchVink. The aim is a generic device link that any firmware gets by declaring it in its label file.

Proposed `device` block in `simple-touch-labels.json`:

```json
"device": {
  "port": "TouchSpore",
  "live": "simple-touch-live/1",
  "settings": [
    { "id": "root",  "label": "Root",  "cc": 20, "channel": 16,
      "options": ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] },
    { "id": "scale", "label": "Scale", "cc": 21, "channel": 16,
      "options": ["Natural minor", "Dorian", "Minor pentatonic", "Phrygian",
                  "Major", "Lydian", "Major pentatonic", "Harmonic minor"] },
    { "id": "to_pads",   "label": "Field → pads",   "cc": 24, "channel": 16, "type": "toggle" },
    { "id": "to_plinks", "label": "Field → plinks", "cc": 25, "channel": 16, "type": "toggle" }
  ]
}
```

A setting writes by sending its CC and shows the value the device echoes back, so the device stays the one source of truth. The same code drives the browser build (`st.sendMidi`, `st.on('midi')`) and hardware (Web MIDI ports).

simple-touch-labels:

- [ ] 5.1 Spec: `device` (port name, live frame version, settings with `cc`, `channel`, `options` / `range` / `type`) in the label format spec, with a JSON Schema entry.
- [ ] 5.2 Player: a source switch, Browser build ↔ Device. Device picks the Web MIDI in/out ports whose name contains `device.port`, sends REQUEST, and drives the panel from the live frame (pads lit, levers, mode labels follow SW1/SW2).
- [ ] 5.3 Player: a Settings panel built from `device.settings` (dropdowns, toggles, ranges). Greyed out until the first echo arrives. Shown for both sources.
- [ ] 5.4 Designer: edit `device.settings` in the Firmware tab, and fill it from the MIDI column where possible.
- [ ] 5.5 Later: firmware-specific readouts (intensity, chord, CPU) declared by byte offset in the firmware's own SysEx frame.

simple-touch-web:

- [ ] 5.6 MPR121 noise model: per-electrode jitter and slow drift, and electrode 13 as the sum of all pads, so flickers and the aura run in the browser. Off by default, so existing builds keep their hashes and sound.
- [ ] 5.7 `PersistentStorage` backed by `localStorage` (already "Later" on the labels roadmap). Then TouchSpore's browser build remembers its scale too, and the `#ifndef` from 1.5 can go.

## Open questions

- Does the OLED add flickers at the top of S37? (3.6)
- Is one font enough for the screens, or does the value row need Font_11x18 (+3.4 KB)?
- Which settings persist: root and scale only, or routing too? (1.4)
- Panel gesture for the scale, or MIDI and the web page only? (1.6)
- Pads and knobs as MIDI out, or keep MIDI out to the generated notes? (2.5)
- Who keeps the `device` and live frame spec: this repo, simple-touch-labels or simple-touch-web? The labels roadmap is still waiting on Synthux about the shared label format.
