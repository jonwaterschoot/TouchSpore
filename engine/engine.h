#pragma once

#include <cstddef>
#include <cstdint>
#include "config.h"
#include "spsc.h"
#include "scale.h"
#include "voices.h"
#include "fx.h"
#include "sequencer.h"

namespace spore {

enum Target : uint8_t { kToPads = 1, kToPlinks = 2 };

// Main loop → audio: something happened on the field
struct TouchEvent {
    // Root: set the root now and play it on a plink. Note: play a MIDI note on a plink.
    enum Kind : uint8_t { Strike, Flicker, Root, Note };
    Kind    kind;
    uint8_t pad;       // for Root: the new root, 0–11. For Note: the MIDI note
    float   amount;    // velocity for strikes and notes, fluctuation amount for flickers
    uint8_t targets;   // Target bitmask from P10/P11 routing
};

// Audio → main loop: notes to send out over MIDI
struct NoteOut {
    uint8_t channel;
    uint8_t note;
    uint8_t velocity;  // 0 = note off
    bool    generated; // a plink from autoplay or a flicker, not a strike or a chord
};

// Platform-independent engine (only depends on DaisySP) so it can also be
// compiled and run on a computer (see tools/sim.cpp).
class Engine {
public:
    // gain sets the output level directly, with no ramp from a default.
    void Init(float sample_rate, float* delay_l, float* delay_r, size_t delay_len,
              uint8_t root = kDefaultRoot, uint8_t scale = kDefaultScale,
              float gain = kDefaultVolume * kDefaultVolume);
    void Process(const float* const* in, float** out, size_t size);

    // ---- called from the main loop ----
    void PushTouch(const TouchEvent& e) { _touch_q.Push(e); }
    bool PopNoteOut(NoteOut& n)         { return _midi_q.Pop(n); }

    void SetReverb(float k)      { _fx.SetReverb(k); }
    void SetDelay(float k)       { _fx.SetDelay(k); }
    void SetChorus(float k)      { _fx.SetChorus(k); }
    void SetPadBlend(float k)    { _pad_blend = k; }
    void SetPlinkTone(float k)   { _plink_tone = k; }    // glass → wood → saturated
    void SetCeiling(uint8_t oct) { _ceiling_oct = oct; } // highest plink: 1..3 octaves above degree 0
    void SetPlinkShape(float k)  { _plink_shape = k; }
    void SetMix(float k)         { _mix = k; }          // 0 = pads only, 0.5 = equal, 1 = plinks only
    void SetVolume(float gain)   { _volume = gain; }    // linear, after the soft clip
    void SetIntensity(float k)   { _intensity = k; }
    void SetAutoMode(Generator::Mode m)    { _gen_mode = m; }
    void SetAutoMod(bool on)     { _auto_mod = on; }   // per-note random octave, tone and shape
    void SetFilterMode(MelodyFilter::Mode m) { _filter_mode = m; }
    void SetRoot(uint8_t root)   { _pending_root = root % 12; }
    void SetScale(uint8_t scale) { _pending_scale = scale % kScaleCount; }
    void AllNotesOff()           { _panic = true; }

    float    Intensity() const { return _intensity; }
    float    Pressure() const  { return _filter.Pressure(); }
    uint32_t NoteCount() const { return _note_count; }   // LED flash on change

    // For the OLED. Written in the audio callback, read from the main loop (single bytes).
    uint8_t Root() const        { return _tuning.Root(); }   // in effect, after SetRoot() lands on a step
    uint8_t Scale() const       { return _tuning.Scale(); }
    uint8_t ChordRoot() const   { return _chord_root; }      // pitch class in the scale, 0..size-1
    uint8_t ChordTones() const  { return _chord_n; }         // 3, or 4 with a seventh

private:
    void _Step();
    void _OnTouch(const TouchEvent& e);
    void _TriggerPlink(int degree, float vel, bool generated = false);
    void _PlayPlink(int note, float vel, float shape, float tone);
    void _VoicePads(bool jump);
    void _SendMidi(uint8_t ch, uint8_t note, uint8_t vel, bool generated = false) { _midi_q.Push({ ch, note, vel, generated }); }
    float _Drunk(float& walk, float step, float limit);

    float _sr = 48000.f;
    uint32_t _samples_per_step = 0, _sample_in_step = 0, _step = 0;

    Tuning       _tuning;
    Rng          _rng;
    MelodyFilter _filter;
    Generator    _gen;
    Harmony      _harmony;
    Fx            _fx;
    BusCompressor _comp;

    PlinkVoice _plinks[kPlinkVoices];
    float      _plink_pan[kPlinkVoices] = {};
    PadVoice   _pads[kPadVoices];
    int        _pad_degree[kPadVoices] = {};
    int        _pad_midi[kPadVoices] = {};
    bool       _pad_sounding[kPadVoices] = {};

    struct PendingOff { uint8_t note; uint8_t steps; };
    PendingOff _offs[16] = {};

    Candidate _flickers[16];          // flicker requests waiting for the next sixteenth
    uint8_t   _n_flickers = 0;

    Spsc<TouchEvent, 64> _touch_q;
    Spsc<NoteOut, 64>    _midi_q;

    // Parameters written by the main loop (32-bit stores are atomic on the M7)
    volatile float _pad_blend = 0.3f, _plink_tone = 0.3f, _plink_shape = 0.3f;
    volatile uint8_t _ceiling_oct = 3;
    volatile bool    _auto_mod = false;

    // Auto modulation (right switch up): drunk walks, sampled and held by each plink
    float _walk_oct = 0.f, _walk_tone = 0.f, _walk_shape = 0.f;
    volatile float _mix = 0.5f, _intensity = 0.f;
    volatile float _volume = kDefaultVolume * kDefaultVolume;
    float          _volume_s = kDefaultVolume * kDefaultVolume;   // smoothed per sample (~20 ms)
    volatile Generator::Mode    _gen_mode = Generator::Mode::On;
    volatile MelodyFilter::Mode _filter_mode = MelodyFilter::Mode::Melodic;
    volatile int  _pending_root = -1, _pending_scale = -1;
    volatile bool _panic = false;

    uint32_t _steps_since_pad_touch = 1000;
    bool     _pads_on = false;
    uint32_t _note_count = 0;
    volatile uint8_t _chord_root = 0, _chord_n = 3;
};

} // namespace spore
