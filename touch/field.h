#pragma once

#include "daisy_seed.h"
#include "config.h"
#include "nocopy.h"
#include <array>

namespace synthux {

// Receives field events. Called synchronously from Field::Process() (main loop).
class FieldListener {
public:
    virtual ~FieldListener() {}
    virtual void OnStrike(uint8_t pad, float velocity) = 0;   // pad crossed the sensitivity threshold
    virtual void OnFlicker(uint8_t pad, float amount)  = 0;   // pad's signal fluctuated (high sensitivity only)
    virtual void OnRelease(uint8_t pad)                = 0;
};

// MPR121 driver that treats the electrodes as a continuous capacitive *field*
// instead of a set of buttons.
//
// Differences from TouchString's Pads:
//  • Ignores the chip's touch status and baselines. Thresholds, hysteresis and
//    baseline tracking are done in software, so the right fader can move them
//    live without stopping the chip (config registers can only be written in Stop mode).
//  • Reads the 13th "proximity" electrode (all 12 pads combined = the whole
//    board as one antenna) as an "aura" level for presence.
//  • At high sensitivity, fluctuation of each electrode (normalised to its own
//    noise floor) fires Flicker events (the Pocket-Scion-style "the plant is
//    playing" behaviour). This also works with crocodile clips/wires on the pads.
//  • Two AFE profiles: Smooth (heavy filtering, stable touch) and Raw (light
//    filtering, lets the fluctuations through). Chosen at Recalibrate() from the
//    current sensitivity, so they never glitch mid-performance.
class Field {
public:
    enum class Profile : uint8_t { Smooth, Raw };

    Field() {}
    void Init(daisy::DaisySeed& hw);
    void Process();                       // call at ~250 Hz from the main loop
    void Recalibrate();                   // call after attaching/removing clips
    void SetListener(FieldListener* l) { _listener = l; }

    // 0 = needs a firm touch … 1 = reacts to presence, wires act as antennas, noise becomes music
    void  SetSensitivity(float s);
    float Sensitivity() const { return _sens; }

    float Level(uint8_t e) const    { return _el[e].level; }     // 0..1 continuous proximity/pressure
    float Activity(uint8_t e) const { return _el[e].act_out; }   // 0..1 fluctuation amount
    bool  IsActive(uint8_t e) const { return _el[e].active; }
    float Aura() const              { return _aura; }            // whole-board presence 0..1

    // Fixed-threshold touch, independent of the fader. Used for the P10/P11 control pads,
    // which must stay reliable when the field is hyper sensitive. Either the chip's own
    // touch detection (same thresholds as TouchString) or the software one.
    bool  IsFirmTouched(uint8_t e) const { return _el[e].firm || (_chip_touch & (1u << e)); }

    Profile CurrentProfile() const { return _profile; }

#if DEBUG
    // For the serial log in TouchSpore.cpp: how often _Configure() ran, why, and the
    // last ECR value the health check read back.
    struct Stats { uint16_t configs, by_ecr, by_fails; uint8_t last_ecr; };
    Stats TakeStats() { Stats s = _stats; _stats.configs = _stats.by_ecr = _stats.by_fails = 0; return s; }
#endif

private:
    NOCOPY(Field)

    struct Electrode {
        float   base     = 0.f;   // software baseline (counts)
        float   prev     = 0.f;
        float   noise    = 0.5f;  // mean |Δ| between polls while idle (counts)
        float   level    = 0.f;
        float   act      = 0.f;   // fluctuation z-score envelope
        float   act_out  = 0.f;
        float   peak     = 0.f;
        uint16_t held    = 0;
        uint8_t strike   = 0;     // strike window countdown (velocity measurement)
        uint8_t rel_cnt  = 0;
        uint8_t refr     = 0;     // flicker refractory countdown
        bool    active   = false;
        bool    firm     = false;
        bool    seeded   = false;
    };

    void _Configure(Profile p);
    bool _CheckChip();
    bool _WriteRegister(uint8_t reg, uint8_t val);
    bool _ReadBurst(uint8_t start_reg, uint8_t* buffer, uint16_t size);
    void _UpdateDerived();

    static constexpr uint8_t kAddr = 0x5A;

    daisy::I2CHandle         _i2c;
    daisy::I2CHandle::Config _i2c_cfg;
    uint16_t _chip_touch = 0;      // MPR121 touch status bits
    uint16_t _fails      = 0;      // consecutive failed reads
    uint16_t _health     = 0;      // polls until the next chip check
#if DEBUG
    Stats    _stats      = {};
#endif
    FieldListener*   _listener = nullptr;
    std::array<Electrode, spore::kElectrodes> _el;

    Profile _profile  = Profile::Smooth;
    float   _sens     = 0.f;
    float   _aura     = 0.f;
    uint16_t _settle  = 0;         // polls of event-free settling after (re)calibration

    // Derived from sensitivity (recomputed in SetSensitivity)
    float _thr        = 40.f;      // activation threshold, counts
    float _noise_mul  = 6.f;       // threshold never goes below noise × this
    float _range      = 300.f;     // counts mapped to level 1.0
    float _base_rate  = 0.002f;    // baseline tracking speed while idle
    float _flick_thr  = 99.f;      // fluctuation z-score threshold (99 = off)
    uint8_t _flick_refr = 40;      // min polls between flickers per pad
};

} // namespace synthux
