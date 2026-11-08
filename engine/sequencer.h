#pragma once

#include <cstdint>
#include "scale.h"

namespace spore {

// Tiny xorshift RNG (avoids pulling <random> into a full flash)
class Rng {
public:
    explicit Rng(uint32_t seed = 0x9E3779B9u) : _s(seed ? seed : 1) {}
    uint32_t Next() { _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5; return _s; }
    float    Uni()  { return (Next() >> 8) * (1.f / 16777216.f); }   // [0,1)
    int      Range(int lo, int hi) { return lo + static_cast<int>(Next() % static_cast<uint32_t>(hi - lo + 1)); }
    bool     Chance(float p) { return Uni() < p; }
private:
    uint32_t _s;
};

// A note request for the current sixteenth. Degree = pitch class in the scale (0..size-1),
// octave = where the requester would *like* it (higher with intensity).
struct Candidate {
    enum Source : uint8_t { Auto, Strike, Flicker };
    uint8_t pc;
    int8_t  octave;
    float   vel;
    Source  source;
};

struct NoteChoice {
    int   degree;   // absolute degree (pc + octave * size)
    float vel;
};

// ---------------------------------------------------------------------------------
// MelodyFilter: turns dense trigger streams into melodic lines.
//
// "Pressure" (0..1) follows the recent density of candidates. As it rises:
//  1. Rhythm thins:   only metrically stronger sixteenths let notes through, and a
//                     token bucket caps notes per second. Swallowed triggers aren't lost:
//                     they become *accent* (velocity) on the next note that passes.
//  2. Leaps shrink:   max interval from the previous note goes from a 5-step leap to a
//                     2-step, so a rising register (intensity) becomes a climbing line
//                     rather than jumps.
//  3. Gap-fill:       after a leap, the next note steps back the other way.
//  4. No stutter:     the same note never repeats more than twice (once when dense).
//  5. Harmony:        on beats, notes snap to the current pad chord's tones.
//  6. Motifs:         short interval patterns are recorded while it's calm and replayed
//                     (transposed to the current note) while it's busy, so dense input
//                     plays recognisable sequences.
// Modes: Free = no rules, only a voice budget; Melodic; Strict = always behaves as if
// the field is busy. The firmware fixes Melodic; Free and Strict are used by tools/sim.cpp.
// ---------------------------------------------------------------------------------
class MelodyFilter {
public:
    enum class Mode : uint8_t { Free, Melodic, Strict };

    void  SetMode(Mode m) { _mode = m; }
    Mode  GetMode() const { return _mode; }
    float Pressure() const { return _pressure; }
    void  Reset() { _has_last = false; _motif_len = 0; _accent = 0.f; }

    // Returns the number of notes written to out (0..3).
    uint8_t Filter(const Candidate* c, uint8_t n,
                   uint8_t step_in_bar,
                   const int* chord_pcs, uint8_t chord_n,
                   int scale_size,
                   NoteChoice* out, Rng& rng);

private:
    int _NearestOctave(int pc, int toward, int size) const;
    int _SnapToChord(int degree, const int* chord_pcs, uint8_t chord_n, int size) const;

    Mode  _mode      = Mode::Melodic;
    float _density   = 0.f;
    float _pressure  = 0.f;
    float _bucket    = 2.f;
    float _accent    = 0.f;

    bool    _has_last = false;
    int     _last = 0;
    int     _last_iv = 0;
    uint8_t _repeats = 0;

    static constexpr uint8_t kMotifMax = 8;
    int8_t  _motif[kMotifMax] = {};   // stored as intervals
    uint8_t _motif_len = 0, _motif_write = 0, _motif_read = 0;
};

// ---------------------------------------------------------------------------------
// Harmony: slow chord progression for the pads (Markov walk over scale degrees).
// ---------------------------------------------------------------------------------
class Harmony {
public:
    void Next(Rng& rng, int scale_size);       // advance automatically
    void Request(int pc) { _requested = pc; }  // P10-routed touch picks the next root
    bool ApplyRequest();                       // call on a beat; true if chord changed
    int  Root() const { return _root; }
    // Chord tones as pitch classes (root, 3rd, 5th in scale steps; 7th sometimes)
    uint8_t Tones(int* out, int scale_size) const;
private:
    int  _root = 0;
    int  _requested = -1;
    bool _seventh = false;
};

// ---------------------------------------------------------------------------------
// Generator: the always-running algorithm. A random walk with "gravity" towards the
// last touched pad and towards chord tones; density and register follow intensity.
// ---------------------------------------------------------------------------------
class Generator {
public:
    enum class Mode : uint8_t { Off, Sparse, On };
    void SetMode(Mode m) { _mode = m; }
    Mode GetMode() const { return _mode; }
    void SetGravity(int pc, float strength) { _gravity_pc = pc; _gravity = strength; }

    // May add one candidate. Returns true if it did.
    bool Step(uint8_t step_in_bar, float intensity, const int* chord_pcs, uint8_t chord_n,
              int scale_size, Candidate& out, Rng& rng);

private:
    Mode  _mode = Mode::On;
    int   _walk = 7;          // absolute degree of the walker (starts an octave up)
    int   _gravity_pc = 0;
    float _gravity = 0.f;
};

// Metric weight of each sixteenth in a 4/4 bar (1 = downbeat)
static constexpr float kMetric[16] = {
    1.0f, 0.15f, 0.35f, 0.15f, 0.7f, 0.15f, 0.35f, 0.15f,
    0.85f, 0.15f, 0.35f, 0.15f, 0.7f, 0.15f, 0.35f, 0.2f,
};

} // namespace spore
