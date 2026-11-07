# TouchSpore

Generative plinks-and-pads firmware for the Synthux Simple Touch, inspired by the Pocket SCÍON.
The touch pads are read as a continuous capacitive *field*: the right fader moves it from
"needs a real touch" to "reacts to presence — and wires on the pads become antennas".
Sketch, built on the TouchString project structure. Compiles; not yet tested on hardware.

## Controls

| Control | Function |
|---|---|
| S30 / S31 / S32 | Reverb / Delay (ping-pong, dotted 8th) / Chorus — each knob = amount + size |
| S33 | Pads: strings ←→ choir |
| S34 | Plinks tone: glass (FM bell) → wood (marimba, around 50 %) → saturated (per-voice drive, darker as it rises) |
| S35 | Plinks: attack & decay together — snappy pluck ←→ soft swelling bowl |
| S36 left fader | Pads ←→ plinks, centre = 50/50 (equal power) |
| S37 right fader | Field sensitivity |
| Right switch (SW2) | Down = touch only · centre = autoplay · up = autoplay + per-note variation: every plink samples and holds three drunk walks (random walks) plus a little jitter of its own: octave −1/0/+1, tone (S34 ±0.5) and attack/decay (S35 ±0.65) around the knobs, so one note rings long, the next is short, some jump an octave |
| Left switch (SW1) | Highest plink note: up = D7, centre = D6, down = D5 (at root D); higher notes fold down by octaves |
| P00–P09 | The field: a strike plays its note at once; flickers and intensity feed the generator |
| P10 tap | Toggle field → slow pads (a strike makes that pad the chord root, at once) |
| P11 tap | Toggle field → plinks (on by default) |
| P10 + P11 hold 0.5 s | Recalibrate — do this after attaching/removing clips |

P10/P11 use the chip's own touch detection with a fixed threshold (as TouchString), so they keep
working when the field is hyper sensitive.
LED: flash per detected touch (long = strike, short = flicker; autoplay notes don't flash);
solid while P10/P11 is held; then 2 blinks = toggled on, 1 = off, 3 = recalibrated (smooth),
4 = recalibrated (raw). LED flashes but no sound: check the left fader (pads ←→ plinks) and P11.

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
| 7 | The loop's delay (system tick not running) |
| 8 | Not stuck: audio CPU overload starves the main loop |

## How the sensitivity fader works (`touch/field.cpp`)

The chip's own touch detection is ignored. Every poll (~250 Hz) the driver reads the 10-bit
filtered data for all 12 pads plus the MPR121's 13th "proximity" electrode (all pads combined:
the whole board as one antenna) and does everything in software, so it can change live:

- **Threshold**: 40 counts (firm touch) → ~1 count (presence), but never below each pad's own
  measured noise × a factor that drops *below 1* at the top of the fader — there, noise itself plays.
- **Baseline tracking** slows as sensitivity rises, so a hovering hand isn't learned away.
- **Flickers** (top half of the fader): fluctuation of each pad, normalised to its own noise floor,
  fires events — the SCÍON idea. Plants, wires, mains hum all count.
- **Aura**: the proximity electrode adds to intensity once the field is sensitive.
- **AFE profile** is chosen at recalibration: *Smooth* (heavy filtering) below 70 % on the fader,
  *Raw* (light filtering, more variance) above. Recalibrating also re-runs the MPR121 auto-config,
  which adapts charge current/time to whatever is clipped on — that's what makes clips work.

All curves are in `Field::_UpdateDerived()`; they are first guesses to tune on the board.

## Generative side (`engine/sequencer.cpp`)

60 BPM, sixteenth grid. A random walk (pulled toward the last touched pad and chord tones) runs on
its own; strikes play immediately and pull the walk toward the touched pad; flickers add candidates;
intensity raises density and register. The pads follow
a slow Markov chord progression in the scale (every 2 bars), voice-led, with a high shimmer voice
that opens with intensity.

**Density filter** (`MelodyFilter`, fixed on Melodic; Free/Strict remain in the engine and `tools/sim.cpp`): pressure follows recent trigger density. As it rises, only
stronger metric positions pass (down to an eighth-note grid) and a token bucket caps notes/s;
swallowed triggers become accent on the next note. Leaps shrink (5 → 2 scale steps) so rising
intensity becomes a climbing line; leaps are followed by a step back; no note repeats more than twice;
beats snap to chord tones; calm phrases are recorded as motifs and replayed while it's busy.

**Output**: a stereo-linked 4:1 bus compressor (2 ms / 250 ms) sits in front of the final soft clip,
so long reverb tails and stacked plinks are turned down instead of clipping.

Simulated storm of 80 flickers/s (`tools/sim.cpp`): Free plays 8 notes/s with leaps up to 18
semitones; Melodic plays ~2 notes/s, max leap 5 semitones, across 2½ octaves.

## MIDI (USB; TRS on USART1 with the TRS mod: RX D14, TX D13)

TRS MIDI is off by default: build with `make UART_MIDI=1` only if your board has the TRS MIDI
mod. On a stock Simple Touch D14 floats, and the noise on it made libDaisy's UART error handling
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
Flash: ~119 KB of 128 KB.

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
