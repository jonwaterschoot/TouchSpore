#include "spore_ui.h"
#include "daisysp.h"
#include <cstring>

using namespace synthux;
using namespace spore;
using namespace daisy;
using namespace daisysp;

namespace {
constexpr uint16_t kTapMaxTicks   = 150;   // < 0.6 s counts as a tap
#ifdef SIMPLE_TOUCH_WEB
// A mouse needs two right-clicks and a trip to the third control, and an armed recalibration
// refuses the volume, scale and root gestures.
constexpr uint16_t kRecalTicks    = 2500;  // ~10 s both pads held arms a recalibration
#else
constexpr uint16_t kRecalTicks    = 625;   // ~2.5 s both pads held arms a recalibration
#endif
constexpr uint16_t kRecalWaitTicks = 75;   // ~0.3 s with both let go before it runs
constexpr uint16_t kRecalLockTicks = 125;  // ~0.5 s after it: P10/P11 ignored (Field relearns baselines)
constexpr uint16_t kBlinkTicks    = 50;    // 200 ms per blink (100 on, 100 off), distinct from touch flashes
constexpr uint8_t  kSavedFlickerTicks = 125; // 500 ms of fast flicker: settings saved
constexpr uint8_t  kSavedFlickerPeriod = 16; // ~15 Hz, faster than any blink code
constexpr uint8_t  kStrikeFlash   = 12;    // ~50 ms LED flash per detected strike
constexpr uint8_t  kFlickerFlash  = 2;     // ~8 ms per flicker
constexpr int      kMidiPerLoop   = 4;     // UART TX blocks ~1 ms per message: cap the main-loop stall
constexpr float    kKnobStep      = 0.01f; // a knob counts as moved (and shows on the OLED) past 1 %
constexpr uint16_t kVolumeHoldTicks = 500; // ~2 s with S36 still: back from volume to mix
constexpr uint16_t kPickWindowTicks = 500; // ~2 s after the last pick with P10/P11 let go. Longer than 8 blinks
constexpr uint8_t  kRootPad       = 0;     // P00: tap = next root, press for kTapMaxTicks = C
constexpr uint8_t  kFirstScalePad = 2;     // P02..P09 pick scales 0..7. P01 is hard to reach, so unused
constexpr uint8_t  kScalePads     = 8;
constexpr float    kRootPlinkVel  = 0.7f;
constexpr uint16_t kMidiSaveTicks = 1250;  // ~5 s after the last root or scale sent over MIDI
constexpr float    kKnobTakeback  = 0.02f; // a knob held by MIDI returns to the panel past 2 %
constexpr uint16_t kLinkTicks     = 2500;  // ~10 s after the last REQUEST: frames stop
constexpr uint8_t  kLinkBeatTicks = 125;   // ~500 ms: everything re-sent while linked
constexpr uint8_t  kFrameTicks    = 8;     // ~33 ms: fastest rate per frame type
constexpr uint8_t  kOledTicks     = 2;     // ~8 ms per half page: a full screen in ~64 ms
constexpr uint8_t  kHitTicks      = 4;     // ~16 ms between hits frames

// SysEx bodies, without F0 and F7 (libDaisy strips those)
const uint8_t kRequest[5] = { 0x7D, 0x53, 0x50, 0x01, 0x7E };
const uint8_t kTouch[5]   = { 0x7D, 0x53, 0x50, 0x01, 0x02 };   // then one force per pad, 0..127
constexpr size_t kPads = 12;

const char* const kKnobLabels[8] = {
    "REVERB", "DELAY", "CHORUS", "PAD BLEND", "TONE", "ATTACK/DECAY", "MIX", "SENSE",
};

// Wire format of the live frame: 0 = up, 1 = centre, 2 = down
uint8_t WirePos(int pos) {
    return pos == Switch3::POS_DOWN ? 2 : pos == Switch3::POS_CENTER ? 1 : 0;
}
}

void SporeUI::Init(DaisySeed& hw) {
    _touch.field().SetListener(this);

    const Settings& saved = _settings.Get();
    _root_pick  = saved.root;
    _scale_pick = saved.scale;
    _volume     = saved.volume;
    _sent_root  = saved.root;     // no port is open yet: a page asks with REQUEST
    _sent_scale = saved.scale;

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
    _stage = kStageMidiOut;    _SendLink(_SendNotes());
    _stage = kStageIdle;
    _screen.SetHarmony(_engine.Root(), _engine.Scale(), _engine.ChordRoot(), _engine.ChordTones());
    _screen.Draw();
    if (_midi_save_wait > 0 && --_midi_save_wait == 0) _save_pending = true;
    if (_save_pending) {
        _save_pending = false;
        _midi_save_wait = 0;   // every save writes all values
        _settings.Save({ Settings::kVersion, _root_pick, _scale_pick, _volume });
        _saved_flicker = kSavedFlickerTicks;
    }
    _Led(hw);
}

// Field → engine ...............................................................

void SporeUI::OnStrike(uint8_t pad, float velocity) {
    // Picking a scale or root plays no field notes. The strike can land before or after
    // the firm touch that makes the pick, so this also covers the passes with P10 + P11 held.
    auto& f = _touch.field();
    if (_pick_mode || (f.IsFirmTouched(kPadSynthPad) && f.IsFirmTouched(kPlinkPad))) return;

    _recent =fminf(_recent + 0.12f + 0.25f * velocity, 1.5f);
    _flash = kStrikeFlash;
    if (_Targets() & kToPlinks) _Hit(pad, velocity);   // the chord engine doesn't light pads
    _engine.PushTouch({ TouchEvent::Strike, pad, velocity, _Targets() });
}

void SporeUI::OnFlicker(uint8_t pad, float amount) {
    _recent = fminf(_recent + 0.02f + 0.04f * amount, 1.5f);
    if (_flash < kFlickerFlash) _flash = kFlickerFlash;
    if (_Targets() & kToPlinks) _Hit(pad, 0.15f + 0.45f * amount);
    // Flickers only ever play plinks; pads are reserved for deliberate strikes
    _engine.PushTouch({ TouchEvent::Flicker, pad, amount, static_cast<uint8_t>(_Targets() & kToPlinks) });
}

// Knobs, faders, switches ...........................................................

void SporeUI::_ProcessControls() {
    auto& k = _touch.knobs();
    float v[8] = {
        k.s30().Process(), k.s31().Process(), k.s32().Process(), k.s33().Process(),
        k.s34().Process(), k.s35().Process(), k.s36().Process(), k.s37().Process(),
    };
    for (int i = 0; i < 8; i++) {
        _panel[i] = v[i];
        if (!(_midi_knobs & (1u << i))) continue;
        if (fabsf(v[i] - _midi_anchor[i]) > kKnobTakeback) _midi_knobs &= ~(1u << i);
        else v[i] = _midi_value[i];
    }
    _engine.SetReverb(v[0]);
    _engine.SetDelay(v[1]);
    _engine.SetChorus(v[2]);
    _engine.SetPadBlend(v[3]);
    _engine.SetPlinkTone(v[4]);
    _engine.SetPlinkShape(v[5]);
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
        _mix = v[6];
        _engine.SetMix(_mix);
        _engine.SetVolume(_volume * _volume);
        return;
    }
    for (int i = 0; i < 8; i++) {
        if (i == 6) continue;   // S36: _ProcessFader
        if (fabsf(v[i] - _shown[i]) > kKnobStep) { _shown[i] = v[i]; _ShowKnob(i, v[i]); }
    }
    _ProcessFader(v[6]);
    if (a != _sw_a) { _sw_a = a; _ShowSwitch(true, a); }
    if (b != _sw_b) { _sw_b = b; _ShowSwitch(false, b); }
}

void SporeUI::_ProcessFader(float s36) {
    const bool moved = fabsf(s36 - _shown[6]) > kKnobStep;
    char val[22];

    // Enter: S36 moves while P10 + P11 are held (the recalibrate bar is filling). The
    // hold is cancelled in _ProcessModPads.
    auto& f = _touch.field();
    if (!_vol_mode && !_pick_mode && moved && !_recal_armed && _recal_lock == 0
        && f.IsFirmTouched(kPadSynthPad) && f.IsFirmTouched(kPlinkPad)) {
        _vol_mode = true;
    }

    if (_vol_mode) {
        if (moved) {
            _shown[6] = s36;
            _volume = s36;
            _vol_idle = 0;
            _engine.SetVolume(_volume * _volume);
            PutStr(PutInt(val, static_cast<int>(_volume * 100.f + 0.5f)), " %");
            _screen.ShowControl("SET VOLUME", val);
        } else if (++_vol_idle >= kVolumeHoldTicks) {
            _vol_mode = false;
            _save_pending = true;
            _mix_pickup = fabsf(s36 - _mix) > kKnobStep;
            _pickup_above = s36 > _mix;
            PutStr(PutInt(val, static_cast<int>(_volume * 100.f + 0.5f)), " %");
            _screen.ShowControl("VOLUME", val);
        }
        return;
    }

    if (_mix_pickup) {
        if ((s36 > _mix) != _pickup_above || fabsf(s36 - _mix) <= kKnobStep) {
            _mix_pickup = false;   // crossed the old mix position: S36 is the mix again
        } else {
            if (moved) {
                // Fader position → mix in effect, as plinks %
                _shown[6] = s36;
                char* p = PutInt(val, static_cast<int>(s36 * 100.f + 0.5f));
                p = PutStr(p, " -> ");
                PutInt(p, static_cast<int>(_mix * 100.f + 0.5f));
                _screen.ShowControl("MIX PICKUP", val);
            }
            return;
        }
    }

    _mix = s36;
    _engine.SetMix(_mix);
    if (moved) { _shown[6] = s36; _ShowKnob(6, s36); }
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
    // Volume or scale/root mode: P10/P11 do nothing until it ends, and a pad still held
    // then can't count as a tap
    _ProcessPickPads(t10, t11);
    if (_vol_mode || _pick_mode) {
        _hold_10 = _hold_11 = 0;
        _both_used = t10 || t11;
        return;
    }

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

// Scale and root gestures. They use the fixed firm threshold, so noise at the top of S37
// can't make a pick.
void SporeUI::_ProcessPickPads(bool t10, bool t11) {
    auto& f = _touch.field();
    uint8_t firm = 0;
    for (uint8_t i = 0; i < kScalePads; i++) {
        if (f.IsFirmTouched(kFirstScalePad + i)) firm |= 1u << i;
    }
    const uint8_t pressed = firm & ~_scale_firm;
    _scale_firm = firm;
    const bool root_down = f.IsFirmTouched(kRootPad);
    const bool root_pressed = root_down && !_root_firm;
    _root_firm = root_down;

    const bool can_pick = _pick_mode
        || (t10 && t11 && !_vol_mode && !_recal_armed && _recal_lock == 0);

    if (pressed && can_pick) {
        _pick_mode = true;
        _pick_idle = 0;
        uint8_t pick = 0;
        while (!(pressed & (1u << pick))) pick++;
        _scale_pick = pick;
        _engine.SetScale(pick);
        _Blink(pick + 1);
        _screen.ShowControl("SCALE", kScales[pick].name);
    }

    if (root_pressed && can_pick) {
        _pick_mode = true;
        _pick_idle = 0;
        _root_ticks = 1;
    } else if (_root_ticks > 0) {
        if (root_down) {
            // Fires once, while still held
            if (_root_ticks < kTapMaxTicks && ++_root_ticks == kTapMaxTicks) _PickRoot(0);
        } else {
            if (_root_ticks < kTapMaxTicks) _PickRoot((_root_pick + 1) % 12);
            _root_ticks = 0;
        }
    }

    if (!_pick_mode) return;
    if (t10 || t11 || _root_ticks > 0) {
        _pick_idle = 0;
    } else if (++_pick_idle >= kPickWindowTicks) {
        _pick_mode = false;
        _save_pending = true;
    }
}

void SporeUI::_PickRoot(uint8_t root) {
    _root_pick = root;
    _engine.PushTouch({ TouchEvent::Root, root, kRootPlinkVel, 0 });
    _flash = kStrikeFlash;
    char val[4];
    PutNote(val, root, false);
    _screen.ShowControl("ROOT", val);
}

void SporeUI::_MidiRoot(uint8_t root) {
    _engine.SetRoot(root);
    if (root != _root_pick) {
        _root_pick = root;
        _midi_save_wait = kMidiSaveTicks;
    }
}

void SporeUI::_MidiScale(uint8_t scale) {
    scale %= kScaleCount;
    _engine.SetScale(scale);
    if (scale != _scale_pick) {
        _scale_pick = scale;
        _midi_save_wait = kMidiSaveTicks;
    }
}

void SporeUI::_MidiKnob(uint8_t knob, float value) {
    _midi_value[knob]  = value;
    _midi_anchor[knob] = _panel[knob];
    _midi_knobs |= 1u << knob;
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
            if (cc.control_number == kCcRoot)       _MidiRoot(cc.value % 12);
            else if (cc.control_number == kCcScale) _MidiScale(cc.value);
            else if (cc.control_number >= kCcFirstKnob && cc.control_number < kCcFirstKnob + 8)
                _MidiKnob(cc.control_number - kCcFirstKnob, cc.value / 127.f);
            break;
        }
        case ChannelMode:   // libDaisy delivers CC 120–127 as this type
            if (m.AsChannelMode().event_type == AllNotesOff) _engine.AllNotesOff();
            break;
        case ProgramChange:
            _MidiScale(m.AsProgramChange().program);
            break;
        case NoteOn: {
            auto on = m.AsNoteOn();
            if (on.velocity == 0) break;
            if (m.channel == kRootNoteChannel) _MidiRoot(on.note % 12);
            else _engine.PushTouch({ TouchEvent::Note, on.note, on.velocity / 127.f, 0 });
            break;
        }
        case SystemCommon:
            if (m.sc_type != SystemExclusive) break;
            if (m.sysex_message_len == sizeof(kRequest) && memcmp(m.sysex_data, kRequest, sizeof(kRequest)) == 0) {
                _link_ticks = kLinkTicks;
                _ResendLink();
                _oled.SetMirror(true);
                _oled.MirrorAll();
                _screen.Redraw();   // with no screen fitted the buffer may never have been drawn
            } else if (m.sysex_message_len == sizeof(kTouch) + kPads && memcmp(m.sysex_data, kTouch, sizeof(kTouch)) == 0) {
                for (size_t i = 0; i < kPads; i++) _touch.field().SetPress(i, m.sysex_data[sizeof(kTouch) + i] / 127.f);
            }
            break;
        default: break;
    }
}

bool SporeUI::_SendNotes() {
    NoteOut n;
    int budget = kMidiPerLoop;
    bool sent = false;
    while (budget-- > 0 && _engine.PopNoteOut(n)) {
        sent = true;
        _screen.OnNote(n);
        if (n.generated && n.velocity > 0) _HitNote(n.note, n.velocity);
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
    return sent;
}

// For the web manual: pads that played a plink, firm touch or not. Only while a page is connected.
void SporeUI::_Hit(uint8_t pad, float level) {
    if (_link_ticks == 0 || pad >= kPads) return;
    const uint8_t v = static_cast<uint8_t>(fclamp(level, 0.01f, 1.f) * 127.f);
    if (v > _hits[pad]) _hits[pad] = v;
}

// A generated note has no pad. It lights the pad that plays its pitch: P00.. follow the
// scale, and where two pads share a pitch class (pad % size), notes an octave up take the higher.
void SporeUI::_HitNote(uint8_t note, uint8_t velocity) {
    const ScaleDef& sc = kScales[_engine.Scale()];
    const int rel = note - kPlinkBaseMidi - _engine.Root();
    const int semis = Tuning::Mod(rel, 12);
    for (int c = 0; c < sc.size; c++) {
        if (sc.steps[c] != semis) continue;
        _Hit(static_cast<uint8_t>(rel >= 12 && c + sc.size < kFieldPads ? c + sc.size : c), velocity / 127.f);
        return;
    }
}

void SporeUI::_ResendLink() {
    _sent_root = _sent_scale = 0xFF;      // not valid MIDI data, so these always differ
    _sent_live[0] = _sent_state[0] = 0xFF;
    _live_wait = _state_wait = 0;
    _link_beat = 0;
}

// Web manual link, USB only: on TRS the echo would reach downstream gear and block ~1 ms
// per message. Root and scale echo on change. The frames run for 10 s after each REQUEST,
// because with no app reading the port every failed send costs 100 µs of the main loop.
void SporeUI::_SendLink([[maybe_unused]] bool notes_sent) {
#ifdef USB_MIDI
    if (_live_wait > 0)  _live_wait--;
    if (_state_wait > 0) _state_wait--;
    if (_oled_wait > 0)  _oled_wait--;
    if (_hit_wait > 0)   _hit_wait--;
    if (_link_ticks > 0) {
        if (--_link_ticks == 0) _oled.SetMirror(false);
        if (++_link_beat >= kLinkBeatTicks) _ResendLink();
    }

    // The USB endpoint holds one transfer at a time, and SendMessage can't report a drop.
    // One send per pass keeps it free. The notes go first, the rest waits a pass.
    if (notes_sent) return;

    const uint8_t root  = _engine.Root();
    const uint8_t scale = _engine.Scale();
    if (root != _sent_root) {
        _sent_root = root;
        _SendCc(kCcRoot, root);
        return;
    }
    if (scale != _sent_scale) {
        _sent_scale = scale;
        _SendCc(kCcScale, scale);
        return;
    }
    if (_link_ticks == 0) return;

    if (_hit_wait == 0) {
        uint8_t any = 0;
        for (uint8_t h : _hits) any |= h;
        if (any) {
            uint8_t frame[19] = { 0xF0, 0x7D, 0x53, 0x50, 0x01, 0x03 };
            memcpy(frame + 6, _hits, sizeof(_hits));
            frame[18] = 0xF7;
            _midi_usb.SendMessage(frame, sizeof(frame));
            memset(_hits, 0, sizeof(_hits));
            _hit_wait = kHitTicks;
            return;
        }
    }

    if (_live_wait == 0) {
        auto& f = _touch.field();
        uint16_t pads = 0;
        for (uint8_t i = 0; i < 12; i++) {
            if (f.IsFirmTouched(i)) pads |= 1u << i;
        }
        const uint8_t live[4] = {
            WirePos(_sw_b), WirePos(_sw_a),   // SW1 is the left switch, SW2 the right
            static_cast<uint8_t>(pads & 0x7F), static_cast<uint8_t>(pads >> 7),
        };
        if (memcmp(live, _sent_live, sizeof(live)) != 0) {
            memcpy(_sent_live, live, sizeof(live));
            uint8_t frame[10] = { 0xF0, 0x7D, 0x53, 0x54, 0x01 };
            memcpy(frame + 5, live, sizeof(live));
            frame[9] = 0xF7;
            _midi_usb.SendMessage(frame, sizeof(frame));
            _live_wait = kFrameTicks;
            return;
        }
    }

    if (_state_wait == 0) {
        uint8_t state[11];
        for (int i = 0; i < 8; i++) state[i] = static_cast<uint8_t>(_shown[i] * 127.f + 0.5f);
        state[8]  = root;
        state[9]  = scale;
        state[10] = _Targets();   // bit 0 = field → pads, bit 1 = field → plinks
        if (memcmp(state, _sent_state, sizeof(state)) != 0) {
            memcpy(_sent_state, state, sizeof(state));
            uint8_t frame[18] = { 0xF0, 0x7D, 0x53, 0x50, 0x01, 0x01 };
            memcpy(frame + 6, state, sizeof(state));
            frame[17] = 0xF7;
            _midi_usb.SendMessage(frame, sizeof(frame));
            _state_wait = kFrameTicks;
            return;
        }
    }

    if (_oled_wait == 0) {
        uint8_t frame[Oled::kMirrorFrameBytes];
        const int n = _oled.MirrorFrame(frame);
        if (n > 0) {
            _midi_usb.SendMessage(frame, n);
            _oled_wait = kOledTicks;
        }
    }
#endif
}

void SporeUI::_SendCc([[maybe_unused]] uint8_t cc, [[maybe_unused]] uint8_t value) {
#ifdef USB_MIDI
    uint8_t msg[3] = { static_cast<uint8_t>(0xB0 | kLinkChannel), cc, value };
    _midi_usb.SendMessage(msg, 3);
#endif
}

// LED: flash per detected touch (so sensing and sound can be told apart);
// blink patterns confirm toggles/recalibration .......................................

void SporeUI::_Led(DaisySeed& hw) {
    // Solid while P10/P11 is held: shows the touch is detected, before the tap registers
    // …and while an armed recalibration waits for both to be let go
    if (_hold_10 > 0 || _hold_11 > 0 || _recal_armed) { hw.SetLed(true); return; }
    if (_saved_flicker > 0) {
        _saved_flicker--;
        hw.SetLed((_saved_flicker % kSavedFlickerPeriod) < kSavedFlickerPeriod / 2);
        return;
    }
    if (_blink_count > 0) {
        bool on = (_blink_tick % kBlinkTicks) < kBlinkTicks / 2;
        if (++_blink_tick >= kBlinkTicks * _blink_count) { _blink_count = 0; _blink_tick = 0; }
        hw.SetLed(on);
        return;
    }
    hw.SetLed(_flash > 0);
    if (_flash > 0) _flash--;
}
