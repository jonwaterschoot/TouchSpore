#pragma once

#include "daisy_seed.h"
#include "touch.h"
#include "engine.h"
#include "config.h"
#include "oled.h"
#include "spore_screen.h"
#include "spore_settings.h"

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
//   P10 + P11 held + firm touch on P02..P09: scale 0..7
//   P10 + P11 held + P00: tap = next root, long press = C. Played on a plink.
//     Both stay open until 2 s after the last pick with P10/P11 let go (_ProcessPickPads)
//   Volume, scale and root save when their gesture ends. Root and scale sent over MIDI
//   save ~5 s after the last change. Nothing else is saved.
class SporeUI : public FieldListener {
public:
    SporeUI(Touch& touch, spore::Engine& engine, Oled& oled, SettingsStore& settings)
        : _touch(touch), _engine(engine), _oled(oled), _settings(settings), _screen(oled) {}

    void Init(daisy::DaisySeed& hw);
    void Process(daisy::DaisySeed& hw);     // ~250 Hz from the main loop

    // Main-loop watchdog, read from the audio callback: Beat() advances every pass,
    // Stage() says which part of the pass is running (the blink code when it stalls).
    // kStageTouch covers all I2C: the MPR121 read and the OLED transfer. kStageIdle
    // covers the screen redraw, the settings save and the LED.
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
    void _ProcessPickPads(bool t10, bool t11);
    void _PickRoot(uint8_t root);
    void _MidiRoot(uint8_t root);
    void _MidiScale(uint8_t scale);
    void _MidiKnob(uint8_t knob, float value);
    void _UpdateIntensity();
    void _ProcessMidi();
    void _HandleMidi(daisy::MidiEvent& m);
    bool _SendNotes();                      // true if any message went out this pass
    void _SendLink(bool notes_sent);
    void _ResendLink();
    void _SendCc(uint8_t cc, uint8_t value);
    void _Blink(uint8_t count) { _blink_count = count; _blink_tick = 0; }
    void _Led(daisy::DaisySeed& hw);

    uint8_t _Targets() const {
        return (_to_pads ? spore::kToPads : 0) | (_to_plinks ? spore::kToPlinks : 0);
    }

    Touch&         _touch;
    spore::Engine& _engine;
    Oled&          _oled;
    SettingsStore& _settings;
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

    // Scale and root gestures. _scale_pick and _root_pick also follow MIDI, and are what
    // gets saved.
    bool     _pick_mode = false;
    uint16_t _pick_idle = 0;
    uint8_t  _scale_firm = 0;         // firm-touch bits of P02..P09 on the last pass
    bool     _root_firm = false;      // P00 firm-touched on the last pass
    uint16_t _root_ticks = 0;         // passes of the current P00 press, 0 = no press
    uint8_t  _scale_pick = spore::kDefaultScale;
    uint8_t  _root_pick = spore::kDefaultRoot;
    uint16_t _midi_save_wait = 0;     // passes until a root or scale sent over MIDI is saved
    bool     _save_pending = false;   // set when a gesture ends, written in kStageIdle

    // CC 22..29 hold a knob at the MIDI value until the physical knob leaves _midi_anchor
    float    _panel[8] = {};          // physical positions on the last pass
    float    _midi_value[8] = {};
    float    _midi_anchor[8] = {};
    uint8_t  _midi_knobs = 0;         // bit per knob: held by MIDI

    // Web manual link (_SendLink). The _sent_* arrays hold the last frame payloads.
    uint8_t  _sent_root = 0, _sent_scale = 0;
    uint8_t  _sent_live[4] = {};
    uint8_t  _sent_state[11] = {};
    uint16_t _link_ticks = 0;         // passes left of the frames, 0 = no page connected
    uint8_t  _link_beat = 0;
    uint8_t  _live_wait = 0, _state_wait = 0;

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
    uint8_t  _saved_flicker = 0;   // passes left of the "settings saved" flicker
};

} // namespace synthux
