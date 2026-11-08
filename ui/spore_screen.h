#pragma once

#include "oled.h"
#include "engine.h"

namespace synthux {

// The one OLED screen, Font_6x8 throughout:
//   row 0   last touched control and its value, or the recalibrate bar
//   row 1   root and scale ("D natural minor")
//   row 2   PL: a dot per scale note, lit for ~160 ms when a plink plays it  | last plink (A#5)
//   row 3   PD: the chord's notes, filled while the pads sound              | chord (Gm7)
// Notes come from the engine's MIDI queue (SporeUI::_SendNotes), so the screen shows what
// was played, also with no MIDI cable or host.
class SporeScreen {
public:
    explicit SporeScreen(Oled& oled) : _oled(oled) {}

    void ShowControl(const char* label, const char* value);
    void ShowProgress(const char* label, float progress);   // 0–1. Below 0: back to the last control
    void OnNote(const spore::NoteOut& n);
    void SetHarmony(uint8_t root, uint8_t scale, uint8_t chord_root, uint8_t chord_tones);

    void Draw();   // once per pass: redraws the frame buffer if anything changed

private:
    int _Column(uint8_t midi) const;   // scale-note column of a MIDI note, -1 if not in the scale

    Oled&   _oled;
    bool    _dirty = true;
    char    _label[22] = "TOUCHSPORE";
    char    _value[22] = "";
    char    _progress_label[22] = "";
    float   _progress = -1.f;
    uint8_t _root = spore::kDefaultRoot, _scale = spore::kDefaultScale;
    uint8_t _chord_root = 0, _chord_tones = 3;
    uint8_t _plink_age[7] = {};   // passes left on the lit dot
    int     _last_plink = -1;     // MIDI note
    uint8_t _pad_held[12] = {};   // sounding pad voices per pitch class (MIDI ch 2)
};

// Text helpers for the control line: no printf, so release builds don't link it.
char* PutStr(char* p, const char* s);
char* PutInt(char* p, int v);
char* PutNote(char* p, int midi, bool octave);   // C#4 = 61, # for sharps (Font_6x8 is ASCII only)

} // namespace synthux
