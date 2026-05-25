FROM devkitpro/devkitarm:20260221

# 3ds-dev: libctru + citro3d + citro2d + 3dstools (picasso, bin2s, 3dsxtool, smdhtool, 3dslink)
RUN dkp-pacman -Syyu --noconfirm \
    3ds-dev

# rsync for sync_romfs_data.sh
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends \
        rsync \
    && rm -rf /var/lib/apt/lists/*

# makerom (Project_CTR) — all deps (mbedtls, blz, yaml) are bundled in deps/
# Build sequence: make deps (builds bundled libs) then make program sequentially
# Note: bannertool (Steveice10) no longer available on GitHub; smdhtool from 3dstools handles SMDH
RUN git clone --depth 1 https://github.com/profi200/Project_CTR.git /tmp/pcttr \
    && cd /tmp/pcttr/makerom \
    && make -j$(nproc) deps && make program \
    && cp bin/makerom /usr/local/bin/ \
    && rm -rf /tmp/pcttr

# Build libstarlight from source and install to $DEVKITPRO/libstarlight
# (testbed Makefile expects -L$(DEVKITPRO)/libstarlight/lib and -I$(DEVKITPRO)/libstarlight/include)
COPY libstarlight /tmp/libstarlight
RUN cd /tmp/libstarlight/libstarlight \
    && make -j$(nproc) install \
    && rm -rf /tmp/libstarlight

WORKDIR /work
