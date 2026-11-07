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
| S34 | Plinks: glass (FM bell) ←→ wood (marimba) |
| S35 | Plinks: attack & decay together — snappy pluck ←→ soft swelling bowl |
| S36 left fader | Pads ←→ plinks, centre = 50/50 (equal power) |
| S37 right fader | Field sensitivity |
| Right switch | Autoplay: up = on, centre = sparse, down = off (touch only) |
| Left switch | Density filter: up = free, centre = melodic, down = strict |
| P00–P09 | The field: strikes, flickers, intensity |
| P10 tap | Toggle field → slow pads (a strike picks the next chord root, on the beat) |
| P11 tap | Toggle field → plinks (on by default) |
| P10 + P11 hold 0.5 s | Recalibrate — do this after attaching/removing clips |

P10/P11 use a fixed threshold, so they keep working when the field is hyper sensitive.
LED: flash per plink; 2 blinks = toggled on, 1 = off, 3 = recalibrated (smooth), 4 = recalibrated (raw).

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
its own; strikes and flickers add candidates; intensity raises density and register. The pads follow
a slow Markov chord progression in the scale (every 2 bars), voice-led, with a high shimmer voice
that opens with intensity.

**Density filter** (`MelodyFilter`): pressure follows recent trigger density. As it rises, only
stronger metric positions pass (down to an eighth-note grid) and a token bucket caps notes/s;
swallowed triggers become accent on the next note. Leaps shrink (5 → 2 scale steps) so rising
intensity becomes a climbing line; leaps are followed by a step back; no note repeats more than twice;
beats snap to chord tones; calm phrases are recorded as motifs and replayed while it's busy.

Simulated storm of 80 flickers/s (`tools/sim.cpp`): Free plays 8 notes/s with leaps up to 18
semitones; Melodic plays ~2 notes/s, max leap 5 semitones, across 2½ octaves.

## MIDI (USB + TRS on USART1: RX D14, TX D13)

In: CC 20 = root (0–11, C–B), CC 21 or Program Change = scale, Note On on ch 16 = root, CC 123 = all off.
Scales: 0 natural minor (default, root D), 1 dorian, 2 minor pent, 3 phrygian, 4 major, 5 lydian,
6 major pent, 7 harmonic minor.
Out: plinks on ch 1, pad chords on ch 2.

## Build

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
