#include "spore_ui.h"
#include "daisysp.h"

using namespace synthux;
using namespace spore;
using namespace daisy;
using namespace daisysp;

namespace {
constexpr uint16_t kTapMaxTicks   = 150;   // < 0.6 s counts as a tap
constexpr uint16_t kRecalTicks    = 625;   // ~2.5 s both pads held arms a recalibration
constexpr uint16_t kRecalWaitTicks = 75;   // ~0.3 s with both let go before it runs
constexpr uint16_t kRecalLockTicks = 125;  // ~0.5 s after it: P10/P11 ignored (Field relearns baselines)
constexpr uint16_t kBlinkTicks    = 50;    // 200 ms per blink (100 on, 100 off), distinct from touch flashes
constexpr uint8_t  kStrikeFlash   = 12;    // ~50 ms LED flash per detected strike
constexpr uint8_t  kFlickerFlash  = 2;     // ~8 ms per flicker
constexpr int      kMidiPerLoop   = 4;     // UART TX blocks ~1 ms per message: cap the main-loop stall
constexpr float    kKnobStep      = 0.01f; // a knob counts as moved (and shows on the OLED) past 1 %

const char* const kKnobLabels[8] = {
    "REVERB", "DELAY", "CHORUS", "PAD BLEND", "TONE", "ATTACK/DECAY", "MIX", "SENSE",
};
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
    _stage = kStageTouch;
    _oled.WaitIdle();                              // the touch read needs the bus
    _touch.Process();                              // reads the MPR121, fires OnStrike/OnFlicker
    _oled.Service();                               // starts at most one half page by DMA
    _stage = kStageControls;   _ProcessControls();
    _stage = kStageModPads;    _ProcessModPads();
    _stage = kStageIntensity;  _UpdateIntensity();
    _stage = kStageMidiOut;    _SendNotes();
    _stage = kStageIdle;
    _screen.SetHarmony(_engine.Root(), _engine.Scale(), _engine.ChordRoot(), _engine.ChordTones());
    _screen.Draw();
    _Led(hw);
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
    const float v[8] = {
        k.s30().Process(), k.s31().Process(), k.s32().Process(), k.s33().Process(),
        k.s34().Process(), k.s35().Process(), k.s36().Process(), k.s37().Process(),
    };
    _engine.SetReverb(v[0]);
    _engine.SetDelay(v[1]);
    _engine.SetChorus(v[2]);
    _engine.SetPadBlend(v[3]);
    _engine.SetPlinkTone(v[4]);
    _engine.SetPlinkShape(v[5]);
    _engine.SetMix(v[6]);
    _touch.field().SetSensitivity(v[7]);

    auto a = _touch.switches().A();
    _engine.SetAutoMode(a == Switch3::POS_DOWN ? Generator::Mode::Off : Generator::Mode::On);
    _engine.SetAutoMod(a == Switch3::POS_UP);
    auto b = _touch.switches().B();
    _engine.SetCeiling(b == Switch3::POS_UP ? 3 : b == Switch3::POS_CENTER ? 2 : 1);

    // OLED: the last control that moved
    if (_settle > 0) {
        _settle--;
        for (int i = 0; i < 8; i++) _shown[i] = v[i];
        _sw_a = a; _sw_b = b;
        return;
    }
    for (int i = 0; i < 8; i++) {
        if (fabsf(v[i] - _shown[i]) > kKnobStep) { _shown[i] = v[i]; _ShowKnob(i, v[i]); }
    }
    if (a != _sw_a) { _sw_a = a; _ShowSwitch(true, a); }
    if (b != _sw_b) { _sw_b = b; _ShowSwitch(false, b); }
}

void SporeUI::_ShowKnob(int i, float v) {
    char val[22];
    char* p = val;
    const int pct = static_cast<int>(v * 100.f + 0.5f);
    if (i == 4) {
        // Zones as in Engine's ToneFor(): glass blends into wood up to 0.45, drive above 0.55
        p = PutStr(p, v < 0.2f ? "glass " : v < 0.55f ? "wood " : "drive ");
    }
    if (i == 6) {   // 0 = pads only, 1 = plinks only
        p = PutStr(p, "PD ");
        p = PutInt(p, 100 - pct);
        p = PutStr(p, " : PL ");
        PutInt(p, pct);
    } else {
        p = PutInt(p, pct);
        p = PutStr(p, " %");
        // Flickers fade in over the top of the fader (Field::_UpdateDerived)
        if (i == 7 && v > 0.45f) PutStr(p, " flicker");
    }
    _screen.ShowControl(kKnobLabels[i], val);
}

void SporeUI::_ShowSwitch(bool autoplay, int pos) {
    if (autoplay) {
        _screen.ShowControl("AUTOPLAY", pos == Switch3::POS_DOWN ? "off" : pos == Switch3::POS_CENTER ? "on" : "on + vary");
        return;
    }
    // Same octave as Engine's ceiling: degree 0 of the plinks plus 1–3 octaves
    const int oct = pos == Switch3::POS_UP ? 3 : pos == Switch3::POS_CENTER ? 2 : 1;
    char val[8];
    PutNote(val, kPlinkBaseMidi + _engine.Root() + 12 * oct, true);
    _screen.ShowControl("HIGHEST NOTE", val);
}

// P10 / P11 use the fixed "firm" threshold, so they stay reliable whatever the fader says.
void SporeUI::_ProcessModPads() {
    auto& f = _touch.field();
    const bool t10 = f.IsFirmTouched(kPadSynthPad);
    const bool t11 = f.IsFirmTouched(kPlinkPad);

    // The recalibration runs only once both pads are let go. With fingers on the board,
    // the MPR121's auto-config sets each pad's charge current for a pad with a finger on
    // it, and the baselines learn the fingers. Recalibrating while held left P10/P11 not
    // responding afterwards (2026-11-08, most likely this).
    if (_recal_armed) {
        if (t10 || t11) { _recal_wait = kRecalWaitTicks; return; }
        if (--_recal_wait > 0) return;
        _recal_armed = false;
        f.Recalibrate();   // picks Smooth/Raw profile from the fader position
        const bool raw = f.CurrentProfile() == Field::Profile::Raw;
        _Blink(raw ? 4 : 3);
        _screen.ShowControl("RECALIBRATED", raw ? "raw" : "smooth");
        _recal_lock = kRecalLockTicks;
        return;
    }
    // Field ignores strikes while it relearns. Keep P10/P11 quiet for as long, so the
    // "RECALIBRATED" line stays up and a stray touch can't toggle routing.
    if (_recal_lock > 0) {
        if (t10 || t11) _recal_lock = kRecalLockTicks;
        else            _recal_lock--;
        return;
    }

    if (t10 && t11) {
        _both_used = true;
        if (++_hold_10 > kRecalTicks) {
            _recal_armed = true;
            _recal_wait = kRecalWaitTicks;
            _hold_10 = _hold_11 = 0;
            _both_used = false;
            _screen.ShowControl("RECALIBRATE", "let go");
            return;
        }
        _screen.ShowProgress("RECAL", static_cast<float>(_hold_10) / kRecalTicks);
        _hold_11 = _hold_10;
        return;
    }

    _screen.ShowProgress("", -1.f);   // a hold let go before 2.5 s: back to the control line

    // Toggle on release of a short tap
    if (!t10 && _hold_10 > 0) {
        if (!_both_used && _hold_10 < kTapMaxTicks) {
            _to_pads = !_to_pads;
            _Blink(_to_pads ? 2 : 1);
            _screen.ShowControl("FIELD -> PADS", _to_pads ? "on" : "off");
        }
        _hold_10 = 0;
    }
    if (!t11 && _hold_11 > 0) {
        if (!_both_used && _hold_11 < kTapMaxTicks) {
            _to_plinks = !_to_plinks;
            _Blink(_to_plinks ? 2 : 1);
            _screen.ShowControl("FIELD -> PLINKS", _to_plinks ? "on" : "off");
        }
        _hold_11 = 0;
    }
    if (t10) _hold_10++;
    if (t11) _hold_11++;
    if (!t10 && !t11) _both_used = false;
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
        _screen.OnNote(n);
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
    // …and while an armed recalibration waits for both to be let go
    if (_hold_10 > 0 || _hold_11 > 0 || _recal_armed) { hw.SetLed(true); return; }
    if (_blink_count > 0) {
        bool on = (_blink_tick % kBlinkTicks) < kBlinkTicks / 2;
        if (++_blink_tick >= kBlinkTicks * _blink_count) { _blink_count = 0; _blink_tick = 0; }
        hw.SetLed(on);
        return;
    }
    hw.SetLed(_flash > 0);
    if (_flash > 0) _flash--;
}
