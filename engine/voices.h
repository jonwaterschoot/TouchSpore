#pragma once

#include "daisysp.h"
#include <cmath>

namespace spore {

// Cheap sine for phase in [0, 1). Parabolic approximation with one refinement step (~0.1 % error).
inline float FastSin(float ph) {
    float x = ph * 2.f - 1.f;                 // -1..1  ↔  -π..π
    float y = 4.f * x * (1.f - fabsf(x));     // parabola, inverted sine shape
    y = 0.225f * (y * fabsf(y) - y) + y;
    return -y;
}
inline float Wrap(float ph) { return ph - static_cast<float>(static_cast<int>(ph)); }

// Plink ......................................................................
// Two sounds, blended by the tone knob, then an optional saturator:
//   A "glass" — soft 2-op FM bell (modulator at 3.5× gives the inharmonic shimmer)
//   B "wood"  — marimba-ish: fundamental + fast-decaying 4th partial
//   Drive     — per-voice soft saturation (chords stay clean: no intermodulation between
//               notes) followed by a one-pole low-pass that closes as drive rises.
// One knob (shape) moves attack and decay together: snappy pluck → soft swelling bowl.
struct PlinkTone {
    float blend  = 0.f;   // 0 = glass … 1 = wood
    float drive  = 1.f;   // gain into the saturator; 1 = clean (saturator bypassed)
    float makeup = 1.f;   // level compensation after the saturator
    float lp     = 1.f;   // one-pole coefficient after the saturator; 1 = open
};

class PlinkVoice {
public:
    void Init(float sr) { _sr = sr; _env = 0.f; _stage = Idle; }

    void Trigger(float freq, float vel, float shape) {
        _freq   = freq;
        _vel    = vel;
        _ph_c = _ph_m = _ph_4 = 0.f;
        float attack_s = 0.001f * powf(150.f, shape * shape);   // 1 ms → 150 ms
        float decay_s  = 0.25f * powf(24.f, shape);             // 0.25 s → 6 s (T60-ish)
        _att_inc  = 1.f / (attack_s * _sr);
        _dec_coef = expf(-6.9f / (decay_s * _sr));
        _bright_coef = expf(-6.9f / (fminf(decay_s, 1.2f) * 0.35f * _sr));
        _bright   = 1.f;
        _stage    = Attack;
        if (_env > 0.f) _env *= 0.5f;   // retrigger of a stolen voice: soften the click
    }

    // Tone is held per voice, so notes can sound different from each other (auto modulation)
    void SetTone(const PlinkTone& t) { _tone = t; }

    float Process() {
        if (_stage == Idle) return 0.f;
        const PlinkTone& t = _tone;
        if (_stage == Attack) {
            _env += _att_inc;
            if (_env >= 1.f) { _env = 1.f; _stage = Decay; }
        } else {
            _env *= _dec_coef;
            if (_env < 0.0005f) { _env = 0.f; _stage = Idle; return 0.f; }
        }
        _bright *= _bright_coef;

        const float inc = _freq / _sr;
        _ph_c = Wrap(_ph_c + inc);
        _ph_m = Wrap(_ph_m + inc * 3.5f);
        _ph_4 = Wrap(_ph_4 + inc * 4.f);

        float index = (0.4f + 1.4f * _vel) * _bright;
        float glass = FastSin(Wrap(_ph_c + index * 0.16f * FastSin(_ph_m) + 1.f));
        float wood  = FastSin(_ph_c) + 0.35f * _bright * _bright * FastSin(_ph_4);

        float s = (glass + (wood - glass) * t.blend) * _env * _vel * 0.28f;
        if (t.drive > 1.f) {
            const float x = s * t.drive;
            s = x / sqrtf(1.f + x * x) * t.makeup;    // smooth, never hard-clips
        }
        _lp += (s - _lp) * t.lp;
        return _lp;
    }

    bool  Active() const { return _stage != Idle; }
    float Level() const  { return _env * _vel; }

private:
    enum Stage : uint8_t { Idle, Attack, Decay };
    float _sr = 48000.f, _freq = 440.f, _vel = 0.f;
    float _ph_c = 0.f, _ph_m = 0.f, _ph_4 = 0.f;
    float _env = 0.f, _att_inc = 0.f, _dec_coef = 0.f;
    float _bright = 0.f, _bright_coef = 0.f;
    float _lp = 0.f;
    PlinkTone _tone;
    Stage _stage = Idle;
};

// Pad ........................................................................
// Long, slow voice that moves between chord tones without re-triggering.
// Pitch changes are instant (no glide), so it is always in tune; only the amplitude swells.
//   A "strings" — three detuned PolyBLEP saws through a slowly breathing low-pass
//   B "choir"   — sine + octave + soft twelfth, with gentle vibrato
class PadVoice {
public:
    void Init(float sr, float lfo_rate) {
        _sr = sr;
        for (int i = 0; i < 3; i++) {
            _saw[i].Init(sr);
            _saw[i].SetWaveform(daisysp::Oscillator::WAVE_POLYBLEP_SAW);
            _saw[i].SetAmp(1.f);
        }
        _filt.Init(sr);
        _filt.SetRes(0.1f);
        _lfo_inc = lfo_rate / sr;
        _amp_up     = 1.f - expf(-1.f / (2.5f * sr));        // ~2.5 s swell in
        _amp_down   = 1.f - expf(-1.f / (5.0f * sr));        // ~5 s release
    }

    void SetNote(float freq)                     { _freq = freq; _ctl = 0; }
    void SetGate(bool on, float level = 1.f)    { _amp_target = on ? level : 0.f; }
    void Swell(float amount)                     { _swell = fminf(_swell + amount, 0.6f); }
    bool Silent() const                          { return _amp < 0.0005f && _amp_target == 0.f; }

    float Process(float blend) {
        _amp += (_amp_target + _swell - _amp) * ((_amp_target + _swell > _amp) ? _amp_up : _amp_down);
        _swell *= 0.99997f;                                  // swell fades over a few seconds
        if (_amp < 0.0002f && _amp_target == 0.f) return 0.f;

        _lfo = Wrap(_lfo + _lfo_inc);
        const float lfo = FastSin(_lfo);

        float out_a = 0.f, out_b = 0.f;
        if (blend < 0.999f) {
            static constexpr float kDetune[3] = { 0.9960f, 1.f, 1.0040f };
            // Coefficients at control rate: Svf::SetFreq costs a sinf + powf per call
            if (_ctl == 0) {
                for (int i = 0; i < 3; i++) _saw[i].SetFreq(_freq * kDetune[i]);
                _filt.SetFreq(_freq * (2.5f + 1.5f * lfo) + 300.f);
            }
            _ctl = (_ctl + 1) & 15;
            float s = 0.f;
            for (int i = 0; i < 3; i++) s += _saw[i].Process();
            _filt.Process(s * 0.33f);
            out_a = _filt.Low();
        }
        if (blend > 0.001f) {
            const float vib = 1.f + 0.0025f * lfo;
            const float inc = _freq * vib / _sr;
            _ph1 = Wrap(_ph1 + inc);
            _ph2 = Wrap(_ph2 + inc * 2.f);
            _ph3 = Wrap(_ph3 + inc * 3.f);
            out_b = FastSin(_ph1) + 0.35f * FastSin(_ph2) + (0.12f + 0.08f * lfo) * FastSin(_ph3);
            out_b *= 0.6f;
        }
        return (out_a + (out_b - out_a) * blend) * _amp * 0.22f;
    }

private:
    float _sr = 48000.f;
    daisysp::Oscillator _saw[3];
    daisysp::Svf _filt;
    float _freq = 0.f;
    float _amp = 0.f, _amp_target = 0.f, _amp_up = 0.f, _amp_down = 0.f, _swell = 0.f;
    float _lfo = 0.f, _lfo_inc = 0.f;
    float _ph1 = 0.f, _ph2 = 0.f, _ph3 = 0.f;
    uint8_t _ctl = 0;
};

} // namespace spore
