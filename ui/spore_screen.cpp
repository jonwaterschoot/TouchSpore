#include "spore_screen.h"
#include <cstring>

using namespace synthux;
using namespace spore;

namespace {
constexpr uint8_t kPlinkLitPasses = 40;   // ~160 ms at 250 Hz

// Grid geometry: labels in x 1–12, 7 columns of 10 px from x 16, info block from x 92
constexpr int kGridX = 16, kColW = 10, kDot = 6, kInfoX = 92;
constexpr int kRowPl = 16, kRowPd = 24;

const char* const kNoteNames[12] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };

// Semitones of an absolute scale degree above the root
int Semis(const ScaleDef& sc, int degree) {
    return sc.steps[degree % sc.size] + 12 * (degree / sc.size);
}

// Chord name from the intervals the scale gives its root, 3rd and 5th (and 7th):
// Gm, A#, Bdim, Cm7, Fmaj7. Pentatonic "chords" stack fourths and read as sus.
char* PutChord(char* p, uint8_t root, const ScaleDef& sc, uint8_t r, uint8_t tones) {
    p = PutStr(p, kNoteNames[(root + sc.steps[r]) % 12]);
    const int base = Semis(sc, r), third = Semis(sc, r + 2) - base, fifth = Semis(sc, r + 4) - base;
    if (third == 3 && fifth == 6)      p = PutStr(p, tones == 4 ? "m7b5" : "dim");
    else if (third == 4 && fifth == 8) p = PutStr(p, "+");
    else if (third == 3)               p = PutStr(p, "m");
    else if (third == 2)               p = PutStr(p, "sus2");
    else if (third == 5)               p = PutStr(p, "sus4");
    if (tones == 4 && !(third == 3 && fifth == 6)) {
        const int seventh = Semis(sc, r + 6) - base;
        p = PutStr(p, seventh == 11 ? "maj7" : "7");
    }
    return p;
}
}

char* synthux::PutStr(char* p, const char* s) {
    while (*s) *p++ = *s++;
    *p = '\0';
    return p;
}

char* synthux::PutInt(char* p, int v) {
    if (v < 0) { *p++ = '-'; v = -v; }
    char tmp[10];
    int n = 0;
    do { tmp[n++] = static_cast<char>('0' + v % 10); v /= 10; } while (v > 0);
    while (n > 0) *p++ = tmp[--n];
    *p = '\0';
    return p;
}

char* synthux::PutNote(char* p, int midi, bool octave) {
    p = PutStr(p, kNoteNames[midi % 12]);
    return octave ? PutInt(p, midi / 12 - 1) : p;
}

void SporeScreen::ShowControl(const char* label, const char* value) {
    std::strncpy(_label, label, sizeof(_label) - 1);
    std::strncpy(_value, value, sizeof(_value) - 1);
    _progress = -1.f;
    _dirty = true;
}

void SporeScreen::ShowProgress(const char* label, float progress) {
    if (progress < 0.f) {
        if (_progress >= 0.f) { _progress = -1.f; _dirty = true; }
        return;
    }
    std::strncpy(_progress_label, label, sizeof(_progress_label) - 1);
    if (progress > 1.f) progress = 1.f;
    // Redraw only when the bar grows by a pixel or more (90 px of travel)
    if (static_cast<int>(progress * 90.f) != static_cast<int>(_progress * 90.f) || _progress < 0.f) _dirty = true;
    _progress = progress;
}

int SporeScreen::_Column(uint8_t midi) const {
    const ScaleDef& sc = kScales[_scale];
    const int rel = (midi - _root + 120) % 12;
    for (int i = 0; i < sc.size; i++) if (sc.steps[i] == rel) return i;
    return -1;
}

void SporeScreen::OnNote(const NoteOut& n) {
    if (n.channel == kPlinkMidiChannel) {
        if (n.velocity == 0) return;
        const int c = _Column(n.note);
        if (c >= 0) _plink_age[c] = kPlinkLitPasses;
        _last_plink = n.note;
        _dirty = true;
    } else if (n.channel == kPadMidiChannel) {
        uint8_t& held = _pad_held[n.note % 12];
        if (n.velocity > 0) held++;
        else if (held > 0) held--;
        _dirty = true;
    }
}

void SporeScreen::SetHarmony(uint8_t root, uint8_t scale, uint8_t chord_root, uint8_t chord_tones) {
    if (root == _root && scale == _scale && chord_root == _chord_root && chord_tones == _chord_tones) return;
    _root = root; _scale = scale; _chord_root = chord_root; _chord_tones = chord_tones;
    _dirty = true;
}

void SporeScreen::Draw() {
    for (auto& a : _plink_age) {
        if (a > 0 && --a == 0) _dirty = true;
    }
    if (!_dirty || !_oled.Present()) return;
    _dirty = false;

    Oled& o = _oled;
    const ScaleDef& sc = kScales[_scale];
    char buf[24];
    o.Clear();

    // Row 0: control line, value right-aligned. Or the hold bar.
    if (_progress >= 0.f) {
        const int x = o.Text(1, 0, _progress_label) + 4;
        o.Rect(x, 1, 126, 6, false);
        const int fill = static_cast<int>((126 - 2 - (x + 2)) * _progress);
        if (fill > 0) o.Rect(x + 2, 3, x + 2 + fill, 4, true);
    } else {
        o.Text(1, 0, _label);
        o.Text(Oled::kWidth - 1 - static_cast<int>(std::strlen(_value)) * Oled::kCharW, 0, _value);
    }

    // Row 1: root and scale
    char* p = PutNote(buf, _root, false);
    p = PutStr(p, " ");
    PutStr(p, sc.name);
    o.Text(1, 8, buf);

    // Rows 2–3: the grid. Lit = filled dot, chord note while the pads are silent = outline,
    // anything else = a 2 px tick marking the column.
    o.Text(1, kRowPl, "PL");
    o.Text(1, kRowPd, "PD");
    for (int c = 0; c < sc.size; c++) {
        const int x = kGridX + c * kColW;
        if (_plink_age[c] > 0) o.Rect(x, kRowPl + 1, x + kDot - 1, kRowPl + kDot, true);
        else                   o.Rect(x + 2, kRowPl + 3, x + 3, kRowPl + 4, true);

        const bool in_chord = Tuning::Mod(c - _chord_root, sc.size) % 2 == 0
                              && Tuning::Mod(c - _chord_root, sc.size) <= 2 * (_chord_tones - 1);
        const bool sounding = _pad_held[(_root + sc.steps[c]) % 12] > 0;
        if (sounding)      o.Rect(x, kRowPd + 1, x + kDot - 1, kRowPd + kDot, true);
        else if (in_chord) o.Rect(x, kRowPd + 1, x + kDot - 1, kRowPd + kDot, false);
        else               o.Rect(x + 2, kRowPd + 3, x + 3, kRowPd + 4, true);
    }

    // Info block: last plink note, current chord
    if (_last_plink >= 0) { PutNote(buf, _last_plink, true); o.Text(kInfoX, kRowPl, buf); }
    PutChord(buf, _root, sc, _chord_root, _chord_tones);
    o.Text(kInfoX, kRowPd, buf);
}
