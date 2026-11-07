#pragma once

#include "daisy_seed.h"
#include "field.h"
#include "knobs.h"
#include "switches.h"
#include "nocopy.h"

namespace synthux {

// Same aggregate as TouchString's Touch, with Pads replaced by Field.
class Touch {
public:
    Touch() {}

    void Init(daisy::DaisySeed& hw) {
        _field.Init(hw);
        _knobs.Init(hw);
        _switches.Init();
        hw.adc.Start();
    }
    void Process() { _field.Process(); }

    Field&    field()    { return _field; }
    Knobs&    knobs()    { return _knobs; }
    Switches& switches() { return _switches; }

private:
    NOCOPY(Touch)
    Field    _field;
    Knobs    _knobs;
    Switches _switches;
};

} // namespace synthux
