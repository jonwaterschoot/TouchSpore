#include "field.h"
#include "daisysp.h"
#include <cmath>

using namespace synthux;
using namespace daisy;
using namespace daisysp;

namespace {
// Fixed thresholds for the control pads (P10/P11), in counts of (baseline − filtered).
// Same as libDaisy's MPR121 defaults (12/6), which TouchString uses on this board.
constexpr float    kFirmOn      = 12.f;
constexpr float    kFirmOff     = 6.f;
constexpr float    kFirmNoise   = 6.f;     // …but never below the pad's own noise × this
constexpr float    kBaseUpRate  = 0.05f;   // reading above baseline (finger left / drift): recover fast
constexpr uint16_t kStuckPolls  = 5000;    // ~20 s active → let the baseline creep (anti-stuck)
constexpr uint8_t  kStrikePolls = 3;       // velocity is the peak over the first 3 polls (~12 ms)
constexpr uint16_t kSettlePolls = 125;     // ~0.5 s noise/baseline learning after calibration
constexpr uint16_t kHealthPolls = 250;     // ~1 s between chip checks
constexpr uint16_t kFailPolls   = 25;      // ~0.1 s of failed reads → reset the I2C peripheral
constexpr uint8_t  kEcrRun      = 0xBC;    // CL = 10, ELEPROX_EN = 11 (ELE0..11 as electrode 13), 12 electrodes

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }
inline float lerp_exp(float a, float b, float t) { return a * powf(b / a, t); }
inline float smoothstep(float e0, float e1, float x) {
    float t = fclamp((x - e0) / (e1 - e0), 0.f, 1.f);
    return t * t * (3.f - 2.f * t);
}
}

bool Field::_WriteRegister(uint8_t reg, uint8_t val) {
    uint8_t buf[2] = { reg, val };
    return _i2c.TransmitBlocking(kAddr, buf, 2, 10) == I2CHandle::Result::OK;
}

// Repeated start between the register address and the read, as libDaisy's Mpr121 driver
// does. With a STOP in between, the MPR121 read from 0x00 whatever start_reg was: the
// burst at 0x00 worked by luck, and the ECR health check read the touch status, failed,
// and re-configured the chip every second (a 94 ms main-loop stall and 0.5 s of
// baseline relearning each time).
bool Field::_ReadBurst(uint8_t start_reg, uint8_t* buffer, uint16_t size) {
    return _i2c.ReadDataAtAddress(kAddr, start_reg, 1, buffer, size, 10) == I2CHandle::Result::OK;
}

void Field::Init(DaisySeed& hw) {
    _i2c_cfg.mode           = I2CHandle::Config::Mode::I2C_MASTER;
    _i2c_cfg.periph         = I2CHandle::Config::Peripheral::I2C_1;
    _i2c_cfg.speed          = I2CHandle::Config::Speed::I2C_400KHZ;
    _i2c_cfg.pin_config.scl = Pin(PORTB, 8);
    _i2c_cfg.pin_config.sda = Pin(PORTB, 9);
    _i2c.Init(_i2c_cfg);

    SetSensitivity(0.f);
    _Configure(Profile::Smooth);
}

void Field::_Configure(Profile p) {
    _profile = p;
    _health = kHealthPolls;
#if DEBUG
    _stats.configs++;
#endif

    // No answer: don't stall the main loop on ~60 more timeouts; _CheckChip retries later
    if (!_WriteRegister(0x80, 0x63)) return;   // soft reset
    System::Delay(5);
    _WriteRegister(0x5E, 0x00);   // stop mode

    // Chip touch status is only used for P10/P11 (IsFirmTouched): libDaisy's defaults, as in TouchString
    for (uint8_t i = 0; i < 12; i++) {
        _WriteRegister(0x41 + i * 2, static_cast<uint8_t>(kFirmOn));
        _WriteRegister(0x42 + i * 2, static_cast<uint8_t>(kFirmOff));
    }
    _WriteRegister(0x59, 4);      // ELEPROX touch
    _WriteRegister(0x5A, 2);      // ELEPROX release

    // Electrode baseline filters (same as TouchString; only used internally by the chip)
    _WriteRegister(0x2B, 0x01); _WriteRegister(0x2C, 0x01); _WriteRegister(0x2D, 0x0E); _WriteRegister(0x2E, 0x00);
    _WriteRegister(0x2F, 0x01); _WriteRegister(0x30, 0x01); _WriteRegister(0x31, 0x10); _WriteRegister(0x32, 0x04);
    _WriteRegister(0x33, 0x00); _WriteRegister(0x34, 0x00); _WriteRegister(0x35, 0x00);
    // Proximity electrode filters: very slow falling baseline so presence isn't absorbed
    _WriteRegister(0x36, 0x01); _WriteRegister(0x37, 0x01); _WriteRegister(0x38, 0x0E); _WriteRegister(0x39, 0x00);
    _WriteRegister(0x3A, 0x01); _WriteRegister(0x3B, 0x01); _WriteRegister(0x3C, 0xFF); _WriteRegister(0x3D, 0xFF);
    _WriteRegister(0x3E, 0x00); _WriteRegister(0x3F, 0x00); _WriteRegister(0x40, 0x00);

    _WriteRegister(0x5B, 0x00);   // no chip debounce

    if (p == Profile::Smooth) {
        _WriteRegister(0x5C, 0xD0);   // CONFIG1: FFI = 34 samples, CDC 16 µA
        _WriteRegister(0x5D, 0x51);   // CONFIG2: CDT 1 µs, SFI = 10, ESI 2 ms
        _WriteRegister(0x7B, 0xCB);   // auto-config, FFI bits must match CONFIG1
    } else {
        _WriteRegister(0x5C, 0x10);   // CONFIG1: FFI = 6 samples → more fluctuation passes through
        _WriteRegister(0x5D, 0x41);   // CONFIG2: CDT 1 µs, SFI = 4, ESI 2 ms
        _WriteRegister(0x7B, 0x0B);
    }
    // Auto-config targets for 3.3 V (AN3889). Auto-config also adapts the charge
    // current/time to whatever is attached. This is what makes crocodile clips work.
    _WriteRegister(0x7D, 200);    // USL
    _WriteRegister(0x7E, 130);    // LSL
    _WriteRegister(0x7F, 180);    // TL
    _WriteRegister(0x7C, 0x00);

    _WriteRegister(0x5E, kEcrRun);
    System::Delay(80);

    for (auto& e : _el) e = Electrode {};
    _chip_touch = 0;
    _settle = kSettlePolls;
}

void Field::Recalibrate() {
    _Configure(_sens > 0.7f ? Profile::Raw : Profile::Smooth);
}

void Field::SetSensitivity(float s) {
    _sens = fclamp(s, 0.f, 1.f);
    _UpdateDerived();
}

// The whole right-fader behaviour lives here. Curves are first guesses. Tune them on hardware.
void Field::_UpdateDerived() {
    const float s = _sens;
    // Activation threshold: 40 counts (firm press; a full press is ~300+) → ~1 count (presence / noise level)
    _thr       = lerp_exp(40.f, 1.0f, s);
    // Threshold is kept above the electrode's own noise × this factor. Below 1 at the top
    // of the fader on purpose: the noise itself starts to trigger.
    _noise_mul = lerp(6.f, 0.7f, s);
    // Counts that map to level 1.0
    _range     = lerp_exp(300.f, 12.f, s);
    // Idle baseline tracking: slower when sensitive so a hovering hand isn't "learned away"
    _base_rate = lerp_exp(0.002f, 0.00015f, s);
    // Fluctuation triggers fade in over the top ~55 % of the fader
    float f    = smoothstep(0.45f, 1.f, s);
    _flick_thr = (f <= 0.f) ? 99.f : lerp(9.f, 1.6f, f);
    _flick_refr = static_cast<uint8_t>(lerp(75.f, 12.f, f));   // 300 ms → 48 ms between flickers per pad
}

// Keeps the chip alive. A static discharge from a finger or a clipped wire can reset the
// MPR121: it then sits in Stop mode and keeps returning frozen data without any I2C error,
// so the whole field would go silent. A stuck bus is reset the same way.
bool Field::_CheckChip() {
    if (_fails >= kFailPolls) {
        _fails = 0;
#if DEBUG
        _stats.by_fails++;
#endif
        _i2c.Init(_i2c_cfg);
        _Configure(_profile);
        return false;
    }
    if (_health > 0 && --_health > 0) return true;
    _health = kHealthPolls;
    uint8_t ecr = 0;
    const bool read_ok = _ReadBurst(0x5E, &ecr, 1);
#if DEBUG
    if (read_ok) _stats.last_ecr = ecr;
    if (read_ok && ecr != kEcrRun) _stats.by_ecr++;
#endif
    if (read_ok && ecr != kEcrRun) {
        _Configure(_profile);
        return false;
    }
    return true;
}

void Field::Process() {
    if (!_CheckChip()) return;

    // Touch status (2 bytes), out-of-range status (2), filtered data ELE0..ELE12 (26)
    uint8_t buf[4 + spore::kElectrodes * 2];
    if (!_ReadBurst(0x00, buf, sizeof(buf))) { _fails++; return; }
    _fails = 0;
    _chip_touch = static_cast<uint16_t>(buf[0] | (buf[1] << 8)) & 0x0FFF;
    const uint8_t* raw = buf + 4;

    const bool settling = _settle > 0;
    if (settling) _settle--;

    for (uint8_t i = 0; i < spore::kElectrodes; i++) {
        auto& e = _el[i];
        const float f = static_cast<float>((static_cast<uint16_t>(raw[i * 2 + 1] & 0x03) << 8) | raw[i * 2]);

        if (!e.seeded) {
            e.base = e.prev = f;
            e.seeded = true;
            continue;
        }

        const float d = fabsf(f - e.prev);
        e.prev = f;
        const float delta = e.base - f;    // grows when capacitance rises (finger, hand, plant, wire)

        // Baseline + noise floor ..........................................
        if (settling) {
            e.base  += (f - e.base) * 0.05f;
            e.noise += (d - e.noise) * 0.05f;
            continue;
        }
        // A firm touch also freezes the baseline, so a held control pad isn't learned away
        if (!e.active && !e.firm) {
            e.base  += (f - e.base) * ((delta < 0.f) ? kBaseUpRate : _base_rate);
            e.noise += (d - e.noise) * 0.01f;
            e.held   = 0;
        } else if (++e.held > kStuckPolls) {
            e.base  += (f - e.base) * 0.0005f;
        }
        const float noise = fmaxf(e.noise, 0.25f);

        // Firm touch (fixed, for control pads) ............................
        const float firm_on = fmaxf(kFirmOn, noise * kFirmNoise);
        if (!e.firm && delta > firm_on)                            e.firm = true;
        else if (e.firm && delta < firm_on * (kFirmOff / kFirmOn)) e.firm = false;

        // Continuous level .................................................
        const float thr = fmaxf(_thr, noise * _noise_mul);
        const float lvl = fclamp((delta - 0.5f * thr) / _range, 0.f, 1.f);
        e.level += (lvl - e.level) * 0.3f;

        if (i == spore::kAuraElectrode) {
            // The aura only means something once the field is sensitive
            _aura = e.level * smoothstep(0.35f, 0.9f, _sens);
            continue;
        }

        // Activation with hysteresis + strike velocity .......................
        if (!e.active) {
            if (delta > thr) {
                e.active = true;
                e.rel_cnt = 0;
                e.strike = kStrikePolls;
                e.peak = delta;
            }
        } else if (delta < thr * 0.6f) {
            if (++e.rel_cnt >= 2) {
                e.active = false;
                if (e.strike > 0) e.strike = 1;            // very short blip: still emit the strike below
                if (_listener && i < spore::kFieldPads && e.strike == 0) _listener->OnRelease(i);
            }
        } else {
            e.rel_cnt = 0;
        }

        if (e.strike > 0) {
            e.peak = fmaxf(e.peak, delta);
            if (--e.strike == 0 && _listener && i < spore::kFieldPads) {
                float n = fclamp((e.peak - thr) / _range, 0.f, 1.f);
                float vel = fclamp(0.35f * n + 0.65f * sqrtf(n), 0.05f, 1.f);
                _listener->OnStrike(i, vel);
                if (!e.active) _listener->OnRelease(i);
            }
        }

        // Fluctuation (Scion-style) ...........................................
        const float z = d / noise;                   // change relative to this electrode's own noise
        e.act += (z - e.act) * 0.25f;
        e.act_out = fclamp((e.act - 1.f) / 6.f, 0.f, 1.f);
        if (e.refr > 0) {
            e.refr--;
        } else if (e.act > _flick_thr && i < spore::kFieldPads) {
            float amount = fclamp((e.act - _flick_thr) / _flick_thr, 0.f, 1.f);
            if (_listener) _listener->OnFlicker(i, amount);
            e.refr = _flick_refr;
        }
    }
}
