#pragma once

#include <cstdint>

// TouchSpore — global constants ...........................................
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
static constexpr uint8_t kPadSynthPad    = 10;    // P10: route field to the slow pad synth
static constexpr uint8_t kPlinkPad       = 11;    // P11: route field to the plinks
static constexpr uint8_t kElectrodes     = 13;    // 12 pads + MPR121 proximity electrode (whole board)
static constexpr uint8_t kAuraElectrode  = 12;

// Tuning (D minor default)
static constexpr uint8_t kDefaultRoot    = 2;     // D (0 = C)
static constexpr uint8_t kDefaultScale   = 0;     // natural minor
static constexpr int     kPlinkBaseMidi  = 12 * 5; // degree 0 of the plinks sits in octave 4 (D4 = 62)
static constexpr int     kPadBaseMidi    = 12 * 3; // pad chords centre around D2..D3

// Delay buffer (lives in SDRAM, allocated in TouchSpore.cpp)
static constexpr uint32_t kDelayMaxSamples = 48000 * 2;

// MIDI ....................................................................
// Input (USB + TRS/UART, any channel unless noted)
static constexpr uint8_t kCcRoot         = 20;    // value 0..11 → C..B (higher values wrap mod 12)
static constexpr uint8_t kCcScale        = 21;    // value → scale index (wraps)
static constexpr uint8_t kRootNoteChannel = 15;   // 0-based: Note On on MIDI channel 16 sets the root
// Program Change (any channel) → scale index
// CC 123 → all notes off

// Output (generated notes, both ports)
static constexpr uint8_t kPlinkMidiChannel = 0;   // MIDI ch 1
static constexpr uint8_t kPadMidiChannel   = 1;   // MIDI ch 2
static constexpr uint8_t kPlinkGateSteps   = 2;   // note-off after 2 sixteenths

} // namespace spore

#if !DEBUG
#define USB_MIDI
#endif
#define UART_MIDI
