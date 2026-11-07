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
CPP_SOURCES = TouchSpore.cpp $(wildcard touch/*.cpp) $(wildcard engine/*.cpp) $(wildcard ui/*.cpp)
C_INCLUDES = -Ilib/ -Icommon/ -Itouch/ -Iengine/ -Iui/

# Library Locations
LIBDAISY_DIR = lib/libDaisy/
DAISYSP_DIR = lib/DaisySP/

# Core location, and generic Makefile.
SYSTEM_FILES_DIR = $(LIBDAISY_DIR)/core
include $(SYSTEM_FILES_DIR)/Makefile

CPP_STANDARD = -std=gnu++17

libs:
	cd $(LIBDAISY_DIR) && "$(MAKE)"
	cd $(DAISYSP_DIR) && "$(MAKE)"

clean-libs:
	cd $(LIBDAISY_DIR) && "$(MAKE)" clean
	cd $(DAISYSP_DIR) && "$(MAKE)" clean
