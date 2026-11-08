#include "oled.h"
#include "util/oled_fonts.h"
#include <cstring>

using namespace synthux;
using namespace daisy;

namespace {
constexpr uint16_t kAddr     = 0x3C;
constexpr uint8_t  kContrast = 0x8F;   // libDaisy's default. Lower it if the screen adds flickers (roadmap 3.6)

// DMA reads from D2 SRAM: DTCM, where ordinary variables live, is out of the DMA's reach.
// Control byte 0x40 (data follows), then one half page.
uint8_t DMA_BUFFER_MEM_SECTION dma_buf[1 + 64];
}

bool Oled::Init(I2CHandle& i2c) {
    _i2c = &i2c;
    // Control byte 0x00: every byte after it is a command. Same sequence as libDaisy's
    // SSD130xDriver for 128×32, plus page addressing mode (0x20 0x02) for _Send().
    uint8_t init[] = {
        0x00,
        0xAE,             // display off
        0xD5, 0x80,       // clock divide
        0xA8, 0x1F,       // multiplex: 32 rows
        0xDA, 0x02,       // COM pins for 128×32
        0xD3, 0x00,       // display offset
        0x40,             // start line 0
        0xA6, 0xA4,       // normal, show RAM
        0x8D, 0x14,       // charge pump on
        0xA1, 0xC8,       // segment remap, COM scan down: (0, 0) is top left
        0x81, kContrast,
        0xD9, 0x25,       // pre-charge
        0xDB, 0x34,       // VCOM detect
        0x20, 0x02,       // page addressing
        0xAF,             // display on
    };
    // The first transfer doubles as the probe: no ACK, no screen
    _present = _i2c->TransmitBlocking(kAddr, init, sizeof(init), 5) == I2CHandle::Result::OK;
    if (!_present) return false;
    _stale = 0xFF;
    Clear();
    Flush();
    return true;
}

void Oled::Clear() { std::memset(_fb, 0, sizeof(_fb)); }

void Oled::Pixel(int x, int y, bool on) {
    if (x < 0 || x >= kWidth || y < 0 || y >= kHeight) return;
    uint8_t& b = _fb[(y >> 3) * kWidth + x];
    const uint8_t bit = static_cast<uint8_t>(1u << (y & 7));
    b = on ? (b | bit) : (b & ~bit);
}

void Oled::Rect(int x0, int y0, int x1, int y1, bool fill) {
    for (int y = y0; y <= y1; y++)
        for (int x = x0; x <= x1; x++)
            if (fill || y == y0 || y == y1 || x == x0 || x == x1) Pixel(x, y, true);
}

int Oled::Text(int x, int y, const char* s) {
    for (; *s && x < kWidth; s++, x += kCharW) {
        const char c = (*s >= 32 && *s <= 126) ? *s : '?';
        // libDaisy font layout: one uint16_t per row, leftmost pixel in bit 15
        const uint16_t* rows = &Font_6x8.data[(c - 32) * kCharH];
        for (int r = 0; r < kCharH; r++)
            for (int col = 0; col < kCharW; col++)
                if ((rows[r] << col) & 0x8000) Pixel(x + col, y + r, true);
    }
    return x;
}

void Oled::_DmaDone(void* self, I2CHandle::Result r) {
    auto* o = static_cast<Oled*>(self);
    if (r != I2CHandle::Result::OK) o->_stale = 0xFF;
    o->_busy = false;
}

bool Oled::_Send(int c, bool dma) {
    const int page = c / 2, col = (c % 2) * kChunk;
    uint8_t cmd[] = {
        0x00,
        static_cast<uint8_t>(0xB0 | page),
        static_cast<uint8_t>(0x00 | (col & 0x0F)),   // column, low nibble
        static_cast<uint8_t>(0x10 | (col >> 4)),     // column, high nibble
    };
    if (_i2c->TransmitBlocking(kAddr, cmd, sizeof(cmd), 5) != I2CHandle::Result::OK) return false;

    uint8_t* src = &_fb[c * kChunk];   // page p, columns col..col+63 are contiguous
    dma_buf[0] = 0x40;
    std::memcpy(dma_buf + 1, src, kChunk);
    std::memcpy(&_sent[c * kChunk], src, kChunk);
    _stale &= static_cast<uint8_t>(~(1u << c));

    if (!dma) {
        if (_i2c->TransmitBlocking(kAddr, dma_buf, sizeof(dma_buf), 10) == I2CHandle::Result::OK) return true;
        _stale |= static_cast<uint8_t>(1u << c);
        return false;
    }
    _busy = true;
    if (_i2c->TransmitDma(kAddr, dma_buf, sizeof(dma_buf), _DmaDone, this) == I2CHandle::Result::OK) return true;
    _busy = false;
    _stale |= static_cast<uint8_t>(1u << c);
    return false;
}

void Oled::Service() {
    if (!_present || _busy) return;
    for (int i = 0; i < kChunks; i++) {
        const int c = (_next + i) % kChunks;
        if ((_stale & (1u << c)) || std::memcmp(&_fb[c * kChunk], &_sent[c * kChunk], kChunk) != 0) {
            _Send(c, true);
            _next = static_cast<uint8_t>((c + 1) % kChunks);
            return;
        }
    }
}

void Oled::Flush() {
    if (!_present) return;
    WaitIdle();
    for (int c = 0; c < kChunks; c++)
        if ((_stale & (1u << c)) || std::memcmp(&_fb[c * kChunk], &_sent[c * kChunk], kChunk) != 0)
            _Send(c, false);
}

// A half page takes ~1.7 ms. Still busy after 5 ms means the transfer died without a
// callback: libDaisy enables only the I2C event interrupt, so a bus error (static from a
// clip, say) is never reported, and the HAL stays BUSY. libDaisy's blocking calls wait
// for READY with no timeout, so the next touch read would hang the main loop (freeze
// code 2). Re-init the bus (HAL back to READY) and stop using the screen until reboot:
// libDaisy also still counts the DMA as active, so a later transfer would never start.
void Oled::WaitIdle() {
    const uint32_t t0 = System::GetNow();
    while (_busy) {
        if (System::GetNow() - t0 > 5) {
            const I2CHandle::Config cfg = _i2c->GetConfig();
            _i2c->Init(cfg);
            _busy = false;
            _present = false;
            return;
        }
    }
}
