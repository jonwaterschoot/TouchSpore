#pragma once

#include <cstdint>
#include "oled.h"

namespace synthux {

// "TOUCHSPORE", then hyphae grow in from the top and bottom edges and branch over the
// word (~1.2 s). Blocking: main() runs it before audio starts, while nothing else uses
// I2C1. The overgrown word stays on screen until SporeUI's first redraw.
void BootAnimation(Oled& oled, uint32_t seed);

} // namespace synthux
