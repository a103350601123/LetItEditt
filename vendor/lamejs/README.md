# lamejs (LAME MP3 encoder)

- Package: `@breezystack/lamejs` 1.2.7
- File: `lamejs.mjs`, a bundled port of LAME 3.100
- License: LGPL-2.1; see `LICENSE.txt` and <https://lame.sourceforge.net/>

## Local patch

The `Mp3Encoder` constructor now sets `R.out_samplerate = R.in_samplerate`
before `lame_init_params`. Without that line LAME silently chose 32 kHz for
low-bitrate stereo MP3 output (for example 96 kbps at a requested 48 kHz),
while the converter reported the requested rate. The patch keeps the encoded
stream at the sample rate the user selected, so the readback metadata and the
actual MP3 frames agree.

This file is the modified source of the bundled library, published here under
the LGPL alongside the rest of the package.
