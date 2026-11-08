# Project Name
TARGET = TouchSpore

# Enabling DEBUG disables USB MIDI
# DEBUG = 1

# TRS MIDI on D13/D14, only for boards with the TRS MIDI mod: make UART_MIDI=1
ifeq ($(UART_MIDI), 1)
C_DEFS += -DUART_MIDI
endif

USE_DAISYSP_LGPL = 1

# Sources
CPP_SOURCES = TouchSpore.cpp common/spi_stub.cpp $(wildcard touch/*.cpp) $(wildcard engine/*.cpp) $(wildcard ui/*.cpp) $(wildcard display/*.cpp)
C_INCLUDES = -Ilib/ -Icommon/ -Itouch/ -Iengine/ -Iui/ -Idisplay/

# simple-touch-web sets SIMPLE_TOUCH_WEB=1. Both files replace symbols of the ARM build
# (libDaisy's SPI init, newlib's syscalls) that don't exist in WebAssembly.
ifdef SIMPLE_TOUCH_WEB
CPP_SOURCES := $(filter-out common/spi_stub.cpp touch/syscalls.cpp,$(CPP_SOURCES))
endif

# Library Locations
LIBDAISY_DIR = lib/libDaisy/
DAISYSP_DIR = lib/DaisySP/

# Core location, and generic Makefile.
SYSTEM_FILES_DIR = $(LIBDAISY_DIR)/core
include $(SYSTEM_FILES_DIR)/Makefile

CPP_STANDARD = -std=gnu++17

# Control code runs at 250 Hz in the main loop, so build it for size (-Os). The audio
# callback code (engine.cpp, fx.cpp) keeps the default -O2. sequencer.cpp also runs in
# the audio callback (Engine::_Step): move it back to -O2 if the audio load rises.
OS_OBJECTS = TouchSpore.o spore_ui.o spore_settings.o spore_screen.o spore_boot.o oled.o field.o knobs.o switches.o sequencer.o
$(addprefix $(BUILD_DIR)/,$(OS_OBJECTS)): OPT = -Os

libs:
	cd $(LIBDAISY_DIR) && "$(MAKE)"
	cd $(DAISYSP_DIR) && "$(MAKE)"

clean-libs:
	cd $(LIBDAISY_DIR) && "$(MAKE)" clean
	cd $(DAISYSP_DIR) && "$(MAKE)" clean

# `make release VERSION=0.1.0` -> build/touchspore-v0.1.0.bin: the lowercase,
# versioned name the Synthux community directory asks for on release assets.
release: all
ifndef VERSION
	$(error usage: make release VERSION=x.y.z)
endif
	cp $(BUILD_DIR)/$(TARGET).bin $(BUILD_DIR)/touchspore-v$(VERSION).bin
