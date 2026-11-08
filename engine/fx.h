#pragma once

#include "daisysp.h"
#include "daisysp-lgpl.h"
#include <cstddef>
#include <cmath>

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

// Stereo-linked bus compressor in front of the final soft clip, so long reverb tails and
// stacked plinks get turned down instead of driven into the clipper. Peak detector;
// the gain is computed at control rate (one powf per 16 samples) and smoothed per sample.
// Attack 0.5 ms and gain smoothing 1 ms: with 2 ms and 3 ms, plink attacks (FM glass
// most of all) reached the soft clip before the gain came down and distorted the highs.
class BusCompressor {
public:
    void Init(float sr) {
        _att    = 1.f - expf(-1.f / (0.0005f * sr));   // 0.5 ms
        _rel    = 1.f - expf(-1.f / (0.25f * sr));     // 250 ms
        _smooth = 1.f - expf(-1.f / (0.001f * sr));
    }

    void Process(float& l, float& r) {
        const float peak = fmaxf(fabsf(l), fabsf(r));
        _env += (peak - _env) * (peak > _env ? _att : _rel);
        if (++_cnt >= 16) {
            _cnt = 0;
            // 4:1 above the threshold: gain = (thr / env)^(1 - 1/4)
            _target = (_env > kThreshold) ? powf(kThreshold / _env, 0.75f) : 1.f;
        }
        _gain += (_target - _gain) * _smooth;
        l *= _gain * kMakeup;
        r *= _gain * kMakeup;
    }

private:
    // Levels are at the soft clip's input, which is close to linear below ~0.5
    static constexpr float kThreshold = 0.5f;
    static constexpr float kMakeup    = 1.0f;   // was 1.3: that pushed compressed peaks into the curve of the clip

    float _att = 0.f, _rel = 0.f, _smooth = 0.f;
    float _env = 0.f, _gain = 1.f, _target = 1.f;
    uint8_t _cnt = 0;
};

} // namespace spore
