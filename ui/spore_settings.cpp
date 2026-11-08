#include "spore_settings.h"
#include "scale.h"

using namespace synthux;

#ifdef SIMPLE_TOUCH_WEB

void SettingsStore::Init() {}
void SettingsStore::Save(const Settings&) {}

#else

using namespace daisy;

namespace {
// Last 64 KB of the 8 MB QSPI. The Daisy bootloader keeps apps from 0x40000 upward.
constexpr uint32_t kOffset = 0x7F0000;

bool Valid(const Settings& s) {
    return s.version == Settings::kVersion && s.root < 12 && s.scale < spore::kScaleCount
        && s.volume >= 0.f && s.volume <= 1.f;   // false for NaN too
}
}

void SettingsStore::Init() {
    _storage.Init(Settings{}, kOffset);
    if (!Valid(_storage.GetSettings())) _storage.RestoreDefaults();
    _now = _storage.GetSettings();
}

void SettingsStore::Save(const Settings& s) {
    _now = s;
    if (s == _storage.GetSettings()) return;

    // PersistentStorage writes only if flash differs, and skips the cache invalidate for
    // apps in internal flash. The QSPI window is cacheable, so without this a stale line
    // can match the new values and the write is dropped (A → B → A leaves B in flash).
    // The +4 is PersistentStorage's state word in front of the struct.
    dsy_dma_invalidate_cache_for_buffer(static_cast<uint8_t*>(_qspi.GetData(kOffset)),
                                        sizeof(Settings) + 4);
    _storage.GetSettings() = s;
    _storage.Save();
}

#endif
