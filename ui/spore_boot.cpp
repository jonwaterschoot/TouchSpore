#include "spore_boot.h"
#include "daisy_seed.h"

using namespace synthux;
using daisy::System;

namespace {
constexpr int kMaxTips  = 48;
constexpr int kFrames   = 70;
constexpr int kFrameMs  = 8;     // on top of the transfer: a frame sends 1–8 half pages, ~1.7 ms each
constexpr int kTurnPct  = 25;    // chance per frame that a tip turns 45°
constexpr int kBranchPct = 7;    // chance per frame that a tip forks off a new one at 90°

// 8 directions, clockwise from right. Screen y grows downwards: 2 = down, 6 = up.
constexpr int8_t kDx[8] = { 1, 1, 0, -1, -1, -1, 0, 1 };
constexpr int8_t kDy[8] = { 0, 1, 1, 1, 0, -1, -1, -1 };

struct Tip { int16_t x, y; uint8_t dir, life; };

struct Rng {
    uint32_t s;
    int  Range(int n) { s = s * 1664525u + 1013904223u; return static_cast<int>((s >> 8) % n); }
    bool Chance(int pct) { return Range(100) < pct; }
};
}

void synthux::BootAnimation(Oled& o, uint32_t seed) {
    if (!o.Present()) return;
    Rng rng{ seed | 1u };
    Tip tips[kMaxTips];
    int n = 0;
    auto spawn = [&](int x, int y, int dir, int life) {
        if (n < kMaxTips)
            tips[n++] = { static_cast<int16_t>(x), static_cast<int16_t>(y),
                          static_cast<uint8_t>(dir & 7), static_cast<uint8_t>(life) };
    };

    const int word_x = (Oled::kWidth - 10 * Oled::kCharW) / 2, word_y = 12;
    o.Clear();
    o.Text(word_x, word_y, "TOUCHSPORE");
    o.Flush();
    System::Delay(250);

    // Seeds along the word's width: 5 grow up from the bottom edge, 3 down from the top
    for (int i = 0; i < 5; i++) spawn(word_x + rng.Range(60), Oled::kHeight - 1, 6 + rng.Range(3) - 1, 60 + rng.Range(40));
    for (int i = 0; i < 3; i++) spawn(word_x + rng.Range(60), 0, 2 + rng.Range(3) - 1, 50 + rng.Range(40));

    for (int f = 0; f < kFrames && n > 0; f++) {
        for (int i = 0; i < n;) {
            Tip& t = tips[i];
            if (rng.Chance(kTurnPct)) t.dir = static_cast<uint8_t>((t.dir + (rng.Chance(50) ? 1 : 7)) & 7);
            t.x += kDx[t.dir];
            t.y += kDy[t.dir];
            if (t.x < 0 || t.x >= Oled::kWidth || t.y < 0 || t.y >= Oled::kHeight || --t.life == 0) {
                tips[i] = tips[--n];   // dead: swap in the last tip, check this slot again
                continue;
            }
            o.Pixel(t.x, t.y, true);
            if (rng.Chance(kBranchPct))
                spawn(t.x, t.y, t.dir + (rng.Chance(50) ? 2 : 6), t.life * 2 / 3 + 5);
            i++;
        }
        o.Flush();
        System::Delay(kFrameMs);
    }
}
