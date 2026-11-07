#pragma once

#include "daisysp.h"
#include "daisysp-lgpl.h"
#include <cstddef>

namespace spore {

// Chorus → ping-pong delay → reverb. One knob per effect: each knob raises the
// wet amount and, coupled to it, the "size" (feedback / depth) of that effect.
class Fx {
public:
    void Init(float sr, float* delay_l, float* delay_r, size_t delay_len, float delay_s);
    void SetChorus(float k) { _chorus_k = k; }
    void SetDelay(float k)  { _delay_k = k; }
    void SetReverb(float k) { _reverb_k = k; }
    void SetDelayTime(float seconds);
    void Process(float& l, float& r);   // in place, per sample

private:
    void _UpdateParams();

    daisysp::Chorus   _chorus;
    daisysp::ReverbSc _reverb;

    float* _dl = nullptr;
    float* _dr = nullptr;
    size_t _dlen = 0, _dwrite = 0, _dtime = 0;
    float  _dlp_l = 0.f, _dlp_r = 0.f, _dlp_coef = 0.f;

    float _chorus_k = 0.f, _delay_k = 0.f, _reverb_k = 0.f;
    float _chorus_wet = 0.f, _delay_wet = 0.f, _delay_fb = 0.f, _reverb_wet = 0.f;
    uint16_t _param_cnt = 0;
    float _sr = 48000.f;
};

} // namespace spore
