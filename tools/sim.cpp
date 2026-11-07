// Host simulation of the TouchSpore engine: feeds a scripted performance
// (calm → touches → dense "antenna storm" → calm) and reports what the
// density filter let through. Optionally renders a WAV.
//
// Build (from the repo root, with DaisySP checked out in lib/DaisySP):
//   g++ -O2 -std=c++17 -Icommon -Iengine -Ilib/DaisySP/Source -Ilib/DaisySP/DaisySP-LGPL/Source \
//       tools/sim.cpp engine/engine.cpp engine/sequencer.cpp engine/fx.cpp \
//       $(find lib/DaisySP/Source lib/DaisySP/DaisySP-LGPL/Source -name '*.cpp') -o sim
//   ./sim melodic out.wav      (modes: free | melodic | strict)

#include "engine.h"
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace spore;

static float dl[kDelayMaxSamples], dr[kDelayMaxSamples];

struct Note { float t; int note; };

static void write_wav(const char* path, const std::vector<int16_t>& s, int sr) {
    FILE* f = fopen(path, "wb");
    uint32_t data = s.size() * 2, riff = 36 + data, sr32 = sr, br = sr * 4, fmt = 16;
    uint16_t pcm = 1, ch = 2, ba = 4, bits = 16;
    fwrite("RIFF", 1, 4, f); fwrite(&riff, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f);
    fwrite(&fmt, 4, 1, f); fwrite(&pcm, 2, 1, f); fwrite(&ch, 2, 1, f); fwrite(&sr32, 4, 1, f);
    fwrite(&br, 4, 1, f); fwrite(&ba, 2, 1, f); fwrite(&bits, 2, 1, f);
    fwrite("data", 1, 4, f); fwrite(&data, 4, 1, f); fwrite(s.data(), 2, s.size(), f);
    fclose(f);
}

int main(int argc, char** argv) {
    const char* mode = argc > 1 ? argv[1] : "melodic";
    const char* wav  = argc > 2 ? argv[2] : nullptr;
    const int sr = 48000, block = 48;
    const float total = 75.f;

    Engine e;
    e.Init(sr, dl, dr, kDelayMaxSamples);
    e.SetFilterMode(!strcmp(mode, "free") ? MelodyFilter::Mode::Free
                  : !strcmp(mode, "strict") ? MelodyFilter::Mode::Strict : MelodyFilter::Mode::Melodic);
    e.SetReverb(0.55f); e.SetDelay(0.35f); e.SetChorus(0.4f);
    e.SetPadBlend(0.4f); e.SetPlinkBlend(0.35f); e.SetPlinkShape(0.35f); e.SetMix(0.55f);

    Rng rng(1234);
    float bufl[block], bufr[block];
    float* out[2] = { bufl, bufr };
    std::vector<int16_t> audio;
    std::vector<Note> notes;
    float intensity = 0.f;

    // Segments: 0–15 auto only · 15–35 occasional strikes · 35–60 storm (high sensitivity) · 60–75 calm
    for (int b = 0; b < static_cast<int>(total * sr / block); b++) {
        float t = static_cast<float>(b) * block / sr;
        float target = t < 15 ? 0.f : t < 35 ? 0.35f : t < 60 ? 0.9f : 0.05f;
        intensity += (target - intensity) * (target > intensity ? 0.01f : 0.0008f);
        e.SetIntensity(intensity);

        const float dt = static_cast<float>(block) / sr;
        if (t >= 15 && t < 60 && rng.Chance(1.0f * dt))   // ~1 strike/s
            e.PushTouch({ TouchEvent::Strike, static_cast<uint8_t>(rng.Range(0, 9)), 0.3f + 0.6f * rng.Uni(), kToPlinks | kToPads });
        if (t >= 35 && t < 60 && rng.Chance(80.f * dt))   // ~80 flickers/s: wires as antennas
            e.PushTouch({ TouchEvent::Flicker, static_cast<uint8_t>(rng.Range(0, 9)), rng.Uni(), kToPlinks });

        e.Process(nullptr, out, block);
        NoteOut n;
        while (e.PopNoteOut(n)) if (n.channel == kPlinkMidiChannel && n.velocity) notes.push_back({ t, n.note });
        if (wav) for (int i = 0; i < block; i++) {
            audio.push_back(static_cast<int16_t>(fmaxf(-1.f, fminf(1.f, bufl[i])) * 32000));
            audio.push_back(static_cast<int16_t>(fmaxf(-1.f, fminf(1.f, bufr[i])) * 32000));
        }
    }

    struct Seg { const char* name; float a, b; };
    Seg segs[] = { { "auto only   ", 0, 15 }, { "touches     ", 15, 35 }, { "storm 80/s  ", 35, 60 }, { "calm        ", 60, 75 } };
    printf("mode=%s\n%-12s %7s %8s %8s %7s %8s %6s\n", mode, "segment", "notes/s", "avg|iv|", "max|iv|", "repeat%", "pitches", "range");
    for (auto& s : segs) {
        int cnt = 0, rep = 0, maxiv = 0, lo = 127, hi = 0; float sumiv = 0; int prev = -1; bool seen[128] = {};
        int uniq = 0;
        for (auto& n : notes) {
            if (n.t < s.a || n.t >= s.b) continue;
            cnt++;
            if (!seen[n.note]) { seen[n.note] = true; uniq++; }
            lo = std::min(lo, n.note); hi = std::max(hi, n.note);
            if (prev >= 0) { int iv = std::abs(n.note - prev); sumiv += iv; maxiv = std::max(maxiv, iv); if (!iv) rep++; }
            prev = n.note;
        }
        printf("%-12s %7.2f %8.2f %8d %6.0f%% %8d %6d\n", s.name, cnt / (s.b - s.a), cnt > 1 ? sumiv / (cnt - 1) : 0.f,
               maxiv, cnt > 1 ? 100.f * rep / (cnt - 1) : 0.f, uniq, cnt ? hi - lo : 0);
    }
    // A slice of the storm melody, as note names
    const char* names[] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    printf("storm excerpt: ");
    int shown = 0;
    for (auto& n : notes) if (n.t >= 45 && shown < 24) { printf("%s%d ", names[n.note % 12], n.note / 12 - 1); shown++; }
    printf("\n");

    if (wav) { write_wav(wav, audio, sr); printf("wrote %s\n", wav); }
    return 0;
}
