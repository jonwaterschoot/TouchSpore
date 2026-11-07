#include "engine.h"
#include <cmath>
#include <algorithm>

using namespace spore;

namespace {
inline float mtof(int note) { return 440.f * powf(2.f, (note - 69) / 12.f); }
inline uint8_t vel7(float v) { int x = static_cast<int>(v * 127.f); return static_cast<uint8_t>(x < 1 ? 1 : (x > 127 ? 127 : x)); }
}

void Engine::Init(float sr, float* delay_l, float* delay_r, size_t delay_len) {
    _sr = sr;
    _samples_per_step = static_cast<uint32_t>(sr * 60.f / kDefaultBpm / kStepsPerBeat);   // 0.25 s at 60 BPM
    _sample_in_step = _samples_per_step - 1;   // first step fires immediately

    _tuning.SetRoot(kDefaultRoot);
    _tuning.SetScale(kDefaultScale);

    for (auto& v : _plinks) v.Init(sr);
    static constexpr float kLfo[kPadVoices] = { 0.07f, 0.09f, 0.11f, 0.05f };
    for (uint8_t i = 0; i < kPadVoices; i++) _pads[i].Init(sr, kLfo[i]);

    // Delay = dotted eighth at the current tempo (0.75 s at 60 BPM)
    _fx.Init(sr, delay_l, delay_r, delay_len, 0.75f * 60.f / kDefaultBpm);
    _VoicePads(true);
}

// Audio callback ...............................................................

void Engine::Process(const float* const* in, float** out, size_t size) {
    (void)in;   // stereo input unused for now — could become a third, "listening" source

    const float mix = _mix;
    const float g_plink = sinf(mix * 1.5707963f);   // equal power: centre = both at -3 dB
    const float g_pad   = cosf(mix * 1.5707963f);
    const float pb = _plink_blend, padb = _pad_blend;

    for (size_t i = 0; i < size; i++) {
        if (++_sample_in_step >= _samples_per_step) {
            _sample_in_step = 0;
            _Step();
        }

        float l = 0.f, r = 0.f;
        for (uint8_t v = 0; v < kPlinkVoices; v++) {
            if (!_plinks[v].Active()) continue;
            float s = _plinks[v].Process(pb);
            l += s * (1.f - _plink_pan[v]);
            r += s * _plink_pan[v];
        }
        l *= g_plink * 1.4f;
        r *= g_plink * 1.4f;

        static constexpr float kPadPan[kPadVoices] = { 0.5f, 0.3f, 0.7f, 0.5f };
        float pl = 0.f, pr = 0.f;
        for (uint8_t v = 0; v < kPadVoices; v++) {
            float s = _pads[v].Process(padb);
            pl += s * (1.f - kPadPan[v]);
            pr += s * kPadPan[v];
        }
        l += pl * g_pad * 1.4f;
        r += pr * g_pad * 1.4f;

        _fx.Process(l, r);
        out[0][i] = daisysp::SoftClip(l * 2.4f);
        out[1][i] = daisysp::SoftClip(r * 2.4f);
    }
}

// Sequencer step (every sixteenth, inside the audio callback) .....................

void Engine::_Step() {
    const uint8_t step_in_bar = _step % kStepsPerBar;
    const float   intensity   = _intensity;

    // Tuning changes from MIDI land on a step boundary
    if (_pending_root >= 0 || _pending_scale >= 0) {
        bool size_changed = false;
        if (_pending_root >= 0)  { _tuning.SetRoot(_pending_root); _pending_root = -1; }
        if (_pending_scale >= 0) {
            int old = _tuning.Size();
            _tuning.SetScale(_pending_scale);
            _pending_scale = -1;
            size_changed = old != _tuning.Size();
        }
        if (size_changed) _filter.Reset();
        _VoicePads(false);
    }
    if (_panic) {
        _panic = false;
        for (auto& o : _offs) if (o.steps) { _SendMidi(kPlinkMidiChannel, o.note, 0); o.steps = 0; }
        for (uint8_t v = 0; v < kPadVoices; v++) if (_pad_sounding[v]) { _SendMidi(kPadMidiChannel, _pad_midi[v], 0); _pad_sounding[v] = false; }
        for (auto& p : _pads) p.SetGate(false);
    }

    const int size = _tuning.Size();
    _gen.SetMode(_gen_mode);
    _filter.SetMode(_filter_mode);

    int chord[4];
    uint8_t chord_n = _harmony.Tones(chord, size);

    // 1. Collect touch events since the last step .................................
    Candidate cands[16];
    uint8_t n = 0;
    TouchEvent e;
    while (_touch_q.Pop(e)) {
        const int pc = e.pad % size;
        if ((e.targets & kToPlinks) && n < 15) {
            Candidate c;
            c.pc     = static_cast<uint8_t>(pc);
            // Higher pads, harder strikes and higher overall intensity reach higher octaves
            c.octave = static_cast<int8_t>(e.pad / size
                        + (intensity > 0.45f ? 1 : 0) + (intensity > 0.8f ? 1 : 0)
                        + ((e.kind == TouchEvent::Strike && e.amount > 0.75f) ? 1 : 0));
            c.vel    = (e.kind == TouchEvent::Strike) ? 0.3f + 0.7f * e.amount : 0.12f + 0.35f * e.amount;
            c.source = (e.kind == TouchEvent::Strike) ? Candidate::Strike : Candidate::Flicker;
            cands[n++] = c;
        }
        if ((e.targets & kToPads) && e.kind == TouchEvent::Strike) {
            _harmony.Request(pc);
            for (auto& p : _pads) p.Swell(0.15f * e.amount);
            _steps_since_pad_touch = 0;
        }
        if (e.kind == TouchEvent::Strike) _gen.SetGravity(pc, 0.6f);
    }

    // 2. The autonomous algorithm adds its own candidate ............................
    Candidate a;
    if (_gen.Step(step_in_bar, intensity, chord, chord_n, size, a, _rng) && n < 16) cands[n++] = a;

    // 3. Density filter decides what actually sounds ................................
    NoteChoice notes[3];
    uint8_t k = _filter.Filter(cands, n, step_in_bar, chord, chord_n, size, notes, _rng);
    for (uint8_t i = 0; i < k; i++) _TriggerPlink(notes[i].degree, notes[i].vel);

    // 4. Harmony: touch requests land on the beat, otherwise change every few bars ...
    const bool on_beat = (step_in_bar % kStepsPerBeat) == 0;
    bool chord_changed = false;
    if (on_beat) chord_changed = _harmony.ApplyRequest();
    if (!chord_changed && step_in_bar == 0 && (_step / kStepsPerBar) % kBarsPerChord == 0
        && _steps_since_pad_touch > kStepsPerBar * kBarsPerChord && _step > 0) {
        _harmony.Next(_rng, size);
        chord_changed = true;
    }

    // Pads sound while the algorithm runs, or for 8 s after a P10-routed touch
    if (_steps_since_pad_touch < 1000) _steps_since_pad_touch++;
    const bool pads_on = (_gen_mode != Generator::Mode::Off) || _steps_since_pad_touch < 32;
    if (chord_changed || pads_on != _pads_on) {
        _pads_on = pads_on;
        _VoicePads(false);
    }
    // Shimmer voice (4th) opens with intensity when the chord has no seventh
    if (chord_n == 3) _pads[3].SetGate(_pads_on && intensity > 0.55f, 0.6f * intensity);

    // 5. MIDI note-offs for plinks ...............................................
    for (auto& o : _offs) {
        if (o.steps && --o.steps == 0) _SendMidi(kPlinkMidiChannel, o.note, 0);
    }

    _step++;
}

void Engine::_TriggerPlink(int degree, float vel) {
    const int note = _tuning.MidiNote(degree, kPlinkBaseMidi);

    // Free voice, or steal the quietest
    uint8_t best = 0;
    float best_level = 2.f;
    for (uint8_t v = 0; v < kPlinkVoices; v++) {
        float lv = _plinks[v].Active() ? _plinks[v].Level() : -1.f;
        if (lv < best_level) { best_level = lv; best = v; }
    }
    _plinks[best].Trigger(mtof(note), vel, _plink_shape);
    _plink_pan[best] = 0.25f + 0.5f * _rng.Uni();

    for (auto& o : _offs) {
        if (o.steps == 0) {
            _SendMidi(kPlinkMidiChannel, static_cast<uint8_t>(note), vel7(vel));
            o.note = static_cast<uint8_t>(note);
            o.steps = kPlinkGateSteps;
            break;
        }
    }
    _note_count++;
}

// Voice-led chord placement for the pad synth
void Engine::_VoicePads(bool jump) {
    const int size = _tuning.Size();
    int tones[4];
    uint8_t n = _harmony.Tones(tones, size);

    // Centres per voice: bass root around degree `size` (D3), upper voices above it
    static constexpr int kLo[kPadVoices] = { 0, 1, 1, 1 };
    const int hi_lim = 2 * size + 3;

    for (uint8_t v = 0; v < kPadVoices; v++) {
        int pc;
        if (v < n) pc = tones[v];
        else       pc = tones[0];                     // shimmer: root, two octaves up

        int target;
        if (v == 3 && n == 3) {
            target = pc + 2 * size;
        } else {
            int ref = jump ? size + 2 * v : _pad_degree[v];
            int oct = Tuning::FloorDiv(ref - pc, size);
            int lo = pc + oct * size, hi = lo + size;
            target = (ref - lo <= hi - ref) ? lo : hi;   // nearest octave = smooth voice leading
            target = std::max(kLo[v] * size - 2, std::min(hi_lim, target));
        }
        _pad_degree[v] = target;
        const int midi = _tuning.MidiNote(target, kPadBaseMidi);
        _pads[v].SetNote(mtof(midi), jump);

        const bool gate = _pads_on && (v < n);         // shimmer voice is gated in _Step
        if (v < n || !_pads_on) _pads[v].SetGate(gate, v == 0 ? 1.f : 0.8f);

        // MIDI: re-send only what changed
        if (_pad_sounding[v] && (!gate || midi != _pad_midi[v])) {
            _SendMidi(kPadMidiChannel, static_cast<uint8_t>(_pad_midi[v]), 0);
            _pad_sounding[v] = false;
        }
        if (gate && !_pad_sounding[v]) {
            _SendMidi(kPadMidiChannel, static_cast<uint8_t>(midi), 70);
            _pad_midi[v] = midi;
            _pad_sounding[v] = true;
        }
    }
}
