#pragma once

#include <atomic>
#include <cstddef>

namespace spore {

// Single-producer / single-consumer ring buffer.
// Used main loop → audio callback (touch events) and audio → main loop (MIDI out).
template <typename T, size_t N>
class Spsc {
    static_assert((N & (N - 1)) == 0, "N must be a power of two");

public:
    bool Push(const T& v) {
        auto w = _write.load(std::memory_order_relaxed);
        auto r = _read.load(std::memory_order_acquire);
        if (w - r >= N) return false;               // full: drop (never block either side)
        _buf[w & (N - 1)] = v;
        _write.store(w + 1, std::memory_order_release);
        return true;
    }

    bool Pop(T& v) {
        auto r = _read.load(std::memory_order_relaxed);
        auto w = _write.load(std::memory_order_acquire);
        if (r == w) return false;
        v = _buf[r & (N - 1)];
        _read.store(r + 1, std::memory_order_release);
        return true;
    }

private:
    T _buf[N];
    std::atomic<uint32_t> _write { 0 };
    std::atomic<uint32_t> _read { 0 };
};

} // namespace spore
