# TouchSpore

Generative plinks-and-pads firmware for the Synthux Simple Touch, inspired by devices like the Pocket SCÍON and Playtronica's Biotron, TouchMe and Playtron or the Spoke Board project.

The Pocket SCÍON wires a plant into a 555 timer circuit and reads micro-fluctuations in its galvanic resistance. One wire sends a signal into the plant, the plant acts as a resistor, and a second wire reads the signal back.
The Simple Touch's MPR121 measures each pad's capacitance to ground.

Neither of these sensors read actual biological signals. Both turn small drifts from plants, skin and the room into a source of randomness, and TouchSpore uses that drift to trigger notes on the Simple Touch.

Pads P00–P09 are read as a continuous capacitive field. The right fader sets their sensitivity. With the fader down they need a firm touch. With the fader up they react to a hand 1–2 cm away, and clipped wires or plants act as antennas. P10 and P11 are control pads and ignore the fader.

To recalibrate, hold P10+P11 for 2.5 seconds, then let go. It runs once both pads have been untouched for 0.3 seconds, so the chip measures the pads without fingers on them. P10 and P11 then ignore touches for 0.5 seconds.

**How touches trigger the notes:** Each field pad plays one note of the scale (default D minor), and higher pads play higher notes. A firm touch (a strike) plays its note at once. Smaller fluctuations (flickers, upper half of the fader) and the autoplay generator suggest notes too, and these wait for the next sixteenth note of a 60 BPM grid. A density filter then picks which of them play. The busier the field, the fewer notes pass, and the ones that do move in small steps and land on chord tones on the beat. This can cause some actual touches to not fire a note immediatly.

Built on the TouchString project structure and its introduction of velocity emulation.

## Controls

| Control | Function |
|---|---|
| S30 / S31 / S32 | Reverb / Delay (ping-pong, dotted 8th) / Chorus. Each knob sets amount + size |
| S33 | Pads: strings ←→ choir |
| S34 | Plinks tone: glass (FM bell) → wood (marimba, around 50 %) → saturated (per-voice drive, darker as it rises) |
| S35 | Plinks attack & decay together: snappy pluck ←→ soft swelling bowl |
| S36 left fader | Pads ←→ plinks, centre = 50/50 (equal power) |
| S37 right fader | Field sensitivity |
| Right switch (SW2) | Down = touch only · centre = autoplay · up = autoplay + per-note variation (see below) |
| Left switch (SW1) | Highest plink note: up = D7, centre = D6, down = D5 (at root D); higher notes fold down by octaves |
| P00–P09 | The field: a strike plays its note at once; flickers and intensity feed the generator |
| P10 tap | Toggle field → slow pads (a strike makes that pad the chord root, at once) |
| P11 tap | Toggle field → plinks (on by default) |
| P10 + P11 hold 2.5 s, let go | Recalibrate. Do this after attaching/removing clips |
| P10 + P11 hold, move S36 | Volume (default 60 %). See below |
| P10 + P11 hold, touch P02–P09 | Scale. See below |
| P10 + P11 hold, P00 | Tap: next root. Press 0.6 s: C. See below |

**Volume** (P10 + P11 + S36): hold P10 and P11, then move S36 before the recalibrate bar fills. You can let go of the pads. S36 sets the volume until it rests for 2 seconds, then controls the mix again once it passes the old mix position.

**Scale** (P10 + P11 + P02–P09): hold P10 and P11, then touch a pad firmly. The pad picks the scale and plays no note. The LED blinks once for P02, up to 8 times for P09.

| Pad | P02 | P03 | P04 | P05 | P06 | P07 | P08 | P09 |
|---|---|---|---|---|---|---|---|---|
| Scale | natural minor | dorian | minor pent | phrygian | major | lydian | major pent | harmonic minor |

**Root** (P10 + P11 + P00): each tap moves the root up one semitone, wrapping from B to C. Press for 0.6 s to jump to C. Each change plays the new root on a plink, so keep S36 away from the pads-only end if you have no screen.

After a scale or root pick you can let go of P10 and P11 and keep picking until 2 seconds after the last pick.

**Saved settings:** volume, scale and root are stored in the Daisy's QSPI flash and load at boot. They survive a firmware update. The gestures save when they end, and root or scale sent over MIDI save 5 seconds after the last change. The LED flickers for 0.5 s after a save. Pads and knobs pause for up to 0.3 s during a save, and audio keeps playing. The P10/P11 routing is not saved and returns to plinks only at every boot.

**Per-note variation** (SW2 up): every plink samples three drunk walks (random walks) plus its own
small jitter. These offset octave (−1/0/+1), tone (S34 ±0.5) and attack/decay (S35 ±0.65) around the
knob positions. One note rings long, the next is short, and some jump an octave.

P10/P11 use the chip's own touch detection with a fixed threshold (as TouchString), so they keep
working when the field is hyper sensitive.
LED: flash per detected touch (long = strike, short = flicker; autoplay notes don't flash);
solid while P10/P11 is held; then 2 blinks = toggled on, 1 = off, 3 = recalibrated (smooth),
4 = recalibrated (raw), fast flicker = settings saved. LED flashes but no sound: check the left fader (pads ←→ plinks), P11 and the
saved volume (P10 + P11 + S36).

**Freeze code.** If the controls stop responding, the LED blinks a code after ~1 s
(N blinks, pause, repeat), driven from the audio callback:

| Blinks | Main loop stuck in |
|---|---|
| 1 | MIDI in |
| 2 | Touch chip (I2C) |
| 3 | Knobs / switches |
| 4 | P10/P11 logic |
| 5 | Intensity |
| 6 | MIDI out |
| 7 | Screen redraw, settings save (QSPI flash) or the loop's delay (system tick not running) |
| 8 | Not stuck: audio CPU overload starves the main loop |

## How the sensitivity fader works (`touch/field.cpp`)

The chip's own touch detection is ignored. Every poll (~250 Hz) the driver reads the 10-bit
filtered data for all 12 pads plus the MPR121's 13th "proximity" electrode (all pads combined:
the whole board as one antenna) and does everything in software, so it can change live:

- **Threshold**: 40 counts (firm touch) → ~1 count (presence), but never below each pad's own
  measured noise × a factor that drops *below 1* at the top of the fader. There, noise itself plays.
- **Baseline tracking** slows as sensitivity rises. The baseline is each pad's "untouched" reading,
  and it slowly follows drift. Slowing it down stops a hand that hovers near a pad from becoming the
  new "untouched" level.
- **Flickers** (top half of the fader): fluctuation of each pad, normalised to its own noise floor,
  fires events (the SCÍON idea). Plants, wires and mains hum all count.
- **Aura**: the proximity electrode adds to intensity once the field is sensitive.
- **AFE profile** (AFE = analog front end, the part of the MPR121 that charges each pad and
  measures it, before any digital processing) is chosen at recalibration: *Smooth* (heavy filtering) below 70 % on the fader,
  *Raw* (light filtering, more variance) above. Recalibrating also re-runs the MPR121 auto-config,
  which adapts charge current/time to whatever is clipped on. This is what makes clips work.

All curves are in `Field::_UpdateDerived()`; they are first guesses to tune on the board.

## Generative side (`engine/sequencer.cpp`)

60 BPM, sixteenth grid. A random walk (pulled toward the last touched pad and chord tones) runs on
its own; strikes play immediately and pull the walk toward the touched pad; flickers add candidates;
intensity raises density and register. The pads follow
a slow Markov chord progression in the scale (every 2 bars), voice-led, with a high shimmer voice
that opens with intensity.

**Chord progression** (`Harmony::Next()`): every 2 bars the pads move to a new chord. Each chord has
a short list of chords that usually sound good after it, and the next one is picked at random from
that list. Only the current chord counts (that is what "Markov" means), so the progression never
loops but still sounds familiar. About 30 % of chords get a seventh. Each pad voice moves to the
nearest note of the new chord (voice-led). A strike routed to the pads (P10) sets the chord root at
once and pauses the progression for 2 bars.

**Density filter** (`MelodyFilter`, fixed on Melodic; Free/Strict remain in the engine and `tools/sim.cpp`): pressure follows recent trigger density. As it rises, only
stronger metric positions pass (down to an eighth-note grid) and a token bucket caps notes/s.
The token bucket is a note budget. The budget refills at a steady rate, each note that plays spends
one unit, and when it's empty extra notes are dropped until it refills. Dropped triggers become
accent on the next note. Leaps shrink (5 → 2 scale steps) so rising
intensity becomes a climbing line; leaps are followed by a step back; no note repeats more than twice;
beats snap to chord tones; calm phrases are recorded as motifs and replayed while it's busy.

**Output**: a stereo-linked 4:1 bus compressor (2 ms / 250 ms) sits in front of the final soft clip,
so long reverb tails and stacked plinks are turned down instead of clipping.

Simulated storm of 80 flickers/s (`tools/sim.cpp`): Free plays 8 notes/s with leaps up to 18
semitones; Melodic plays ~2 notes/s, max leap 5 semitones, across 2½ octaves.

## OLED (optional)

SSD1306 128×32 I2C screen on D11 (SCL) / D12 (SDA), address 0x3C, powered from 3V3. It shares the MPR121's bus. With no screen fitted the firmware sends nothing to it.

| Row | Shows |
|---|---|
| 0 | Last moved control and its value, or the recalibrate bar |
| 1 | Root and scale |
| 2 | PL: a dot per scale note, lit when a plink plays it. Right: last plink note |
| 3 | PD: the chord's notes, filled while the pads sound. Right: chord name |

At boot, TOUCHSPORE gets overgrown by branching hyphae (about 1 s). The pads then learn their baselines with the screen running. With S37 at the top and wires held onto the pads, the screen added no flickers (not yet tested with clips). If it does on your board, recalibrate with the screen fitted.

## MIDI (USB; TRS on USART1 with the TRS mod: RX D14, TX D13)

TRS MIDI is off by default: it was causing errors, if you modded your Simple Touch with trs, build with `make UART_MIDI=1`. On a stock Simple Touch D14 floats, and the noise on it made libDaisy's UART error handling
starve the main loop (all controls froze while audio kept playing, freeze code 1).

In: CC 20 = root (0–11, C–B), CC 21 or Program Change = scale, Note On on ch 16 = root, CC 123 = all off.
Scales: 0 natural minor (default, root D), 1 dorian, 2 minor pent, 3 phrygian, 4 major, 5 lydian,
6 major pent, 7 harmonic minor.
Out: plinks on ch 1, pad chords on ch 2.

## Build

On Windows, run these commands from Git Bash so the make recipes use a POSIX-compatible shell.

```sh
git submodule add https://github.com/Synthux-Academy/libDaisy.git lib/libDaisy
git submodule add https://github.com/electro-smith/DaisySP.git lib/DaisySP
git submodule update --init --recursive
make libs -j8 && make -j8 && make program-dfu
```
Flash: ~125 KB of 128 KB.

### Release

1. In [CHANGELOG.md](CHANGELOG.md), rename `Unreleased` to the version and date, such as `0.1.0 (2026-11-20)`.
2. `make release VERSION=0.1.0` writes `build/touchspore-v0.1.0.bin`.
3. Commit, tag `v0.1.0`, and push the tag.
4. Create a GitHub release from the tag, attach the `.bin`, and paste the version's changelog entry as the notes.

Plans and progress: [docs/ROADMAP.md](docs/ROADMAP.md).

Host simulation (no hardware): see the header of `tools/sim.cpp`.

## Open questions for the hardware

- Real count ranges with clips/wires attached (thresholds, `_range`, flicker z-scores).
- Whether the Raw profile is needed, or Smooth + low threshold is already lively enough.
- Mains hum on long wires: musical, or needs a notch / longer ESI?
- Switch positions vs. labels on the board (copied from TouchString's `Switches`).

## Credits

`touch/knobs.*`, `touch/switches.*`, `touch/syscalls.cpp`, `common/nocopy.h`, project layout and
MPR121 register setup from [TouchString](https://github.com/Synthux-Academy/TouchString)
(Vlad Litvinenko, Rosa Schuurmans, Vincent Maurer).

## License

The TouchSpore code is released under the [MIT License](LICENSE).

It builds on:

- [libDaisy (Synthux fork)](https://github.com/Synthux-Academy/libDaisy) and [DaisySP](https://github.com/electro-smith/DaisySP): MIT License.
- [DaisySP-LGPL](https://github.com/electro-smith/DaisySP-LGPL) for the reverb (`ReverbSc`, `USE_DAISYSP_LGPL = 1` in the Makefile): LGPL-2.1. The firmware (`.bin`) contains it, so for that part the `.bin` falls under the LGPL. Its source comes with the DaisySP submodule, and this repository has everything needed to rebuild the `.bin` with a changed version of it (see [Build](#build)).

Not covered by the MIT License: the files taken from TouchString (listed under [Credits](#credits)). TouchString has no license file, so they stay under their authors' terms until Synthux Academy adds a license or they are rewritten.
