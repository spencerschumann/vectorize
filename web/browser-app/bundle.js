// src/pdf/image_load.ts
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({
        width: img.width,
        height: img.height,
        data: new Uint8ClampedArray(imageData.data)
      });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      reject(new Error("Failed to load image"));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

// src/gpu/gpu_context.ts
var cachedContext = null;
var isInitializing = false;
var initPromise = null;
async function getGPUContext() {
  if (cachedContext) {
    return cachedContext;
  }
  if (isInitializing && initPromise) {
    return initPromise;
  }
  isInitializing = true;
  initPromise = (async () => {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported in this environment");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter found");
    }
    const device = await adapter.requestDevice();
    device.addEventListener("uncapturederror", (event) => {
      const gpuEvent = event;
      console.error("WebGPU uncaptured error:");
      console.error("  Type:", gpuEvent.error.constructor.name);
      console.error("  Message:", gpuEvent.error.message);
      console.error("  Full error:", gpuEvent.error);
    });
    console.log("WebGPU Adapter Limits:");
    console.log(`  maxStorageBufferBindingSize: ${adapter.limits.maxStorageBufferBindingSize}`);
    console.log(`  maxBufferSize: ${adapter.limits.maxBufferSize}`);
    console.log(`  maxComputeWorkgroupStorageSize: ${adapter.limits.maxComputeWorkgroupStorageSize}`);
    console.log(`  maxComputeInvocationsPerWorkgroup: ${adapter.limits.maxComputeInvocationsPerWorkgroup}`);
    console.log(`  maxComputeWorkgroupsPerDimension: ${adapter.limits.maxComputeWorkgroupsPerDimension}`);
    console.log(`  maxComputeWorkgroupSizeX: ${adapter.limits.maxComputeWorkgroupSizeX}`);
    console.log(`  maxComputeWorkgroupSizeY: ${adapter.limits.maxComputeWorkgroupSizeY}`);
    console.log(`  maxComputeWorkgroupSizeZ: ${adapter.limits.maxComputeWorkgroupSizeZ}`);
    cachedContext = { device, adapter };
    isInitializing = false;
    return cachedContext;
  })();
  return initPromise;
}
function createGPUBuffer(device, data, usage) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true
  });
  const arrayBuffer = buffer.getMappedRange();
  if (data instanceof Uint8Array) {
    new Uint8Array(arrayBuffer).set(data);
  } else if (data instanceof Uint32Array) {
    new Uint32Array(arrayBuffer).set(data);
  } else {
    new Float32Array(arrayBuffer).set(data);
  }
  buffer.unmap();
  return buffer;
}
async function readGPUBuffer(device, buffer, size) {
  const readBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
  device.queue.submit([commandEncoder.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);
  const data = new Uint8Array(readBuffer.getMappedRange()).slice();
  readBuffer.unmap();
  readBuffer.destroy();
  return data;
}

// src/gpu/white_threshold_gpu.ts
var shaderCode = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    threshold: f32,
    _padding: f32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    
    // Read pixel from input
    let pixel = input[pixel_idx];
    
    // Extract RGBA bytes (little-endian: R is lowest byte)
    let r = (pixel & 0xFFu);
    let g = (pixel >> 8u) & 0xFFu;
    let b = (pixel >> 16u) & 0xFFu;
    let a = (pixel >> 24u) & 0xFFu;
    
    // Calculate average brightness
    let avg = (f32(r) + f32(g) + f32(b)) / (3.0 * 255.0);
    
    var out_r: u32;
    var out_g: u32;
    var out_b: u32;
    var out_a: u32;
    
    if (avg >= params.threshold) {
        // Set to pure white
        out_r = 255u;
        out_g = 255u;
        out_b = 255u;
        out_a = 255u;
    } else {
        // Keep original
        out_r = r;
        out_g = g;
        out_b = b;
        out_a = a;
    }
    
    // Pack back into u32
    output[pixel_idx] = out_r | (out_g << 8u) | (out_b << 16u) | (out_a << 24u);
}
`;
async function whiteThresholdGPU(image, threshold = 0.85) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const byteSize = pixelCount * 4;
  console.log(`Image: ${width}x${height}, ${pixelCount} pixels, ${byteSize} bytes`);
  console.log(`Input data length: ${data.length}, byteLength: ${data.byteLength}`);
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  console.log(`Input buffer created: ${byteSize} bytes`);
  const outputBuffer = device.createBuffer({
    size: byteSize,
    // Size in bytes (= pixelCount * 4)
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: false
  });
  console.log(`Output buffer created: ${byteSize} bytes`);
  const paramsBuffer = device.createBuffer({
    size: 16,
    // 4 floats * 4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const paramsArrayBuffer = new ArrayBuffer(16);
  const paramsU32View = new Uint32Array(paramsArrayBuffer);
  const paramsF32View = new Float32Array(paramsArrayBuffer);
  paramsU32View[0] = width;
  paramsU32View[1] = height;
  paramsF32View[2] = threshold;
  paramsF32View[3] = 0;
  device.queue.writeBuffer(paramsBuffer, 0, paramsArrayBuffer);
  const shaderModule = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  console.log(`Dispatching ${workgroupsX} x ${workgroupsY} workgroups for ${width}x${height} image`);
  passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  console.log("Submitted compute shader");
  if (typeof window !== "undefined") {
    console.log("Browser detected, using onSubmittedWorkDone()");
    await device.queue.onSubmittedWorkDone();
    console.log("GPU work completed");
  } else {
    console.log("Deno detected, using delay workaround");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const outputData = await readGPUBuffer(device, outputBuffer, byteSize);
  console.log(`Read back white threshold output data: ${outputData.length} bytes`);
  console.log(`First 10 u32 values from output: ${Array.from(new Uint32Array(outputData.buffer, 0, 10))}`);
  console.log(`First 10 RGBA pixels: ${Array.from(outputData.slice(0, 40))}`);
  const row123Start = 123 * 6800 * 4;
  const row124Start = 124 * 6800 * 4;
  console.log(`Row 123 first 10 pixels: ${Array.from(outputData.slice(row123Start, row123Start + 40))}`);
  console.log(`Row 124 first 10 pixels: ${Array.from(outputData.slice(row124Start, row124Start + 40))}`);
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: new Uint8ClampedArray(outputData.buffer, 0, byteSize)
  };
}

// src/gpu/palettize_gpu.ts
var shaderCode2 = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<storage, read> palette: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    palette_size: u32,
}

fn color_distance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    let diff = c1 - c2;
    return dot(diff, diff);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let idx = y * params.width + x;
    let pixel = input[idx];
    
    // Unpack RGB
    let r = f32(pixel & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    let color = vec3<f32>(r, g, b);
    
    // Find nearest palette color
    var best_idx: u32 = 0u;
    var best_dist = 999999.0;
    
    for (var i = 0u; i < params.palette_size; i++) {
        let pal_pixel = palette[i];
        let pr = f32(pal_pixel & 0xFFu) / 255.0;
        let pg = f32((pal_pixel >> 8u) & 0xFFu) / 255.0;
        let pb = f32((pal_pixel >> 16u) & 0xFFu) / 255.0;
        let pal_color = vec3<f32>(pr, pg, pb);
        
        let dist = color_distance(color, pal_color);
        if (dist < best_dist) {
            best_dist = dist;
            best_idx = i;
        }
    }
    
    // Pack 2 pixels per u32 (4 bits each)
    // Each workgroup handles one pixel, we'll pack later
    output[idx] = best_idx;
}
`;
async function palettizeGPU(image, palette) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const paletteSize = palette.length / 4;
  if (paletteSize !== 16) {
    throw new Error("GPU palettization currently only supports 16-color palettes");
  }
  const pixelCount = width * height;
  const input = new Uint32Array(pixelCount);
  const paletteU32 = new Uint32Array(paletteSize);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    input[i] = dataView.getUint32(i * 4, true);
  }
  const paletteView = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  for (let i = 0; i < paletteSize; i++) {
    paletteU32[i] = paletteView.getUint32(i * 4, true);
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: pixelCount * 4,
    // Temporary: one u32 per pixel
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paletteBuffer = createGPUBuffer(
    device,
    new Uint8Array(paletteU32.buffer, paletteU32.byteOffset, paletteU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const paramsData = new Uint32Array([width, height, paletteSize, 0]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode2 });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paletteBuffer } },
      { binding: 3, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const indices = await readGPUBuffer(device, outputBuffer, pixelCount * 4);
  const indicesU32 = new Uint32Array(indices.buffer);
  const packedSize = Math.ceil(pixelCount / 2);
  const packed = new Uint8Array(packedSize);
  for (let i = 0; i < pixelCount; i++) {
    const byteIdx = Math.floor(i / 2);
    const isHighNibble = i % 2 === 0;
    const paletteIdx = indicesU32[i] & 15;
    if (isHighNibble) {
      packed[byteIdx] = paletteIdx << 4;
    } else {
      packed[byteIdx] |= paletteIdx;
    }
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paletteBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: packed,
    palette: new Uint8ClampedArray(palette)
  };
}

// src/formats/palettized.ts
function getPixelPal(img, x, y) {
  const pixelIndex = y * img.width + x;
  const byteIndex = Math.floor(pixelIndex / 2);
  const isHighNibble = pixelIndex % 2 === 0;
  if (isHighNibble) {
    return img.data[byteIndex] >> 4 & 15;
  } else {
    return img.data[byteIndex] & 15;
  }
}
var DEFAULT_PALETTE_16 = new Uint32Array([
  4294967295,
  // 0: white
  255,
  // 1: black
  4278190335,
  // 2: red
  16711935,
  // 3: green
  65535,
  // 4: blue
  4294902015,
  // 5: yellow
  4278255615,
  // 6: magenta
  16777215,
  // 7: cyan
  2155905279,
  // 8: gray
  3233857791,
  // 9: light gray
  2147483903,
  // 10: dark red
  8388863,
  // 11: dark green
  33023,
  // 12: dark blue
  2155872511,
  // 13: olive
  2147516671,
  // 14: purple
  8421631
  // 15: teal
]);

// src/gpu/median_gpu.ts
var shaderCode3 = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn get_pixel(data: ptr<storage, array<u32>>, x: u32, y: u32, w: u32) -> u32 {
    let idx = y * w + x;
    let packed = (*data)[idx / 2u];
    
    // Extract 4-bit value
    if (idx % 2u == 0u) {
        return (packed >> 4u) & 0xFu;
    } else {
        return packed & 0xFu;
    }
}

fn median9(values: array<u32, 9>) -> u32 {
    // Simple bubble sort for 9 values
    var sorted = values;
    for (var i = 0u; i < 9u; i++) {
        for (var j = 0u; j < 8u - i; j++) {
            if (sorted[j] > sorted[j + 1u]) {
                let tmp = sorted[j];
                sorted[j] = sorted[j + 1u];
                sorted[j + 1u] = tmp;
            }
        }
    }
    return sorted[4]; // Middle value
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    // Clamp coordinates for edge handling
    let x_prev = max(x, 1u) - 1u;
    let x_next = min(x + 1u, params.width - 1u);
    let y_prev = max(y, 1u) - 1u;
    let y_next = min(y + 1u, params.height - 1u);
    
    // Gather 3x3 neighborhood
    var values: array<u32, 9>;
    values[0] = get_pixel(&input, x_prev, y_prev, params.width);
    values[1] = get_pixel(&input, x,      y_prev, params.width);
    values[2] = get_pixel(&input, x_next, y_prev, params.width);
    values[3] = get_pixel(&input, x_prev, y,      params.width);
    values[4] = get_pixel(&input, x,      y,      params.width);
    values[5] = get_pixel(&input, x_next, y,      params.width);
    values[6] = get_pixel(&input, x_prev, y_next, params.width);
    values[7] = get_pixel(&input, x,      y_next, params.width);
    values[8] = get_pixel(&input, x_next, y_next, params.width);
    
    let median_val = median9(values);
    
    // Store result (unpacked, one u32 per pixel for now)
    let idx = y * params.width + x;
    output[idx] = median_val;
}
`;
async function median3x3GPU(image) {
  const { device } = await getGPUContext();
  const { width, height, data, palette } = image;
  const pixelCount = width * height;
  const unpacked = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    unpacked[i] = getPixelPal(image, i % width, Math.floor(i / width));
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: unpacked.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsData = new Uint32Array([width, height]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode3 });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const outputData = await readGPUBuffer(device, outputBuffer, unpacked.byteLength);
  const outputU32 = new Uint32Array(outputData.buffer);
  const packedSize = Math.ceil(pixelCount / 2);
  const packed = new Uint8Array(packedSize);
  for (let i = 0; i < pixelCount; i++) {
    const byteIdx = Math.floor(i / 2);
    const isHighNibble = i % 2 === 0;
    const paletteIdx = outputU32[i] & 15;
    if (isHighNibble) {
      packed[byteIdx] = paletteIdx << 4;
    } else {
      packed[byteIdx] |= paletteIdx;
    }
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: packed,
    palette: new Uint8ClampedArray(palette)
  };
}

// src/formats/binary.ts
function createBinaryImage(width, height) {
  const size = Math.ceil(width * height / 8);
  return {
    width,
    height,
    data: new Uint8Array(size)
  };
}
function setPixelBin(img, x, y, value) {
  const pixelIndex = y * img.width + x;
  const byteIndex = Math.floor(pixelIndex / 8);
  const bitIndex = 7 - pixelIndex % 8;
  if (value === 1) {
    img.data[byteIndex] |= 1 << bitIndex;
  } else {
    img.data[byteIndex] &= ~(1 << bitIndex);
  }
}

// src/raster/threshold.ts
function extractBlack(img, options = {}) {
  const { whiteThreshold = 0.1, blackThreshold = 0.05 } = options;
  const binary = createBinaryImage(img.width, img.height);
  if (!img.palette) {
    throw new Error("Palettized image must have palette");
  }
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const paletteIndex = getPixelPal(img, x, y);
      const color = img.palette[paletteIndex];
      const r = color >> 24 & 255;
      const g = color >> 16 & 255;
      const b = color >> 8 & 255;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const normalized = gray / 255;
      let isBlack = false;
      if (normalized > whiteThreshold) {
        isBlack = false;
      } else if (normalized < blackThreshold) {
        isBlack = true;
      } else {
        const midpoint = (whiteThreshold + blackThreshold) / 2;
        isBlack = normalized < midpoint;
      }
      setPixelBin(binary, x, y, isBlack ? 1 : 0);
    }
  }
  return binary;
}

// browser-app/main.ts
function paletteToRGBA(palette) {
  const rgba = new Uint8ClampedArray(palette.length * 4);
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    rgba[i * 4] = color >> 24 & 255;
    rgba[i * 4 + 1] = color >> 16 & 255;
    rgba[i * 4 + 2] = color >> 8 & 255;
    rgba[i * 4 + 3] = color & 255;
  }
  return rgba;
}
var PALETTE_RGBA = paletteToRGBA(DEFAULT_PALETTE_16);
var dropZone = document.getElementById("dropZone");
var fileInput = document.getElementById("fileInput");
var statusEl = document.getElementById("status");
var resultsEl = document.getElementById("results");
dropZone?.addEventListener("click", () => fileInput?.click());
dropZone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});
dropZone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    processImage(files[0]);
  }
});
fileInput?.addEventListener("change", (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    processImage(files[0]);
  }
});
async function processImage(file) {
  try {
    showStatus(`Loading: ${file.name}...`);
    const start = performance.now();
    const image = await loadImageFromFile(file);
    const loadTime = performance.now() - start;
    showStatus(`Loaded: ${image.width}x${image.height} (${loadTime.toFixed(1)}ms)`);
    displayImage(image, "Original");
    showStatus("Initializing WebGPU...");
    const t1 = performance.now();
    const thresholded = await whiteThresholdGPU(image, 0.85);
    const t2 = performance.now();
    showStatus(`White threshold: ${(t2 - t1).toFixed(1)}ms`);
    displayImage(thresholded, "1. White Threshold");
    const t3 = performance.now();
    const palettized = await palettizeGPU(thresholded, PALETTE_RGBA);
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    const t5 = performance.now();
    const median = await median3x3GPU(palettized);
    const t6 = performance.now();
    showStatus(`Median filter: ${(t6 - t5).toFixed(1)}ms`);
    const t7 = performance.now();
    const _binary = extractBlack(median);
    const t8 = performance.now();
    showStatus(`Extract black: ${(t8 - t7).toFixed(1)}ms`);
    const totalTime = t8 - t1;
    showStatus(`\u2713 Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    const err = error;
    showStatus(`Error: ${err.message}`, true);
    console.error(error);
  }
}
function displayImage(image, label) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.style.maxWidth = "100%";
  canvas.style.border = "1px solid #ccc";
  canvas.style.marginBottom = "1rem";
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height
    );
    ctx.putImageData(imageData, 0, 0);
  }
  const container = document.createElement("div");
  container.style.marginBottom = "2rem";
  const title = document.createElement("h3");
  title.textContent = label;
  title.style.marginBottom = "0.5rem";
  container.appendChild(title);
  container.appendChild(canvas);
  resultsEl?.appendChild(container);
}
function showStatus(message, isError = false) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#ef4444" : "#000";
  }
  console.log(message);
}
