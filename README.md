# vectorize: ImageMagick + autotrace Docker image (Fedora 43)

This repository contains a `Dockerfile` that builds a small Fedora 43 image with ImageMagick and `autotrace` installed.

Why Fedora?
- Fedora's package set includes `autotrace` in dnf repos for current releases, which avoids building from source. Previous attempts with Debian/Ubuntu variants sometimes lacked an `autotrace` package.

Build
----
From the `vectorize` directory:
```bash
docker build -t vectorize-magick-autotrace .
```

Quick test (versions)
----
```bash
docker run --rm vectorize-magick-autotrace
```

Example: raster -> SVG
----
```bash
# from host (bash)
docker run --rm -v "$(pwd)":/data -w /data vectorize-magick-autotrace \
  bash -lc "magick input.png -alpha off -resize 800x800 pnm:- | autotrace --output-file output.svg --output-format svg -"
```

Notes
----
- If you need a smaller image, you can attempt Alpine but `autotrace` may require compilation and extra build deps.
- If Fedora package names change, install `autotrace` and `ImageMagick` with the names available in the repo.
# vectorize: ImageMagick + autotrace Docker image

This image provides ImageMagick (`magick`) and `autotrace` on Debian slim.

Build
----
From the `vectorize` directory:
```bash
docker build -t vectorize-magick-autotrace .