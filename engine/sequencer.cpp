#include "sequencer.h"
#include <cmath>
#include <cstdlib>
#include <algorithm>

using namespace spore;

namespace {
inline float clampf(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline int   sign(int x) { return (x > 0) - (x < 0); }

bool InChord(int pc, const int* chord_pcs, uint8_t n) {
    for (uint8_t i = 0; i < n; i++) if (chord_pcs[i] == pc) return true;
    return false;
}
}

// MelodyFilter ...................................................................

int MelodyFilter::_NearestOctave(int pc, int toward, int size) const {
    int oct = Tuning::FloorDiv(toward - pc, size);
    int lo = pc + oct * size, hi = lo + size;
    return (toward - lo <= hi - toward) ? lo : hi;
}

int MelodyFilter::_SnapToChord(int degree, const int* chord_pcs, uint8_t chord_n, int size) const {
    for (int d = 0; d <= 3; d++) {
        // prefer moving in the direction of travel, so a line keeps its contour
        int first = (_last_iv >= 0) ? d : -d;
        if (InChord(Tuning::Mod(degree + first, size), chord_pcs, chord_n))  return degree + first;
        if (InChord(Tuning::Mod(degree - first, size), chord_pcs, chord_n))  return degree - first;
    }
    return degree;
}

uint8_t MelodyFilter::Filter(const Candidate* c, uint8_t n,
                             uint8_t step_in_bar,
                             const int* chord_pcs, uint8_t chord_n,
                             int size,
                             NoteChoice* out, Rng& rng) {
    // 0. Measure density → pressure ..........................................
    _density += (static_cast<float>(n) - _density) * 0.1f;             // ~2.5 s memory at 60 BPM
    float p = clampf((_density - 0.35f) / 1.6f, 0.f, 1.f);
    if (_mode == Mode::Strict) p = fmaxf(p, 0.6f);
    _pressure = p;

    const float refill = (_mode == Mode::Free) ? 3.f : 1.f - 0.5f * p;   // notes per step: 4/s → 2/s
    _bucket = fminf(_bucket + refill, 2.f);
    if (n == 0) return 0;

    // Free: strongest few, no melodic rules ...................................
    if (_mode == Mode::Free) {
        uint8_t count = 0;
        for (uint8_t i = 0; i < n && count < 3 && _bucket >= 1.f; i++, count++) {
            out[count] = { c[i].pc + c[i].octave * size, c[i].vel };
            _bucket -= 1.f;
        }
        return count;
    }

    // Rank candidates: strikes > auto > flickers ...............................
    int best = 0, second = -1;
    auto score = [](const Candidate& k) {
        return k.vel + (k.source == Candidate::Strike ? 0.35f : (k.source == Candidate::Auto ? 0.1f : 0.f));
    };
    for (uint8_t i = 1; i < n; i++) {
        if (score(c[i]) > score(c[best])) { second = best; best = i; }
        else if (second < 0 || score(c[i]) > score(c[second])) second = i;
    }
    const Candidate& b = c[best];

    // 1. Rhythmic thinning: metric gate + token bucket ...........................
    const float w = kMetric[step_in_bar % 16];
    const bool  forced = (b.source == Candidate::Strike && b.vel > 0.8f);   // a real hard hit always speaks
    if (!forced && (w < p * 0.3f || _bucket < 1.f)) {   // busy → eighth-note grid
        float swallowed = 0.f;
        for (uint8_t i = 0; i < n; i++) swallowed += c[i].vel;
        _accent = fminf(_accent + swallowed * 0.1f, 0.5f);                   // density → dynamics
        return 0;
    }
    _bucket = fmaxf(_bucket - 1.f, -1.f);
    const float vel = fminf(1.f, b.vel + _accent);
    _accent = 0.f;

    // 2–4. Pitch ..............................................................
    const int wanted = b.pc + b.octave * size;   // where the requester wants to be
    int target;
    if (!_has_last) {
        target = wanted;
    } else {
        const int max_leap = static_cast<int>(lroundf(5.f - 3.f * p));   // 5 steps calm → 2 steps busy

        if (_motif_len >= 3 && rng.Chance(p * 0.55f)) {
            // 6. Replay a recorded motif interval from the current note
            uint8_t start = (_motif_write + kMotifMax - _motif_len) % kMotifMax;
            target = _last + _motif[(start + _motif_read % _motif_len) % kMotifMax];
            _motif_read++;
            // let the register still drift towards where intensity wants it
            if (wanted - target > size)  target += 1;
            if (target - wanted > size)  target -= 1;
        } else {
            // Head for the requested register, but only one leap at a time → climbing lines
            int ref = _last + std::max(-max_leap, std::min(max_leap, wanted - _last));
            target = _NearestOctave(b.pc, ref, size);
        }

        int iv = target - _last;
        if (std::abs(iv) > max_leap) target = _last + sign(iv) * max_leap;

        // 3. Gap-fill after a leap
        if (std::abs(_last_iv) >= 3 && rng.Chance(0.4f + 0.5f * p)) {
            target = _last - sign(_last_iv) * (rng.Chance(0.7f) ? 1 : 2);
        }

        // 4. Repetition limit
        if (target == _last) {
            if (++_repeats >= (p > 0.6f ? 1 : 2)) {
                target += rng.Chance(0.5f) ? 1 : -1;
                _repeats = 0;
            }
        } else {
            _repeats = 0;
        }
    }

    // 5. Harmony on beats
    if (w >= 0.7f && chord_n > 0) target = _SnapToChord(target, chord_pcs, chord_n, size);

    // Keep inside the playable range (degree -size .. 3*size ≈ D3..D7), reflect at the edges
    if (target < -size)    target = -size + (-size - target);
    if (target > 3 * size) target = 3 * size - (target - 3 * size);

    // Record motif while calm
    if (_has_last && p < 0.35f) {
        int ivr = std::max(-4, std::min(4, target - _last));
        if (ivr != 0) {
            _motif[_motif_write] = static_cast<int8_t>(ivr);
            _motif_write = (_motif_write + 1) % kMotifMax;
            if (_motif_len < kMotifMax) _motif_len++;
        }
    }
    _last_iv  = _has_last ? target - _last : 0;
    _last     = target;
    _has_last = true;

    out[0] = { target, vel };
    uint8_t count = 1;

    // Occasional dyad (a third below) while it's still calm
    if (second >= 0 && p < 0.4f && _bucket >= 1.f && rng.Chance(0.35f)) {
        out[count++] = { target - 2, c[second].vel * 0.6f };
        _bucket -= 1.f;
    }
    return count;
}

// Harmony .......................................................................

void Harmony::Next(Rng& rng, int size) {
    if (size == 7) {
        // Markov table over scale degrees (duplicates = weight). Minor: i → VI, iv, III, VII…
        static constexpr uint8_t k7[7][4] = {
            { 5, 3, 2, 6 },   // i   → VI iv III VII
            { 4, 6, 4, 0 },   // ii° → v VII v i
            { 5, 3, 6, 5 },   // III → VI iv VII VI
            { 0, 4, 6, 0 },   // iv  → i v VII i
            { 0, 5, 0, 3 },   // v   → i VI i iv
            { 3, 6, 0, 2 },   // VI  → iv VII i III
            { 0, 2, 5, 0 },   // VII → i III VI i
        };
        _root = k7[_root % 7][rng.Range(0, 3)];
    } else {
        int step = rng.Range(-2, 2);
        _root = Tuning::Mod(_root + (step == 0 ? 1 : step), size);
        if (rng.Chance(0.3f)) _root = 0;
    }
    _seventh = rng.Chance(0.3f);
}

bool Harmony::ApplyRequest() {
    if (_requested < 0) return false;
    bool changed = _requested != _root;
    _root = _requested;
    _requested = -1;
    return changed;
}

uint8_t Harmony::Tones(int* out, int size) const {
    out[0] = _root;
    out[1] = Tuning::Mod(_root + 2, size);
    out[2] = Tuning::Mod(_root + 4, size);
    if (_seventh && size == 7) { out[3] = Tuning::Mod(_root + 6, size); return 4; }
    return 3;
}

// Generator ....................................................................

bool Generator::Step(uint8_t step_in_bar, float intensity, const int* chord_pcs, uint8_t chord_n,
                     int size, Candidate& out, Rng& rng) {
    _gravity *= 0.97f;
    if (_mode == Mode::Off) return false;

    const float w = kMetric[step_in_bar % 16];
    const float base = (_mode == Mode::Sparse) ? 0.14f : 0.30f;
    const float p = base * (0.5f + 1.2f * intensity) * (0.45f + 0.55f * w);
    if (!rng.Chance(p)) return false;

    static constexpr int8_t kSteps[7] = { -2, -1, -1, 0, 1, 1, 2 };
    _walk += kSteps[rng.Range(0, 6)];

    // Gravity towards the most recently touched pad
    if (_gravity > 0.05f && rng.Chance(_gravity)) {
        int oct = Tuning::FloorDiv(_walk, size);
        int g = _gravity_pc + oct * size;
        int diff = g - _walk;
        _walk += sign(diff) * std::min(std::abs(diff), 2);
    }
    // On strong beats lean on chord tones
    if (w >= 0.7f && chord_n > 0 && !InChord(Tuning::Mod(_walk, size), chord_pcs, chord_n)) {
        _walk += InChord(Tuning::Mod(_walk + 1, size), chord_pcs, chord_n) ? 1 : -1;
    }
    if (_walk < 0)        _walk = -_walk;                  // reflect at the edges
    if (_walk > 2 * size) _walk = 4 * size - _walk;

    out.pc     = static_cast<uint8_t>(Tuning::Mod(_walk, size));
    out.octave = static_cast<int8_t>(Tuning::FloorDiv(_walk, size) + (intensity > 0.5f ? 1 : 0)
                                     + (rng.Chance(intensity * 0.25f) ? 1 : 0));
    out.vel    = 0.25f + 0.35f * rng.Uni() + 0.2f * intensity;
    out.source = Candidate::Auto;
    return true;
}
