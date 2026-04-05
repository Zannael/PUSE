TARGET      := puse-switch
BUILD       := build
SOURCES     := source source/core source/io
INCLUDES    := include
ROMFS       := romfs

APP_TITLE   := PUSE Switch
APP_AUTHOR  := zappaganini
APP_VERSION := 0.1.0

ARCH        := -march=armv8-a+crc+crypto -mtune=cortex-a57 -fPIE

CFLAGS      := -g -O2 -ffunction-sections -fdata-sections $(ARCH)
CXXFLAGS    := $(CFLAGS) -fno-rtti -fno-exceptions -std=gnu++17
LDFLAGS     := -specs=$(DEVKITPRO)/libnx/switch.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)
LIBS        := -lnx
LD          := aarch64-none-elf-g++
LIBDIRS     := $(CURDIR)/tools/Plutonium/Plutonium $(PORTLIBS) $(LIBNX)

LIBS        := -lpu -lSDL2_mixer -lopusfile -lopus -lmodplug -lmpg123 -lvorbisidec -logg -lSDL2_ttf -lSDL2_gfx -lSDL2_image -lSDL2 -lEGL -lGLESv2 -lglapi -ldrm_nouveau -lwebp -lpng -ljpeg `sdl2-config --libs` -lfreetype -lharfbuzz -lz -lbz2 -lnx

ifneq ($(BUILD),$(notdir $(CURDIR)))

export OUTPUT := $(CURDIR)/$(TARGET)
export TOPDIR := $(CURDIR)
export VPATH  := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir))
export DEPSDIR := $(CURDIR)/$(BUILD)
export LD
export NROFLAGS += --romfsdir=$(TOPDIR)/romfs

CFILES   := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
CPPFILES := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.cpp)))
SFILES   := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.s)))

export OFILES := $(CPPFILES:.cpp=.o) $(CFILES:.c=.o) $(SFILES:.s=.o)

export INCLUDE := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) $(foreach dir,$(LIBDIRS),-I$(dir)/include) -I$(CURDIR)/$(BUILD) -I$(DEVKITPRO)/libnx/include -I$(DEVKITPRO)/portlibs/switch/include
export CPPFLAGS := $(INCLUDE)
export LIBPATHS := $(foreach dir,$(LIBDIRS),-L$(dir)/lib) -L$(DEVKITPRO)/libnx/lib -L$(DEVKITPRO)/portlibs/switch/lib

export APP_TITLE APP_AUTHOR APP_VERSION

.PHONY: all clean

all: $(BUILD) $(TARGET).nro

$(BUILD):
	@mkdir -p $(BUILD)
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(TOPDIR)/Makefile

$(TARGET).nro: $(BUILD)

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).nro $(TARGET).elf

else

.PHONY: all

all: $(OUTPUT).nro

$(OUTPUT).elf: $(OFILES)

$(OUTPUT).nro: $(OUTPUT).elf

endif

include $(DEVKITPRO)/libnx/switch_rules
