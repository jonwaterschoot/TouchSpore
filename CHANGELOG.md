# Changelog

## Unreleased

### Added

- Added pad touches over USB MIDI: a web page can press pads as a finger would, including the P10/P11 gestures. Pads let go 2 s after the last message.
- Added the OLED over USB MIDI while a page is connected, with or without a screen fitted.
- Added pad hits over USB MIDI: plinks from strikes, flickers and autoplay light the pads on a connected page, by velocity. The pad chords don't.

## 0.1.0 (2026-11-08)

First release.

### Added

- Added the sensing field: P00–P09 play notes of the scale (default D natural minor). S37 sets sensitivity from firm touch to a hand 1–2 cm away.
- Added flicker events in the upper half of S37: pad noise from plants, clips and wires suggests notes on a 60 BPM sixteenth grid.
- Added autoplay on SW2 centre, and per-note variation on SW2 up (random octave, tone and length per plink).
- Added slow pad chords: a Markov progression that moves every 2 bars. Tap P10 to route strikes to the pads, tap P11 to toggle the plinks.
- Added plink tone on S34 (glass → wood → saturated), attack and decay on S35, highest plink note on SW1 (D5, D6 or D7).
- Added reverb, ping-pong delay and chorus on S30–S32, and the pads ←→ plinks mix on S36.
- Added recalibration: hold P10 + P11 for 2.5 s, then let go. Do it after attaching or removing clips.
- Added volume: hold P10 + P11 and move S36. Default 60 %.
- Added scale selection on the panel: hold P10 + P11 and touch P02–P09.
- Added root selection on the panel: hold P10 + P11, tap P00 for the next semitone, press 0.6 s for C. Each change plays the root on a plink.
- Added saved settings: volume, scale and root load at boot. Saved to QSPI flash when their gesture ends, or 5 s after root or scale sent over MIDI (LED flickers for 0.5 s). Pads and knobs pause for up to 0.3 s during a save.
- Added OLED support (SSD1306 128×32 at 0x3C, optional): last control, scale, plink notes, chord.
- Added USB MIDI in: notes on ch 1–15 play plinks, CC 22–29 set S30–S37 until the knob is moved, CC 20 root, CC 21 or Program Change scale, Note On ch 16 root, CC 123 all notes off. Out: plinks on ch 1, pad chords on ch 2.
- Added the web manual link over USB: CC 20 and CC 21 on ch 16 report root and scale on every change. After a SysEx request, frames report the knobs, pads and switches for 10 s.
- Added TRS MIDI for boards with the TRS mod: build with `make UART_MIDI=1`. Off by default, because a floating D14 on stock boards froze the controls.
- Added LED freeze codes: 1–8 blinks name the main-loop stage that is stuck (see README).
- Added `make release VERSION=x.y.z`: writes `build/touchspore-vX.Y.Z.bin`.
- Added a browser build (simple-touch-web): settings are not saved there, and flickers and the aura do nothing.

### Tested on hardware

- Tested saved settings and panel gestures (2026-11-08): volume, scale and root survive a power cycle, audio keeps playing during a save, and the scale and root gestures pick only with P10 + P11 held.
- Tested the MIDI link (2026-11-08): MIDI in and out work on the device, values reach the web manual link, and changes survive a reboot.

### Known issues

- Not all curves are tuned on hardware yet (see "Open questions for the hardware" in the README).
