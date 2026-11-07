#include "fx.h"
#include <cmath>
#include <cstring>

using namespace spore;

void Fx::Init(float sr, float* delay_l, float* delay_r, size_t delay_len, float delay_s) {
    _sr = sr;
    _chorus.Init(sr);
    _chorus.SetLfoFreq(0.21f, 0.27f);
    _chorus.SetDelayMs(9.f, 13.f);
    _chorus.SetFeedback(0.1f);

    _reverb.Init(sr);
    _reverb.SetLpFreq(7000.f);

    _dl = delay_l;
    _dr = delay_r;
    _dlen = delay_len;
    memset(_dl, 0, sizeof(float) * _dlen);
    memset(_dr, 0, sizeof(float) * _dlen);
    _dlp_coef = 1.f - expf(-2.f * 3.14159265f * 3200.f / sr);  // darkening in the feedback path
    SetDelayTime(delay_s);
    _UpdateParams();
}

void Fx::SetDelayTime(float seconds) {
    size_t t = static_cast<size_t>(seconds * _sr);
    _dtime = (t >= _dlen) ? _dlen - 1 : (t < 1 ? 1 : t);
}

void Fx::_UpdateParams() {
    _chorus_wet = _chorus_k * 0.7f;
    _chorus.SetLfoDepth(0.15f + 0.6f * _chorus_k);

    _delay_wet = _delay_k * 0.55f;
    _delay_fb  = 0.15f + 0.6f * _delay_k;          // 0.15 → 0.75

    _reverb_wet = _reverb_k * 0.75f;
    _reverb.SetFeedback(0.72f + 0.24f * _reverb_k); // room → long hall
}

void Fx::Process(float& l, float& r) {
    if (++_param_cnt >= 64) { _param_cnt = 0; _UpdateParams(); }

    // Chorus (mono in, stereo out)
    _chorus.Process(0.5f * (l + r));
    l += (_chorus.GetLeft()  - l) * _chorus_wet;
    r += (_chorus.GetRight() - r) * _chorus_wet;

    // Ping-pong delay: L feeds R, R feeds L
    size_t rd = (_dwrite + _dlen - _dtime) % _dlen;
    float dl = _dl[rd], dr = _dr[rd];
    _dlp_l += (dl - _dlp_l) * _dlp_coef;
    _dlp_r += (dr - _dlp_r) * _dlp_coef;
    _dl[_dwrite] = 0.5f * (l + r) * 0.7f + _dlp_r * _delay_fb;   // input enters on the left…
    _dr[_dwrite] = _dlp_l * _delay_fb;                         // …and bounces right
    _dwrite = (_dwrite + 1) % _dlen;
    l += dl * _delay_wet;
    r += dr * _delay_wet;

    // Reverb
    float rl, rr;
    _reverb.Process(l, r, &rl, &rr);
    l += rl * _reverb_wet;
    r += rr * _reverb_wet;
}
