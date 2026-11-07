#include "spore_ui.h"
#include "daisysp.h"

using namespace synthux;
using namespace spore;
using namespace daisy;
using namespace daisysp;

namespace {
constexpr uint16_t kTapMaxTicks   = 150;   // < 0.6 s counts as a tap
constexpr uint16_t kRecalTicks    = 120;   // ~0.5 s both pads held
constexpr uint16_t kBlinkTicks    = 50;    // 200 ms per blink (100 on, 100 off), distinct from touch flashes
constexpr uint8_t  kStrikeFlash   = 12;    // ~50 ms LED flash per detected strike
constexpr uint8_t  kFlickerFlash  = 2;     // ~8 ms per flicker
constexpr int      kMidiPerLoop   = 4;     // UART TX blocks ~1 ms per message: cap the main-loop stall
}

void SporeUI::Init(DaisySeed& hw) {
    _touch.field().SetListener(this);

#ifdef USB_MIDI
    MidiUsbHandler::Config usb_cfg;
    // With no app reading the port every TX fails, and each retry burns 100 µs of the main loop
    usb_cfg.transport_config.tx_retry_count = 1;
    _midi_usb.Init(usb_cfg);
#endif
#ifdef UART_MIDI
    // Default UART MIDI pins: USART1, RX = D14 (PB7), TX = D13 (PB6)
    MidiUartHandler::Config uart_cfg;
    _midi_uart.Init(uart_cfg);
    // libDaisy leaves RX floating. Pull it up to MIDI's idle level, so an unplugged jack
    // reads as silence instead of noise (PB7 = D14).
    GPIOB->PUPDR = (GPIOB->PUPDR & ~(3u << (7 * 2))) | (1u << (7 * 2));
    _midi_uart.StartReceive();
#endif
}

void SporeUI::Process(DaisySeed& hw) {
    _beat = _beat + 1;
    _stage = kStageMidiIn;     _ProcessMidi();
    _stage = kStageTouch;      _touch.Process();   // reads the MPR121, fires OnStrike/OnFlicker
    _stage = kStageControls;   _ProcessControls();
    _stage = kStageModPads;    _ProcessModPads();
    _stage = kStageIntensity;  _UpdateIntensity();
    _stage = kStageMidiOut;    _SendNotes();
    _stage = kStageIdle;       _Led(hw);
}

// Field → engine ...............................................................

void SporeUI::OnStrike(uint8_t pad, float velocity) {
    _recent = fminf(_recent + 0.12f + 0.25f * velocity, 1.5f);
    _flash = kStrikeFlash;
    _engine.PushTouch({ TouchEvent::Strike, pad, velocity, _Targets() });
}

void SporeUI::OnFlicker(uint8_t pad, float amount) {
    _recent = fminf(_recent + 0.02f + 0.04f * amount, 1.5f);
    if (_flash < kFlickerFlash) _flash = kFlickerFlash;
    // Flickers only ever play plinks; pads are reserved for deliberate strikes
    _engine.PushTouch({ TouchEvent::Flicker, pad, amount, static_cast<uint8_t>(_Targets() & kToPlinks) });
}

// Knobs, faders, switches ...........................................................

void SporeUI::_ProcessControls() {
    auto& k = _touch.knobs();
    _engine.SetReverb(k.s30().Process());
    _engine.SetDelay(k.s31().Process());
    _engine.SetChorus(k.s32().Process());
    _engine.SetPadBlend(k.s33().Process());
    _engine.SetPlinkTone(k.s34().Process());
    _engine.SetPlinkShape(k.s35().Process());
    _engine.SetMix(k.s36().Process());
    _touch.field().SetSensitivity(k.s37().Process());

    auto a = _touch.switches().A();
    _engine.SetAutoMode(a == Switch3::POS_DOWN ? Generator::Mode::Off : Generator::Mode::On);
    _engine.SetAutoMod(a == Switch3::POS_UP);
    auto b = _touch.switches().B();
    _engine.SetCeiling(b == Switch3::POS_UP ? 3 : b == Switch3::POS_CENTER ? 2 : 1);
}

// P10 / P11 use the fixed "firm" threshold, so they stay reliable whatever the fader says.
void SporeUI::_ProcessModPads() {
    auto& f = _touch.field();
    const bool t10 = f.IsFirmTouched(kPadSynthPad);
    const bool t11 = f.IsFirmTouched(kPlinkPad);

    if (t10 && t11) {
        _both_used = true;
        if (++_hold_10 > kRecalTicks && !_recal_latched) {
            _recal_latched = true;
            f.Recalibrate();   // picks Smooth/Raw profile from the fader position
            _Blink(f.CurrentProfile() == Field::Profile::Raw ? 4 : 3);
        }
        _hold_11 = _hold_10;
        return;
    }

    // Toggle on release of a short tap
    if (!t10 && _hold_10 > 0) {
        if (!_both_used && _hold_10 < kTapMaxTicks) { _to_pads = !_to_pads; _Blink(_to_pads ? 2 : 1); }
        _hold_10 = 0;
    }
    if (!t11 && _hold_11 > 0) {
        if (!_both_used && _hold_11 < kTapMaxTicks) { _to_plinks = !_to_plinks; _Blink(_to_plinks ? 2 : 1); }
        _hold_11 = 0;
    }
    if (t10) _hold_10++;
    if (t11) _hold_11++;
    if (!t10 && !t11) { _both_used = false; _recal_latched = false; }
}

// Intensity: how much is happening on the field. Rises fast, falls slowly.
void SporeUI::_UpdateIntensity() {
    auto& f = _touch.field();
    float max_lvl = 0.f, sum_act = 0.f;
    for (uint8_t i = 0; i < kFieldPads; i++) {
        max_lvl = fmaxf(max_lvl, f.Level(i));
        sum_act += f.Activity(i);
    }
    _recent *= 0.995f;                                         // ~0.8 s half-life
    float target = fclamp(0.45f * max_lvl + 0.05f * sum_act + 0.5f * _recent + 0.4f * f.Aura(), 0.f, 1.f);
    _intensity += (target - _intensity) * ((target > _intensity) ? 0.05f : 0.004f);
    _engine.SetIntensity(_intensity);
}

// MIDI ..............................................................................

void SporeUI::_ProcessMidi() {
#ifdef USB_MIDI
    _midi_usb.Listen();
    while (_midi_usb.HasEvents()) { auto m = _midi_usb.PopEvent(); _HandleMidi(m); }
#endif
#ifdef UART_MIDI
    _midi_uart.Listen();
    while (_midi_uart.HasEvents()) { auto m = _midi_uart.PopEvent(); _HandleMidi(m); }
#endif
}

void SporeUI::_HandleMidi(MidiEvent& m) {
    switch (m.type) {
        case ControlChange: {
            auto cc = m.AsControlChange();
            if (cc.control_number == kCcRoot)       _engine.SetRoot(cc.value % 12);
            else if (cc.control_number == kCcScale) _engine.SetScale(cc.value);
            else if (cc.control_number == 123)      _engine.AllNotesOff();
            break;
        }
        case ProgramChange:
            _engine.SetScale(m.AsProgramChange().program);
            break;
        case NoteOn: {
            auto on = m.AsNoteOn();
            if (m.channel == kRootNoteChannel && on.velocity > 0) _engine.SetRoot(on.note % 12);
            break;
        }
        default: break;
    }
}

void SporeUI::_SendNotes() {
    NoteOut n;
    int budget = kMidiPerLoop;
    while (budget-- > 0 && _engine.PopNoteOut(n)) {
        uint8_t msg[3] = {
            static_cast<uint8_t>((n.velocity ? 0x90 : 0x80) | (n.channel & 0x0F)),
            static_cast<uint8_t>(n.note & 0x7F),
            n.velocity,
        };
#ifdef USB_MIDI
        _midi_usb.SendMessage(msg, 3);
#endif
#ifdef UART_MIDI
        _midi_uart.SendMessage(msg, 3);
#endif
    }
}

// LED: flash per detected touch (so sensing and sound can be told apart);
// blink patterns confirm toggles/recalibration .......................................

void SporeUI::_Led(DaisySeed& hw) {
    // Solid while P10/P11 is held: shows the touch is detected, before the tap registers
    if (_hold_10 > 0 || _hold_11 > 0) { hw.SetLed(true); return; }
    if (_blink_count > 0) {
        bool on = (_blink_tick % kBlinkTicks) < kBlinkTicks / 2;
        if (++_blink_tick >= kBlinkTicks * _blink_count) { _blink_count = 0; _blink_tick = 0; }
        hw.SetLed(on);
        return;
    }
    hw.SetLed(_flash > 0);
    if (_flash > 0) _flash--;
}
