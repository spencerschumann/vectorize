// src/pdf/image_load.ts
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx3 = canvas.getContext("2d");
      if (!ctx3) {
        reject(new Error("Could not get 2D context"));
        return;
      }
      ctx3.drawImage(img, 0, 0);
      const imageData = ctx3.getImageData(0, 0, img.width, img.height);
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

// src/pdf/pdf_render.ts
async function renderPdfPage(options, backend, pdfjsLib2) {
  const { file, pageNumber, scale = 2 } = options;
  const loadingTask = pdfjsLib2.getDocument({ data: file });
  const pdf = await loadingTask.promise;
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(
      `Page ${pageNumber} out of range (1-${pdf.numPages})`
    );
  }
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = backend.createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get 2D context");
  }
  await page.render({
    canvasContext: context,
    viewport
  }).promise;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data
  };
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
  return await initPromise;
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

// src/gpu/cleanup_gpu.ts
var extractChannelsShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> value_out: array<f32>;
@group(0) @binding(2) var<storage, read_write> saturation_out: array<f32>;
@group(0) @binding(3) var<storage, read_write> hue_out: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let pixel = input[pixel_idx];
    
    // Extract RGBA bytes (little-endian: byte 0=R, 1=G, 2=B, 3=A)
    // But when stored as u32 in GPU buffer from RGBA bytes:
    // GPU sees it as: A|B|G|R (bytes 3|2|1|0 in memory become 0|1|2|3 in u32)
    let r = f32((pixel >> 0u) & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    
    // Calculate min and max for HSV
    let min_rgb = min(min(r, g), b);
    let max_rgb = max(max(r, g), b);
    let delta = max_rgb - min_rgb;
    
    // Value = min(R,G,B) - gives 1.0 for white, 0.0 for black/colors
    value_out[pixel_idx] = min_rgb;
    
    // Saturation = max(R,G,B) - min(R,G,B) - gives 0.0 for grayscale, higher for saturated
    saturation_out[pixel_idx] = delta;
    
    // Hue calculation
    var h: f32 = -1.0;
    if (delta > 0.1) {
        if (max_rgb == r) {
            h = ((g - b) / delta) / 6.0;
            if (h < 0.0) {
                h = h + 1.0;
            }
        } else if (max_rgb == g) {
            h = ((b - r) / delta + 2.0) / 6.0;
        } else {
            h = ((r - g) / delta + 4.0) / 6.0;
        }
    }
    hue_out[pixel_idx] = h; // Store hue as 0.0 to 1.0
}
`;
var thresholdShader = `
@group(0) @binding(0) var<storage, read> value_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> value_out: array<atomic<u32>>;
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
    let value = value_in[pixel_idx];
    
    // Binary threshold: 1 = line (dark), 0 = background (light)
    // Inverted from original: value < threshold means it's dark (a line)
    if (value < params.threshold) {
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&value_out[word_idx], 1u << bit_idx);
    }
}
`;
var medianFilterShader = `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Sorting network for 9 elements (median filter)
fn median9(v: array<f32, 9>) -> f32 {
    var arr = v;
    
    // Simple bubble sort for median (good enough for 9 elements)
    for (var i = 0u; i < 9u; i = i + 1u) {
        for (var j = 0u; j < 8u - i; j = j + 1u) {
            if (arr[j] > arr[j + 1u]) {
                let temp = arr[j];
                arr[j] = arr[j + 1u];
                arr[j + 1u] = temp;
            }
        }
    }
    
    return arr[4]; // Middle element
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let w = i32(params.width);
    let h = i32(params.height);
    let ix = i32(x);
    let iy = i32(y);
    
    var values: array<f32, 9>;
    var idx = 0u;
    
    // Gather 3x3 neighborhood
    for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
            let nx = clamp(ix + dx, 0, w - 1);
            let ny = clamp(iy + dy, 0, h - 1);
            values[idx] = input[u32(ny) * params.width + u32(nx)];
            idx = idx + 1u;
        }
    }
    
    let pixel_idx = y * params.width + x;
    output[pixel_idx] = median9(values);
}
`;
var recombineShader = `
@group(0) @binding(0) var<storage, read> value_in: array<u32>;
@group(0) @binding(1) var<storage, read> saturation_in: array<f32>;
@group(0) @binding(2) var<storage, read> hue_in: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Convert HSV to RGB
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
    if (h < 0 || s < 0.1) {
        // Grayscale
        return vec3<f32>(v, v, v);
    }
    
    let h6 = h * 6.0;
    let sector = u32(floor(h6));
    let frac = h6 - f32(sector);
    
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * frac);
    let t = v * (1.0 - s * (1.0 - frac));
    
    switch (sector % 6u) {
        case 0u: { return vec3<f32>(v, t, p); }
        case 1u: { return vec3<f32>(q, v, p); }
        case 2u: { return vec3<f32>(p, v, t); }
        case 3u: { return vec3<f32>(p, q, v); }
        case 4u: { return vec3<f32>(t, p, v); }
        default: { return vec3<f32>(v, p, q); }
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    
    // Read packed binary value: 1 = line, 0 = background
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let value_bit = (value_in[word_idx] >> bit_idx) & 1u;
    
    let saturation = saturation_in[pixel_idx]; // Cleaned saturation
    let hue = hue_in[pixel_idx]; // Cleaned hue
    
    // For background pixels (value_bit = 0), output white
    // For line pixels (value_bit = 1), reconstruct color from cleaned hue and saturation
    var rgb: vec3<f32>;
    if (value_bit == 0u) {
        // Background - output white
        rgb = vec3<f32>(1.0, 1.0, 1.0);
    } else {
        // Line - reconstruct color with full brightness
        // Use saturation and hue to rebuild the color
        if (saturation < 0.1 || hue < 0.0) {
            // Grayscale line - output black
            rgb = vec3<f32>(0.0, 0.0, 0.0);
        } else {
            // Colored line - reconstruct from HSV with V=1.0 for full brightness
            rgb = hsv_to_rgb(hue, 1.0, 1.0);
        }
    }
    
    let r = u32(clamp(rgb.x * 255.0, 0.0, 255.0));
    let g = u32(clamp(rgb.y * 255.0, 0.0, 255.0));
    let b = u32(clamp(rgb.z * 255.0, 0.0, 255.0));
    let a = 255u;
    
    output[pixel_idx] = r | (g << 8u) | (b << 16u) | (a << 24u);
}
`;
var channelToGrayscaleShader = `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let value = input[pixel_idx];
    
    let gray = u32(clamp(value * 255.0, 0.0, 255.0));
    output[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;
var binaryToGrayscaleShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let bit = (input[word_idx] >> bit_idx) & 1u;
    
    // 1 = line (black), 0 = background (white)
    let gray = (1u - bit) * 255u;
    output[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;
var hueToRGBShader = `
@group(0) @binding(0) var<storage, read> hue_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
    if (h < 0 || s < 0.1) {
        // Grayscale
        return vec3<f32>(v, v, v);
    }

    let h6 = h * 6.0;
    let sector = u32(floor(h6));
    let frac = h6 - f32(sector);
    
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * frac);
    let t = v * (1.0 - s * (1.0 - frac));
    
    switch (sector % 6u) {
        case 0u: { return vec3<f32>(v, t, p); }
        case 1u: { return vec3<f32>(q, v, p); }
        case 2u: { return vec3<f32>(p, v, t); }
        case 3u: { return vec3<f32>(p, q, v); }
        case 4u: { return vec3<f32>(t, p, v); }
        default: { return vec3<f32>(v, p, q); }
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let hue = hue_in[pixel_idx];
    
    // Convert hue to RGB with full saturation and value for visualization
    let rgb = hsv_to_rgb(hue, 1.0, 1.0);
    
    let r = u32(clamp(rgb.x * 255.0, 0.0, 255.0));
    let g = u32(clamp(rgb.y * 255.0, 0.0, 255.0));
    let b = u32(clamp(rgb.z * 255.0, 0.0, 255.0));
    
    output[pixel_idx] = r | (g << 8u) | (b << 16u) | (255u << 24u);
}
`;
async function cleanupGPU(image) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const byteSize = pixelCount * 4;
  const floatByteSize = pixelCount * 4;
  const binaryWordCount = Math.ceil(pixelCount / 32);
  const binaryByteSize = binaryWordCount * 4;
  console.log(`Cleanup: ${width}x${height}, ${pixelCount} pixels, data.length=${data.length}, expected=${byteSize}`);
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const valueBuffer1 = device.createBuffer({
    size: floatByteSize,
    // f32
    usage: GPUBufferUsage.STORAGE
  });
  const valueBuffer2 = device.createBuffer({
    size: binaryByteSize,
    // Packed binary format
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const saturationBuffer1 = device.createBuffer({
    size: floatByteSize,
    // f32
    usage: GPUBufferUsage.STORAGE
  });
  const saturationBuffer2 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const hueBuffer1 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const hueBuffer2 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const outputBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const extractParams = new Uint32Array([width, height]);
  const extractParamsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(extractParamsBuffer, 0, extractParams);
  const thresholdParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const thresholdParamsArray = new ArrayBuffer(16);
  const thresholdParamsU32 = new Uint32Array(thresholdParamsArray);
  const thresholdParamsF32 = new Float32Array(thresholdParamsArray);
  thresholdParamsU32[0] = width;
  thresholdParamsU32[1] = height;
  thresholdParamsF32[2] = 0.5;
  thresholdParamsF32[3] = 0;
  device.queue.writeBuffer(thresholdParamsBuffer, 0, thresholdParamsArray);
  const medianParams = new Uint32Array([width, height]);
  const medianParamsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(medianParamsBuffer, 0, medianParams);
  const extractModule = device.createShaderModule({ code: extractChannelsShader });
  const thresholdModule = device.createShaderModule({ code: thresholdShader });
  const medianModule = device.createShaderModule({ code: medianFilterShader });
  const recombineModule = device.createShaderModule({ code: recombineShader });
  const extractPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: extractModule, entryPoint: "main" }
  });
  const thresholdPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: thresholdModule, entryPoint: "main" }
  });
  const medianPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: medianModule, entryPoint: "main" }
  });
  const recombinePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: recombineModule, entryPoint: "main" }
  });
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  {
    const bindGroup = device.createBindGroup({
      layout: extractPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: valueBuffer1 } },
        { binding: 2, resource: { buffer: saturationBuffer1 } },
        { binding: 3, resource: { buffer: hueBuffer1 } },
        { binding: 4, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(extractPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  device.queue.writeBuffer(valueBuffer2, 0, new Uint32Array(binaryWordCount));
  {
    const bindGroup = device.createBindGroup({
      layout: thresholdPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer1 } },
        { binding: 1, resource: { buffer: valueBuffer2 } },
        { binding: 2, resource: { buffer: thresholdParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(thresholdPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: medianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: saturationBuffer1 } },
        { binding: 1, resource: { buffer: saturationBuffer2 } },
        { binding: 2, resource: { buffer: medianParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(medianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: medianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: hueBuffer1 } },
        { binding: 1, resource: { buffer: hueBuffer2 } },
        { binding: 2, resource: { buffer: medianParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(medianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: recombinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer2 } },
        { binding: 1, resource: { buffer: saturationBuffer2 } },
        { binding: 2, resource: { buffer: hueBuffer2 } },
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(recombinePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  if (typeof window !== "undefined") {
    await device.queue.onSubmittedWorkDone();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const grayscaleModule = device.createShaderModule({ code: channelToGrayscaleShader });
  const binaryModule = device.createShaderModule({ code: binaryToGrayscaleShader });
  const hueVisModule = device.createShaderModule({ code: hueToRGBShader });
  const grayscalePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: grayscaleModule, entryPoint: "main" }
  });
  const binaryPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: binaryModule, entryPoint: "main" }
  });
  const hueVisPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: hueVisModule, entryPoint: "main" }
  });
  const valueVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const saturationVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const saturationMedianVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const hueVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const hueMedianVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  {
    const bindGroup = device.createBindGroup({
      layout: binaryPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer2 } },
        { binding: 1, resource: { buffer: valueVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(binaryPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: grayscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: saturationBuffer1 } },
        { binding: 1, resource: { buffer: saturationVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(grayscalePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: grayscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: saturationBuffer2 } },
        { binding: 1, resource: { buffer: saturationMedianVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(grayscalePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: hueVisPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: hueBuffer1 } },
        { binding: 1, resource: { buffer: hueVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(hueVisPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: hueVisPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: hueBuffer2 } },
        { binding: 1, resource: { buffer: hueMedianVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(hueVisPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const [finalData, valueData, satData, satMedianData, hueData, hueMedianData] = await Promise.all([
    readGPUBuffer(device, outputBuffer, byteSize),
    readGPUBuffer(device, valueVisBuffer, byteSize),
    readGPUBuffer(device, saturationVisBuffer, byteSize),
    readGPUBuffer(device, saturationMedianVisBuffer, byteSize),
    readGPUBuffer(device, hueVisBuffer, byteSize),
    readGPUBuffer(device, hueMedianVisBuffer, byteSize)
  ]);
  console.log(`Cleanup complete: ${finalData.length} bytes`);
  inputBuffer.destroy();
  valueBuffer1.destroy();
  saturationBuffer1.destroy();
  hueBuffer1.destroy();
  outputBuffer.destroy();
  valueVisBuffer.destroy();
  saturationVisBuffer.destroy();
  saturationMedianVisBuffer.destroy();
  hueVisBuffer.destroy();
  hueMedianVisBuffer.destroy();
  extractParamsBuffer.destroy();
  thresholdParamsBuffer.destroy();
  medianParamsBuffer.destroy();
  return {
    value: {
      width,
      height,
      data: new Uint8ClampedArray(valueData.buffer, 0, byteSize)
    },
    saturation: {
      width,
      height,
      data: new Uint8ClampedArray(satData.buffer, 0, byteSize)
    },
    saturationMedian: {
      width,
      height,
      data: new Uint8ClampedArray(satMedianData.buffer, 0, byteSize)
    },
    hue: {
      width,
      height,
      data: new Uint8ClampedArray(hueData.buffer, 0, byteSize)
    },
    hueMedian: {
      width,
      height,
      data: new Uint8ClampedArray(hueMedianData.buffer, 0, byteSize)
    },
    final: {
      width,
      height,
      data: new Uint8ClampedArray(finalData.buffer, 0, byteSize)
    },
    valueBuffer: valueBuffer2,
    // Don't destroy - pass to value processing
    saturationBuffer: saturationBuffer2,
    // Don't destroy - pass to recombination
    hueBuffer: hueBuffer2,
    // Don't destroy - pass to recombination
    width,
    height
  };
}
async function recombineWithValue(valueBuffer, saturationBuffer, hueBuffer, width, height) {
  const { device } = await getGPUContext();
  const pixelCount = width * height;
  const byteSize = pixelCount * 4;
  const outputBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsArray = new ArrayBuffer(8);
  const paramsU32 = new Uint32Array(paramsArray);
  paramsU32[0] = width;
  paramsU32[1] = height;
  const paramsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
  const recombineModule = device.createShaderModule({ code: recombineShader });
  const recombinePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: recombineModule, entryPoint: "main" }
  });
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  const bindGroup = device.createBindGroup({
    layout: recombinePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: valueBuffer } },
      { binding: 1, resource: { buffer: saturationBuffer } },
      { binding: 2, resource: { buffer: hueBuffer } },
      { binding: 3, resource: { buffer: outputBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } }
    ]
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(recombinePipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroupsX, workgroupsY);
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const finalData = await readGPUBuffer(device, outputBuffer, byteSize);
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: new Uint8ClampedArray(finalData.buffer, 0, byteSize)
  };
}

// src/gpu/value_process_gpu.ts
var weightedMedianShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn get_bit(data: ptr<storage, array<u32>, read>, x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 0u; // Background outside bounds
    }
    let pixel_idx = y * w + x;
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    return ((*data)[word_idx] >> bit_idx) & 1u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let w = params.width;
    let h = params.height;
    
    // Gather 3x3 neighborhood
    var sum = 0u;
    
    // Corners = 4 samples (1x each)
    sum += get_bit(&input, max(x, 1u) - 1u, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), min(y + 1u, h - 1u), w, h);
    
    // Cardinals = 8 samples (2x each for weighting)
    sum += get_bit(&input, x, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, x, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, x, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, x, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, y, w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, y, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), y, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), y, w, h);
    
    // Center = 1 sample
    sum += get_bit(&input, x, y, w, h);
    
    // Total: 4 corners + 8 cardinals + 1 center = 13 samples
    // Median threshold: keep if >= 7 samples are set
    let median_bit = u32(sum >= 7u);
    
    if (median_bit == 1u) {
        let pixel_idx = y * w + x;
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
    }
}
`;
var skeletonizeShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> change_counter: array<atomic<u32>>;

struct Params {
    width: u32,
    height: u32,
    iteration: u32,  // 0 or 1 for two-pass algorithm
    _padding: u32,
}

fn get_bit(data: ptr<storage, array<u32>, read>, x: i32, y: i32, w: u32, h: u32) -> u32 {
    if (x < 0 || y < 0 || x >= i32(w) || y >= i32(h)) {
        return 0u; // Background outside bounds
    }
    let pixel_idx = u32(y) * w + u32(x);
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    return (input[word_idx] >> bit_idx) & 1u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = i32(global_id.x);
    let y = i32(global_id.y);
    
    if (x >= i32(params.width) || y >= i32(params.height)) {
        return;
    }
    
    let w = params.width;
    let h = params.height;
    
    // Get center pixel (1 = line, 0 = background)
    let p1 = get_bit(&input, x, y, w, h);
    
    // Only process line pixels
    if (p1 == 0u) {
        return;
    }
    
    // Get 8-neighborhood in Zhang-Suen order (P2-P9):
    // P9 P2 P3
    // P8 P1 P4
    // P7 P6 P5
    let p2 = get_bit(&input, x,     y - 1, w, h);  // N
    let p3 = get_bit(&input, x + 1, y - 1, w, h);  // NE
    let p4 = get_bit(&input, x + 1, y,     w, h);  // E
    let p5 = get_bit(&input, x + 1, y + 1, w, h);  // SE
    let p6 = get_bit(&input, x,     y + 1, w, h);  // S
    let p7 = get_bit(&input, x - 1, y + 1, w, h);  // SW
    let p8 = get_bit(&input, x - 1, y,     w, h);  // W
    let p9 = get_bit(&input, x - 1, y - 1, w, h);  // NW
    
    // Condition 1: 2 <= B(P1) <= 6
    // B(P1) = number of line neighbors
    let b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
    if (b < 2u || b > 6u) {
        // Keep pixel
        let pixel_idx = u32(y) * w + u32(x);
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
        return;
    }
    
    // Condition 2: A(P1) = 1
    // A(P1) = number of 0->1 transitions in ordered sequence P2,P3,...,P9,P2
    var a = 0u;
    if (p2 == 0u && p3 == 1u) { a += 1u; }
    if (p3 == 0u && p4 == 1u) { a += 1u; }
    if (p4 == 0u && p5 == 1u) { a += 1u; }
    if (p5 == 0u && p6 == 1u) { a += 1u; }
    if (p6 == 0u && p7 == 1u) { a += 1u; }
    if (p7 == 0u && p8 == 1u) { a += 1u; }
    if (p8 == 0u && p9 == 1u) { a += 1u; }
    if (p9 == 0u && p2 == 1u) { a += 1u; }
    
    if (a != 1u) {
        // Keep pixel
        let pixel_idx = u32(y) * w + u32(x);
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
        return;
    }
    
    // Conditions 3 & 4 depend on iteration (step 1 vs step 2)
    // BOTH conditions must be satisfied (both products = 0) to delete
    var should_delete = false;
    
    if (params.iteration == 0u) {
        // Step 1:
        // Condition 3: P2 * P4 * P6 = 0 (at least one of N, E, S is background)
        // Condition 4: P4 * P6 * P8 = 0 (at least one of E, S, W is background)
        if ((p2 * p4 * p6) == 0u && (p4 * p6 * p8) == 0u) {
            should_delete = true;
        }
    } else {
        // Step 2:
        // Condition 3: P2 * P4 * P8 = 0 (at least one of N, E, W is background)
        // Condition 4: P2 * P6 * P8 = 0 (at least one of N, S, W is background)
        if ((p2 * p4 * p8) == 0u && (p2 * p6 * p8) == 0u) {
            should_delete = true;
        }
    }
    
    if (!should_delete) {
        let pixel_idx = u32(y) * w + u32(x);
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
    } else {
        // Pixel was deleted - increment change counter
        atomicAdd(&change_counter[0], 1u);
    }
}
`;
var binaryToRGBAShader = `
@group(0) @binding(0) var<storage, read> binary_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> rgba_out: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let bit = (binary_in[word_idx] >> bit_idx) & 1u;
    
    // 1 = line (black), 0 = background (white)
    let gray = (1u - bit) * 255u;
    
    rgba_out[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;
async function processValueChannel(valueBuffer, width, height) {
  const { device } = await getGPUContext();
  const pixelCount = width * height;
  const binaryWordCount = Math.ceil(pixelCount / 32);
  const binaryByteSize = binaryWordCount * 4;
  const rgbaByteSize = pixelCount * 4;
  console.log(`Value processing: ${width}x${height}`);
  const binaryBuffer2 = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const binaryBuffer3 = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const binaryBuffer4 = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const binaryBufferTemp = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const rgbaBuffer1 = device.createBuffer({
    size: rgbaByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const rgbaBuffer2 = device.createBuffer({
    size: rgbaByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const params = new Uint32Array([width, height]);
  const paramsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(paramsBuffer, 0, params);
  const skeletonParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const changeCounterBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const stagingBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const medianModule = device.createShaderModule({ code: weightedMedianShader });
  const skeletonModule = device.createShaderModule({ code: skeletonizeShader });
  const toRGBAModule = device.createShaderModule({ code: binaryToRGBAShader });
  const medianPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: medianModule, entryPoint: "main" }
  });
  const skeletonPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: skeletonModule, entryPoint: "main" }
  });
  const toRGBAPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: toRGBAModule, entryPoint: "main" }
  });
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  device.queue.writeBuffer(binaryBuffer2, 0, new Uint32Array(binaryWordCount));
  device.queue.writeBuffer(binaryBuffer3, 0, new Uint32Array(binaryWordCount));
  device.queue.writeBuffer(binaryBuffer4, 0, new Uint32Array(binaryWordCount));
  {
    const bindGroup = device.createBindGroup({
      layout: medianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer } },
        { binding: 1, resource: { buffer: binaryBuffer2 } },
        { binding: 2, resource: { buffer: paramsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(medianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(binaryBuffer2, 0, binaryBuffer3, 0, binaryByteSize);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  let convergedIter = -1;
  for (let iter = 0; iter < 20; iter++) {
    const inputBuffer = iter % 2 == 0 ? binaryBuffer3 : binaryBuffer4;
    const outputBuffer = iter % 2 == 0 ? binaryBuffer4 : binaryBuffer3;
    device.queue.writeBuffer(binaryBufferTemp, 0, new Uint32Array(binaryWordCount));
    device.queue.writeBuffer(outputBuffer, 0, new Uint32Array(binaryWordCount));
    device.queue.writeBuffer(changeCounterBuffer, 0, new Uint32Array(1));
    {
      const skeletonParams = new Uint32Array([width, height, 0, 0]);
      device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
      const bindGroup = device.createBindGroup({
        layout: skeletonPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: binaryBufferTemp } },
          { binding: 2, resource: { buffer: skeletonParamsBuffer } },
          { binding: 3, resource: { buffer: changeCounterBuffer } }
        ]
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(skeletonPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    {
      const skeletonParams = new Uint32Array([width, height, 1, 0]);
      device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
      const bindGroup = device.createBindGroup({
        layout: skeletonPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: binaryBufferTemp } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: skeletonParamsBuffer } },
          { binding: 3, resource: { buffer: changeCounterBuffer } }
        ]
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(skeletonPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(changeCounterBuffer, 0, stagingBuffer, 0, 4);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const counterData = new Uint32Array(stagingBuffer.getMappedRange());
      const changeCount = counterData[0];
      stagingBuffer.unmap();
      if (changeCount === 0) {
        convergedIter = iter;
        console.log(`Zhang-Suen converged after ${iter + 1} iteration(s) (${(iter + 1) * 2} passes)`);
        break;
      }
    }
  }
  if (convergedIter === -1) {
    console.log(`Zhang-Suen completed maximum 20 iterations (40 passes) without full convergence`);
  }
  const finalIterCount = convergedIter === -1 ? 19 : convergedIter;
  const finalSkeletonBuffer = finalIterCount % 2 == 0 ? binaryBuffer4 : binaryBuffer3;
  {
    const bindGroup = device.createBindGroup({
      layout: toRGBAPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: binaryBuffer2 } },
        { binding: 1, resource: { buffer: rgbaBuffer1 } },
        { binding: 2, resource: { buffer: paramsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(toRGBAPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: toRGBAPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: finalSkeletonBuffer } },
        { binding: 1, resource: { buffer: rgbaBuffer2 } },
        { binding: 2, resource: { buffer: paramsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(toRGBAPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const [medianData, skeletonData] = await Promise.all([
    readGPUBuffer(device, rgbaBuffer1, rgbaByteSize),
    readGPUBuffer(device, rgbaBuffer2, rgbaByteSize)
  ]);
  console.log(`Value processing complete`);
  binaryBuffer2.destroy();
  binaryBuffer4.destroy();
  rgbaBuffer1.destroy();
  rgbaBuffer2.destroy();
  paramsBuffer.destroy();
  skeletonParamsBuffer.destroy();
  return {
    median: {
      width,
      height,
      data: new Uint8ClampedArray(medianData.buffer, 0, rgbaByteSize)
    },
    skeleton: {
      width,
      height,
      data: new Uint8ClampedArray(skeletonData.buffer, 0, rgbaByteSize)
    },
    skeletonBuffer: finalSkeletonBuffer
    // Don't destroy - pass to recombination
  };
}

// src/gpu/palettize_gpu.ts
var shaderCode = `
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

fn luminosity(color: vec3<f32>) -> f32 {
    return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
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
    
    // If input pixel is black (luminosity < threshold), force to white (palette index 0)
    const threshold = 0.10;
    let lum = luminosity(color);
    if (lum < threshold) {
        output[idx] = 0u;
        return;
    }
    
    // Pre-compute which palette indices are black (luminosity < 20%)
    var is_black: array<bool, 16>;
    for (var i = 0u; i < params.palette_size; i++) {
        let pal_pixel = palette[i];
        let pr = f32(pal_pixel & 0xFFu) / 255.0;
        let pg = f32((pal_pixel >> 8u) & 0xFFu) / 255.0;
        let pb = f32((pal_pixel >> 16u) & 0xFFu) / 255.0;
        let pal_color = vec3<f32>(pr, pg, pb);
        let pal_lum = luminosity(pal_color);
        is_black[i] = pal_lum < threshold;
    }
    
    // Find nearest palette color, skipping black palette entries
    var best_idx: u32 = 0u;
    var best_dist = 999999.0;
    
    for (var i = 0u; i < params.palette_size; i++) {
        // Skip black palette colors
        if (is_black[i]) {
            continue;
        }
        
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
    palette: new Uint32Array(palette)
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
var DEFAULT_PALETTE = new Uint32Array([
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
  4289331455,
  // 5: orange (yellow is too similar to white)
  4278255615,
  // 6: magenta
  16777215,
  // 7: cyan
  2155905279
  // 8: gray
]);

// src/gpu/median_gpu.ts
var shaderCode2 = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn get_pixel(data: ptr<storage, array<u32>>, x: u32, y: u32, w: u32) -> u32 {
    let idx = y * w + x;
    return (*data)[idx] & 0xFu;
}

fn mode_nonzero(values: array<u32, 9>, center: u32) -> u32 {
    // Count occurrences of each color
    var counts: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        counts[i] = 0u;
    }
    
    for (var i = 0u; i < 9u; i++) {
        let val = values[i];
        counts[val] = counts[val] + 1u;
    }
    
    // Strategy: Only change center pixel if it's clearly an outlier
    // Look at the 8 neighbors (excluding center)
    var neighbor_counts: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        neighbor_counts[i] = 0u;
    }
    
    // Count only the 8 neighbors (skip center at index 4)
    for (var i = 0u; i < 9u; i++) {
        if (i != 4u) {
            let val = values[i];
            neighbor_counts[val] = neighbor_counts[val] + 1u;
        }
    }
    
    // Find the most common neighbor color
    var max_neighbor_count = 0u;
    var dominant_neighbor = 0u;
    for (var color = 0u; color < 16u; color++) {
        if (neighbor_counts[color] > max_neighbor_count) {
            max_neighbor_count = neighbor_counts[color];
            dominant_neighbor = color;
        }
    }
    
    // Decision logic:
    // 1. If center is different from all 8 neighbors, it's a single-pixel island - replace it
    // 2. If 6+ neighbors agree on a color different from center, center is likely a cavity/barnacle - replace it
    // 3. Otherwise, keep center as-is to preserve edges
    
    if (neighbor_counts[center] == 0u) {
        // Center is completely isolated from all 8 neighbors - definitely noise
        return dominant_neighbor;
    } else if (max_neighbor_count >= 6u && dominant_neighbor != center) {
        // Strong majority of neighbors agree on a different color - likely cavity or barnacle
        return dominant_neighbor;
    }
    
    // Keep center pixel - it's part of a legitimate feature
    return center;
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
    
    let center = values[4];
    let result = mode_nonzero(values, center);
    
    // Store result (unpacked, one u32 per pixel for now)
    let idx = y * params.width + x;
    output[idx] = result;
}
`;
async function median3x3GPU(image) {
  const { device } = await getGPUContext();
  const { width, height, palette } = image;
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
    palette: palette ? new Uint32Array(palette) : void 0
  };
}

// src/gpu/extract_black_gpu.ts
var shaderCode3 = `
@group(0) @binding(0) var<storage, read> input_rgba: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    threshold: f32,
}

// Set a bit in the bit-packed array using atomics
fn set_pixel_bit(x: u32, y: u32, w: u32, value: u32) {
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    let bit_position = byte_shift + bit_idx;
    
    let bit_mask = 1u << bit_position;
    
    if (value == 1u) {
        atomicOr(&output[u32_idx], bit_mask);
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let idx = y * params.width + x;
    let pixel = input_rgba[idx];
    
    // Unpack RGBA (little-endian: RGBA in memory = ABGR in u32)
    let r = f32(pixel & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    
    // Calculate luminosity
    let luminosity = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // If below threshold, mark as black (1)
    if (luminosity < params.threshold) {
        set_pixel_bit(x, y, params.width, 1u);
    }
}
`;
async function extractBlackGPU(image, luminosityThreshold = 0.2) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const inputU32 = new Uint32Array(pixelCount);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    inputU32[i] = dataView.getUint32(i * 4, true);
  }
  const byteCount = Math.ceil(pixelCount / 8);
  const u32Count = Math.ceil(byteCount / 4);
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: u32Count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsArray = new ArrayBuffer(16);
  const paramsU32 = new Uint32Array(paramsArray);
  const paramsF32 = new Float32Array(paramsArray);
  paramsU32[0] = width;
  paramsU32[1] = height;
  paramsF32[2] = luminosityThreshold;
  const paramsBuffer = createGPUBuffer(
    device,
    new Uint8Array(paramsArray),
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
  const resultU32 = await readGPUBuffer(device, outputBuffer, u32Count * 4);
  const resultU32Array = new Uint32Array(resultU32.buffer);
  const resultData = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    resultData[i] = resultU32Array[u32Idx] >> shift & 255;
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: resultData
  };
}

// src/gpu/bloom_gpu.ts
var shaderCode4 = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Get a bit from the bit-packed array
// Data format: 8 pixels per byte, MSB first, bytes packed into u32s (little-endian)
fn get_pixel_bit(x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 0u;
    }
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    
    let u32_val = input[u32_idx];
    let byte_val = (u32_val >> byte_shift) & 0xFFu;
    let bit_val = (byte_val >> bit_idx) & 1u;
    return bit_val;
}

// Set a bit in the bit-packed array using atomics
fn set_pixel_bit(x: u32, y: u32, w: u32, value: u32) {
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    let bit_position = byte_shift + bit_idx;
    
    let bit_mask = 1u << bit_position;
    
    if (value == 1u) {
        atomicOr(&output[u32_idx], bit_mask);
    } else {
        atomicAnd(&output[u32_idx], ~bit_mask);
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    // Check 3x3 neighborhood for any black pixels (value == 1)
    var has_black = false;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let nx = i32(x) + dx;
            let ny = i32(y) + dy;
            
            if (nx >= 0 && ny >= 0 && nx < i32(params.width) && ny < i32(params.height)) {
                let bit = get_pixel_bit(u32(nx), u32(ny), params.width, params.height);
                if (bit == 1u) {
                    has_black = true;
                }
            }
        }
    }
    
    // Set output pixel
    set_pixel_bit(x, y, params.width, select(0u, 1u, has_black));
}
`;
async function bloomFilter3x3GPU(image) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const byteCount = Math.ceil(pixelCount / 8);
  const u32Count = Math.ceil(byteCount / 4);
  const inputU32 = new Uint32Array(u32Count);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    inputU32[u32Idx] |= data[i] << shift;
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: u32Count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsData = new Uint32Array([width, height]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode4 });
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
  const resultU32 = await readGPUBuffer(device, outputBuffer, u32Count * 4);
  const resultU32Array = new Uint32Array(resultU32.buffer);
  const resultData = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    resultData[i] = resultU32Array[u32Idx] >> shift & 255;
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: resultData
  };
}

// src/gpu/subtract_black_gpu.ts
var shaderCode5 = `
@group(0) @binding(0) var<storage, read> input_rgba: array<u32>;
@group(0) @binding(1) var<storage, read> bloom_mask: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Get a bit from the bit-packed binary image
// Data format: 8 pixels per byte, MSB first, bytes packed into u32s (little-endian)
fn get_pixel_bit(x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 0u;
    }
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    
    let u32_val = bloom_mask[u32_idx];
    let byte_val = (u32_val >> byte_shift) & 0xFFu;
    let bit_val = (byte_val >> bit_idx) & 1u;
    return bit_val;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let idx = y * params.width + x;
    let is_black = get_pixel_bit(x, y, params.width, params.height);
    
    if (is_black == 1u) {
        // Set to white: RGBA = (255, 255, 255, 255)
        // In little-endian u32: 0xFFFFFFFF
        output[idx] = 0xFFFFFFFFu;
    } else {
        // Copy original pixel
        output[idx] = input_rgba[idx];
    }
}
`;
async function subtractBlackGPU(image, bloomFiltered) {
  if (image.width !== bloomFiltered.width || image.height !== bloomFiltered.height) {
    throw new Error("Image dimensions must match");
  }
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const inputU32 = new Uint32Array(pixelCount);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    inputU32[i] = dataView.getUint32(i * 4, true);
  }
  const byteCount = bloomFiltered.data.length;
  const u32Count = Math.ceil(byteCount / 4);
  const maskU32 = new Uint32Array(u32Count);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    maskU32[u32Idx] |= bloomFiltered.data[i] << shift;
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const maskBuffer = createGPUBuffer(
    device,
    new Uint8Array(maskU32.buffer, maskU32.byteOffset, maskU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: pixelCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsData = new Uint32Array([width, height]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode5 });
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
      { binding: 1, resource: { buffer: maskBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
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
  const resultBytes = await readGPUBuffer(device, outputBuffer, pixelCount * 4);
  const resultData = new Uint8ClampedArray(resultBytes);
  inputBuffer.destroy();
  maskBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: resultData
  };
}

// browser-app/storage.ts
var DB_NAME = "CleanPlansDB";
var DB_VERSION = 1;
var STORE_NAME = "files";
var db = null;
async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db2 = event.target.result;
      if (!db2.objectStoreNames.contains(STORE_NAME)) {
        const store = db2.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("uploadedAt", "uploadedAt", { unique: false });
      }
    };
  });
}
async function saveFile(file, thumbnail) {
  const db2 = await openDB();
  const id = crypto.randomUUID();
  const arrayBuffer = await file.arrayBuffer();
  const storedFile = {
    id,
    name: file.name,
    type: file.type,
    data: new Uint8Array(arrayBuffer),
    uploadedAt: Date.now(),
    thumbnail
  };
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(storedFile);
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
}
async function updateFile(id, updates) {
  const db2 = await openDB();
  const existing = await getFile(id);
  if (!existing) {
    throw new Error(`File ${id} not found`);
  }
  const updated = { ...existing, ...updates };
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(updated);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function getFile(id) {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function listFiles() {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const files = request.result;
      files.sort((a, b) => b.uploadedAt - a.uploadedAt);
      resolve(files);
    };
    request.onerror = () => reject(request.error);
  });
}
async function deleteFile(id) {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function clearAllFiles() {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// browser-app/utils.ts
function u32ToHex(color) {
  const r = color >> 24 & 255;
  const g = color >> 16 & 255;
  const b = color >> 8 & 255;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function hexToRGBA(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

// browser-app/state.ts
var state = {
  currentFileId: null,
  currentPdfData: null,
  currentImage: null,
  currentSelectedPage: null,
  pdfPageCount: 0,
  cancelThumbnailLoading: false,
  // Processing state
  currentStage: "cropped",
  processedImages: /* @__PURE__ */ new Map(),
  vectorizedImages: /* @__PURE__ */ new Map(),
  // e.g., "color_1_vec"
  // Palette configuration
  userPalette: Array.from(DEFAULT_PALETTE).map((color) => ({
    inputColor: u32ToHex(color),
    outputColor: u32ToHex(color),
    mapToBg: false
  })),
  currentPaletteName: "",
  // Canvas/Viewport State
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  isDraggingCropHandle: false,
  activeCropHandle: null,
  cropRegion: null,
  lastPanX: 0,
  lastPanY: 0,
  // Processing canvas state
  processZoom: 1,
  processPanX: 0,
  processPanY: 0,
  isProcessPanning: false,
  lastProcessPanX: 0,
  lastProcessPanY: 0,
  processViewInitialized: false,
  // Vector overlay state
  vectorOverlayEnabled: false,
  vectorOverlayStage: null
  // e.g., "color_1_vec"
};

// browser-app/canvas.ts
var canvasContainer;
var mainCanvas;
var ctx;
var cropOverlay;
var cropCtx;
var zoomLevel;
var cropInfo;
function initCanvasElements(elements) {
  canvasContainer = elements.canvasContainer;
  mainCanvas = elements.mainCanvas;
  ctx = elements.ctx;
  cropOverlay = elements.cropOverlay;
  cropCtx = elements.cropCtx;
  zoomLevel = elements.zoomLevel;
  cropInfo = elements.cropInfo;
}
function loadImage(image, statusCallback) {
  state.currentImage = image;
  mainCanvas.width = image.width;
  mainCanvas.height = image.height;
  cropOverlay.width = image.width;
  cropOverlay.height = image.height;
  mainCanvas.style.display = "block";
  canvasContainer.style.opacity = "1";
  const savedCrop = getCropSettings(image.width, image.height);
  if (savedCrop) {
    state.cropRegion = savedCrop;
  } else {
    setDefaultCrop(image.width, image.height);
  }
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  ctx.putImageData(imageData, 0, 0);
  fitToScreen();
  cropOverlay.style.display = "block";
  drawCropOverlay();
  statusCallback(`\u2713 Ready: ${image.width}\xD7${image.height} pixels`);
}
function fitToScreen() {
  if (!state.currentImage) return;
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;
  const imageWidth = state.currentImage.width;
  const imageHeight = state.currentImage.height;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  state.zoom = Math.min(scaleX, scaleY) * 0.9;
  state.panX = (containerWidth - imageWidth * state.zoom) / 2;
  state.panY = (containerHeight - imageHeight * state.zoom) / 2;
  updateZoom();
  updateTransform();
}
function updateZoom() {
  zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
}
function setDefaultCrop(imageWidth, imageHeight) {
  const margin = 0.1;
  state.cropRegion = {
    x: imageWidth * margin,
    y: imageHeight * margin,
    width: imageWidth * (1 - 2 * margin),
    height: imageHeight * (1 - 2 * margin)
  };
  updateCropInfo();
}
function getCropSettings(imageWidth, imageHeight) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}
function saveCropSettings(imageWidth, imageHeight, crop) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  localStorage.setItem(key, JSON.stringify(crop));
}
function updateCropInfo() {
  if (state.cropRegion) {
    cropInfo.textContent = `Crop: ${Math.round(state.cropRegion.width)}\xD7${Math.round(state.cropRegion.height)} at (${Math.round(state.cropRegion.x)}, ${Math.round(state.cropRegion.y)})`;
  }
}
function getCropHandleAtPoint(x, y) {
  if (!state.cropRegion) return null;
  const handleSize = 15 / state.zoom;
  const { x: cx, y: cy, width: cw, height: ch } = state.cropRegion;
  if (Math.abs(x - cx) < handleSize && Math.abs(y - cy) < handleSize) return "tl";
  if (Math.abs(x - (cx + cw)) < handleSize && Math.abs(y - cy) < handleSize) return "tr";
  if (Math.abs(x - cx) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "bl";
  if (Math.abs(x - (cx + cw)) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "br";
  if (Math.abs(x - (cx + cw / 2)) < handleSize && Math.abs(y - cy) < handleSize) return "t";
  if (Math.abs(x - (cx + cw / 2)) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "b";
  if (Math.abs(y - (cy + ch / 2)) < handleSize && Math.abs(x - cx) < handleSize) return "l";
  if (Math.abs(y - (cy + ch / 2)) < handleSize && Math.abs(x - (cx + cw)) < handleSize) return "r";
  return null;
}
function updateCursorForHandle(handle) {
  if (!handle) {
    canvasContainer.style.cursor = "default";
  } else if (handle === "tl" || handle === "br") {
    canvasContainer.style.cursor = "nwse-resize";
  } else if (handle === "tr" || handle === "bl") {
    canvasContainer.style.cursor = "nesw-resize";
  } else if (handle === "t" || handle === "b") {
    canvasContainer.style.cursor = "ns-resize";
  } else if (handle === "l" || handle === "r") {
    canvasContainer.style.cursor = "ew-resize";
  }
}
function adjustCropRegion(handle, dx, dy) {
  if (!state.cropRegion || !state.currentImage) return;
  const { x, y, width, height } = state.cropRegion;
  let newX = x, newY = y, newWidth = width, newHeight = height;
  switch (handle) {
    case "tl":
      newX = x + dx;
      newY = y + dy;
      newWidth = width - dx;
      newHeight = height - dy;
      break;
    case "tr":
      newY = y + dy;
      newWidth = width + dx;
      newHeight = height - dy;
      break;
    case "bl":
      newX = x + dx;
      newWidth = width - dx;
      newHeight = height + dy;
      break;
    case "br":
      newWidth = width + dx;
      newHeight = height + dy;
      break;
    case "t":
      newY = y + dy;
      newHeight = height - dy;
      break;
    case "b":
      newHeight = height + dy;
      break;
    case "l":
      newX = x + dx;
      newWidth = width - dx;
      break;
    case "r":
      newWidth = width + dx;
      break;
  }
  newX = Math.max(0, Math.min(newX, state.currentImage.width - 10));
  newY = Math.max(0, Math.min(newY, state.currentImage.height - 10));
  newWidth = Math.max(10, Math.min(newWidth, state.currentImage.width - newX));
  newHeight = Math.max(10, Math.min(newHeight, state.currentImage.height - newY));
  state.cropRegion.x = newX;
  state.cropRegion.y = newY;
  state.cropRegion.width = newWidth;
  state.cropRegion.height = newHeight;
  updateCropInfo();
}
function updateTransform() {
  const transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  mainCanvas.style.transform = transform;
  mainCanvas.style.transformOrigin = "0 0";
  mainCanvas.style.willChange = "transform";
  cropOverlay.style.transform = transform;
  cropOverlay.style.transformOrigin = "0 0";
  cropOverlay.style.willChange = "transform";
  if (state.zoom >= 1) {
    mainCanvas.style.imageRendering = "pixelated";
  } else {
    mainCanvas.style.imageRendering = "smooth";
  }
  drawCropOverlay();
}
function redrawCanvas() {
  if (!state.currentImage) return;
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(state.currentImage.data),
    state.currentImage.width,
    state.currentImage.height
  );
  ctx.putImageData(imageData, 0, 0);
  drawCropOverlay();
}
function drawCropOverlay() {
  if (!state.currentImage || !state.cropRegion) {
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    return;
  }
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  cropCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
  cropCtx.fillRect(0, 0, state.currentImage.width, state.currentImage.height);
  cropCtx.globalCompositeOperation = "destination-out";
  cropCtx.fillStyle = "rgba(0, 0, 0, 1)";
  cropCtx.fillRect(
    state.cropRegion.x,
    state.cropRegion.y,
    state.cropRegion.width,
    state.cropRegion.height
  );
  cropCtx.globalCompositeOperation = "source-over";
  cropCtx.strokeStyle = "#4f46e5";
  cropCtx.lineWidth = 3 / state.zoom;
  cropCtx.strokeRect(
    state.cropRegion.x,
    state.cropRegion.y,
    state.cropRegion.width,
    state.cropRegion.height
  );
  const handleSize = 10 / state.zoom;
  cropCtx.fillStyle = "#4f46e5";
  const cx = state.cropRegion.x;
  const cy = state.cropRegion.y;
  const cw = state.cropRegion.width;
  const ch = state.cropRegion.height;
  const handles = [
    // Corners
    [cx, cy],
    // top-left
    [cx + cw, cy],
    // top-right
    [cx, cy + ch],
    // bottom-left
    [cx + cw, cy + ch],
    // bottom-right
    // Edges
    [cx + cw / 2, cy],
    // top
    [cx + cw, cy + ch / 2],
    // right
    [cx + cw / 2, cy + ch],
    // bottom
    [cx, cy + ch / 2]
    // left
  ];
  for (const [x, y] of handles) {
    cropCtx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
  }
}
function cropImage(image, crop) {
  const x = Math.max(0, Math.min(Math.round(crop.x), image.width - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), image.height - 1));
  const width = Math.max(1, Math.min(Math.round(crop.width), image.width - x));
  const height = Math.max(1, Math.min(Math.round(crop.height), image.height - y));
  const croppedData = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const srcOffset = ((y + row) * image.width + x) * 4;
    const dstOffset = row * width * 4;
    const copyLength = width * 4;
    if (srcOffset + copyLength <= image.data.length) {
      croppedData.set(
        image.data.subarray(srcOffset, srcOffset + copyLength),
        dstOffset
      );
    }
  }
  return { width, height, data: croppedData };
}

// browser-app/palette.ts
var colorEditorIndex = null;
var eyedropperMode = null;
var eyedropperActive = false;
var showStatusCallback = () => {
};
var mainCanvasRef = null;
async function autosavePaletteToFile() {
  if (state.currentFileId) {
    try {
      const palette = JSON.stringify(state.userPalette);
      await updateFile(state.currentFileId, { palette });
      console.log("Auto-saved palette to file storage");
    } catch (err) {
      console.error("Failed to auto-save palette:", err);
    }
  }
}
function initPaletteModule(callbacks) {
  showStatusCallback = callbacks.showStatus;
  mainCanvasRef = callbacks.mainCanvas;
}
function initPaletteDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PalettesDB", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db2 = event.target.result;
      if (!db2.objectStoreNames.contains("palettes")) {
        db2.createObjectStore("palettes", { keyPath: "name" });
      }
    };
  });
}
async function savePalette(name) {
  if (!name || name.trim() === "") {
    showStatusCallback("Please enter a palette name", true);
    return;
  }
  try {
    const db2 = await initPaletteDB();
    const transaction = db2.transaction(["palettes"], "readwrite");
    const store = transaction.objectStore("palettes");
    await store.put({
      name: name.trim(),
      palette: JSON.parse(JSON.stringify(state.userPalette)),
      timestamp: Date.now()
    });
    showStatusCallback(`\u2713 Palette "${name.trim()}" saved`);
  } catch (error) {
    showStatusCallback(`Error saving palette: ${error}`, true);
  }
}
async function loadPalette(name) {
  try {
    const db2 = await initPaletteDB();
    const transaction = db2.transaction(["palettes"], "readonly");
    const store = transaction.objectStore("palettes");
    if (name) {
      const request = store.get(name);
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          if (request.result) {
            state.userPalette.length = 0;
            state.userPalette.push(...request.result.palette);
            state.currentPaletteName = name;
            renderPaletteUI();
            showStatusCallback(`\u2713 Loaded palette "${name}"`);
            resolve(request.result);
          } else {
            showStatusCallback(`Palette "${name}" not found`, true);
            reject(new Error("Not found"));
          }
        };
        request.onerror = () => reject(request.error);
      });
    } else {
      const allRequest = store.getAll();
      return new Promise((resolve, reject) => {
        allRequest.onsuccess = () => {
          const palettes = allRequest.result;
          if (palettes.length === 0) {
            showStatusCallback("No saved palettes", true);
            resolve([]);
            return;
          }
          const names = palettes.map((p) => p.name).join("\n");
          const selected = prompt(`Available palettes:
${names}

Enter name to load:`);
          if (selected && palettes.some((p) => p.name === selected)) {
            loadPalette(selected);
          }
          resolve(palettes);
        };
        allRequest.onerror = () => reject(allRequest.error);
      });
    }
  } catch (error) {
    showStatusCallback(`Error loading palette: ${error}`, true);
  }
}
async function setDefaultPalette() {
  const name = state.currentPaletteName || prompt("Enter name for this palette:");
  if (!name) return;
  localStorage.setItem("defaultPalette", name);
  await savePalette(name);
  showStatusCallback(`\u2713 Set "${name}" as default palette`);
}
async function loadDefaultPalette() {
  const defaultName = localStorage.getItem("defaultPalette");
  if (defaultName) {
    try {
      await loadPalette(defaultName);
      showStatusCallback(`\u2713 Loaded default palette "${defaultName}"`);
    } catch {
      showStatusCallback("Default palette not found", true);
    }
  }
}
function renderPaletteUI() {
  const paletteDisplay = document.getElementById("paletteDisplay");
  if (!paletteDisplay) {
    console.error("paletteDisplay not found in DOM!");
    return;
  }
  paletteDisplay.innerHTML = "";
  state.userPalette.forEach((color, index) => {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-bottom: 1px solid #3a3a3a; cursor: pointer; transition: background 0.2s;";
    item.onmouseover = () => item.style.background = "#333";
    item.onmouseout = () => item.style.background = "transparent";
    item.onclick = () => openColorEditor(index);
    const inputSwatch = document.createElement("div");
    inputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.inputColor}; flex-shrink: 0;`;
    item.appendChild(inputSwatch);
    if (color.mapToBg) {
      const statusIcon = document.createElement("span");
      statusIcon.textContent = "\u2715";
      statusIcon.style.cssText = "font-size: 0.9rem; color: #ef4444; flex-shrink: 0; width: 16px; text-align: center;";
      statusIcon.title = "Remove";
      item.appendChild(statusIcon);
    } else if (color.inputColor.toLowerCase() !== color.outputColor.toLowerCase()) {
      const arrow = document.createElement("span");
      arrow.textContent = "\u2192";
      arrow.style.cssText = "font-size: 0.9rem; color: #999; flex-shrink: 0;";
      item.appendChild(arrow);
      const outputSwatch = document.createElement("div");
      outputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.outputColor}; flex-shrink: 0;`;
      item.appendChild(outputSwatch);
    }
    const hexLabel = document.createElement("div");
    hexLabel.style.cssText = "font-family: 'Courier New', monospace; font-size: 0.8rem; color: #aaa; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;";
    hexLabel.textContent = color.inputColor.toUpperCase();
    hexLabel.title = color.inputColor.toUpperCase();
    item.appendChild(hexLabel);
    if (index === 0) {
      const bgLabel = document.createElement("span");
      bgLabel.textContent = "BG";
      bgLabel.style.cssText = "font-size: 0.7rem; color: #4f46e5; font-weight: 600; flex-shrink: 0; padding: 0.1rem 0.3rem; background: rgba(79, 70, 229, 0.2); border-radius: 3px;";
      item.appendChild(bgLabel);
    }
    paletteDisplay.appendChild(item);
  });
}
function openColorEditor(index) {
  colorEditorIndex = index;
  const color = state.userPalette[index];
  let modal = document.getElementById("colorEditorModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "colorEditorModal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px);
      z-index: 3000; display: flex; align-items: center; justify-content: center;
    `;
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background: #1a1a1a; border: 2px solid #4f46e5; border-radius: 8px; padding: 1.5rem; min-width: 400px; max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="margin: 0; color: #fff;">Edit Color ${index}${index === 0 ? " (Background)" : ""}</h3>
        <button id="closeColorEditor" style="background: none; border: none; color: #999; font-size: 1.5rem; cursor: pointer; padding: 0; width: 32px; height: 32px;">\xD7</button>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- Input Color -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Input Color (from document)</label>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.inputColor}; flex-shrink: 0;"></div>
            <input type="text" id="inputColorHex" value="${color.inputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperInput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">\u{1F4A7}</button>
          </div>
        </div>
        
        <!-- Output Options -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Output (in vectorized result)</label>
          
          <div style="display: flex; gap: 0.75rem; margin-bottom: 0.5rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="same" ${!color.mapToBg && color.inputColor === color.outputColor ? "checked" : ""} style="cursor: pointer;">
              <span>Keep same color</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="different" ${!color.mapToBg && color.inputColor !== color.outputColor ? "checked" : ""} style="cursor: pointer;">
              <span>Transform to:</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="remove" ${color.mapToBg ? "checked" : ""} style="cursor: pointer;">
              <span style="color: #ef4444;">Remove</span>
            </label>
          </div>
          
          <div id="outputColorSection" style="display: flex; gap: 0.5rem; align-items: center; ${color.mapToBg || color.inputColor === color.outputColor ? "opacity: 0.4; pointer-events: none;" : ""}">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.outputColor}; flex-shrink: 0;"></div>
            <input type="text" id="outputColorHex" value="${color.outputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperOutput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">\u{1F4A7}</button>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button id="saveColorEdit" style="flex: 1; padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: 600;">Save</button>
          ${index !== 0 ? '<button id="deleteColor" style="padding: 0.75rem 1.25rem; background: #ef4444; border: none; border-radius: 4px; color: white; cursor: pointer;">Delete</button>' : ""}
          <button id="cancelColorEdit" style="padding: 0.75rem 1.25rem; background: #3a3a3a; border: none; border-radius: 4px; color: white; cursor: pointer;">Cancel</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = "flex";
  const inputHexField = document.getElementById("inputColorHex");
  const outputHexField = document.getElementById("outputColorHex");
  const outputSection = document.getElementById("outputColorSection");
  const outputModeRadios = document.getElementsByName("outputMode");
  outputModeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "different") {
        outputSection.style.opacity = "1";
        outputSection.style.pointerEvents = "auto";
      } else {
        outputSection.style.opacity = "0.4";
        outputSection.style.pointerEvents = "none";
      }
    });
  });
  document.getElementById("eyedropperInput").addEventListener("click", () => {
    eyedropperMode = "input";
    activateEyedropper();
    modal.style.display = "none";
  });
  document.getElementById("eyedropperOutput").addEventListener("click", () => {
    eyedropperMode = "output";
    activateEyedropper();
    modal.style.display = "none";
  });
  document.getElementById("saveColorEdit").addEventListener("click", () => {
    const inputColor = inputHexField.value;
    const outputColor = outputHexField.value;
    const selectedMode = Array.from(outputModeRadios).find((r) => r.checked)?.value;
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
      alert("Invalid input color format. Use #RRGGBB");
      return;
    }
    if (selectedMode === "different" && !/^#[0-9A-Fa-f]{6}$/.test(outputColor)) {
      alert("Invalid output color format. Use #RRGGBB");
      return;
    }
    state.userPalette[index].inputColor = inputColor;
    if (selectedMode === "remove") {
      state.userPalette[index].mapToBg = true;
      state.userPalette[index].outputColor = inputColor;
    } else if (selectedMode === "different") {
      state.userPalette[index].mapToBg = false;
      state.userPalette[index].outputColor = outputColor;
    } else {
      state.userPalette[index].mapToBg = false;
      state.userPalette[index].outputColor = inputColor;
    }
    renderPaletteUI();
    autosavePaletteToFile();
    closeColorEditor();
  });
  const deleteBtn = document.getElementById("deleteColor");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (index !== 0 && confirm("Delete this color?")) {
        state.userPalette.splice(index, 1);
        renderPaletteUI();
        autosavePaletteToFile();
        closeColorEditor();
      }
    });
  }
  document.getElementById("cancelColorEdit").addEventListener("click", closeColorEditor);
  document.getElementById("closeColorEditor").addEventListener("click", closeColorEditor);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeColorEditor();
  });
}
function closeColorEditor() {
  const modal = document.getElementById("colorEditorModal");
  if (modal) modal.style.display = "none";
  colorEditorIndex = null;
  eyedropperMode = null;
}
function addPaletteColor() {
  if (state.userPalette.length >= 16) {
    showStatusCallback("Maximum 16 colors allowed", true);
    return;
  }
  const newIndex = state.userPalette.length;
  state.userPalette.push({
    inputColor: "#808080",
    outputColor: "#808080",
    mapToBg: false
  });
  renderPaletteUI();
  autosavePaletteToFile();
  openColorEditor(newIndex);
}
function resetPaletteToDefault() {
  state.userPalette.length = 0;
  Array.from(DEFAULT_PALETTE).forEach((color) => {
    state.userPalette.push({
      inputColor: u32ToHex(color),
      outputColor: u32ToHex(color),
      mapToBg: false
    });
  });
  renderPaletteUI();
  autosavePaletteToFile();
  showStatusCallback("Palette reset to default");
}
function activateEyedropper() {
  if (!state.currentImage) {
    showStatusCallback("No image loaded", true);
    return;
  }
  if (!mainCanvasRef) {
    showStatusCallback("Canvas not initialized", true);
    return;
  }
  eyedropperActive = true;
  document.body.classList.add("eyedropper-active");
  mainCanvasRef.style.cursor = "crosshair";
  showStatusCallback("\u{1F4A7} Click on the image to pick a color (ESC to cancel)");
}
function deactivateEyedropper() {
  if (!mainCanvasRef) return;
  eyedropperActive = false;
  document.body.classList.remove("eyedropper-active");
  mainCanvasRef.style.cursor = "";
  showStatusCallback("Eyedropper cancelled");
}
function pickColorFromCanvas(x, y) {
  if (!state.currentImage || !mainCanvasRef) return;
  const rect = mainCanvasRef.getBoundingClientRect();
  const scaleX = state.currentImage.width / rect.width;
  const scaleY = state.currentImage.height / rect.height;
  const imgX = Math.floor((x - rect.left) * scaleX);
  const imgY = Math.floor((y - rect.top) * scaleY);
  if (imgX < 0 || imgX >= state.currentImage.width || imgY < 0 || imgY >= state.currentImage.height) {
    return;
  }
  const pixelIndex = (imgY * state.currentImage.width + imgX) * 4;
  const r = state.currentImage.data[pixelIndex];
  const g = state.currentImage.data[pixelIndex + 1];
  const b = state.currentImage.data[pixelIndex + 2];
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  deactivateEyedropper();
  if (colorEditorIndex !== null && eyedropperMode) {
    if (eyedropperMode === "input") {
      state.userPalette[colorEditorIndex].inputColor = hex;
    } else if (eyedropperMode === "output") {
      state.userPalette[colorEditorIndex].outputColor = hex;
      state.userPalette[colorEditorIndex].mapToBg = false;
    }
    autosavePaletteToFile();
    openColorEditor(colorEditorIndex);
    showStatusCallback(`Picked ${hex.toUpperCase()}`);
  } else {
    addColorToPalette(hex);
    showStatusCallback(`Added ${hex.toUpperCase()} to palette`);
  }
}
function addColorToPalette(hex) {
  if (state.userPalette.length >= 16) {
    showStatusCallback("Maximum 16 colors - remove one first", true);
    return;
  }
  state.userPalette.push({
    inputColor: hex,
    outputColor: hex,
    mapToBg: false
  });
  renderPaletteUI();
  showStatusCallback(`Added ${hex} to palette`);
}
function buildPaletteRGBA() {
  const palette = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < state.userPalette.length && i < 16; i++) {
    const color = state.userPalette[i];
    const [r, g, b, a] = hexToRGBA(color.inputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  for (let i = state.userPalette.length; i < 16; i++) {
    const [r, g, b, a] = hexToRGBA(state.userPalette[0].inputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  return palette;
}
function isEyedropperActive() {
  return eyedropperActive;
}
function forceDeactivateEyedropper() {
  if (eyedropperActive) {
    deactivateEyedropper();
  }
}

// browser-app/primitives/circle.ts
function detectCircle(path, vertices, epsilon) {
  if (!path.closed || path.vertices.length < 4) {
    return null;
  }
  const coords = path.vertices.map((id) => vertices.get(id));
  let points = coords;
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first.x === last.x && first.y === last.y) {
      points = coords.slice(0, -1);
    }
  }
  if (points.length < 4) {
    return null;
  }
  const circle = fitCircleLeastSquares(points);
  if (!circle) {
    return null;
  }
  const distancesSquared = points.map((p) => {
    const dx = p.x - circle.cx;
    const dy = p.y - circle.cy;
    return dx * dx + dy * dy;
  });
  const radiusSquared = circle.radius * circle.radius;
  const minRadiusSquared = (circle.radius - epsilon) * (circle.radius - epsilon);
  const maxRadiusSquared = (circle.radius + epsilon) * (circle.radius + epsilon);
  const minRadiusSquared2x = (circle.radius - 2 * epsilon) * (circle.radius - 2 * epsilon);
  const maxRadiusSquared2x = (circle.radius + 2 * epsilon) * (circle.radius + 2 * epsilon);
  const withinEpsilon = distancesSquared.filter(
    (d) => d >= minRadiusSquared && d <= maxRadiusSquared
  ).length;
  const allWithin2Epsilon = distancesSquared.every(
    (d) => d >= minRadiusSquared2x && d <= maxRadiusSquared2x
  );
  const percentileThreshold = 0.9;
  const isCircle = withinEpsilon / distancesSquared.length >= percentileThreshold && allWithin2Epsilon;
  console.log(
    `Circle detection: path with ${points.length} points, fitted radius ${circle.radius.toFixed(2)}, center (${circle.cx.toFixed(2)}, ${circle.cy.toFixed(2)}), ${(withinEpsilon / distancesSquared.length * 100).toFixed(1)}% within epsilon, all within 2x epsilon => ${isCircle ? "CIRCLE" : "not a circle"}`
  );
  if (isCircle) {
    return {
      cx: circle.cx + 0.5,
      // Shift by 0.5 to align with pixel centers
      cy: circle.cy + 0.5,
      radius: circle.radius
    };
  }
  return null;
}
function fitCircleLeastSquares(points) {
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  const centeredPoints = points.map((p) => ({
    x: p.x - mx,
    y: p.y - my
  }));
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0;
  let Sxxx = 0, Sxyy = 0, Syyy = 0, Sxxy = 0;
  for (const p of centeredPoints) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;
    Sxx += x2;
    Sxy += x * y;
    Syy += y2;
    Sx += x;
    Sy += y;
    Sxxx += x * x2;
    Sxyy += x * y2;
    Syyy += y * y2;
    Sxxy += x2 * y;
  }
  const b1 = Sxxx + Sxyy;
  const b2 = Syyy + Sxxy;
  const b3 = Sxx + Syy;
  const det = Sxx * (Syy * n - Sy * Sy) - Sxy * (Sxy * n - Sx * Sy) + Sx * (Sxy * Sy - Syy * Sx);
  if (Math.abs(det) < 1e-10) {
    return null;
  }
  const detA = b1 * (Syy * n - Sy * Sy) - Sxy * (b2 * n - b3 * Sy) + Sx * (b2 * Sy - Syy * b3);
  const a = detA / det / 2;
  const detB = Sxx * (b2 * n - b3 * Sy) - b1 * (Sxy * n - Sx * Sy) + Sx * (Sxy * b3 - b2 * Sx);
  const b = detB / det / 2;
  const detC = Sxx * (Syy * b3 - Sy * b2) - Sxy * (Sxy * b3 - Sx * b2) + b1 * (Sxy * Sy - Syy * Sx);
  const c = detC / det;
  const cx = a + mx;
  const cy = b + my;
  const r2 = c + a * a + b * b;
  if (r2 <= 0) {
    return null;
  }
  const radius = Math.sqrt(r2);
  return { cx, cy, radius };
}

// browser-app/vectorize.ts
function vectorizeSkeleton(binary) {
  const { width, height } = binary;
  const getVertexId = (x, y) => y * width + x;
  const paths = [];
  const visited = /* @__PURE__ */ new Set();
  const vertices = /* @__PURE__ */ new Map();
  const getUnvisitedNeighbors = (x, y) => {
    const neighbors = [];
    const cardinalOffsets = [[0, -1], [1, 0], [0, 1], [
      -1,
      0
    ]];
    for (const [dx, dy] of cardinalOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nId = getVertexId(nx, ny);
        if (isPixelSet(binary, nx, ny) && !visited.has(nId)) {
          neighbors.push([nx, ny]);
        }
      }
    }
    const diagonalOffsets = [[-1, -1], [1, -1], [
      -1,
      1
    ], [1, 1]];
    for (const [dx, dy] of diagonalOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nId = getVertexId(nx, ny);
        if (isPixelSet(binary, nx, ny) && !visited.has(nId)) {
          const hasStairStep = cardinalOffsets.some(([cdx, cdy]) => {
            const cx = x + cdx;
            const cy = y + cdy;
            if (cx >= 0 && cx < width && cy >= 0 && cy < height && isPixelSet(binary, cx, cy)) {
              const dcx = nx - cx;
              const dcy = ny - cy;
              return Math.abs(dcx) + Math.abs(dcy) === 1;
            }
            return false;
          });
          if (!hasStairStep) {
            neighbors.push([nx, ny]);
          }
        }
      }
    }
    return neighbors;
  };
  const extendPath = (pathVertices, forward) => {
    while (true) {
      const currentId = forward ? pathVertices[pathVertices.length - 1] : pathVertices[0];
      const currentVertex = vertices.get(currentId);
      if (!currentVertex) break;
      const neighbors = getUnvisitedNeighbors(currentVertex.x, currentVertex.y);
      if (neighbors.length === 0) break;
      const [nx, ny] = neighbors[0];
      const nextId = getVertexId(nx, ny);
      if (!vertices.has(nextId)) {
        vertices.set(nextId, { x: nx, y: ny, id: nextId, neighbors: [] });
      }
      visited.add(nextId);
      if (forward) {
        pathVertices.push(nextId);
      } else {
        pathVertices.unshift(nextId);
      }
      const nextNeighbors = getUnvisitedNeighbors(nx, ny);
      if (nextNeighbors.length > 1) break;
    }
  };
  let totalPixels = 0;
  for (let byteIdx = 0; byteIdx < binary.data.length; byteIdx++) {
    const byte = binary.data[byteIdx];
    if (byte === 0) continue;
    const startPixelIdx = byteIdx * 8;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if ((byte & 1 << 7 - bitIdx) === 0) continue;
      const pixelIdx = startPixelIdx + bitIdx;
      const x = pixelIdx % width;
      const y = Math.floor(pixelIdx / width);
      if (y >= height) break;
      totalPixels++;
      const id = getVertexId(x, y);
      if (visited.has(id)) continue;
      const pathVertices = [id];
      visited.add(id);
      if (!vertices.has(id)) {
        vertices.set(id, { x, y, id, neighbors: [] });
      }
      extendPath(pathVertices, true);
      extendPath(pathVertices, false);
      paths.push({
        vertices: pathVertices,
        closed: false
      });
    }
  }
  console.log(
    `Vectorization: ${totalPixels} skeleton pixels, visited ${visited.size}, traced ${paths.length} paths`
  );
  for (const path of paths) {
    if (path.vertices.length >= 3) {
      const startV = vertices.get(path.vertices[0]);
      const endV = vertices.get(path.vertices[path.vertices.length - 1]);
      if (Math.abs(startV.x - endV.x) <= 1 && Math.abs(startV.y - endV.y) <= 1) {
        path.closed = true;
        if (startV.x !== endV.x || startV.y !== endV.y) {
          path.vertices.push(path.vertices[0]);
        }
      }
    }
  }
  const circleEpsilon = 1.4;
  const circleResults = paths.map(
    (path) => detectCircle(path, vertices, circleEpsilon)
  );
  const circleCount = circleResults.filter((r) => r !== null).length;
  console.log(`Vectorization: Detected ${circleCount} circles`);
  const dpPaths = paths.map(
    (path, i) => circleResults[i] ? path : douglasPeucker(path, vertices, 0.1)
  );
  const totalDPBefore = paths.reduce((sum, p) => sum + p.vertices.length, 0);
  const totalDPAfter = dpPaths.reduce((sum, p) => sum + p.vertices.length, 0);
  console.log(
    `Vectorization: DP pass simplified from ${totalDPBefore} to ${totalDPAfter} vertices`
  );
  const simplifiedPaths = dpPaths.map(
    (path, i) => circleResults[i] ? path : segmentedLinearRegression(path, vertices, width, 0.75)
  );
  const totalVerticesBefore = dpPaths.reduce(
    (sum, p) => sum + p.vertices.length,
    0
  );
  const totalVerticesAfter = simplifiedPaths.reduce(
    (sum, p) => sum + p.vertices.length,
    0
  );
  console.log(
    `Vectorization: SLR simplified from ${totalVerticesBefore} to ${totalVerticesAfter} vertices (${((1 - totalVerticesAfter / totalVerticesBefore) * 100).toFixed(1)}% reduction)`
  );
  const finalPaths = simplifiedPaths.map((path, i) => {
    const circle = circleResults[i];
    return {
      points: path.vertices.map((id) => {
        const v = vertices.get(id);
        return v ? { x: v.x, y: v.y } : { x: 0, y: 0 };
      }),
      closed: path.closed,
      circle: circle || void 0
    };
  });
  return {
    width,
    height,
    paths: finalPaths
  };
}
function segmentedLinearRegression(path, vertices, width, epsilon) {
  if (path.vertices.length <= 2) {
    return path;
  }
  let coords = path.vertices.map((id) => vertices.get(id));
  let wasClosed = path.closed;
  if (wasClosed && coords.length > 2) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first.x === last.x && first.y === last.y) {
      coords = coords.slice(0, -1);
      if (coords.length > 2) {
        const cx = coords.reduce((sum, p) => sum + p.x, 0) / coords.length;
        const cy = coords.reduce((sum, p) => sum + p.y, 0) / coords.length;
        let maxDist = 0;
        let maxDistIndex = 0;
        for (let i = 0; i < coords.length; i++) {
          const dx = coords[i].x - cx;
          const dy = coords[i].y - cy;
          const dist = dx * dx + dy * dy;
          if (dist > maxDist) {
            maxDist = dist;
            maxDistIndex = i;
          }
        }
        coords = [
          ...coords.slice(maxDistIndex),
          ...coords.slice(0, maxDistIndex)
        ];
      }
    }
  }
  const simplified = slrRecursive(coords, epsilon, width, wasClosed);
  for (const vertex of simplified) {
    if (!vertices.has(vertex.id)) {
      vertices.set(vertex.id, vertex);
    }
  }
  const resultVertices = simplified.map((v) => v.id);
  if (wasClosed && simplified.length > 0) {
    resultVertices.push(simplified[0].id);
  }
  return {
    vertices: resultVertices,
    closed: wasClosed
  };
}
function slrRecursive(points, epsilon, width, isClosed = false) {
  if (points.length <= 2) {
    return points;
  }
  const { direction, centroid, maxError } = fitLineToSegments(points);
  if (maxError <= epsilon) {
    const start2 = points[0];
    const end2 = points[points.length - 1];
    const projStart = projectOntoLine(start2, centroid, direction);
    const projEnd = projectOntoLine(end2, centroid, direction);
    if (false) {
      console.log(
        `
=== SLR: Good fit (error ${maxError.toFixed(2)} <= ${epsilon}) ===`
      );
      console.log(`Points: ${points.map((p) => `(${p.x},${p.y})`).join(", ")}`);
      console.log(
        `Centroid: (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)})`
      );
      console.log(
        `Direction: (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)})`
      );
      console.log(
        `Projected start: (${projStart.x.toFixed(2)}, ${projStart.y.toFixed(2)})`
      );
      console.log(
        `Projected end: (${projEnd.x.toFixed(2)}, ${projEnd.y.toFixed(2)})`
      );
    }
    const startId = projStart.y * width + projStart.x;
    const endId = projEnd.y * width + projEnd.x;
    return [
      { ...projStart, id: startId, neighbors: [] },
      { ...projEnd, id: endId, neighbors: [] }
    ];
  }
  const start = points[0];
  const end = points[points.length - 1];
  let maxDist = 0;
  let maxDistIndex = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lineLen = Math.sqrt(dx * dx + dy * dy);
  if (lineLen < 1e-10) {
    return [start, end];
  }
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dist = Math.abs(
      (end.y - start.y) * p.x - (end.x - start.x) * p.y + end.x * start.y - end.y * start.x
    ) / lineLen;
    if (dist > maxDist) {
      maxDist = dist;
      maxDistIndex = i;
    }
  }
  const left = slrRecursive(
    points.slice(0, maxDistIndex + 1),
    epsilon,
    width,
    false
  );
  const right = slrRecursive(points.slice(maxDistIndex), epsilon, width, false);
  if (left.length > 1 && right.length > 1) {
    const intersection = findLineIntersection(
      left[left.length - 2],
      left[left.length - 1],
      right[0],
      right[1]
    );
    if (intersection) {
      const intId = intersection.y * width + intersection.x;
      const intVertex = { ...intersection, id: intId, neighbors: [] };
      return [
        ...left.slice(0, -1),
        intVertex,
        ...right.slice(1)
      ];
    }
  }
  return [...left.slice(0, -1), ...right];
}
function fitLineToSegments(points) {
  let totalLength = 0;
  let weightedCx = 0;
  let weightedCy = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const dx2 = B.x - A.x;
    const dy2 = B.y - A.y;
    const L = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const segmentCentroid = {
      x: (A.x + B.x) / 2,
      y: (A.y + B.y) / 2
    };
    totalLength += L;
    weightedCx += L * segmentCentroid.x;
    weightedCy += L * segmentCentroid.y;
  }
  const centroid = {
    x: weightedCx / totalLength,
    y: weightedCy / totalLength
  };
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const dx2 = B.x - A.x;
    const dy2 = B.y - A.y;
    const L = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const Ax = A.x - centroid.x;
    const Ay = A.y - centroid.y;
    const Bx = B.x - centroid.x;
    const By = B.y - centroid.y;
    covXX += L / 3 * (Ax * Ax + Ax * Bx + Bx * Bx);
    covXY += L / 3 * (Ax * Ay + Ax * By + Bx * By);
    covYY += L / 3 * (Ay * Ay + Ay * By + By * By);
  }
  const trace = covXX + covYY;
  const det = covXX * covYY - covXY * covXY;
  const lambda1 = trace / 2 + Math.sqrt(Math.max(0, trace * trace / 4 - det));
  let dx, dy;
  if (Math.abs(covXY) > 1e-10) {
    dx = lambda1 - covYY;
    dy = covXY;
  } else if (covXX > covYY) {
    dx = 1;
    dy = 0;
  } else {
    dx = 0;
    dy = 1;
  }
  const dirLength = Math.sqrt(dx * dx + dy * dy);
  dx /= dirLength;
  dy /= dirLength;
  const direction = { x: dx, y: dy };
  let maxError = 0;
  let maxErrorIndex = 1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const vx = p.x - centroid.x;
    const vy = p.y - centroid.y;
    const error = Math.abs(vx * dy - vy * dx);
    if (error > maxError) {
      maxError = error;
      maxErrorIndex = i;
    }
  }
  return { direction, centroid, maxError, maxErrorIndex };
}
function projectOntoLine(point, linePoint, direction) {
  const vx = point.x - linePoint.x;
  const vy = point.y - linePoint.y;
  const t = vx * direction.x + vy * direction.y;
  return {
    x: linePoint.x + t * direction.x,
    y: linePoint.y + t * direction.y
  };
}
function findLineIntersection(a1, a2, b1, b2) {
  const dx1 = a2.x - a1.x;
  const dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x;
  const dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) {
    return {
      x: Math.round((a2.x + b1.x) / 2),
      y: Math.round((a2.y + b1.y) / 2)
    };
  }
  const dx3 = b1.x - a1.x;
  const dy3 = b1.y - a1.y;
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  return {
    x: Math.round(a1.x + t * dx1),
    y: Math.round(a1.y + t * dy1)
  };
}
function douglasPeucker(path, vertices, epsilon) {
  if (path.vertices.length <= 2) {
    return path;
  }
  const vertexCoords = path.vertices.map((id) => vertices.get(id));
  const simplified = douglasPeuckerRecursive(vertexCoords, epsilon);
  return {
    vertices: simplified.map((v) => v.id),
    closed: path.closed
  };
}
function douglasPeuckerRecursive(points, epsilon) {
  if (points.length <= 2) {
    return points;
  }
  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  if (maxDistance > epsilon) {
    const left = douglasPeuckerRecursive(
      points.slice(0, maxIndex + 1),
      epsilon
    );
    const right = douglasPeuckerRecursive(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [start, end];
  }
}
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      (point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2
    );
  }
  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  );
  const denominator = Math.sqrt(dx * dx + dy * dy);
  return numerator / denominator;
}
function isPixelSet(binary, x, y) {
  const pixelIndex = y * binary.width + x;
  const byteIndex = Math.floor(pixelIndex / 8);
  const bitIndex = 7 - pixelIndex % 8;
  if (byteIndex >= binary.data.length) return false;
  return (binary.data[byteIndex] & 1 << bitIndex) !== 0;
}
function renderVectorizedToSVG(vectorized, svgElement) {
  const { width, height, paths } = vectorized;
  svgElement.setAttribute("width", width.toString());
  svgElement.setAttribute("height", height.toString());
  svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgElement.style.display = "block";
  svgElement.innerHTML = "";
  for (const path of paths) {
    if (path.circle) {
      const circleElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      circleElement.setAttribute("cx", path.circle.cx.toString());
      circleElement.setAttribute("cy", path.circle.cy.toString());
      circleElement.setAttribute("r", path.circle.radius.toString());
      circleElement.setAttribute("fill", "none");
      circleElement.setAttribute("stroke", "red");
      circleElement.setAttribute("stroke-width", "0.5");
      circleElement.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circleElement);
    } else {
      if (path.points.length === 0) continue;
      const firstPoint = path.points[0];
      let pathData = `M ${firstPoint.x + 0.5} ${firstPoint.y + 0.5}`;
      for (let i = 1; i < path.points.length; i++) {
        const point = path.points[i];
        pathData += ` L ${point.x + 0.5} ${point.y + 0.5}`;
      }
      if (path.closed) {
        pathData += " Z";
      }
      const pathElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      pathElement.setAttribute("d", pathData);
      pathElement.setAttribute("fill", "none");
      pathElement.setAttribute("stroke", "red");
      pathElement.setAttribute("stroke-width", "0.5");
      pathElement.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(pathElement);
    }
  }
  for (const path of paths) {
    if (path.circle) {
      const centerDot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      centerDot.setAttribute("cx", path.circle.cx.toString());
      centerDot.setAttribute("cy", path.circle.cy.toString());
      centerDot.setAttribute("r", "0.5");
      centerDot.setAttribute("fill", "#00aa00");
      centerDot.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(centerDot);
    } else {
      for (const point of path.points) {
        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle"
        );
        circle.setAttribute("cx", (point.x + 0.5).toString());
        circle.setAttribute("cy", (point.y + 0.5).toString());
        circle.setAttribute("r", "0.5");
        circle.setAttribute("fill", "#00aa00");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        svgElement.appendChild(circle);
      }
    }
  }
}

// browser-app/main.ts
var browserCanvasBackend = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
};
var uploadFileList = document.getElementById(
  "uploadFileList"
);
var uploadBtn = document.getElementById("uploadBtn");
var clearAllBtn = document.getElementById("clearAllBtn");
var fileInput = document.getElementById("fileInput");
var uploadScreen = document.getElementById("uploadScreen");
var pageSelectionScreen = document.getElementById(
  "pageSelectionScreen"
);
var pdfFileName = document.getElementById(
  "pdfFileName"
);
var pageGrid = document.getElementById("pageGrid");
var pageStatusText = document.getElementById(
  "pageStatusText"
);
var backToFilesBtn = document.getElementById(
  "backToFilesBtn"
);
var cropScreen = document.getElementById("cropScreen");
var canvasContainer2 = document.getElementById(
  "canvasContainer"
);
var mainCanvas2 = document.getElementById("mainCanvas");
var ctx2 = mainCanvas2.getContext("2d");
var cropOverlay2 = document.getElementById("cropOverlay");
var cropCtx2 = cropOverlay2.getContext("2d");
var zoomInBtn = document.getElementById("zoomInBtn");
var zoomOutBtn = document.getElementById("zoomOutBtn");
var zoomLevel2 = document.getElementById("zoomLevel");
var fitToScreenBtn = document.getElementById(
  "fitToScreenBtn"
);
var clearCropBtn = document.getElementById(
  "clearCropBtn"
);
var cropInfo2 = document.getElementById("cropInfo");
var processBtn = document.getElementById("processBtn");
var statusText = document.getElementById("statusText");
var resultsContainer = document.getElementById(
  "resultsContainer"
);
var navStepFile = document.getElementById("navStepFile");
var navStepPage = document.getElementById("navStepPage");
var navStepConfigure = document.getElementById(
  "navStepConfigure"
);
var toggleToolbarBtn = document.getElementById(
  "toggleToolbarBtn"
);
var cropSidebar = document.getElementById("cropSidebar");
var processSidebar = document.getElementById(
  "processSidebar"
);
var paletteName = document.getElementById("paletteName");
var addPaletteColorBtn = document.getElementById(
  "addPaletteColorBtn"
);
var resetPaletteBtn = document.getElementById(
  "resetPaletteBtn"
);
var savePaletteBtn = document.getElementById(
  "savePaletteBtn"
);
var loadPaletteBtn = document.getElementById(
  "loadPaletteBtn"
);
var setDefaultPaletteBtn = document.getElementById(
  "setDefaultPaletteBtn"
);
console.log("Palette buttons:", {
  addPaletteColorBtn,
  resetPaletteBtn,
  savePaletteBtn,
  loadPaletteBtn,
  setDefaultPaletteBtn
});
var processingScreen = document.getElementById(
  "processingScreen"
);
var processCanvasContainer = document.getElementById(
  "processCanvasContainer"
);
var processCanvas = document.getElementById(
  "processCanvas"
);
var processCtx = processCanvas.getContext("2d");
var processSvgOverlay = document.getElementById(
  "processSvgOverlay"
);
var processZoomInBtn = document.getElementById(
  "processZoomInBtn"
);
var processZoomOutBtn = document.getElementById(
  "processZoomOutBtn"
);
var processZoomLevel = document.getElementById(
  "processZoomLevel"
);
var processFitToScreenBtn = document.getElementById(
  "processFitToScreenBtn"
);
var processStatusText = document.getElementById(
  "processStatusText"
);
var stageCroppedBtn = document.getElementById(
  "stageCroppedBtn"
);
var stageExtractBlackBtn = document.getElementById(
  "stageExtractBlackBtn"
);
var stageSubtractBlackBtn = document.getElementById(
  "stageSubtractBlackBtn"
);
var stageValueBtn = document.getElementById(
  "stageValueBtn"
);
var stageSaturationBtn = document.getElementById(
  "stageSaturationBtn"
);
var stageSaturationMedianBtn = document.getElementById(
  "stageSaturationMedianBtn"
);
var stageHueBtn = document.getElementById("stageHueBtn");
var stageHueMedianBtn = document.getElementById(
  "stageHueMedianBtn"
);
var stageCleanupBtn = document.getElementById(
  "stageCleanupBtn"
);
var stagePalettizedBtn = document.getElementById(
  "stagePalettizedBtn"
);
var stageMedianBtn = document.getElementById(
  "stageMedianBtn"
);
var colorStagesContainer = document.getElementById(
  "colorStagesContainer"
);
var vectorOverlayContainer = document.getElementById(
  "vectorOverlayContainer"
);
initCanvasElements({
  canvasContainer: canvasContainer2,
  mainCanvas: mainCanvas2,
  ctx: ctx2,
  cropOverlay: cropOverlay2,
  cropCtx: cropCtx2,
  zoomLevel: zoomLevel2,
  cropInfo: cropInfo2
});
initPaletteModule({
  showStatus,
  mainCanvas: mainCanvas2
});
stageCroppedBtn.addEventListener(
  "click",
  () => displayProcessingStage("cropped")
);
stageExtractBlackBtn.addEventListener(
  "click",
  () => displayProcessingStage("extract_black")
);
stageSubtractBlackBtn.addEventListener(
  "click",
  () => displayProcessingStage("subtract_black")
);
stageValueBtn.addEventListener("click", () => displayProcessingStage("value"));
stageSaturationBtn.addEventListener(
  "click",
  () => displayProcessingStage("saturation")
);
stageSaturationMedianBtn.addEventListener(
  "click",
  () => displayProcessingStage("saturation_median")
);
stageHueBtn.addEventListener("click", () => displayProcessingStage("hue"));
stageHueMedianBtn.addEventListener(
  "click",
  () => displayProcessingStage("hue_median")
);
stageCleanupBtn.addEventListener(
  "click",
  () => displayProcessingStage("cleanup")
);
stagePalettizedBtn.addEventListener(
  "click",
  () => displayProcessingStage("palettized")
);
stageMedianBtn.addEventListener(
  "click",
  () => displayProcessingStage("median")
);
processZoomInBtn.addEventListener("click", () => {
  state.processZoom = Math.min(10, state.processZoom * 1.2);
  updateProcessZoom();
  updateProcessTransform();
});
processZoomOutBtn.addEventListener("click", () => {
  state.processZoom = Math.max(0.1, state.processZoom / 1.2);
  updateProcessZoom();
  updateProcessTransform();
});
processFitToScreenBtn.addEventListener("click", () => {
  processFitToScreen();
});
navStepFile.addEventListener("click", () => {
  if (!navStepFile.classList.contains("disabled")) {
    setMode("upload");
  }
});
navStepPage.addEventListener("click", () => {
  if (!navStepPage.classList.contains("disabled") && state.currentPdfData) {
    setMode("pageSelection");
  }
});
toggleToolbarBtn.addEventListener("click", () => {
  cropSidebar?.classList.toggle("collapsed");
  processSidebar?.classList.toggle("collapsed");
});
refreshFileList();
setMode("upload");
uploadBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
uploadScreen.addEventListener("click", (e) => {
  const target = e.target;
  if (target.closest(".file-card") || target.closest(".upload-actions")) {
    return;
  }
  if (target === uploadScreen || target.closest(".upload-file-list")) {
    fileInput.click();
  }
});
fileInput.addEventListener("change", (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});
uploadScreen.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadScreen.classList.add("drag-over");
});
uploadScreen.addEventListener("dragleave", (e) => {
  if (e.target === uploadScreen) {
    uploadScreen.classList.remove("drag-over");
  }
});
uploadScreen.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadScreen.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});
clearAllBtn.addEventListener("click", async () => {
  if (confirm("Delete all saved files?")) {
    await clearAllFiles();
    await refreshFileList();
    showStatus("All files cleared");
  }
});
backToFilesBtn.addEventListener("click", () => {
  state.currentFileId = null;
  state.currentPdfData = null;
  state.currentImage = null;
  state.cropRegion = null;
  setMode("upload");
  refreshFileList();
});
zoomInBtn.addEventListener("click", () => {
  state.zoom = Math.min(10, state.zoom * 1.2);
  updateZoom();
  updateTransform();
});
zoomOutBtn.addEventListener("click", () => {
  state.zoom /= 1.2;
  updateZoom();
  redrawCanvas();
});
fitToScreenBtn.addEventListener("click", () => {
  fitToScreen();
});
clearCropBtn.addEventListener("click", () => {
  if (state.currentImage) {
    setDefaultCrop(state.currentImage.width, state.currentImage.height);
    drawCropOverlay();
  }
});
processBtn.addEventListener("click", async () => {
  if (state.currentImage) {
    await startProcessing();
  }
});
canvasContainer2.addEventListener("mousedown", (e) => {
  const rect = canvasContainer2.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left - state.panX) / state.zoom;
  const canvasY = (e.clientY - rect.top - state.panY) / state.zoom;
  const handle = getCropHandleAtPoint(canvasX, canvasY);
  if (handle && state.cropRegion) {
    state.isDraggingCropHandle = true;
    state.activeCropHandle = handle;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
  } else if (!e.shiftKey) {
    state.isPanning = true;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    canvasContainer2.classList.add("grabbing");
  }
});
canvasContainer2.addEventListener("mousemove", (e) => {
  if (state.isDraggingCropHandle && state.activeCropHandle && state.cropRegion) {
    const dx = (e.clientX - state.lastPanX) / state.zoom;
    const dy = (e.clientY - state.lastPanY) / state.zoom;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    adjustCropRegion(state.activeCropHandle, dx, dy);
    drawCropOverlay();
  } else if (state.isPanning) {
    const dx = e.clientX - state.lastPanX;
    const dy = e.clientY - state.lastPanY;
    state.panX += dx;
    state.panY += dy;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    updateTransform();
  } else {
    const rect = canvasContainer2.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - state.panX) / state.zoom;
    const canvasY = (e.clientY - rect.top - state.panY) / state.zoom;
    const handle = getCropHandleAtPoint(canvasX, canvasY);
    updateCursorForHandle(handle);
  }
});
canvasContainer2.addEventListener("mouseup", () => {
  if (state.isDraggingCropHandle) {
    state.isDraggingCropHandle = false;
    state.activeCropHandle = null;
    if (state.currentImage && state.cropRegion) {
      saveCropSettings(
        state.currentImage.width,
        state.currentImage.height,
        state.cropRegion
      );
      updateCropInfo();
    }
  }
  if (state.isPanning) {
    state.isPanning = false;
    canvasContainer2.classList.remove("grabbing");
  }
});
canvasContainer2.addEventListener("mouseleave", () => {
  state.isPanning = false;
  canvasContainer2.classList.remove("grabbing");
});
canvasContainer2.addEventListener("wheel", (e) => {
  e.preventDefault();
  const isPinchZoom = e.ctrlKey;
  if (isPinchZoom) {
    const rect = canvasContainer2.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const canvasX = (mouseX - state.panX) / state.zoom;
    const canvasY = (mouseY - state.panY) / state.zoom;
    const zoomSpeed = 0.01;
    const zoomChange = -e.deltaY * zoomSpeed * state.zoom;
    const newZoom = Math.max(0.1, Math.min(20, state.zoom + zoomChange));
    state.panX = mouseX - canvasX * newZoom;
    state.panY = mouseY - canvasY * newZoom;
    state.zoom = newZoom;
    updateZoom();
    updateTransform();
  } else {
    state.panX -= e.deltaX;
    state.panY -= e.deltaY;
    updateTransform();
  }
});
processCanvasContainer.addEventListener("mousedown", (e) => {
  state.isProcessPanning = true;
  state.lastProcessPanX = e.clientX;
  state.lastProcessPanY = e.clientY;
  processCanvasContainer.classList.add("grabbing");
});
processCanvasContainer.addEventListener("mousemove", (e) => {
  if (state.isProcessPanning) {
    const dx = e.clientX - state.lastProcessPanX;
    const dy = e.clientY - state.lastProcessPanY;
    state.processPanX += dx;
    state.processPanY += dy;
    state.lastProcessPanX = e.clientX;
    state.lastProcessPanY = e.clientY;
    updateProcessTransform();
  }
});
processCanvasContainer.addEventListener("mouseup", () => {
  if (state.isProcessPanning) {
    state.isProcessPanning = false;
    processCanvasContainer.classList.remove("grabbing");
  }
});
processCanvasContainer.addEventListener("mouseleave", () => {
  state.isProcessPanning = false;
  processCanvasContainer.classList.remove("grabbing");
});
processCanvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const isPinchZoom = e.ctrlKey;
  if (isPinchZoom) {
    const rect = processCanvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    let width = 0, height = 0;
    const image = state.processedImages.get(state.currentStage);
    if (image) {
      width = image.width;
      height = image.height;
    } else if (state.currentStage.endsWith("_vec")) {
      const vectorized = state.vectorizedImages.get(state.currentStage);
      if (vectorized) {
        width = vectorized.width;
        height = vectorized.height;
      }
    }
    if (width === 0 || height === 0) return;
    const canvasX = (mouseX - state.processPanX) / state.processZoom;
    const canvasY = (mouseY - state.processPanY) / state.processZoom;
    const zoomSpeed = 5e-3;
    const zoomChange = -e.deltaY * zoomSpeed * state.processZoom;
    const newZoom = Math.max(0.1, Math.min(10, state.processZoom + zoomChange));
    state.processPanX = mouseX - canvasX * newZoom;
    state.processPanY = mouseY - canvasY * newZoom;
    state.processZoom = newZoom;
    updateProcessZoom();
    updateProcessTransform();
  } else {
    state.processPanX -= e.deltaX;
    state.processPanY -= e.deltaY;
    updateProcessTransform();
  }
});
function updateNavigation(mode) {
  navStepFile.classList.remove("active", "completed", "disabled");
  navStepPage.classList.remove("active", "completed", "disabled");
  navStepConfigure.classList.remove("active", "completed", "disabled");
  switch (mode) {
    case "upload":
      navStepFile.classList.add("active");
      navStepPage.classList.add("disabled");
      navStepConfigure.classList.add("disabled");
      break;
    case "pageSelection":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("active");
      navStepConfigure.classList.add("disabled");
      break;
    case "crop":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("completed");
      navStepConfigure.classList.add("active");
      break;
    case "processing":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("completed");
      navStepConfigure.classList.add("completed");
      break;
  }
}
function setMode(mode) {
  console.log("setMode called:", mode);
  uploadScreen.classList.remove("active");
  pageSelectionScreen.classList.remove("active");
  cropScreen.classList.remove("active");
  processingScreen.classList.remove("active");
  pageSelectionScreen.style.display = "";
  switch (mode) {
    case "upload":
      uploadScreen.classList.add("active");
      console.log("Upload screen activated");
      console.log(
        "uploadScreen display:",
        globalThis.getComputedStyle(uploadScreen).display
      );
      console.log(
        "uploadScreen hasClass active:",
        uploadScreen.classList.contains("active")
      );
      break;
    case "pageSelection":
      pageSelectionScreen.classList.add("active");
      pageSelectionScreen.style.display = "flex";
      console.log(
        "Page selection screen activated, pageGrid children:",
        pageGrid.children.length
      );
      console.log(
        "pageSelectionScreen display:",
        globalThis.getComputedStyle(pageSelectionScreen).display
      );
      console.log(
        "pageSelectionScreen visibility:",
        globalThis.getComputedStyle(pageSelectionScreen).visibility
      );
      break;
    case "crop":
      cropScreen.classList.add("active");
      console.log("Crop screen activated");
      break;
    case "processing":
      processingScreen.classList.add("active");
      console.log("Processing screen activated");
      break;
  }
  updateNavigation(mode);
}
function showStatus(message, isError = false) {
  let activeStatusText = statusText;
  if (pageSelectionScreen.classList.contains("active")) {
    activeStatusText = pageStatusText;
  } else if (processingScreen.classList.contains("active")) {
    activeStatusText = processStatusText;
  }
  activeStatusText.textContent = message;
  if (isError) {
    activeStatusText.classList.add("status-error");
  } else {
    activeStatusText.classList.remove("status-error");
  }
  console.log(message);
}
initPaletteDB();
async function handleFileUpload(file) {
  try {
    showStatus(`Loading: ${file.name}...`);
    if (!state.currentFileId) {
      try {
        state.currentFileId = await saveFile(file);
        console.log(`File saved with ID: ${state.currentFileId}`);
        await loadDefaultPalette();
        await refreshFileList();
      } catch (err) {
        console.error("Error saving file:", err);
      }
    }
    if (file.type === "application/pdf") {
      console.log("handleFileUpload: Detected PDF, calling loadPdf");
      await loadPdf(file);
      console.log(
        "handleFileUpload: loadPdf complete, switching to pageSelection mode"
      );
      setMode("pageSelection");
    } else {
      console.log("handleFileUpload: Detected image, loading directly");
      const image = await loadImageFromFile(file);
      await loadImage(image, showStatus);
      setMode("crop");
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
async function loadPdf(file) {
  try {
    console.log("loadPdf: Starting to load", file.name);
    const arrayBuffer = await file.arrayBuffer();
    console.log("loadPdf: Got arrayBuffer, length:", arrayBuffer.byteLength);
    const copy = new Uint8Array(arrayBuffer.byteLength);
    copy.set(new Uint8Array(arrayBuffer));
    state.currentPdfData = copy;
    console.log("loadPdf: Created copy", copy.length);
    const initialCopy = state.currentPdfData.slice();
    console.log("loadPdf: Calling getDocument");
    const loadingTask = pdfjsLib.getDocument({ data: initialCopy });
    const pdf = await loadingTask.promise;
    state.pdfPageCount = pdf.numPages;
    console.log("loadPdf: PDF loaded, pages:", state.pdfPageCount);
    showStatus(`PDF loaded: ${state.pdfPageCount} pages`);
    console.log("loadPdf: About to set pdfFileName, element:", pdfFileName);
    try {
      pdfFileName.textContent = file.name;
      console.log("loadPdf: pdfFileName set successfully");
    } catch (e) {
      console.error("loadPdf: Error setting pdfFileName:", e);
    }
    console.log("loadPdf: pdfFileName set, about to generate thumbnails");
    console.log("loadPdf: Generating page thumbnails, clearing pageGrid");
    console.log("loadPdf: pageGrid element:", pageGrid);
    const existingCards = pageGrid.children.length;
    if (existingCards > 0) {
      console.log(
        `[THUMBNAIL] PURGING ${existingCards} existing thumbnail cards from cache`
      );
    }
    pageGrid.innerHTML = "";
    console.log(
      "loadPdf: pageGrid cleared, adding",
      state.pdfPageCount,
      "cards"
    );
    const pageDimensions = [];
    let pageLabels = null;
    try {
      pageLabels = await pdf.getPageLabels();
    } catch (_e) {
    }
    for (let i = 1; i <= state.pdfPageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const pageLabel = pageLabels && pageLabels[i - 1] || `Page ${i}`;
      pageDimensions.push({
        width: viewport.width,
        height: viewport.height,
        pageLabel
      });
      const card = document.createElement("div");
      card.className = "page-card";
      const imageDiv = document.createElement("div");
      imageDiv.className = "page-card-image";
      imageDiv.textContent = "\u{1F4C4}";
      const aspectRatio = viewport.width / viewport.height;
      imageDiv.style.aspectRatio = aspectRatio.toString();
      imageDiv.style.width = 250 * aspectRatio + "px";
      const label = document.createElement("div");
      label.className = "page-card-label";
      label.textContent = pageLabel;
      card.appendChild(imageDiv);
      card.appendChild(label);
      card.dataset.pageNum = i.toString();
      if (i === state.currentSelectedPage) {
        card.classList.add("selected");
      }
      card.addEventListener("click", () => {
        selectPdfPage(i);
      });
      pageGrid.appendChild(card);
    }
    const MAX_THUMBNAILS = 50;
    const thumbnailsToRender = Math.min(state.pdfPageCount, MAX_THUMBNAILS);
    state.cancelThumbnailLoading = false;
    (async () => {
      const pagesBySize = Array.from(
        { length: state.pdfPageCount },
        (_, i) => i
      ).sort((a, b) => {
        const areaA = pageDimensions[a].width * pageDimensions[a].height;
        const areaB = pageDimensions[b].width * pageDimensions[b].height;
        return areaB - areaA;
      });
      const renderQueue = [];
      const addedPages = /* @__PURE__ */ new Set();
      let sequentialIndex = 0;
      let largestIndex = 0;
      console.log(
        `[THUMBNAIL] Building render queue for ${thumbnailsToRender} thumbnails out of ${state.pdfPageCount} pages`
      );
      while (renderQueue.length < thumbnailsToRender && (sequentialIndex < state.pdfPageCount || largestIndex < pagesBySize.length)) {
        if (sequentialIndex < state.pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        if (sequentialIndex < state.pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        while (largestIndex < pagesBySize.length && renderQueue.length < thumbnailsToRender) {
          const largestPageIdx = pagesBySize[largestIndex++];
          if (!addedPages.has(largestPageIdx)) {
            renderQueue.push(largestPageIdx);
            addedPages.add(largestPageIdx);
            break;
          }
        }
      }
      console.log(
        `[THUMBNAIL] Render queue built with ${renderQueue.length} pages:`,
        renderQueue.map((idx) => {
          const pageNum = idx + 1;
          const label = pageDimensions[idx]?.pageLabel || `Page ${pageNum}`;
          return `${pageNum}(${label})`;
        }).join(", ")
      );
      const batchSize = 3;
      let completed = 0;
      const allCards = Array.from(pageGrid.children);
      for (let i = 0; i < renderQueue.length; i += batchSize) {
        if (state.cancelThumbnailLoading) {
          console.log(
            `[THUMBNAIL] Loading cancelled after ${completed} thumbnails`
          );
          showStatus(`Thumbnail loading cancelled`);
          return;
        }
        const batch = [];
        const batchInfo = [];
        for (let j = 0; j < batchSize && i + j < renderQueue.length; j++) {
          const pageIndex = renderQueue[i + j];
          const pageNum = pageIndex + 1;
          const pageLabel = pageDimensions[pageIndex]?.pageLabel || `Page ${pageNum}`;
          if (pageIndex < allCards.length) {
            const card = allCards[pageIndex];
            const imageDiv = card.querySelector(
              ".page-card-image"
            );
            if (imageDiv) {
              batchInfo.push(`${pageNum}(${pageLabel})`);
              batch.push(generatePageThumbnail(pageNum, pageLabel, imageDiv));
            } else {
              console.warn(
                `[THUMBNAIL] No imageDiv found for page ${pageNum}(${pageLabel}) at index ${pageIndex}`
              );
            }
          } else {
            console.warn(
              `[THUMBNAIL] Page index ${pageIndex} out of bounds (cards.length=${allCards.length}) for page ${pageNum}`
            );
          }
        }
        if (batch.length > 0) {
          console.log(
            `[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: Rendering ${batchInfo.join(", ")}`
          );
          await Promise.all(batch);
          completed += batch.length;
          console.log(
            `[THUMBNAIL] Batch complete. Total: ${completed}/${renderQueue.length}`
          );
          const statusMsg = thumbnailsToRender < state.pdfPageCount ? `Loading thumbnails: ${completed}/${thumbnailsToRender} (${state.pdfPageCount} pages total)` : `Loading thumbnails: ${completed}/${state.pdfPageCount}`;
          showStatus(statusMsg);
        } else {
          console.warn(
            `[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: No valid thumbnails to render`
          );
        }
      }
      const finalMsg = thumbnailsToRender < state.pdfPageCount ? `PDF loaded: ${state.pdfPageCount} pages (showing ${thumbnailsToRender} thumbnails)` : `PDF loaded: ${state.pdfPageCount} pages`;
      showStatus(finalMsg);
    })();
  } catch (error) {
    console.error("loadPdf error:", error);
    showStatus(`PDF load error: ${error.message}`, true);
    throw error;
  }
}
async function generatePageThumbnail(pageNum, pageLabel, container) {
  try {
    if (!state.currentPdfData) {
      console.warn(`[THUMBNAIL] No PDF data for page ${pageNum}(${pageLabel})`);
      return;
    }
    console.log(`[THUMBNAIL] START rendering page ${pageNum}(${pageLabel})`);
    const pdfDataCopy = state.currentPdfData.slice();
    const image = await renderPdfPage(
      { file: pdfDataCopy, pageNumber: pageNum, scale: 0.4 },
      browserCanvasBackend,
      pdfjsLib
    );
    console.log(
      `[THUMBNAIL] RENDERED page ${pageNum}(${pageLabel}): ${image.width}x${image.height}`
    );
    const aspectRatio = image.width / image.height;
    container.style.aspectRatio = aspectRatio.toString();
    container.style.width = 250 * aspectRatio + "px";
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx3 = canvas.getContext("2d");
    if (ctx3) {
      const imageData = new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height
      );
      ctx3.putImageData(imageData, 0, 0);
      const img = document.createElement("img");
      img.src = canvas.toDataURL();
      container.innerHTML = "";
      container.appendChild(img);
      console.log(
        `[THUMBNAIL] COMPLETE page ${pageNum}(${pageLabel}) - image inserted into DOM`
      );
    }
  } catch (err) {
    console.error(
      `[THUMBNAIL] ERROR generating thumbnail for page ${pageNum}(${pageLabel}):`,
      err
    );
  }
}
async function selectPdfPage(pageNum) {
  try {
    console.log("selectPdfPage: Starting, page:", pageNum);
    if (!state.currentPdfData) {
      console.error("selectPdfPage: No PDF data!");
      showStatus("No PDF loaded", true);
      return;
    }
    state.cancelThumbnailLoading = true;
    state.currentSelectedPage = pageNum;
    const cards = pageGrid.querySelectorAll(".page-card");
    cards.forEach((card) => card.classList.remove("selected"));
    const selectedCard = pageGrid.querySelector(`[data-page-num="${pageNum}"]`);
    if (selectedCard) {
      selectedCard.classList.add("selected");
    }
    setMode("crop");
    ctx2.clearRect(0, 0, mainCanvas2.width, mainCanvas2.height);
    cropCtx2.clearRect(0, 0, cropOverlay2.width, cropOverlay2.height);
    mainCanvas2.width = 0;
    mainCanvas2.height = 0;
    cropOverlay2.width = 0;
    cropOverlay2.height = 0;
    cropOverlay2.style.display = "none";
    showStatus(`\u23F3 Rendering page ${pageNum} at 200 DPI...`);
    canvasContainer2.style.opacity = "0.3";
    let progressDots = 0;
    const progressInterval = setInterval(() => {
      progressDots = (progressDots + 1) % 4;
      showStatus(
        `\u23F3 Rendering page ${pageNum} at 200 DPI${".".repeat(progressDots)}`
      );
    }, 300);
    console.log("selectPdfPage: Creating copy");
    const pdfDataCopy = state.currentPdfData.slice();
    console.log("selectPdfPage: Calling renderPdfPage");
    const image = await renderPdfPage(
      {
        file: pdfDataCopy,
        pageNumber: pageNum,
        scale: 2.778
      },
      browserCanvasBackend,
      pdfjsLib
    );
    console.log("selectPdfPage: Got image", image.width, "x", image.height);
    clearInterval(progressInterval);
    canvasContainer2.style.opacity = "1";
    await loadImage(image, showStatus);
    showStatus(`\u2713 Page ${pageNum} loaded: ${image.width}\xD7${image.height}`);
    if (state.currentFileId && state.currentImage) {
      const thumbnail = generateThumbnail(state.currentImage);
      const palette = JSON.stringify(state.userPalette);
      await updateFile(state.currentFileId, { thumbnail, palette });
      await refreshFileList();
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
function rgbaToBinary(rgba) {
  const { width, height, data } = rgba;
  const numPixels = width * height;
  const byteCount = Math.ceil(numPixels / 8);
  const binaryData = new Uint8Array(byteCount);
  for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
    const r = data[pixelIndex * 4];
    if (r < 128) {
      const bitByteIndex = Math.floor(pixelIndex / 8);
      const bitIndex = 7 - pixelIndex % 8;
      binaryData[bitByteIndex] |= 1 << bitIndex;
    }
  }
  return { width, height, data: binaryData };
}
function extractColorFromPalettized(palettized, colorIndex) {
  const { width, height, data } = palettized;
  const numPixels = width * height;
  const byteCount = Math.ceil(numPixels / 8);
  const binaryData = new Uint8Array(byteCount);
  for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
    const byteIndex = Math.floor(pixelIndex / 2);
    const isHighNibble = pixelIndex % 2 === 0;
    const paletteIndex = isHighNibble ? data[byteIndex] >> 4 & 15 : data[byteIndex] & 15;
    if (paletteIndex === colorIndex) {
      const bitByteIndex = Math.floor(pixelIndex / 8);
      const bitIndex = 7 - pixelIndex % 8;
      binaryData[bitByteIndex] |= 1 << bitIndex;
    }
  }
  return { width, height, data: binaryData };
}
async function binaryToGPUBuffer(binary) {
  const { device } = await getGPUContext();
  const { width, height, data } = binary;
  const numPixels = width * height;
  const numWords = Math.ceil(numPixels / 32);
  const packed = new Uint32Array(numWords);
  for (let i = 0; i < numPixels; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - i % 8;
    const bit = data[byteIdx] >> bitIdx & 1;
    if (bit) {
      const wordIdx = Math.floor(i / 32);
      const bitInWord = i % 32;
      packed[wordIdx] |= 1 << bitInWord;
    }
  }
  const buffer = createGPUBuffer(
    device,
    packed,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  return buffer;
}
async function startProcessing() {
  if (!state.currentImage) return;
  try {
    setMode("processing");
    state.processedImages.clear();
    state.processViewInitialized = false;
    let processImage = state.currentImage;
    if (state.cropRegion && state.cropRegion.width > 0 && state.cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(state.currentImage, state.cropRegion);
    }
    state.processedImages.set("cropped", processImage);
    displayProcessingStage("cropped");
    showStatus("Extracting black...");
    const extractBlackStart = performance.now();
    const extractedBlack = await extractBlackGPU(processImage, 0.2);
    const extractBlackEnd = performance.now();
    showStatus(
      `Extract black: ${(extractBlackEnd - extractBlackStart).toFixed(1)}ms`
    );
    state.processedImages.set("extract_black", extractedBlack);
    displayProcessingStage("extract_black");
    const color1Buffer = await binaryToGPUBuffer(extractedBlack);
    const color1SkelResults = await processValueChannel(
      color1Buffer,
      extractedBlack.width,
      extractedBlack.height
    );
    state.processedImages.set("color_1", color1SkelResults.median);
    state.processedImages.set("color_1_skel", color1SkelResults.skeleton);
    color1Buffer.destroy();
    color1SkelResults.skeletonBuffer.destroy();
    showStatus("Applying bloom filter...");
    const bloomStart = performance.now();
    const bloomFiltered = await bloomFilter3x3GPU(extractedBlack);
    const bloomEnd = performance.now();
    showStatus(`Bloom filter: ${(bloomEnd - bloomStart).toFixed(1)}ms`);
    showStatus("Subtracting black...");
    const subtractStart = performance.now();
    const subtractedImage = await subtractBlackGPU(processImage, bloomFiltered);
    const subtractEnd = performance.now();
    showStatus(`Subtract black: ${(subtractEnd - subtractStart).toFixed(1)}ms`);
    state.processedImages.set("subtract_black", subtractedImage);
    displayProcessingStage("subtract_black");
    processImage = subtractedImage;
    showStatus("Running cleanup (extracting channels)...");
    const t1 = performance.now();
    const cleanupResults = await cleanupGPU(processImage);
    const t2 = performance.now();
    showStatus(`Cleanup: ${(t2 - t1).toFixed(1)}ms`);
    state.processedImages.set("value", cleanupResults.value);
    state.processedImages.set("saturation", cleanupResults.saturation);
    state.processedImages.set(
      "saturation_median",
      cleanupResults.saturationMedian
    );
    state.processedImages.set("hue", cleanupResults.hue);
    state.processedImages.set("hue_median", cleanupResults.hueMedian);
    showStatus("Recombining channels...");
    const t2d = performance.now();
    const cleanupFinal = await recombineWithValue(
      cleanupResults.valueBuffer,
      cleanupResults.saturationBuffer,
      cleanupResults.hueBuffer,
      cleanupResults.width,
      cleanupResults.height
    );
    const t2e = performance.now();
    showStatus(`Recombine: ${(t2e - t2d).toFixed(1)}ms`);
    state.processedImages.set("cleanup", cleanupFinal);
    displayProcessingStage("cleanup");
    cleanupResults.valueBuffer.destroy();
    cleanupResults.saturationBuffer.destroy();
    cleanupResults.hueBuffer.destroy();
    showStatus("Palettizing...");
    const t3 = performance.now();
    const inputPalette = buildPaletteRGBA();
    const palettized = await palettizeGPU(cleanupFinal, inputPalette);
    const outputPalette = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < state.userPalette.length && i < 16; i++) {
      const color = state.userPalette[i];
      const useColor = color.mapToBg ? state.userPalette[0].outputColor : color.outputColor;
      const [r, g, b, a] = hexToRGBA(useColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    for (let i = state.userPalette.length; i < 16; i++) {
      const [r, g, b, a] = hexToRGBA(state.userPalette[0].outputColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    const outputPaletteU32 = new Uint32Array(16);
    const outputView = new DataView(
      outputPalette.buffer,
      outputPalette.byteOffset,
      outputPalette.byteLength
    );
    for (let i = 0; i < 16; i++) {
      outputPaletteU32[i] = outputView.getUint32(i * 4, true);
    }
    palettized.palette = outputPaletteU32;
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    state.processedImages.set("palettized", palettized);
    displayProcessingStage("palettized");
    showStatus("Applying median filter (pass 1/3)...");
    const t4b = performance.now();
    let median = await median3x3GPU(palettized);
    showStatus("Applying median filter (pass 2/3)...");
    median = await median3x3GPU(median);
    showStatus("Applying median filter (pass 3/3)...");
    median = await median3x3GPU(median);
    const t4c = performance.now();
    showStatus(`Median filter (3 passes): ${(t4c - t4b).toFixed(1)}ms`);
    state.processedImages.set("median", median);
    displayProcessingStage("median");
    showStatus("Processing individual colors...");
    const t5 = performance.now();
    for (let i = 1; i < state.userPalette.length && i < 16; i++) {
      const color = state.userPalette[i];
      if (color.mapToBg) continue;
      if (i === 1) continue;
      showStatus(`Processing color ${i}...`);
      const colorBinary = extractColorFromPalettized(median, i);
      state.processedImages.set(`color_${i}`, colorBinary);
      const colorBuffer = await binaryToGPUBuffer(colorBinary);
      const skelResults = await processValueChannel(
        colorBuffer,
        colorBinary.width,
        colorBinary.height
      );
      state.processedImages.set(`color_${i}_skel`, skelResults.skeleton);
      colorBuffer.destroy();
      skelResults.skeletonBuffer.destroy();
    }
    const t6 = performance.now();
    showStatus(`Per-color processing: ${(t6 - t5).toFixed(1)}ms`);
    addColorStageButtons();
    const totalTime = t6 - t1;
    showStatus(`\u2713 Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
function addColorStageButtons() {
  colorStagesContainer.innerHTML = "";
  vectorOverlayContainer.innerHTML = "";
  for (let i = 1; i < state.userPalette.length && i < 16; i++) {
    const color = state.userPalette[i];
    if (color.mapToBg) continue;
    if (!state.processedImages.has(`color_${i}`)) continue;
    const colorBtn = document.createElement("button");
    colorBtn.className = "stage-btn";
    colorBtn.textContent = `Color ${i}`;
    colorBtn.style.borderLeft = `4px solid ${color.outputColor}`;
    colorBtn.addEventListener(
      "click",
      () => displayProcessingStage(`color_${i}`)
    );
    colorStagesContainer.appendChild(colorBtn);
    if (state.processedImages.has(`color_${i}_skel`)) {
      const skelBtn = document.createElement("button");
      skelBtn.className = "stage-btn";
      skelBtn.textContent = `Color ${i} Skel`;
      skelBtn.style.borderLeft = `4px solid ${color.outputColor}`;
      skelBtn.dataset.stage = `color_${i}_skel`;
      skelBtn.addEventListener(
        "click",
        () => displayProcessingStage(`color_${i}_skel`)
      );
      colorStagesContainer.appendChild(skelBtn);
      const vecStage = `color_${i}_vec`;
      const vecToggle = document.createElement("button");
      vecToggle.className = "stage-btn";
      vecToggle.textContent = `Color ${i} Vec`;
      vecToggle.style.borderLeft = `4px solid ${color.outputColor}`;
      vecToggle.dataset.stage = vecStage;
      vecToggle.addEventListener("click", () => toggleVectorOverlay(vecStage));
      vectorOverlayContainer.appendChild(vecToggle);
    }
  }
}
function toggleVectorOverlay(vecStage) {
  if (state.vectorOverlayEnabled && state.vectorOverlayStage === vecStage) {
    state.vectorOverlayEnabled = false;
    state.vectorOverlayStage = null;
    processSvgOverlay.style.display = "none";
    updateVectorOverlayButtons();
    showStatus("Vector overlay hidden");
    return;
  }
  let vectorized = state.vectorizedImages.get(vecStage);
  if (!vectorized) {
    const skelStage = vecStage.replace("_vec", "_skel");
    const skelImage = state.processedImages.get(skelStage);
    if (!skelImage) {
      showStatus(`Skeleton stage ${skelStage} not available`, true);
      return;
    }
    let binaryImage;
    const expectedBinaryLength = Math.ceil(
      skelImage.width * skelImage.height / 8
    );
    if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
      console.log(`Converting ${skelStage} from RGBA to binary format`);
      binaryImage = rgbaToBinary(skelImage);
    } else if (skelImage.data instanceof Uint8Array && skelImage.data.length === expectedBinaryLength) {
      binaryImage = skelImage;
    } else {
      showStatus(`${skelStage} has unexpected format`, true);
      return;
    }
    showStatus(`Vectorizing ${skelStage}...`);
    const vectorizeStart = performance.now();
    vectorized = vectorizeSkeleton(binaryImage);
    state.vectorizedImages.set(vecStage, vectorized);
    const vectorizeEnd = performance.now();
    const totalPoints2 = vectorized.paths.reduce(
      (sum, p) => sum + p.points.length,
      0
    );
    console.log(
      `Vectorized: ${vectorized.paths.length} paths, ${totalPoints2} points (${(vectorizeEnd - vectorizeStart).toFixed(1)}ms)`
    );
  }
  state.vectorOverlayEnabled = true;
  state.vectorOverlayStage = vecStage;
  const currentImage = state.processedImages.get(state.currentStage);
  if (currentImage) {
    renderVectorizedToSVG(
      vectorized,
      processSvgOverlay,
      currentImage.width,
      currentImage.height
    );
    processSvgOverlay.style.display = "block";
  }
  updateVectorOverlayButtons();
  const totalPoints = vectorized.paths.reduce(
    (sum, p) => sum + p.points.length,
    0
  );
  showStatus(
    `Vector overlay: ${vectorized.paths.length} paths, ${totalPoints} points`
  );
}
function updateVectorOverlayButtons() {
  vectorOverlayContainer.querySelectorAll(".stage-btn").forEach((btn) => {
    const btnStage = btn.dataset.stage;
    if (btnStage === state.vectorOverlayStage && state.vectorOverlayEnabled) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}
function displayProcessingStage(stage) {
  if (stage.endsWith("_vec")) {
    let vectorized = state.vectorizedImages.get(stage);
    if (!vectorized) {
      const skelStage2 = stage.replace("_vec", "_skel");
      const skelImage2 = state.processedImages.get(skelStage2);
      if (!skelImage2) {
        showStatus(`Skeleton stage ${skelStage2} not available`, true);
        return;
      }
      let binaryImage;
      const expectedBinaryLength = Math.ceil(
        skelImage2.width * skelImage2.height / 8
      );
      if (skelImage2.data instanceof Uint8ClampedArray && skelImage2.data.length === skelImage2.width * skelImage2.height * 4) {
        console.log(`Converting ${skelStage2} from RGBA to binary format`);
        binaryImage = rgbaToBinary(skelImage2);
      } else if (skelImage2.data instanceof Uint8Array && skelImage2.data.length === expectedBinaryLength) {
        binaryImage = skelImage2;
      } else {
        showStatus(`${skelStage2} has unexpected format`, true);
        console.error(`Unexpected format:`, {
          dataType: skelImage2.data?.constructor?.name,
          actualLength: skelImage2.data.length,
          expectedRGBA: skelImage2.width * skelImage2.height * 4,
          expectedBinary: expectedBinaryLength
        });
        return;
      }
      showStatus(`Vectorizing ${skelStage2}...`);
      const vectorizeStart = performance.now();
      vectorized = vectorizeSkeleton(binaryImage);
      state.vectorizedImages.set(stage, vectorized);
      const vectorizeEnd = performance.now();
      const totalPoints2 = vectorized.paths.reduce(
        (sum, p) => sum + p.points.length,
        0
      );
      showStatus(
        `Vectorized: ${vectorized.paths.length} paths, ${totalPoints2} points (${(vectorizeEnd - vectorizeStart).toFixed(1)}ms)`
      );
    }
    state.currentStage = stage;
    document.querySelectorAll(".stage-btn").forEach(
      (btn2) => btn2.classList.remove("active")
    );
    const btn = Array.from(document.querySelectorAll(".stage-btn")).find(
      (b) => b.dataset.stage === stage
    );
    btn?.classList.add("active");
    const skelStage = stage.replace("_vec", "_skel");
    const skelImage = state.processedImages.get(skelStage);
    if (skelImage) {
      processCanvas.width = skelImage.width;
      processCanvas.height = skelImage.height;
      let rgbaData2;
      if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
        rgbaData2 = skelImage.data;
      } else {
        const numPixels = skelImage.width * skelImage.height;
        rgbaData2 = new Uint8ClampedArray(numPixels * 4);
        for (let i = 0; i < numPixels; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitIndex = 7 - i % 8;
          const bit = skelImage.data[byteIndex] >> bitIndex & 1;
          const value = bit ? 0 : 255;
          rgbaData2[i * 4] = value;
          rgbaData2[i * 4 + 1] = value;
          rgbaData2[i * 4 + 2] = value;
          rgbaData2[i * 4 + 3] = 255;
        }
      }
      const imageData2 = new ImageData(
        rgbaData2,
        skelImage.width,
        skelImage.height
      );
      processCtx.putImageData(imageData2, 0, 0);
    }
    renderVectorizedToSVG(vectorized, processSvgOverlay);
    if (!state.processViewInitialized) {
      processFitToScreen();
      state.processViewInitialized = true;
    } else {
      updateProcessTransform();
    }
    const totalPoints = vectorized.paths.reduce(
      (sum, p) => sum + p.points.length,
      0
    );
    showStatus(
      `Viewing: ${stage} (${vectorized.paths.length} paths, ${totalPoints} points)`
    );
    return;
  }
  const image = state.processedImages.get(stage);
  if (!image) {
    showStatus(`Stage ${stage} not available`, true);
    return;
  }
  state.currentStage = stage;
  if (state.vectorOverlayEnabled && state.vectorOverlayStage) {
    const vectorized = state.vectorizedImages.get(state.vectorOverlayStage);
    if (vectorized) {
      renderVectorizedToSVG(
        vectorized,
        processSvgOverlay,
        image.width,
        image.height
      );
      processSvgOverlay.style.display = "block";
    }
  }
  document.querySelectorAll(".stage-btn").forEach(
    (btn) => btn.classList.remove("active")
  );
  if (typeof stage === "string" && stage.startsWith("color_")) {
    const btn = Array.from(document.querySelectorAll(".stage-btn")).find(
      (b) => b.textContent?.toLowerCase().replace(" ", "_").includes(stage)
    );
    btn?.classList.add("active");
  } else {
    const stageButtons = {
      cropped: stageCroppedBtn,
      extract_black: stageExtractBlackBtn,
      subtract_black: stageSubtractBlackBtn,
      value: stageValueBtn,
      saturation: stageSaturationBtn,
      saturation_median: stageSaturationMedianBtn,
      hue: stageHueBtn,
      hue_median: stageHueMedianBtn,
      cleanup: stageCleanupBtn,
      palettized: stagePalettizedBtn,
      median: stageMedianBtn
    };
    const baseStage = stage;
    stageButtons[baseStage]?.classList.add("active");
  }
  processCanvas.width = image.width;
  processCanvas.height = image.height;
  let rgbaData;
  if ("palette" in image && image.palette) {
    const numPixels = image.width * image.height;
    rgbaData = new Uint8ClampedArray(numPixels * 4);
    for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
      const byteIndex = Math.floor(pixelIndex / 2);
      const isHighNibble = pixelIndex % 2 === 0;
      const colorIndex = isHighNibble ? image.data[byteIndex] >> 4 & 15 : image.data[byteIndex] & 15;
      const pixelOffset = pixelIndex * 4;
      const packedColor = image.palette[colorIndex];
      rgbaData[pixelOffset] = packedColor & 255;
      rgbaData[pixelOffset + 1] = packedColor >> 8 & 255;
      rgbaData[pixelOffset + 2] = packedColor >> 16 & 255;
      rgbaData[pixelOffset + 3] = packedColor >> 24 & 255;
    }
  } else if (image.data instanceof Uint8Array && image.data.length === Math.ceil(image.width * image.height / 8)) {
    rgbaData = new Uint8ClampedArray(image.width * image.height * 4);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const pixelIndex = y * image.width + x;
        const byteIndex = Math.floor(pixelIndex / 8);
        const bitIndex = 7 - pixelIndex % 8;
        const bitValue = image.data[byteIndex] >> bitIndex & 1;
        const value = bitValue ? 0 : 255;
        const offset = pixelIndex * 4;
        rgbaData[offset] = value;
        rgbaData[offset + 1] = value;
        rgbaData[offset + 2] = value;
        rgbaData[offset + 3] = 255;
      }
    }
  } else {
    rgbaData = new Uint8ClampedArray(image.data);
  }
  const displayData = new Uint8ClampedArray(rgbaData);
  const imageData = new ImageData(
    displayData,
    image.width,
    image.height
  );
  processCtx.putImageData(imageData, 0, 0);
  if (!state.processViewInitialized) {
    processFitToScreen();
    state.processViewInitialized = true;
  } else {
    updateProcessTransform();
  }
  showStatus(`Viewing: ${stage} (${image.width}\xD7${image.height})`);
}
function processFitToScreen() {
  let imageWidth = 0, imageHeight = 0;
  const image = state.processedImages.get(state.currentStage);
  if (image) {
    imageWidth = image.width;
    imageHeight = image.height;
  } else if (state.currentStage.endsWith("_vec")) {
    const vectorized = state.vectorizedImages.get(state.currentStage);
    if (vectorized) {
      imageWidth = vectorized.width;
      imageHeight = vectorized.height;
    }
  }
  if (imageWidth === 0 || imageHeight === 0) return;
  const containerWidth = processCanvasContainer.clientWidth;
  const containerHeight = processCanvasContainer.clientHeight;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  state.processZoom = Math.min(scaleX, scaleY) * 0.9;
  state.processPanX = (containerWidth - imageWidth * state.processZoom) / 2;
  state.processPanY = (containerHeight - imageHeight * state.processZoom) / 2;
  updateProcessZoom();
  updateProcessTransform();
}
function updateProcessZoom() {
  processZoomLevel.textContent = `${Math.round(state.processZoom * 100)}%`;
}
function updateProcessTransform() {
  const transform = `translate(${state.processPanX}px, ${state.processPanY}px) scale(${state.processZoom})`;
  processCanvas.style.transform = transform;
  processCanvas.style.transformOrigin = "0 0";
  processCanvas.style.willChange = "transform";
  processSvgOverlay.style.transform = transform;
  processSvgOverlay.style.transformOrigin = "0 0";
  processSvgOverlay.style.willChange = "transform";
  if (state.processZoom >= 1) {
    processCanvas.style.imageRendering = "pixelated";
  } else {
    processCanvas.style.imageRendering = "auto";
  }
}
function generateThumbnail(image) {
  const maxSize = 128;
  const scale = Math.min(maxSize / image.width, maxSize / image.height);
  const thumbWidth = Math.floor(image.width * scale);
  const thumbHeight = Math.floor(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx3 = canvas.getContext("2d");
  if (!ctx3) return "";
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return "";
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  tempCtx.putImageData(imageData, 0, 0);
  ctx3.imageSmoothingEnabled = true;
  ctx3.imageSmoothingQuality = "high";
  ctx3.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);
  return canvas.toDataURL("image/png");
}
async function refreshFileList() {
  const files = await listFiles();
  console.log(`Refreshing file list: ${files.length} files`);
  if (files.length === 0) {
    uploadFileList.innerHTML = `
      <div class="upload-empty">
        <div>\u{1F4C1}</div>
        <div>No files yet</div>
      </div>
    `;
    return;
  }
  uploadFileList.innerHTML = `<div class="files-grid"></div>`;
  const filesGrid = uploadFileList.querySelector(
    ".files-grid"
  );
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-card";
    if (file.id === state.currentFileId) {
      item.classList.add("active");
    }
    const thumbnail = document.createElement("div");
    thumbnail.className = "file-thumbnail";
    if (file.thumbnail) {
      const img = document.createElement("img");
      img.src = file.thumbnail;
      thumbnail.appendChild(img);
    } else {
      thumbnail.textContent = file.type.includes("pdf") ? "\u{1F4C4}" : "\u{1F5BC}\uFE0F";
    }
    const info = document.createElement("div");
    info.className = "file-info";
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.name;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    const date = new Date(file.uploadedAt);
    const size = (file.data.length / 1024).toFixed(0);
    meta.textContent = `${size} KB \u2022 ${date.toLocaleDateString()}`;
    info.appendChild(name);
    info.appendChild(meta);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "file-delete";
    deleteBtn.textContent = "\xD7";
    deleteBtn.title = "Delete file";
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`Delete ${file.name}?`)) {
        await deleteFile(file.id);
        if (file.id === state.currentFileId) {
          state.currentFileId = null;
          state.currentPdfData = null;
          state.currentImage = null;
          setMode("upload");
        }
        await refreshFileList();
        showStatus(`Deleted ${file.name}`);
      }
    };
    item.appendChild(thumbnail);
    item.appendChild(info);
    item.appendChild(deleteBtn);
    item.onclick = () => loadStoredFile(file.id);
    filesGrid.appendChild(item);
  }
}
async function loadStoredFile(id) {
  showStatus("\u23F3 Loading file...");
  const stored = await getFile(id);
  if (!stored) {
    showStatus("File not found", true);
    return;
  }
  state.currentFileId = id;
  if (stored.palette) {
    try {
      const savedPalette = JSON.parse(stored.palette);
      state.userPalette.length = 0;
      state.userPalette.push(...savedPalette);
      renderPaletteUI();
      console.log("Restored saved palette with", savedPalette.length, "colors");
    } catch (err) {
      console.error("Failed to restore palette:", err);
      await loadDefaultPalette();
    }
  } else {
    await loadDefaultPalette();
  }
  const data = new Uint8Array(stored.data);
  const blob = new Blob([data], { type: stored.type });
  const file = new File([blob], stored.name, { type: stored.type });
  await refreshFileList();
  await handleFileUpload(file);
}
console.log("Setting up palette event listeners...");
if (addPaletteColorBtn) {
  addPaletteColorBtn.addEventListener("click", () => {
    console.log("Add button clicked!");
    addPaletteColor();
  });
} else {
  console.error("addPaletteColorBtn not found!");
}
if (resetPaletteBtn) {
  resetPaletteBtn.addEventListener("click", () => {
    console.log("Reset button clicked!");
    resetPaletteToDefault();
  });
} else {
  console.error("resetPaletteBtn not found!");
}
if (savePaletteBtn) {
  savePaletteBtn.addEventListener("click", () => {
    const name = paletteName.value;
    savePalette(name);
  });
}
if (loadPaletteBtn) {
  loadPaletteBtn.addEventListener("click", () => {
    loadPalette();
  });
}
if (setDefaultPaletteBtn) {
  setDefaultPaletteBtn.addEventListener("click", () => {
    setDefaultPalette();
  });
}
mainCanvas2.addEventListener("click", (e) => {
  if (isEyedropperActive()) {
    pickColorFromCanvas(e.clientX, e.clientY);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isEyedropperActive()) {
    forceDeactivateEyedropper();
  }
});
renderPaletteUI();
