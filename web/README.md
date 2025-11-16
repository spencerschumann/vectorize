# CleanPlans Vectorizer - TypeScript + WebGPU

Browser and Deno-compatible TypeScript implementation of the vectorization pipeline. Replaces the Python/ImageMagick/Autotrace proof-of-concept with modern WebGPU-accelerated processing.

## 🚀 Quick Start

### Prerequisites
- **Deno** v1.40+ ([install](https://deno.land/))
- Modern browser with WebGPU (Chrome/Edge 113+)

### Run Browser App
```bash
cd web
deno task dev
# Open http://localhost:8000
```

### Run CLI (Deno Command Line)
```bash
cd web

# Extract first page
deno task cli --input path/to/file.pdf

# Full pipeline on page 2
deno task cli --input path/to/file.pdf --page 2 --full-pipeline
```

### Run Tests
```bash
cd web
deno task test
```

## 📁 Project Structure

```
web/
├── deno.json              # Config, tasks, dependencies
├── src/                   # Shared TypeScript (browser + Deno)
│   ├── pdf/
│   │   ├── pdf_render.ts       # PDF abstraction (browser)
│   │   ├── pdf_render_deno.ts  # PDF for Deno CLI
│   │   ├── browser_canvas.ts   # Browser HTMLCanvas backend
│   │   └── deno_canvas.ts      # (deprecated - not used)
│   ├── raster/
│   │   ├── crop.ts
│   │   ├── grayscale.ts
│   │   ├── median.ts           # 3x3 median filter
│   │   ├── palette.ts          # 16-color palettization
│   │   └── threshold.ts        # Black channel extraction
│   ├── formats/
│   │   ├── rgba_image.ts       # 4 bytes/pixel
│   │   ├── palettized.ts       # 4 bits/pixel (2 px/byte)
│   │   ├── binary.ts           # 1 bit/pixel (8 px/byte)
│   │   └── formats_test.ts     # Unit tests
│   └── util/
├── browser-app/
│   ├── server.ts          # Deno HTTP server
│   ├── index.html         # UI
│   └── main.ts            # Browser entry
├── deno-app/
│   └── cli.ts             # CLI for batch + testing
└── README.md
```

## ✅ Phase 1: Complete

**All core pipeline steps implemented in TypeScript:**
- ✅ PDF rendering (pdf.js in browser, pdf-lib in Deno)
- ✅ Dual backends (browser: full rendering, Deno: metadata + synthetic images)
- ✅ Image formats (RGBA, 4bpp palettized, 1bpp binary)
- ✅ Crop, grayscale, median filter, palettize, threshold
- ✅ Browser UI + CLI
- ✅ Unit tests

## 🎯 Roadmap

### Phase 2: GPU Acceleration
- [ ] WebGPU compute shaders (median, palettize)
- [ ] Interactive crop in browser
- [ ] PNG export for debugging

### Phase 3: Vectorization
- [ ] Skeletonization/thinning
- [ ] Path tracing
- [ ] Bezier curve fitting
- [ ] SVG export

### Phase 4: Optimization
- [ ] Web Workers
- [ ] Batch processing
- [ ] Performance tuning

## 💻 Usage

### Browser
1. `deno task dev`
2. Open http://localhost:8000
3. Drop PDF file
4. View rendered page (full pixel-perfect rendering)

### CLI
```bash
# Show help
deno task cli --help

# Extract page metadata
deno task cli --input plan.pdf --page 1

# Full pipeline with synthetic image
deno task cli --input plan.pdf --full-pipeline
# Creates: output_raw.txt, output_palette.txt, output_binary.txt
```

**Note**: The CLI uses pdf-lib which extracts PDF metadata (page count, dimensions) and creates blank images for testing the pipeline. For full pixel rendering in Deno, consider pre-rendering PDFs to images or using headless Chrome.

### Programmatic
```typescript
import { renderPdfPage } from "./src/pdf/pdf_render.ts";
import { toGrayscale } from "./src/raster/grayscale.ts";
import { median3x3 } from "./src/raster/median.ts";
import { palettize16, DEFAULT_PALETTE_16 } from "./src/raster/palette.ts";
import { extractBlack } from "./src/raster/threshold.ts";
import { cropRGBA } from "./src/raster/crop.ts";

// Full pipeline example (browser)
const rgba = await renderPdfPage({...}, backend, pdfjsLib);
const cropped = cropRGBA(rgba, { x: 100, y: 100, width: 800, height: 600 });
const gray = toGrayscale(cropped);
const filtered = median3x3(gray);
const pal = palettize16(filtered, DEFAULT_PALETTE_16);
const black = extractBlack(pal, { whiteThreshold: 0.10, blackThreshold: 0.05 });
```

## 🧪 Testing

```bash
# All tests
deno task test

# Specific test
deno test src/formats/formats_test.ts
```

**Tested:**
- Palettized/binary pixel packing
- Grayscale conversion (luminance formula)
- Crop correctness
- Format integrity

## 📚 Image Formats

### RGBA (4 bytes/pixel)
```typescript
interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // length = width * height * 4
}
```

### Palettized (4 bits/pixel)
```typescript
interface PalettizedImage {
  width: number;
  height: number;
  data: Uint8Array;       // 2 pixels per byte, high nibble first
  palette?: Uint32Array;  // 16 RGBA colors
}
```

### Binary (1 bit/pixel)
```typescript
interface BinaryImage {
  width: number;
  height: number;
  data: Uint8Array;  // 8 pixels per byte, MSB-first
}
```

## 🔄 Pipeline Flow

```
PDF
 ↓ (Browser: pdf.js → pixels | Deno: pdf-lib → metadata → synthetic image)
RGBA (4 bytes/px)
 ↓ crop
RGBA (cropped)
 ↓ toGrayscale
RGBA (gray)
 ↓ median3x3
RGBA (filtered)
 ↓ palettize16
Palettized (4 bits/px, 16 colors, no dither)
 ↓ extractBlack
Binary (1 bit/px, thresholded)
```

Each step: pure function, deterministic, testable.

## 🛠️ Tech Stack

- **TypeScript** - shared code between browser & Deno
- **Deno** - runtime for CLI, testing
- **PDF.js** - PDF rendering (browser only)
- **pdf-lib** - PDF metadata (Deno CLI)
- **WebGPU** - GPU acceleration (planned)

## 📝 PDF Rendering Strategy

### Browser (Full Rendering)
- Uses **PDF.js** with HTMLCanvas
- Renders pages to actual pixels (RGBA)
- Full fidelity for production use

### Deno CLI (Metadata + Testing)
- Uses **pdf-lib** for PDF parsing
- Extracts page count, dimensions
- Creates synthetic blank images at correct size
- Allows testing full pipeline without native dependencies

**For production Deno use with real PDFs:**
- Pre-render PDFs to images (PNG/TIFF)
- Use external tools (poppler, ghostscript)
- Run browser version in headless Chrome
- Use the CLI for testing pipeline logic

## 🌐 Browser Support

- Chrome/Edge 113+ (WebGPU)
- All modern browsers (PDF extraction)

## 🤝 Contributing

Focus areas:
- WebGPU compute shaders
- Vectorization algorithms  
- UI/UX
- Test coverage

## 📖 References

- Original: `../` (Python/Docker proof-of-concept)
- `README_original.md` - detailed pipeline spec
- [WebGPU](https://www.w3.org/TR/webgpu/)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [pdf-lib](https://pdf-lib.js.org/)
- [Deno](https://deno.land/manual)
