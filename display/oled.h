#pragma once

#include "daisy_seed.h"

namespace synthux {

// 128×32 SSD1306 at 0x3C on I2C1, next to the MPR121 (0x5A). Field owns the bus handle
// and sets it to 400 kHz: the panel would take 1 MHz, the MPR121 is not rated for it.
//
// Drawing only writes the frame buffer. Service() sends at most one changed half page
// (64 columns, ~1.7 ms at 400 kHz) per main-loop pass, by DMA, so the transfer runs
// during the rest of the pass and the wait for the next tick. A blocking transfer would
// stretch with the audio load (the audio interrupt preempts it), and a full page
// (~3.3 ms) plus the pass (up to 2.7 ms measured) would overrun the 4 ms period.
//
// Main loop only. Call WaitIdle() before any other transfer on I2C1.
class Oled {
public:
    static constexpr int kWidth = 128, kHeight = 32;
    static constexpr int kCharW = 6, kCharH = 8;   // Font_6x8: 21 characters × 4 rows

    // Probes 0x3C. false: no screen fitted, and every call below does nothing.
    bool Init(daisy::I2CHandle& i2c);
    bool Present() const { return _present; }

    void Clear();
    void Pixel(int x, int y, bool on);
    void Rect(int x0, int y0, int x1, int y1, bool fill);   // corners inclusive
    // Font_6x8, clipped at the right edge. Characters outside ASCII 32–126 print as '?'.
    // Returns the x after the last character.
    int  Text(int x, int y, const char* s);

    void Service();    // once per pass, right after the touch read
    void Flush();      // blocking: everything that changed (boot, before audio starts)
    void WaitIdle();   // after 5 ms: re-inits I2C1 and turns the screen off until reboot

private:
    static constexpr int kPages = kHeight / 8, kChunk = 64;
    static constexpr int kChunks = kPages * kWidth / kChunk;   // 8 half pages

    bool _Send(int chunk, bool dma);
    static void _DmaDone(void* self, daisy::I2CHandle::Result r);

    daisy::I2CHandle* _i2c = nullptr;
    bool          _present = false;
    volatile bool _busy = false;
    uint8_t       _stale = 0;      // bit per half page: resend whatever _sent says (Init() sets all)
    uint8_t       _next = 0;       // round robin, so one busy half page can't starve the rest
    uint8_t       _fb[kPages * kWidth] = {};     // page layout: a byte is 8 pixels down, bit 0 on top
    uint8_t       _sent[kPages * kWidth] = {};   // what the panel shows
};

} // namespace synthux
