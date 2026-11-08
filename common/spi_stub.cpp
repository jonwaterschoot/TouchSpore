// Replaces libDaisy's dsy_spi_global_init(), which System::Init() calls on every boot.
// TouchSpore uses no SPI. With this definition in our own sources the linker never pulls
// spi.o out of libdaisy.a, which saves ~8 KB of flash (the OLED needs the room).
// UART can't be dropped the same way: libDaisy's logger links uart.o directly.
extern "C" void dsy_spi_global_init() {}
