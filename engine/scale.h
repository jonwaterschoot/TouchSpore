#pragma once

#include <cstdint>

namespace spore {

struct ScaleDef {
    uint8_t     size;
    int8_t      steps[7];
    const char* name;      // shown on the OLED (Font_6x8, ASCII only)
};

// Scale index is what CC 21 / Program Change selects.
static constexpr ScaleDef kScales[] = {
    { 7, { 0, 2, 3, 5, 7, 8, 10 }, "natural minor" },    // 0 (default, with root D)
    { 7, { 0, 2, 3, 5, 7, 9, 10 }, "dorian" },           // 1
    { 5, { 0, 3, 5, 7, 10 },       "minor pentatonic" }, // 2
    { 7, { 0, 1, 3, 5, 7, 8, 10 }, "phrygian" },         // 3
    { 7, { 0, 2, 4, 5, 7, 9, 11 }, "major" },            // 4
    { 7, { 0, 2, 4, 6, 7, 9, 11 }, "lydian" },           // 5
    { 5, { 0, 2, 4, 7, 9 },        "major pentatonic" }, // 6
    { 7, { 0, 2, 3, 5, 7, 8, 11 }, "harmonic minor" },   // 7
};
static constexpr uint8_t kScaleCount = sizeof(kScales) / sizeof(kScales[0]);

// Degrees are "absolute scale steps": 0 = root, size = root one octave up, -1 = the step below the root.
class Tuning {
public:
    void SetRoot(uint8_t root)   { _root = root % 12; }
    void SetScale(uint8_t index) { _scale = index % kScaleCount; }
    uint8_t Root() const  { return _root; }
    uint8_t Scale() const { return _scale; }
    int     Size() const  { return kScales[_scale].size; }

    // base_midi = MIDI note of the octave that holds degree 0 (before adding the root)
    int MidiNote(int degree, int base_midi) const {
        const auto& sc = kScales[_scale];
        int oct = FloorDiv(degree, sc.size);
        int idx = degree - oct * sc.size;
        return base_midi + _root + oct * 12 + sc.steps[idx];
    }

    static int FloorDiv(int a, int b) { return (a >= 0) ? a / b : -((-a + b - 1) / b); }
    static int Mod(int a, int b)      { return a - FloorDiv(a, b) * b; }

private:
    uint8_t _root  = 2;
    uint8_t _scale = 0;
};

} // namespace spore
