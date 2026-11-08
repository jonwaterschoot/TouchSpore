# Changelog

## Unreleased

First release, planned as 0.1.0.

### Added

- Added the sensing field: P00–P09 play notes of the scale (default D natural minor). S37 sets sensitivity from firm touch to a hand 1–2 cm away.
- Added flicker events in the upper half of S37: pad noise from plants, clips and wires suggests notes on a 60 BPM sixteenth grid.
- Added autoplay on SW2 centre, and per-note variation on SW2 up (random octave, tone and length per plink).
- Added slow pad chords: a Markov progression that moves every 2 bars. Tap P10 to route strikes to the pads, tap P11 to toggle the plinks.
- Added plink tone on S34 (glass → wood → saturated), attack and decay on S35, highest plink note on SW1 (D5, D6 or D7).
- Added reverb, ping-pong delay and chorus on S30–S32, and the pads ←→ plinks mix on S36.
- Added recalibration: hold P10 + P11 for 2.5 s, then let go. Do it after attaching or removing clips.
- Added volume: hold P10 + P11 and move S36. Default 60 %, reset on every boot.
- Added OLED support (SSD1306 128×32 at 0x3C, optional): last control, scale, plink notes, chord.
- Added USB MIDI in: CC 20 root, CC 21 or Program Change scale, Note On ch 16 root, CC 123 all notes off. Out: plinks on ch 1, pad chords on ch 2.
- Added TRS MIDI for boards with the TRS mod: build with `make UART_MIDI=1`. Off by default, because a floating D14 on stock boards froze the controls.
- Added LED freeze codes: 1–8 blinks name the main-loop stage that is stuck (see README).
- Added `make release VERSION=x.y.z`: writes `build/touchspore-vX.Y.Z.bin`.

### Known issues

- Scale and root reset to D natural minor at every boot. Saving them is Phase 1 in [docs/ROADMAP.md](docs/ROADMAP.md).
- Not all curves are tuned on hardware yet (see "Open questions for the hardware" in the README).
