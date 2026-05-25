FROM devkitpro/devkitarm:20260221

# 3ds-dev: libctru + citro3d + citro2d + 3dstools (picasso, bin2s, 3dsxtool, smdhtool, 3dslink)
RUN dkp-pacman -Syyu --noconfirm \
    3ds-dev

# rsync is required by libstarlight's dist-bin Makefile target
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends rsync \
    && rm -rf /var/lib/apt/lists/*

# Build libstarlight from source and install to $DEVKITPRO/libstarlight
# (testbed Makefile expects -L$(DEVKITPRO)/libstarlight/lib and -I$(DEVKITPRO)/libstarlight/include)
COPY libstarlight /tmp/libstarlight
RUN cd /tmp/libstarlight/libstarlight \
    && make -j$(nproc) install \
    && rm -rf /tmp/libstarlight

WORKDIR /work
