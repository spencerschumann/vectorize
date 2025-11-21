// src/pdf/image_load.ts
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx2 = canvas.getContext("2d");
      if (!ctx2) {
        reject(new Error("Could not get 2D context"));
        return;
      }
      ctx2.drawImage(img, 0, 0);
      const imageData = ctx2.getImageData(0, 0, img.width, img.height);
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
@group(0) @binding(1) var<storage, read_write> value_out: array<f32>;
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
    
    // Binary threshold: above = 1.0 (white/background), below = 0.0 (lines)
    value_out[pixel_idx] = select(0.0, 1.0, value >= params.threshold);
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
@group(0) @binding(0) var<storage, read> value_in: array<f32>;
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
    
    let value = value_in[pixel_idx]; // Binary mask: 0 = line, 1 = background
    let saturation = saturation_in[pixel_idx]; // Cleaned saturation
    let hue = hue_in[pixel_idx]; // Cleaned hue
    
    // For background pixels (value = 1), output white
    // For line pixels (value = 0), reconstruct color from cleaned hue and saturation
    var rgb: vec3<f32>;
    if (value > 0.6) {
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
  console.log(`Cleanup: ${width}x${height}, ${pixelCount} pixels, data.length=${data.length}, expected=${byteSize}`);
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const valueBuffer1 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const valueBuffer2 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const saturationBuffer1 = device.createBuffer({
    size: floatByteSize,
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
  const hueVisModule = device.createShaderModule({ code: hueToRGBShader });
  const grayscalePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: grayscaleModule, entryPoint: "main" }
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
      layout: grayscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer2 } },
        { binding: 1, resource: { buffer: valueVisBuffer } },
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
  valueBuffer2.destroy();
  saturationBuffer1.destroy();
  saturationBuffer2.destroy();
  hueBuffer1.destroy();
  hueBuffer2.destroy();
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
    }
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

// browser-app/main.ts
var browserCanvasBackend = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
};
var currentMode = "upload";
var currentFileId = null;
var currentFile = null;
var currentPdfData = null;
var currentImage = null;
var currentSelectedPage = null;
var pdfPageCount = 0;
var cancelThumbnailLoading = false;
var currentStage = "cropped";
var processedImages = /* @__PURE__ */ new Map();
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
var userPalette = Array.from(DEFAULT_PALETTE).map((color) => ({
  inputColor: u32ToHex(color),
  outputColor: u32ToHex(color),
  mapToBg: false
}));
var zoom = 1;
var panX = 0;
var panY = 0;
var isPanning = false;
var isDraggingCropHandle = false;
var activeCropHandle = null;
var cropRegion = null;
var lastPanX = 0;
var lastPanY = 0;
var processZoom = 1;
var processPanX = 0;
var processPanY = 0;
var isProcessPanning = false;
var lastProcessPanX = 0;
var lastProcessPanY = 0;
var processViewInitialized = false;
var uploadFileList = document.getElementById("uploadFileList");
var uploadBtn = document.getElementById("uploadBtn");
var clearAllBtn = document.getElementById("clearAllBtn");
var fileInput = document.getElementById("fileInput");
var uploadScreen = document.getElementById("uploadScreen");
var pageSelectionScreen = document.getElementById("pageSelectionScreen");
var pdfFileName = document.getElementById("pdfFileName");
var pageGrid = document.getElementById("pageGrid");
var pageStatusText = document.getElementById("pageStatusText");
var backToFilesBtn = document.getElementById("backToFilesBtn");
var cropScreen = document.getElementById("cropScreen");
var canvasContainer = document.getElementById("canvasContainer");
var mainCanvas = document.getElementById("mainCanvas");
var ctx = mainCanvas.getContext("2d");
var cropOverlay = document.getElementById("cropOverlay");
var cropCtx = cropOverlay.getContext("2d");
var zoomInBtn = document.getElementById("zoomInBtn");
var zoomOutBtn = document.getElementById("zoomOutBtn");
var zoomLevel = document.getElementById("zoomLevel");
var fitToScreenBtn = document.getElementById("fitToScreenBtn");
var clearCropBtn = document.getElementById("clearCropBtn");
var cropInfo = document.getElementById("cropInfo");
var processBtn = document.getElementById("processBtn");
var backFromCropBtn = document.getElementById("backFromCropBtn");
var statusText = document.getElementById("statusText");
var resultsPanel = document.getElementById("resultsPanel");
var resultsContainer = document.getElementById("resultsContainer");
var paletteList = document.getElementById("paletteList");
var addPaletteColorBtn = document.getElementById("addPaletteColorBtn");
var resetPaletteBtn = document.getElementById("resetPaletteBtn");
var processingScreen = document.getElementById("processingScreen");
var processCanvasContainer = document.getElementById("processCanvasContainer");
var processCanvas = document.getElementById("processCanvas");
var processCtx = processCanvas.getContext("2d");
var processZoomInBtn = document.getElementById("processZoomInBtn");
var processZoomOutBtn = document.getElementById("processZoomOutBtn");
var processZoomLevel = document.getElementById("processZoomLevel");
var processFitToScreenBtn = document.getElementById("processFitToScreenBtn");
var processStatusText = document.getElementById("processStatusText");
var backToCropBtn = document.getElementById("backToCropBtn");
var stageCroppedBtn = document.getElementById("stageCroppedBtn");
var stageValueBtn = document.getElementById("stageValueBtn");
var stageSaturationBtn = document.getElementById("stageSaturationBtn");
var stageSaturationMedianBtn = document.getElementById("stageSaturationMedianBtn");
var stageHueBtn = document.getElementById("stageHueBtn");
var stageHueMedianBtn = document.getElementById("stageHueMedianBtn");
var stageCleanupBtn = document.getElementById("stageCleanupBtn");
var stagePalettizedBtn = document.getElementById("stagePalettizedBtn");
var stageMedianBtn = document.getElementById("stageMedianBtn");
var stageBinaryBtn = document.getElementById("stageBinaryBtn");
backToCropBtn.addEventListener("click", () => {
  setMode("crop");
});
stageCroppedBtn.addEventListener("click", () => displayProcessingStage("cropped"));
stageValueBtn.addEventListener("click", () => displayProcessingStage("value"));
stageSaturationBtn.addEventListener("click", () => displayProcessingStage("saturation"));
stageSaturationMedianBtn.addEventListener("click", () => displayProcessingStage("saturation_median"));
stageHueBtn.addEventListener("click", () => displayProcessingStage("hue"));
stageHueMedianBtn.addEventListener("click", () => displayProcessingStage("hue_median"));
stageCleanupBtn.addEventListener("click", () => displayProcessingStage("cleanup"));
stagePalettizedBtn.addEventListener("click", () => displayProcessingStage("palettized"));
stageMedianBtn.addEventListener("click", () => displayProcessingStage("median"));
stageBinaryBtn.addEventListener("click", () => displayProcessingStage("binary"));
processZoomInBtn.addEventListener("click", () => {
  processZoom = Math.min(10, processZoom * 1.2);
  updateProcessZoom();
  updateProcessTransform();
});
processZoomOutBtn.addEventListener("click", () => {
  processZoom = Math.max(0.1, processZoom / 1.2);
  updateProcessZoom();
  updateProcessTransform();
});
processFitToScreenBtn.addEventListener("click", () => {
  processFitToScreen();
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
  currentFileId = null;
  currentPdfData = null;
  currentImage = null;
  cropRegion = null;
  setMode("upload");
  refreshFileList();
});
backFromCropBtn.addEventListener("click", () => {
  if (currentFile?.type === "application/pdf") {
    setMode("pageSelection");
  } else {
    setMode("upload");
  }
});
zoomInBtn.addEventListener("click", () => {
  zoom = Math.min(10, zoom * 1.2);
  updateZoom();
  updateTransform();
});
zoomOutBtn.addEventListener("click", () => {
  zoom /= 1.2;
  updateZoom();
  redrawCanvas();
});
fitToScreenBtn.addEventListener("click", () => {
  fitToScreen();
});
clearCropBtn.addEventListener("click", () => {
  if (currentImage) {
    setDefaultCrop(currentImage.width, currentImage.height);
    drawCropOverlay();
  }
});
processBtn.addEventListener("click", async () => {
  if (currentImage) {
    await startProcessing();
  }
});
canvasContainer.addEventListener("mousedown", (e) => {
  const rect = canvasContainer.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left - panX) / zoom;
  const canvasY = (e.clientY - rect.top - panY) / zoom;
  const handle = getCropHandleAtPoint(canvasX, canvasY);
  if (handle && cropRegion) {
    isDraggingCropHandle = true;
    activeCropHandle = handle;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
  } else if (!e.shiftKey) {
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    canvasContainer.classList.add("grabbing");
  }
});
canvasContainer.addEventListener("mousemove", (e) => {
  if (isDraggingCropHandle && activeCropHandle && cropRegion) {
    const dx = (e.clientX - lastPanX) / zoom;
    const dy = (e.clientY - lastPanY) / zoom;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    adjustCropRegion(activeCropHandle, dx, dy);
    drawCropOverlay();
  } else if (isPanning) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    panX += dx;
    panY += dy;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    updateTransform();
  } else {
    const rect = canvasContainer.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - panX) / zoom;
    const canvasY = (e.clientY - rect.top - panY) / zoom;
    const handle = getCropHandleAtPoint(canvasX, canvasY);
    updateCursorForHandle(handle);
  }
});
canvasContainer.addEventListener("mouseup", () => {
  if (isDraggingCropHandle) {
    isDraggingCropHandle = false;
    activeCropHandle = null;
    if (currentImage && cropRegion) {
      saveCropSettings(currentImage.width, currentImage.height, cropRegion);
      updateCropInfo();
    }
  }
  if (isPanning) {
    isPanning = false;
    canvasContainer.classList.remove("grabbing");
  }
});
canvasContainer.addEventListener("mouseleave", () => {
  isPanning = false;
  canvasContainer.classList.remove("grabbing");
});
canvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const isPinchZoom = e.ctrlKey;
  if (isPinchZoom) {
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const canvasX = (mouseX - panX) / zoom;
    const canvasY = (mouseY - panY) / zoom;
    const zoomSpeed = 5e-3;
    const zoomChange = -e.deltaY * zoomSpeed * zoom;
    const newZoom = Math.max(0.1, Math.min(10, zoom + zoomChange));
    panX = mouseX - canvasX * newZoom;
    panY = mouseY - canvasY * newZoom;
    zoom = newZoom;
    updateZoom();
    updateTransform();
  } else {
    panX -= e.deltaX;
    panY -= e.deltaY;
    updateTransform();
  }
});
processCanvasContainer.addEventListener("mousedown", (e) => {
  isProcessPanning = true;
  lastProcessPanX = e.clientX;
  lastProcessPanY = e.clientY;
  processCanvasContainer.classList.add("grabbing");
});
processCanvasContainer.addEventListener("mousemove", (e) => {
  if (isProcessPanning) {
    const dx = e.clientX - lastProcessPanX;
    const dy = e.clientY - lastProcessPanY;
    processPanX += dx;
    processPanY += dy;
    lastProcessPanX = e.clientX;
    lastProcessPanY = e.clientY;
    updateProcessTransform();
  }
});
processCanvasContainer.addEventListener("mouseup", () => {
  if (isProcessPanning) {
    isProcessPanning = false;
    processCanvasContainer.classList.remove("grabbing");
  }
});
processCanvasContainer.addEventListener("mouseleave", () => {
  isProcessPanning = false;
  processCanvasContainer.classList.remove("grabbing");
});
processCanvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const isPinchZoom = e.ctrlKey;
  if (isPinchZoom) {
    const rect = processCanvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const image = processedImages.get(currentStage);
    if (!image) return;
    const canvasX = (mouseX - processPanX) / processZoom;
    const canvasY = (mouseY - processPanY) / processZoom;
    const zoomSpeed = 5e-3;
    const zoomChange = -e.deltaY * zoomSpeed * processZoom;
    const newZoom = Math.max(0.1, Math.min(10, processZoom + zoomChange));
    processPanX = mouseX - canvasX * newZoom;
    processPanY = mouseY - canvasY * newZoom;
    processZoom = newZoom;
    updateProcessZoom();
    updateProcessTransform();
  } else {
    processPanX -= e.deltaX;
    processPanY -= e.deltaY;
    updateProcessTransform();
  }
});
function setMode(mode) {
  console.log("setMode called:", mode);
  currentMode = mode;
  uploadScreen.classList.remove("active");
  pageSelectionScreen.classList.remove("active");
  cropScreen.classList.remove("active");
  processingScreen.classList.remove("active");
  pageSelectionScreen.style.display = "";
  switch (mode) {
    case "upload":
      uploadScreen.classList.add("active");
      console.log("Upload screen activated");
      console.log("uploadScreen display:", globalThis.getComputedStyle(uploadScreen).display);
      console.log("uploadScreen hasClass active:", uploadScreen.classList.contains("active"));
      break;
    case "pageSelection":
      pageSelectionScreen.classList.add("active");
      pageSelectionScreen.style.display = "flex";
      console.log("Page selection screen activated, pageGrid children:", pageGrid.children.length);
      console.log("pageSelectionScreen display:", globalThis.getComputedStyle(pageSelectionScreen).display);
      console.log("pageSelectionScreen visibility:", globalThis.getComputedStyle(pageSelectionScreen).visibility);
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
async function handleFileUpload(file) {
  try {
    currentFile = file;
    showStatus(`Loading: ${file.name}...`);
    if (!currentFileId) {
      try {
        currentFileId = await saveFile(file);
        console.log(`File saved with ID: ${currentFileId}`);
        await refreshFileList();
      } catch (err) {
        console.error("Error saving file:", err);
      }
    }
    if (file.type === "application/pdf") {
      console.log("handleFileUpload: Detected PDF, calling loadPdf");
      await loadPdf(file);
      console.log("handleFileUpload: loadPdf complete, switching to pageSelection mode");
      setMode("pageSelection");
    } else {
      console.log("handleFileUpload: Detected image, loading directly");
      const image = await loadImageFromFile(file);
      await loadImage(image);
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
    currentPdfData = copy;
    console.log("loadPdf: Created copy", copy.length);
    const initialCopy = currentPdfData.slice();
    console.log("loadPdf: Calling getDocument");
    const loadingTask = pdfjsLib.getDocument({ data: initialCopy });
    const pdf = await loadingTask.promise;
    pdfPageCount = pdf.numPages;
    console.log("loadPdf: PDF loaded, pages:", pdfPageCount);
    showStatus(`PDF loaded: ${pdfPageCount} pages`);
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
      console.log(`[THUMBNAIL] PURGING ${existingCards} existing thumbnail cards from cache`);
    }
    pageGrid.innerHTML = "";
    console.log("loadPdf: pageGrid cleared, adding", pdfPageCount, "cards");
    const pageDimensions = [];
    let pageLabels = null;
    try {
      pageLabels = await pdf.getPageLabels();
    } catch (_e) {
    }
    for (let i = 1; i <= pdfPageCount; i++) {
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
      if (i === currentSelectedPage) {
        card.classList.add("selected");
      }
      card.addEventListener("click", () => {
        selectPdfPage(i);
      });
      pageGrid.appendChild(card);
    }
    const MAX_THUMBNAILS = 50;
    const thumbnailsToRender = Math.min(pdfPageCount, MAX_THUMBNAILS);
    cancelThumbnailLoading = false;
    (async () => {
      const pagesBySize = Array.from({ length: pdfPageCount }, (_, i) => i).sort((a, b) => {
        const areaA = pageDimensions[a].width * pageDimensions[a].height;
        const areaB = pageDimensions[b].width * pageDimensions[b].height;
        return areaB - areaA;
      });
      const renderQueue = [];
      const addedPages = /* @__PURE__ */ new Set();
      let sequentialIndex = 0;
      let largestIndex = 0;
      console.log(`[THUMBNAIL] Building render queue for ${thumbnailsToRender} thumbnails out of ${pdfPageCount} pages`);
      while (renderQueue.length < thumbnailsToRender && (sequentialIndex < pdfPageCount || largestIndex < pagesBySize.length)) {
        if (sequentialIndex < pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        if (sequentialIndex < pdfPageCount && renderQueue.length < thumbnailsToRender) {
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
      console.log(`[THUMBNAIL] Render queue built with ${renderQueue.length} pages:`, renderQueue.map((idx) => {
        const pageNum = idx + 1;
        const label = pageDimensions[idx]?.pageLabel || `Page ${pageNum}`;
        return `${pageNum}(${label})`;
      }).join(", "));
      const batchSize = 3;
      let completed = 0;
      const allCards = Array.from(pageGrid.children);
      for (let i = 0; i < renderQueue.length; i += batchSize) {
        if (cancelThumbnailLoading) {
          console.log(`[THUMBNAIL] Loading cancelled after ${completed} thumbnails`);
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
            const imageDiv = card.querySelector(".page-card-image");
            if (imageDiv) {
              batchInfo.push(`${pageNum}(${pageLabel})`);
              batch.push(generatePageThumbnail(pageNum, pageLabel, imageDiv));
            } else {
              console.warn(`[THUMBNAIL] No imageDiv found for page ${pageNum}(${pageLabel}) at index ${pageIndex}`);
            }
          } else {
            console.warn(`[THUMBNAIL] Page index ${pageIndex} out of bounds (cards.length=${allCards.length}) for page ${pageNum}`);
          }
        }
        if (batch.length > 0) {
          console.log(`[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: Rendering ${batchInfo.join(", ")}`);
          await Promise.all(batch);
          completed += batch.length;
          console.log(`[THUMBNAIL] Batch complete. Total: ${completed}/${renderQueue.length}`);
          const statusMsg = thumbnailsToRender < pdfPageCount ? `Loading thumbnails: ${completed}/${thumbnailsToRender} (${pdfPageCount} pages total)` : `Loading thumbnails: ${completed}/${pdfPageCount}`;
          showStatus(statusMsg);
        } else {
          console.warn(`[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: No valid thumbnails to render`);
        }
      }
      const finalMsg = thumbnailsToRender < pdfPageCount ? `PDF loaded: ${pdfPageCount} pages (showing ${thumbnailsToRender} thumbnails)` : `PDF loaded: ${pdfPageCount} pages`;
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
    if (!currentPdfData) {
      console.warn(`[THUMBNAIL] No PDF data for page ${pageNum}(${pageLabel})`);
      return;
    }
    console.log(`[THUMBNAIL] START rendering page ${pageNum}(${pageLabel})`);
    const pdfDataCopy = currentPdfData.slice();
    const image = await renderPdfPage(
      { file: pdfDataCopy, pageNumber: pageNum, scale: 0.4 },
      browserCanvasBackend,
      pdfjsLib
    );
    console.log(`[THUMBNAIL] RENDERED page ${pageNum}(${pageLabel}): ${image.width}x${image.height}`);
    const aspectRatio = image.width / image.height;
    container.style.aspectRatio = aspectRatio.toString();
    container.style.width = 250 * aspectRatio + "px";
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx2 = canvas.getContext("2d");
    if (ctx2) {
      const imageData = new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height
      );
      ctx2.putImageData(imageData, 0, 0);
      const img = document.createElement("img");
      img.src = canvas.toDataURL();
      container.innerHTML = "";
      container.appendChild(img);
      console.log(`[THUMBNAIL] COMPLETE page ${pageNum}(${pageLabel}) - image inserted into DOM`);
    }
  } catch (err) {
    console.error(`[THUMBNAIL] ERROR generating thumbnail for page ${pageNum}(${pageLabel}):`, err);
  }
}
async function selectPdfPage(pageNum) {
  try {
    console.log("selectPdfPage: Starting, page:", pageNum);
    if (!currentPdfData) {
      console.error("selectPdfPage: No PDF data!");
      showStatus("No PDF loaded", true);
      return;
    }
    cancelThumbnailLoading = true;
    currentSelectedPage = pageNum;
    const cards = pageGrid.querySelectorAll(".page-card");
    cards.forEach((card) => card.classList.remove("selected"));
    const selectedCard = pageGrid.querySelector(`[data-page-num="${pageNum}"]`);
    if (selectedCard) {
      selectedCard.classList.add("selected");
    }
    setMode("crop");
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    mainCanvas.width = 0;
    mainCanvas.height = 0;
    cropOverlay.width = 0;
    cropOverlay.height = 0;
    cropOverlay.style.display = "none";
    showStatus(`\u23F3 Rendering page ${pageNum} at 200 DPI...`);
    canvasContainer.style.opacity = "0.3";
    let progressDots = 0;
    const progressInterval = setInterval(() => {
      progressDots = (progressDots + 1) % 4;
      showStatus(`\u23F3 Rendering page ${pageNum} at 200 DPI${".".repeat(progressDots)}`);
    }, 300);
    console.log("selectPdfPage: Creating copy");
    const pdfDataCopy = currentPdfData.slice();
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
    canvasContainer.style.opacity = "1";
    await loadImage(image);
    showStatus(`\u2713 Page ${pageNum} loaded: ${image.width}\xD7${image.height}`);
    if (currentFileId && currentImage) {
      const thumbnail = generateThumbnail(currentImage);
      await updateFile(currentFileId, { thumbnail });
      await refreshFileList();
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
function loadImage(image) {
  currentImage = image;
  mainCanvas.width = image.width;
  mainCanvas.height = image.height;
  cropOverlay.width = image.width;
  cropOverlay.height = image.height;
  mainCanvas.style.display = "block";
  canvasContainer.style.opacity = "1";
  const savedCrop = getCropSettings(image.width, image.height);
  if (savedCrop) {
    cropRegion = savedCrop;
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
  showStatus(`\u2713 Ready: ${image.width}\xD7${image.height} pixels`);
}
function fitToScreen() {
  if (!currentImage) return;
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;
  const imageWidth = currentImage.width;
  const imageHeight = currentImage.height;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  zoom = Math.min(scaleX, scaleY) * 0.9;
  panX = (containerWidth - imageWidth * zoom) / 2;
  panY = (containerHeight - imageHeight * zoom) / 2;
  updateZoom();
  updateTransform();
}
function updateZoom() {
  zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
}
function setDefaultCrop(imageWidth, imageHeight) {
  const margin = 0.1;
  cropRegion = {
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
  if (cropRegion) {
    cropInfo.textContent = `Crop: ${Math.round(cropRegion.width)}\xD7${Math.round(cropRegion.height)} at (${Math.round(cropRegion.x)}, ${Math.round(cropRegion.y)})`;
  }
}
function getCropHandleAtPoint(x, y) {
  if (!cropRegion) return null;
  const handleSize = 15 / zoom;
  const { x: cx, y: cy, width: cw, height: ch } = cropRegion;
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
  if (!cropRegion || !currentImage) return;
  const { x, y, width, height } = cropRegion;
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
  newX = Math.max(0, Math.min(newX, currentImage.width - 10));
  newY = Math.max(0, Math.min(newY, currentImage.height - 10));
  newWidth = Math.max(10, Math.min(newWidth, currentImage.width - newX));
  newHeight = Math.max(10, Math.min(newHeight, currentImage.height - newY));
  cropRegion.x = newX;
  cropRegion.y = newY;
  cropRegion.width = newWidth;
  cropRegion.height = newHeight;
  updateCropInfo();
}
function updateTransform() {
  const transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  mainCanvas.style.transform = transform;
  mainCanvas.style.transformOrigin = "0 0";
  mainCanvas.style.willChange = "transform";
  cropOverlay.style.transform = transform;
  cropOverlay.style.transformOrigin = "0 0";
  cropOverlay.style.willChange = "transform";
  if (zoom >= 1) {
    mainCanvas.style.imageRendering = "pixelated";
  } else {
    mainCanvas.style.imageRendering = "smooth";
  }
  drawCropOverlay();
}
function redrawCanvas() {
  if (!currentImage) return;
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImage.data),
    currentImage.width,
    currentImage.height
  );
  ctx.putImageData(imageData, 0, 0);
  drawCropOverlay();
}
function drawCropOverlay() {
  if (!currentImage || !cropRegion) {
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    return;
  }
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  cropCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
  cropCtx.fillRect(0, 0, currentImage.width, currentImage.height);
  cropCtx.globalCompositeOperation = "destination-out";
  cropCtx.fillStyle = "rgba(0, 0, 0, 1)";
  cropCtx.fillRect(
    cropRegion.x,
    cropRegion.y,
    cropRegion.width,
    cropRegion.height
  );
  cropCtx.globalCompositeOperation = "source-over";
  cropCtx.strokeStyle = "#4f46e5";
  cropCtx.lineWidth = 3 / zoom;
  cropCtx.strokeRect(
    cropRegion.x,
    cropRegion.y,
    cropRegion.width,
    cropRegion.height
  );
  const handleSize = 10 / zoom;
  cropCtx.fillStyle = "#4f46e5";
  const cx = cropRegion.x;
  const cy = cropRegion.y;
  const cw = cropRegion.width;
  const ch = cropRegion.height;
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
async function startProcessing() {
  if (!currentImage) return;
  try {
    setMode("processing");
    processedImages.clear();
    processViewInitialized = false;
    let processImage = currentImage;
    if (cropRegion && cropRegion.width > 0 && cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(currentImage, cropRegion);
    }
    processedImages.set("cropped", processImage);
    displayProcessingStage("cropped");
    showStatus("Running cleanup (removing JPEG noise)...");
    const t1 = performance.now();
    const cleanupResults = await cleanupGPU(processImage);
    const t2 = performance.now();
    showStatus(`Cleanup: ${(t2 - t1).toFixed(1)}ms`);
    processedImages.set("value", cleanupResults.value);
    processedImages.set("saturation", cleanupResults.saturation);
    processedImages.set("saturation_median", cleanupResults.saturationMedian);
    processedImages.set("hue", cleanupResults.hue);
    processedImages.set("hue_median", cleanupResults.hueMedian);
    processedImages.set("cleanup", cleanupResults.final);
    displayProcessingStage("cleanup");
    showStatus("Palettizing...");
    const t3 = performance.now();
    const customPalette = buildPaletteRGBA();
    const palettized = await palettizeGPU(cleanupResults.final, customPalette);
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    processedImages.set("palettized", palettized);
    displayProcessingStage("palettized");
    showStatus("Applying median filter...");
    const t5 = performance.now();
    const median = await median3x3GPU(palettized);
    const t6 = performance.now();
    showStatus(`Median filter: ${(t6 - t5).toFixed(1)}ms`);
    processedImages.set("median", median);
    displayProcessingStage("median");
    showStatus("Extracting black...");
    const t7 = performance.now();
    const binary = extractBlack(median);
    const t8 = performance.now();
    showStatus(`Extract black: ${(t8 - t7).toFixed(1)}ms`);
    processedImages.set("binary", binary);
    displayProcessingStage("binary");
    const totalTime = t8 - t1;
    showStatus(`\u2713 Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
function displayProcessingStage(stage) {
  const image = processedImages.get(stage);
  if (!image) {
    showStatus(`Stage ${stage} not available`, true);
    return;
  }
  currentStage = stage;
  document.querySelectorAll(".stage-btn").forEach((btn) => btn.classList.remove("active"));
  const stageButtons = {
    cropped: stageCroppedBtn,
    value: stageValueBtn,
    saturation: stageSaturationBtn,
    saturation_median: stageSaturationMedianBtn,
    hue: stageHueBtn,
    hue_median: stageHueMedianBtn,
    cleanup: stageCleanupBtn,
    palettized: stagePalettizedBtn,
    median: stageMedianBtn,
    binary: stageBinaryBtn
  };
  stageButtons[stage]?.classList.add("active");
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
      const paletteOffset = colorIndex * 4;
      const pixelOffset = pixelIndex * 4;
      rgbaData[pixelOffset] = image.palette[paletteOffset];
      rgbaData[pixelOffset + 1] = image.palette[paletteOffset + 1];
      rgbaData[pixelOffset + 2] = image.palette[paletteOffset + 2];
      rgbaData[pixelOffset + 3] = image.palette[paletteOffset + 3];
    }
  } else if (image.data instanceof Uint8Array && image.data.length === image.width * image.height) {
    rgbaData = new Uint8ClampedArray(image.width * image.height * 4);
    for (let i = 0; i < image.data.length; i++) {
      const value = image.data[i] ? 0 : 255;
      const offset = i * 4;
      rgbaData[offset] = value;
      rgbaData[offset + 1] = value;
      rgbaData[offset + 2] = value;
      rgbaData[offset + 3] = 255;
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
  if (!processViewInitialized) {
    processFitToScreen();
    processViewInitialized = true;
  } else {
    updateProcessTransform();
  }
  showStatus(`Viewing: ${stage} (${image.width}\xD7${image.height})`);
}
function processFitToScreen() {
  const image = processedImages.get(currentStage);
  if (!image) return;
  const containerWidth = processCanvasContainer.clientWidth;
  const containerHeight = processCanvasContainer.clientHeight;
  const imageWidth = image.width;
  const imageHeight = image.height;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  processZoom = Math.min(scaleX, scaleY) * 0.9;
  processPanX = (containerWidth - imageWidth * processZoom) / 2;
  processPanY = (containerHeight - imageHeight * processZoom) / 2;
  updateProcessZoom();
  updateProcessTransform();
}
function updateProcessZoom() {
  processZoomLevel.textContent = `${Math.round(processZoom * 100)}%`;
}
function updateProcessTransform() {
  const transform = `translate(${processPanX}px, ${processPanY}px) scale(${processZoom})`;
  processCanvas.style.transform = transform;
  processCanvas.style.transformOrigin = "0 0";
  processCanvas.style.willChange = "transform";
  if (processZoom >= 1) {
    processCanvas.style.imageRendering = "pixelated";
  } else {
    processCanvas.style.imageRendering = "auto";
  }
}
function cropImage(image, region) {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.min(image.width - x, Math.floor(region.width));
  const height = Math.min(image.height - y, Math.floor(region.height));
  const croppedData = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const srcOffset = ((y + row) * image.width + x) * 4;
    const dstOffset = row * width * 4;
    croppedData.set(
      image.data.subarray(srcOffset, srcOffset + width * 4),
      dstOffset
    );
  }
  return { width, height, data: croppedData };
}
function generateThumbnail(image) {
  const maxSize = 128;
  const scale = Math.min(maxSize / image.width, maxSize / image.height);
  const thumbWidth = Math.floor(image.width * scale);
  const thumbHeight = Math.floor(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return "";
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
  ctx2.imageSmoothingEnabled = true;
  ctx2.imageSmoothingQuality = "high";
  ctx2.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);
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
  const filesGrid = uploadFileList.querySelector(".files-grid");
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-card";
    if (file.id === currentFileId) {
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
        if (file.id === currentFileId) {
          currentFileId = null;
          currentPdfData = null;
          currentImage = null;
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
  currentFileId = id;
  const data = new Uint8Array(stored.data);
  const blob = new Blob([data], { type: stored.type });
  const file = new File([blob], stored.name, { type: stored.type });
  await refreshFileList();
  await handleFileUpload(file);
}
function renderPaletteUI() {
  paletteList.innerHTML = "";
  userPalette.forEach((color, index) => {
    const entry = document.createElement("div");
    entry.className = "palette-entry";
    if (index === 0) entry.classList.add("background");
    const header = document.createElement("div");
    header.className = "palette-entry-header";
    const indexLabel = document.createElement("div");
    indexLabel.className = index === 0 ? "palette-index bg-index" : "palette-index";
    indexLabel.textContent = `${index}${index === 0 ? " (BG)" : ""}`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-color";
    removeBtn.textContent = "Remove";
    removeBtn.disabled = index === 0;
    removeBtn.onclick = () => {
      if (index !== 0) {
        userPalette.splice(index, 1);
        renderPaletteUI();
      }
    };
    header.appendChild(indexLabel);
    header.appendChild(removeBtn);
    entry.appendChild(header);
    const inputGroup = document.createElement("div");
    inputGroup.className = "color-picker-group";
    const inputLabel = document.createElement("label");
    inputLabel.textContent = "Input (matching):";
    inputGroup.appendChild(inputLabel);
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "color-picker-wrapper";
    const inputColorPicker = document.createElement("input");
    inputColorPicker.type = "color";
    inputColorPicker.value = color.inputColor;
    inputColorPicker.oninput = (e) => {
      const hex = e.target.value;
      userPalette[index].inputColor = hex;
      inputHex.value = hex;
    };
    const inputHex = document.createElement("input");
    inputHex.type = "text";
    inputHex.value = color.inputColor;
    inputHex.maxLength = 7;
    inputHex.oninput = (e) => {
      const hex = e.target.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        userPalette[index].inputColor = hex;
        inputColorPicker.value = hex;
      }
    };
    inputWrapper.appendChild(inputColorPicker);
    inputWrapper.appendChild(inputHex);
    inputGroup.appendChild(inputWrapper);
    entry.appendChild(inputGroup);
    const outputGroup = document.createElement("div");
    outputGroup.className = "color-picker-group";
    const outputLabel = document.createElement("label");
    outputLabel.textContent = "Output (display):";
    outputGroup.appendChild(outputLabel);
    const outputWrapper = document.createElement("div");
    outputWrapper.className = "color-picker-wrapper";
    const outputColorPicker = document.createElement("input");
    outputColorPicker.type = "color";
    outputColorPicker.value = color.outputColor;
    outputColorPicker.oninput = (e) => {
      const hex = e.target.value;
      userPalette[index].outputColor = hex;
      outputHex.value = hex;
    };
    const outputHex = document.createElement("input");
    outputHex.type = "text";
    outputHex.value = color.outputColor;
    outputHex.maxLength = 7;
    outputHex.oninput = (e) => {
      const hex = e.target.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        userPalette[index].outputColor = hex;
        outputColorPicker.value = hex;
      }
    };
    outputWrapper.appendChild(outputColorPicker);
    outputWrapper.appendChild(outputHex);
    outputGroup.appendChild(outputWrapper);
    entry.appendChild(outputGroup);
    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = color.mapToBg;
    checkbox.disabled = index === 0;
    checkbox.onchange = (e) => {
      userPalette[index].mapToBg = e.target.checked;
    };
    checkboxLabel.appendChild(checkbox);
    checkboxLabel.appendChild(document.createTextNode("Map to BG"));
    entry.appendChild(checkboxLabel);
    paletteList.appendChild(entry);
  });
}
function addPaletteColor() {
  if (userPalette.length >= 16) {
    showStatus("Maximum 16 colors allowed", true);
    return;
  }
  userPalette.push({
    inputColor: "#808080",
    outputColor: "#808080",
    mapToBg: false
  });
  renderPaletteUI();
}
function resetPaletteToDefault() {
  userPalette.length = 0;
  Array.from(DEFAULT_PALETTE).forEach((color) => {
    userPalette.push({
      inputColor: u32ToHex(color),
      outputColor: u32ToHex(color),
      mapToBg: false
    });
  });
  renderPaletteUI();
  showStatus("Palette reset to default");
}
function showColorHistogram() {
  if (!currentImage) {
    showStatus("No image loaded", true);
    return;
  }
  showStatus("\u23F3 Analyzing colors...");
  const quantize = (value) => Math.round(value / 64) * 64;
  const colorCounts = /* @__PURE__ */ new Map();
  const data = currentImage.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const qR = quantize(r);
    const qG = quantize(g);
    const qB = quantize(b);
    const key = `${qR},${qG},${qB}`;
    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
      existing.avgR += r;
      existing.avgG += g;
      existing.avgB += b;
      existing.samples++;
    } else {
      colorCounts.set(key, {
        count: 1,
        avgR: r,
        avgG: g,
        avgB: b,
        samples: 1
      });
    }
  }
  const buckets = Array.from(colorCounts.entries()).map(([_key, data2]) => {
    const avgR = Math.round(data2.avgR / data2.samples);
    const avgG = Math.round(data2.avgG / data2.samples);
    const avgB = Math.round(data2.avgB / data2.samples);
    const hex = `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`;
    return { hex, count: data2.count, r: avgR, g: avgG, b: avgB };
  });
  buckets.sort((a, b) => b.count - a.count);
  const backgroundHex = buckets.length > 0 ? buckets[0].hex : "#ffffff";
  const secondCount = buckets.length > 1 ? buckets[1].count : buckets[0].count;
  if (buckets.length > 0) {
    buckets[0].count = Math.min(buckets[0].count, secondCount);
  }
  const bgR = parseInt(backgroundHex.slice(1, 3), 16);
  const bgG = parseInt(backgroundHex.slice(3, 5), 16);
  const bgB = parseInt(backgroundHex.slice(5, 7), 16);
  const borderColor = `rgb(${255 - bgR}, ${255 - bgG}, ${255 - bgB})`;
  const rgbToHSV = (r, g, b) => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === rNorm) {
        h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) / 6;
      } else if (max === gNorm) {
        h = ((bNorm - rNorm) / delta + 2) / 6;
      } else {
        h = ((rNorm - gNorm) / delta + 4) / 6;
      }
    }
    const s = max === 0 ? 0 : delta / max;
    const v = max;
    return { h, s, v };
  };
  const grayscale = [];
  const chromatic = [];
  buckets.forEach((bucket) => {
    const { s } = rgbToHSV(bucket.r, bucket.g, bucket.b);
    if (s < 0.1) {
      grayscale.push(bucket);
    } else {
      chromatic.push(bucket);
    }
  });
  grayscale.sort((a, b) => {
    const { v: vA } = rgbToHSV(a.r, a.g, a.b);
    const { v: vB } = rgbToHSV(b.r, b.g, b.b);
    return vA - vB;
  });
  chromatic.sort((a, b) => {
    const hsvA = rgbToHSV(a.r, a.g, a.b);
    const hsvB = rgbToHSV(b.r, b.g, b.b);
    if (Math.abs(hsvA.h - hsvB.h) > 0.015) {
      return hsvA.h - hsvB.h;
    }
    if (Math.abs(hsvA.s - hsvB.s) > 0.05) {
      return hsvB.s - hsvA.s;
    }
    return hsvB.v - hsvA.v;
  });
  const allColorsSorted = [...chromatic, ...grayscale];
  const modal = document.getElementById("histogramModal");
  const body = document.getElementById("histogramBody");
  const total = currentImage.width * currentImage.height;
  body.style.backgroundColor = backgroundHex;
  const tiles = document.createElement("div");
  tiles.className = "histogram-tiles";
  const maxCount = Math.max(...allColorsSorted.map((b) => b.count));
  const minSize = 3;
  const maxSize = 120;
  allColorsSorted.forEach(({ hex, count }) => {
    const percent = count / total * 100;
    const sizeFactor = count / maxCount;
    const size = Math.max(minSize, sizeFactor * maxSize);
    const tile = document.createElement("div");
    tile.className = "color-tile";
    tile.style.backgroundColor = hex;
    tile.style.width = `${size}px`;
    tile.style.height = `${size}px`;
    tile.style.border = `1px solid ${borderColor}`;
    tile.title = `${hex.toUpperCase()} - ${percent.toFixed(3)}%`;
    const label = document.createElement("div");
    label.className = "color-tile-label";
    if (size > 20) {
      label.textContent = percent >= 1 ? `${percent.toFixed(1)}%` : `${percent.toFixed(2)}%`;
    }
    tile.appendChild(label);
    tile.onclick = () => {
      addColorToPalette(hex);
      modal.classList.remove("active");
      showStatus(`Added ${hex} (${percent.toFixed(2)}%) to palette`);
    };
    tiles.appendChild(tile);
  });
  body.innerHTML = "";
  body.appendChild(tiles);
  modal.classList.add("active");
  showStatus(`${allColorsSorted.length} colors (${chromatic.length} chromatic, ${grayscale.length} grayscale, bg: ${backgroundHex})`);
}
function addColorToPalette(hex) {
  if (userPalette.length >= 16) {
    showStatus("Maximum 16 colors - remove one first", true);
    return;
  }
  userPalette.push({
    inputColor: hex,
    outputColor: hex,
    mapToBg: false
  });
  renderPaletteUI();
  showStatus(`Added ${hex} to palette`);
}
var histogramModal = document.getElementById("histogramModal");
var closeHistogramBtn = document.getElementById("closeHistogramBtn");
closeHistogramBtn.addEventListener("click", () => {
  histogramModal.classList.remove("active");
});
histogramModal.addEventListener("click", (e) => {
  if (e.target === histogramModal) {
    histogramModal.classList.remove("active");
  }
});
function buildPaletteRGBA() {
  const palette = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < userPalette.length && i < 16; i++) {
    const color = userPalette[i];
    const useColor = color.mapToBg ? userPalette[0].outputColor : color.inputColor;
    const [r, g, b, a] = hexToRGBA(useColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  for (let i = userPalette.length; i < 16; i++) {
    const [r, g, b, a] = hexToRGBA(userPalette[0].outputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  return palette;
}
addPaletteColorBtn.addEventListener("click", addPaletteColor);
resetPaletteBtn.addEventListener("click", resetPaletteToDefault);
var showHistogramBtn = document.getElementById("showHistogramBtn");
showHistogramBtn.addEventListener("click", showColorHistogram);
renderPaletteUI();
