#pragma once

#include "daisy_seed.h"
#include "touch.h"
#include "engine.h"
#include "config.h"
#include "oled.h"
#include "spore_screen.h"

namespace synthux {

// Controls ..................................................................
//   S30 reverb      S31 delay       S32 chorus
//   S33 pad blend   S34 plink tone: glass → wood → saturated   S35 plink attack/decay
//   S36 (left fader)  pads ←→ plinks mix, centre = 50/50
//   S37 (right fader) field sensitivity: firm touch → presence / antenna
//   Right switch: up = autoplay + per-note random octave, tone (S34) and length (S35),
//                 centre = autoplay, down = touch only
//   Left switch:  highest plink note   up = D7, centre = D6, down = D5 (at root D; higher notes fold down)
//   P00..P09  the field (notes, flickers, intensity)
//   P10 tap   toggle: field → slow pads (touch picks the next chord root)
//   P11 tap   toggle: field → plinks
//   P10 + P11 hold ~2.5 s, then let go: recalibrate (do this after attaching crocodile clips)
//   P10 + P11 held + S36 moved: S36 sets the volume until it rests 2 s (_ProcessFader)
class SporeUI : public FieldListener {
public:
    SporeUI(Touch& touch, spore::Engine& engine, Oled& oled)
        : _touch(touch), _engine(engine), _oled(oled), _screen(oled) {}

    void Init(daisy::DaisySeed& hw);
    void Process(daisy::DaisySeed& hw);     // ~250 Hz from the main loop

    // Main-loop watchdog, read from the audio callback: Beat() advances every pass,
    // Stage() says which part of the pass is running (the blink code when it stalls).
    // kStageTouch covers all I2C: the MPR121 read and the OLED transfer. kStageIdle
    // covers the screen redraw and the LED.
    enum Stage : uint8_t {
        kStageMidiIn = 1, kStageTouch, kStageControls, kStageModPads,
        kStageIntensity, kStageMidiOut, kStageIdle,
    };
    uint32_t Beat() const  { return _beat; }
    uint8_t  Stage() const { return _stage; }

    // FieldListener
    void OnStrike(uint8_t pad, float velocity) override;
    void OnFlicker(uint8_t pad, float amount) override;
    void OnRelease(uint8_t pad) override {}

private:
    void _ProcessControls();
    void _ShowKnob(int i, float v);
    void _ShowSwitch(bool autoplay, int pos);
    void _ProcessModPads();
    void _UpdateIntensity();
    void _ProcessMidi();
    void _HandleMidi(daisy::MidiEvent& m);
    void _SendNotes();
    void _Blink(uint8_t count) { _blink_count = count; _blink_tick = 0; }
    void _Led(daisy::DaisySeed& hw);

    uint8_t _Targets() const {
        return (_to_pads ? spore::kToPads : 0) | (_to_plinks ? spore::kToPlinks : 0);
    }

    Touch&         _touch;
    spore::Engine& _engine;
    Oled&          _oled;
    SporeScreen    _screen;

    // Last value shown per knob (S30–S37). The first passes only follow the knobs:
    // AnalogControl's smoothing starts at 0, and that ramp is not a change.
    float    _shown[8] = {};
    uint8_t  _settle = 50;
    int      _sw_a = -1, _sw_b = -1;

    // Hidden volume: S36 moved while P10 + P11 are held. S36 then sets the volume until
    // it has been still for kVolumeHoldTicks. The mix stays put meanwhile, and S36 takes
    // it back only once the fader crosses the old mix position (pickup, no jump).
    void     _ProcessFader(float s36);
    float    _volume = spore::kDefaultVolume;
    float    _mix = 0.5f;
    bool     _vol_mode = false;
    uint16_t _vol_idle = 0;
    bool     _mix_pickup = false;
    bool     _pickup_above = false;   // fader was above the mix when the pickup started

#ifdef USB_MIDI
    daisy::MidiUsbHandler  _midi_usb;
#endif
#ifdef UART_MIDI
    daisy::MidiUartHandler _midi_uart;
#endif

    // Routing (P10/P11)
    bool     _to_pads = false;
    bool     _to_plinks = true;
    uint16_t _hold_10 = 0, _hold_11 = 0;
    bool     _both_used = false;
    bool     _recal_armed = false; // held 2.5 s: recalibrates once both pads are let go
    uint16_t _recal_wait = 0;      // passes with both let go still to wait
    uint16_t _recal_lock = 0;      // passes left before P10/P11 count again after a recalibration

    // Intensity
    float _recent = 0.f;
    float _intensity = 0.f;

    // Watchdog
    volatile uint32_t _beat = 0;
    volatile uint8_t  _stage = 0;

    // LED
    uint8_t  _flash = 0;
    uint8_t  _blink_count = 0;
    uint16_t _blink_tick = 0;
};

} // namespace synthux
