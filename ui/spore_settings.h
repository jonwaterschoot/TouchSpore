#pragma once

#include "daisy_seed.h"
#include "config.h"
#ifndef SIMPLE_TOUCH_WEB
#include "util/PersistentStorage.h"
#endif

namespace synthux {

// Bump kVersion when the layout changes. Older data then loads as defaults.
struct Settings {
    static constexpr uint8_t kVersion = 3;

    uint8_t version = kVersion;
    uint8_t root    = spore::kDefaultRoot;     // 0–11, C–B
    uint8_t scale   = spore::kDefaultScale;    // index into kScales
    float   volume  = spore::kDefaultVolume;   // fader position 0–1, gain = position²

    bool operator==(const Settings& o) const {
        return version == o.version && root == o.root && scale == o.scale && volume == o.volume;
    }
    bool operator!=(const Settings& o) const { return !(*this == o); }
};

// The browser build has no QSPI: Get() returns the defaults and nothing is saved.
class SettingsStore {
public:
    explicit SettingsStore([[maybe_unused]] daisy::DaisySeed& hw)
#ifndef SIMPLE_TOUCH_WEB
        : _qspi(hw.qspi), _storage(hw.qspi)
#endif
    {}

    // After hw.Init(). Blank, foreign or out-of-range flash is overwritten with defaults.
    void Init();

    const Settings& Get() const { return _now; }

    // Writes only if the values differ from the saved ones. A write blocks for the 4 KB
    // sector erase (45 ms typical, 300 ms max). Audio keeps running, because the code runs
    // from internal flash and QSPI erase leaves interrupts on.
    void Save(const Settings& s);

private:
    Settings _now;
#ifndef SIMPLE_TOUCH_WEB
    daisy::QSPIHandle&                  _qspi;
    daisy::PersistentStorage<Settings>  _storage;
#endif
};

} // namespace synthux
