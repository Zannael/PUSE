FROM devkitpro/devkita64:latest

# Plutonium + SDL2 dependency stack (matching Plutonium README)
RUN dkp-pacman -Syyu --noconfirm \
    switch-tools \
    switch-pkg-config \
    switch-sdl2 \
    switch-sdl2_ttf \
    switch-sdl2_image \
    switch-sdl2_gfx \
    switch-sdl2_mixer \
    switch-mesa \
    switch-glad \
    switch-glm \
    switch-libdrm_nouveau \
    switch-libwebp \
    switch-libpng \
    switch-freetype \
    switch-bzip2 \
    switch-libjpeg-turbo \
    switch-opusfile \
    switch-libopus

WORKDIR /work
