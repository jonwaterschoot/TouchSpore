#pragma once

#include "daisy_seed.h"
#include "touch.h"
#include "engine.h"
#include "config.h"

namespace synthux {

// Controls ..................................................................
//   S30 reverb      S31 delay       S32 chorus
//   S33 pad blend   S34 plink blend S35 plink attack/decay
//   S36 (left fader)  pads ←→ plinks mix, centre = 50/50
//   S37 (right fader) field sensitivity: firm touch → presence / antenna
//   Right switch: autoplay   up = on, centre = sparse, down = off (touch only)
//   Left switch:  density filter   up = free, centre = melodic, down = strict
//   P00..P09  the field (notes, flickers, intensity)
//   P10 tap   toggle: field → slow pads (touch picks the next chord root)
//   P11 tap   toggle: field → plinks
//   P10 + P11 hold ~0.5 s: recalibrate (do this after attaching crocodile clips)
class SporeUI : public FieldListener {
public:
    SporeUI(Touch& touch, spore::Engine& engine) : _touch(touch), _engine(engine) {}

    void Init(daisy::DaisySeed& hw);
    void Process(daisy::DaisySeed& hw);     // ~250 Hz from the main loop

    // FieldListener
    void OnStrike(uint8_t pad, float velocity) override;
    void OnFlicker(uint8_t pad, float amount) override;
    void OnRelease(uint8_t pad) override {}

private:
    void _ProcessControls();
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
    bool     _recal_latched = false;

    // Intensity
    float _recent = 0.f;
    float _intensity = 0.f;

    // LED
    uint32_t _last_note_count = 0;
    uint8_t  _flash = 0;
    uint8_t  _blink_count = 0;
    uint16_t _blink_tick = 0;
};

} // namespace synthux
