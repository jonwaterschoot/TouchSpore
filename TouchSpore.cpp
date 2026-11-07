#include "daisy_seed.h"
#include "touch/touch.h"
#include "engine/engine.h"
#include "ui/spore_ui.h"

const char* USBD_MANUFACTURER_STRING = "Synthux";
const char* USBD_PRODUCT_STRING_HS   = "TouchSpore";
const char* USBD_PRODUCT_STRING_FS   = "TouchSpore";

using namespace daisy;
using namespace synthux;

DaisySeed hw;
Touch touch;
spore::Engine engine;
SporeUI ui(touch, engine);

// Ping-pong delay lines live in the 64 MB SDRAM
static float DSY_SDRAM_BSS delay_l[spore::kDelayMaxSamples];
static float DSY_SDRAM_BSS delay_r[spore::kDelayMaxSamples];

void AudioCallback(AudioHandle::InputBuffer in, AudioHandle::OutputBuffer out, size_t size) {
    engine.Process(in, out, size);
}

int main(void) {
    hw.Init();
    hw.SetAudioBlockSize(48);
    hw.SetAudioSampleRate(SaiHandle::Config::SampleRate::SAI_48KHZ);

    touch.Init(hw);
    // Let Field learn baselines and noise floors (~0.5 s) before anything can trigger
    for (int i = 0; i < 140; i++) {
        touch.Process();
        System::Delay(4);
    }

    engine.Init(hw.AudioSampleRate(), delay_l, delay_r, spore::kDelayMaxSamples);
    ui.Init(hw);

    hw.StartAudio(AudioCallback);

    while (1) {
        ui.Process(hw);
        System::Delay(4);
    }
}
