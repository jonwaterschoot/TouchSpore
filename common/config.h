#pragma once

#include <cstdint>

// TouchSpore: global constants ...........................................
namespace spore {

// Clock: 60 BPM, sixteenth-note grid
static constexpr float   kDefaultBpm     = 60.f;
static constexpr uint8_t kStepsPerBeat   = 4;
static constexpr uint8_t kStepsPerBar    = 16;
static constexpr uint8_t kBarsPerChord   = 2;     // auto chord change every 2 bars (8 s)

// Voices
static constexpr uint8_t kPlinkVoices    = 6;
static constexpr uint8_t kPadVoices      = 4;     // 3 chord tones + 1 shimmer voice

// Pads
static constexpr uint8_t kFieldPads      = 10;    // P00..P09: sensing "field" pads → notes
static constexpr uint8_t kFirstNotePad   = 3;     // P03 plays note 0. P00..P02 continue above P09
constexpr uint8_t PadToNote(uint8_t pad)   { return (pad + kFieldPads - kFirstNotePad) % kFieldPads; }
constexpr uint8_t NoteToPad(uint8_t note)  { return (note + kFirstNotePad) % kFieldPads; }
static constexpr uint8_t kPadSynthPad    = 10;    // P10: route field to the slow pad synth
static constexpr uint8_t kPlinkPad       = 11;    // P11: route field to the plinks
static constexpr uint8_t kElectrodes     = 13;    // 12 pads + MPR121 proximity electrode (whole board)
static constexpr uint8_t kAuraElectrode  = 12;

// Tuning (D minor default)
static constexpr uint8_t kDefaultRoot    = 2;     // D (0 = C)
static constexpr uint8_t kDefaultScale   = 0;     // natural minor
static constexpr int     kPlinkBaseMidi  = 12 * 5; // degree 0 of the plinks sits in octave 4 (D4 = 62)
static constexpr int     kPadBaseMidi    = 12 * 3; // pad chords centre around D2..D3

// Hidden volume (P10 + P11 + S36), after the soft clip. Fader position 0–1, gain = position².
// Used until a volume has been saved (ui/spore_settings.h).
static constexpr float   kDefaultVolume  = 0.6f;  // gain 0.36, −9 dB

// Delay buffer (lives in SDRAM, allocated in TouchSpore.cpp)
static constexpr uint32_t kDelayMaxSamples = 48000 * 2;

// MIDI ....................................................................
// Input (USB + TRS/UART, any channel unless noted)
static constexpr uint8_t kCcRoot         = 20;    // value 0..11 → C..B (higher values wrap mod 12)
static constexpr uint8_t kCcScale        = 21;    // value → scale index (wraps)
static constexpr uint8_t kRootNoteChannel = 15;   // 0-based: Note On on MIDI channel 16 sets the root
static constexpr uint8_t kCcFirstKnob    = 22;    // CC 22..29 → S30..S37, until the knob is moved
// Program Change (any channel) → scale index
// Note On on any other channel → plays that note on a plink
// CC 123 → all notes off

// Output (USB only): CC 20 / CC 21 echo of the root and scale in effect
static constexpr uint8_t kLinkChannel    = 15;    // 0-based: MIDI channel 16

// Output (generated notes, both ports)
static constexpr uint8_t kPlinkMidiChannel = 0;   // MIDI ch 1
static constexpr uint8_t kPadMidiChannel   = 1;   // MIDI ch 2
static constexpr uint8_t kPlinkGateSteps   = 2;   // note-off after 2 sixteenths

} // namespace spore

#if !DEBUG
#define USB_MIDI
#endif
// TRS MIDI (USART1, RX D14 / TX D13) needs the TRS MIDI mod: build with `make UART_MIDI=1`.
// Off by default: on a stock Simple Touch D14 is unconnected and floats, and the noise
// on it trips libDaisy's UART error handling into an interrupt storm that starves the
// main loop (controls freeze, audio keeps running).
