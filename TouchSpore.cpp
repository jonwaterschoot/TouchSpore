#include "daisy_seed.h"
#include "touch/touch.h"
#include "engine/engine.h"
#include "ui/spore_ui.h"
#include "display/oled.h"
#include "ui/spore_boot.h"
#include "ui/spore_settings.h"

const char* USBD_MANUFACTURER_STRING = "Synthux";
const char* USBD_PRODUCT_STRING_HS   = "TouchSpore";
const char* USBD_PRODUCT_STRING_FS   = "TouchSpore";

using namespace daisy;
using namespace synthux;

DaisySeed hw;
CpuLoadMeter cpu;
Touch touch;
spore::Engine engine;
Oled oled;
SettingsStore settings(hw);
SporeUI ui(touch, engine, oled, settings);

// Ping-pong delay lines live in the 64 MB SDRAM
static float DSY_SDRAM_BSS delay_l[spore::kDelayMaxSamples];
static float DSY_SDRAM_BSS delay_r[spore::kDelayMaxSamples];

// Main-loop watchdog. The audio callback is the one thing that keeps running when the
// controls freeze, so it watches SporeUI::Beat(). After ~1 s without a main-loop pass it
// takes over the LED and blinks a code, then a 1.5 s pause, repeating:
//   1–7 blinks = stuck in that SporeUI::Stage (1 MIDI in, 2 I2C: touch chip or OLED, 3 knobs & switches,
//                4 P10/P11, 5 intensity, 6 MIDI out, 7 OLED redraw, settings save, LED and the wait for the next 4 ms tick)
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

static constexpr uint32_t kPeriodMs = 4;
#ifndef SIMPLE_TOUCH_WEB
static uint32_t next_pass = 0;
#endif
#if DEBUG
static uint32_t log_at = 0, pass_max_ticks = 0, ticks_per_us = 1;
#endif

static void Setup() {
    hw.Init();
    hw.SetAudioBlockSize(48);
    hw.SetAudioSampleRate(SaiHandle::Config::SampleRate::SAI_48KHZ);

    settings.Init();
    touch.Init(hw);
    // Screen on before the baseline learn, so the pads calibrate with the panel running
    // (its charge pump adds supply noise). No screen at 0x3C: nothing is sent, ever.
    if (oled.Init(touch.field().Bus())) BootAnimation(oled, System::GetTick());
    // Let Field learn baselines and noise floors (~0.5 s) before anything can trigger
    for (int i = 0; i < 140; i++) {
        touch.Process();
        System::Delay(4);
    }

    const Settings& saved = settings.Get();
    engine.Init(hw.AudioSampleRate(), delay_l, delay_r, spore::kDelayMaxSamples,
                saved.root, saved.scale, saved.volume * saved.volume);
    ui.Init(hw);
    cpu.Init(hw.AudioSampleRate(), hw.AudioBlockSize());

    hw.StartAudio(AudioCallback);

#ifndef SIMPLE_TOUCH_WEB
    next_pass = System::GetNow();
#endif
#if DEBUG
    // `make DEBUG=1`: no USB MIDI (config.h), the USB port is a serial log instead.
    // Every 2 s: audio load avg/max, the longest main-loop pass, and how often the MPR121
    // was re-configured (by the ECR health check or by failed reads). Then the counters reset.
    // Ticks, not GetUs(): GetUs() wraps every ~21 s and breaks the subtraction.
    hw.StartLog(false);
    ticks_per_us = System::GetTickFreq() / 1000000u;
    log_at = System::GetNow();
#endif
}

static void Loop() {
#if DEBUG
    const uint32_t t0 = System::GetTick();
#endif
    ui.Process(hw);
#if DEBUG
    const uint32_t dt = System::GetTick() - t0;
    if (dt > pass_max_ticks) pass_max_ticks = dt;
    if (System::GetNow() - log_at >= 2000) {
        log_at = System::GetNow();
        const auto st = touch.field().TakeStats();
        hw.PrintLine("cpu avg %d.%d %%  max %d.%d %%  pass max %u us  config %u (ecr %u, fails %u)  ecr 0x%02X",
                     int(cpu.GetAvgCpuLoad() * 100.f), int(cpu.GetAvgCpuLoad() * 1000.f) % 10,
                     int(cpu.GetMaxCpuLoad() * 100.f), int(cpu.GetMaxCpuLoad() * 1000.f) % 10,
                     unsigned(pass_max_ticks / ticks_per_us),
                     unsigned(st.configs), unsigned(st.by_ecr), unsigned(st.by_fails), unsigned(st.last_ecr));
        cpu.Reset();
        pass_max_ticks = 0;
    }
#endif
#ifdef SIMPLE_TOUCH_WEB
    // The browser's clock advances only between passes, so a spin on GetNow() never ends.
    // The board starts the next pass after this delay.
    System::Delay(kPeriodMs);
#else
    // Fixed 4 ms period: wait for the next tick instead of a Delay(4) after the work,
    // so a long pass (OLED page, settings save) doesn't stretch timings that count
    // passes (tap, recalibrate hold). A pass that overruns by more than a period
    // restarts the schedule instead of running catch-up passes back to back.
    next_pass += kPeriodMs;
    if (static_cast<int32_t>(System::GetNow() - next_pass) > static_cast<int32_t>(kPeriodMs))
        next_pass = System::GetNow();
    while (static_cast<int32_t>(System::GetNow() - next_pass) < 0) {}
#endif
}

#ifdef SIMPLE_TOUCH_WEB
#include "simple_touch_web.h"
ST_WEB_FIRMWARE(Setup, Loop)
#else
int main(void) {
    Setup();
    while (1) Loop();
}
#endif
