FROM devkitpro/devkitarm:20260221

# 3ds-dev: libctru + citro3d + citro2d + 3dstools (picasso, bin2s, 3dsxtool, smdhtool, 3dslink)
RUN dkp-pacman -Syyu --noconfirm \
    3ds-dev

# rsync + build deps for makerom/bannertool
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends \
        rsync cmake libmbedtls-dev \
    && rm -rf /var/lib/apt/lists/*

# makerom (Project_CTR) — CIA/CCI packer
RUN git clone --depth 1 https://github.com/profi200/Project_CTR.git /tmp/pcttr \
    && cd /tmp/pcttr/makerom \
    && cmake -DCMAKE_BUILD_TYPE=Release . \
    && make -j$(nproc) \
    && cp makerom /usr/local/bin/ \
    && rm -rf /tmp/pcttr

# bannertool — 3DS banner + audio packer
RUN git clone --depth 1 https://github.com/Steveice10/bannertool.git /tmp/bannertool \
    && cd /tmp/bannertool \
    && cmake -DCMAKE_BUILD_TYPE=Release . \
    && make -j$(nproc) \
    && find . -maxdepth 3 -name bannertool -type f -exec cp {} /usr/local/bin/ \; \
    && rm -rf /tmp/bannertool

# Build libstarlight from source and install to $DEVKITPRO/libstarlight
# (testbed Makefile expects -L$(DEVKITPRO)/libstarlight/lib and -I$(DEVKITPRO)/libstarlight/include)
COPY libstarlight /tmp/libstarlight
RUN cd /tmp/libstarlight/libstarlight \
    && make -j$(nproc) install \
    && rm -rf /tmp/libstarlight

WORKDIR /work
