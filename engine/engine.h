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
    enum Kind : uint8_t { Strike, Flicker };
    Kind    kind;
    uint8_t pad;
    float   amount;    // velocity for strikes, fluctuation amount for flickers
    uint8_t targets;   // Target bitmask from P10/P11 routing
};

// Audio → main loop: notes to send out over MIDI
struct NoteOut {
    uint8_t channel;
    uint8_t note;
    uint8_t velocity;  // 0 = note off
};

// Platform-independent engine (only depends on DaisySP) so it can also be
// compiled and run on a computer — see tools/sim.cpp.
class Engine {
public:
    void Init(float sample_rate, float* delay_l, float* delay_r, size_t delay_len);
    void Process(const float* const* in, float** out, size_t size);

    // ---- called from the main loop ----
    void PushTouch(const TouchEvent& e) { _touch_q.Push(e); }
    bool PopNoteOut(NoteOut& n)         { return _midi_q.Pop(n); }

    void SetReverb(float k)      { _fx.SetReverb(k); }
    void SetDelay(float k)       { _fx.SetDelay(k); }
    void SetChorus(float k)      { _fx.SetChorus(k); }
    void SetPadBlend(float k)    { _pad_blend = k; }
    void SetPlinkBlend(float k)  { _plink_blend = k; }
    void SetPlinkShape(float k)  { _plink_shape = k; }
    void SetMix(float k)         { _mix = k; }          // 0 = pads only, 0.5 = equal, 1 = plinks only
    void SetIntensity(float k)   { _intensity = k; }
    void SetAutoMode(Generator::Mode m)    { _gen_mode = m; }
    void SetFilterMode(MelodyFilter::Mode m) { _filter_mode = m; }
    void SetRoot(uint8_t root)   { _pending_root = root % 12; }
    void SetScale(uint8_t scale) { _pending_scale = scale % kScaleCount; }
    void AllNotesOff()           { _panic = true; }

    float    Intensity() const { return _intensity; }
    float    Pressure() const  { return _filter.Pressure(); }
    uint32_t NoteCount() const { return _note_count; }   // LED flash on change

private:
    void _Step();
    void _TriggerPlink(int degree, float vel);
    void _VoicePads(bool jump);
    void _SendMidi(uint8_t ch, uint8_t note, uint8_t vel) { _midi_q.Push({ ch, note, vel }); }

    float _sr = 48000.f;
    uint32_t _samples_per_step = 0, _sample_in_step = 0, _step = 0;

    Tuning       _tuning;
    Rng          _rng;
    MelodyFilter _filter;
    Generator    _gen;
    Harmony      _harmony;
    Fx           _fx;

    PlinkVoice _plinks[kPlinkVoices];
    float      _plink_pan[kPlinkVoices] = {};
    PadVoice   _pads[kPadVoices];
    int        _pad_degree[kPadVoices] = {};
    int        _pad_midi[kPadVoices] = {};
    bool       _pad_sounding[kPadVoices] = {};

    struct PendingOff { uint8_t note; uint8_t steps; };
    PendingOff _offs[16] = {};

    Spsc<TouchEvent, 64> _touch_q;
    Spsc<NoteOut, 64>    _midi_q;

    // Parameters written by the main loop (32-bit stores are atomic on the M7)
    volatile float _pad_blend = 0.3f, _plink_blend = 0.3f, _plink_shape = 0.3f;
    volatile float _mix = 0.5f, _intensity = 0.f;
    volatile Generator::Mode    _gen_mode = Generator::Mode::On;
    volatile MelodyFilter::Mode _filter_mode = MelodyFilter::Mode::Melodic;
    volatile int  _pending_root = -1, _pending_scale = -1;
    volatile bool _panic = false;

    uint32_t _steps_since_pad_touch = 1000;
    bool     _pads_on = false;
    uint32_t _note_count = 0;
};

} // namespace spore
