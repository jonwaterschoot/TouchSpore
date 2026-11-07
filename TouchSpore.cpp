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
CpuLoadMeter cpu;
Touch touch;
spore::Engine engine;
SporeUI ui(touch, engine);

// Ping-pong delay lines live in the 64 MB SDRAM
static float DSY_SDRAM_BSS delay_l[spore::kDelayMaxSamples];
static float DSY_SDRAM_BSS delay_r[spore::kDelayMaxSamples];

// Main-loop watchdog. The audio callback is the one thing that keeps running when the
// controls freeze, so it watches SporeUI::Beat(). After ~1 s without a main-loop pass it
// takes over the LED and blinks a code, then a 1.5 s pause, repeating:
//   1–7 blinks = stuck in that SporeUI::Stage (1 MIDI in, 2 touch chip/I2C, 3 knobs & switches,
//                4 P10/P11, 5 intensity, 6 MIDI out, 7 the loop's Delay)
//   8 blinks   = audio CPU overload: the main loop is starved, not stuck
// Blocks are 1 ms (48 samples at 48 kHz), so the counters below are in ms.
void Watchdog() {
    static uint32_t beat = 0, idle_ms = 0, tick = 0;
    static uint8_t  code = 0;
    constexpr uint32_t kStallMs = 1000, kBlinkMs = 300, kPauseMs = 1500;

    const uint32_t b = ui.Beat();
    if (b != beat) { beat = b; idle_ms = 0; code = 0; return; }
    if (idle_ms < kStallMs) { idle_ms++; return; }

    if (code == 0) { code = (cpu.GetAvgCpuLoad() > 0.95f) ? 8 : ui.Stage(); tick = 0; }
    const uint32_t t = tick++ % (code * kBlinkMs + kPauseMs);
    hw.SetLed(t < code * kBlinkMs && (t % kBlinkMs) < kBlinkMs / 2);
}

void AudioCallback(AudioHandle::InputBuffer in, AudioHandle::OutputBuffer out, size_t size) {
    cpu.OnBlockStart();
    engine.Process(in, out, size);
    cpu.OnBlockEnd();
    Watchdog();
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
    cpu.Init(hw.AudioSampleRate(), hw.AudioBlockSize());

    hw.StartAudio(AudioCallback);

    while (1) {
        ui.Process(hw);
        System::Delay(4);
    }
}
