/**
 * WebGPU cleanup operation
 * Handles JPEG compression noise by processing channels separately:
 * 1. Calculate value (min(R,G,B)) for background vs lines
 * 2. Calculate saturation (max(R,G,B) - min(R,G,B))
 * 3. Threshold value at 50%
 * 4. Median filter on saturation (3x3)
 * 5. Extract hue and median filter it (3x3)
 * 6. Recombine into RGB
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

// Step 1: Extract value, saturation, and hue channels
const extractChannelsShader = `
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

// Step 2: Threshold value channel to binary (u32)
const thresholdShader = `
@group(0) @binding(0) var<storage, read> value_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> value_out: array<u32>;
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
    
    // Binary threshold: 1 = background (white), 0 = line (black)
    value_out[pixel_idx] = u32(value >= params.threshold);
}
`;

// Step 3: 3x3 Median filter for saturation and hue
const medianFilterShader = `
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

// Step 4: Recombine channels into RGB
const recombineShader = `
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
    
    let value = value_in[pixel_idx]; // Binary: 0 = line, 1 = background
    let saturation = saturation_in[pixel_idx]; // Cleaned saturation
    let hue = hue_in[pixel_idx]; // Cleaned hue
    
    // For background pixels (value = 1), output white
    // For line pixels (value = 0), reconstruct color from cleaned hue and saturation
    var rgb: vec3<f32>;
    if (value == 1u) {
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

// Helper: Convert single channel (f32) to grayscale RGBA
const channelToGrayscaleShader = `
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

// Helper: Convert binary u32 to grayscale RGBA
const binaryToGrayscaleShader = `
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
    let bit = input[pixel_idx];
    
    let gray = bit * 255u;  // 0=black, 1=white (255)
    output[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;

// Helper: Convert hue channel to RGB for visualization
const hueToRGBShader = `
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

export interface CleanupResults {
    value: RGBAImage;              // Thresholded value channel (visualized)
    saturation: RGBAImage;         // Raw saturation channel
    saturationMedian: RGBAImage;   // Median-filtered saturation
    hue: RGBAImage;                // Raw hue channel
    hueMedian: RGBAImage;          // Median-filtered hue
    final: RGBAImage;              // Final recombined result
    valueBuffer: GPUBuffer;        // Binary value buffer (u32 array: 0=line, 1=bg)
    saturationBuffer: GPUBuffer;   // Median-filtered saturation buffer (f32)
    hueBuffer: GPUBuffer;          // Median-filtered hue buffer (f32)
    width: number;
    height: number;
}

/**
 * Apply cleanup filter using multi-pass WebGPU pipeline
 * Returns all intermediate channel visualizations
 */
export async function cleanupGPU(image: RGBAImage): Promise<CleanupResults> {
    const { device } = await getGPUContext();
    const { width, height, data } = image;
    
    const pixelCount = width * height;
    const byteSize = pixelCount * 4;
    const floatByteSize = pixelCount * 4; // f32 arrays
    
    console.log(`Cleanup: ${width}x${height}, ${pixelCount} pixels, data.length=${data.length}, expected=${byteSize}`);
    
    // Create input buffer - data should be RGBA bytes (4 per pixel)
    // Shader will read as array<u32> where each u32 contains one RGBA pixel
    const inputBuffer = createGPUBuffer(
        device,
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    // Create channel buffers
    const valueBuffer1 = device.createBuffer({
        size: floatByteSize,  // f32
        usage: GPUBufferUsage.STORAGE,
    });
    
    const valueBuffer2 = device.createBuffer({
        size: byteSize,  // u32 - binary format
        usage: GPUBufferUsage.STORAGE,
    });
    
    const saturationBuffer1 = device.createBuffer({
        size: floatByteSize,  // f32
        usage: GPUBufferUsage.STORAGE,
    });
    
    const saturationBuffer2 = device.createBuffer({
        size: floatByteSize,
        usage: GPUBufferUsage.STORAGE,
    });
    
    const hueBuffer1 = device.createBuffer({
        size: floatByteSize,
        usage: GPUBufferUsage.STORAGE,
    });
    
    const hueBuffer2 = device.createBuffer({
        size: floatByteSize,
        usage: GPUBufferUsage.STORAGE,
    });
    
    const outputBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    // Create params buffers
    const extractParams = new Uint32Array([width, height]);
    const extractParamsBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(extractParamsBuffer, 0, extractParams);
    
    // Threshold params: u32 width, u32 height, f32 threshold, f32 padding
    const thresholdParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const thresholdParamsArray = new ArrayBuffer(16);
    const thresholdParamsU32 = new Uint32Array(thresholdParamsArray);
    const thresholdParamsF32 = new Float32Array(thresholdParamsArray);
    thresholdParamsU32[0] = width;   // u32
    thresholdParamsU32[1] = height;  // u32
    thresholdParamsF32[2] = 0.5;     // f32 threshold (50%)
    thresholdParamsF32[3] = 0.0;     // f32 padding
    device.queue.writeBuffer(thresholdParamsBuffer, 0, thresholdParamsArray);
    
    const medianParams = new Uint32Array([width, height]);
    const medianParamsBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(medianParamsBuffer, 0, medianParams);
    
    // Create shader modules
    const extractModule = device.createShaderModule({ code: extractChannelsShader });
    const thresholdModule = device.createShaderModule({ code: thresholdShader });
    const medianModule = device.createShaderModule({ code: medianFilterShader });
    const recombineModule = device.createShaderModule({ code: recombineShader });
    
    // Create pipelines
    const extractPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: extractModule, entryPoint: "main" },
    });
    
    const thresholdPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: thresholdModule, entryPoint: "main" },
    });
    
    const medianPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: medianModule, entryPoint: "main" },
    });
    
    const recombinePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: recombineModule, entryPoint: "main" },
    });
    
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    
    // Pass 1: Extract channels
    {
        const bindGroup = device.createBindGroup({
            layout: extractPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: inputBuffer } },
                { binding: 1, resource: { buffer: valueBuffer1 } },
                { binding: 2, resource: { buffer: saturationBuffer1 } },
                { binding: 3, resource: { buffer: hueBuffer1 } },
                { binding: 4, resource: { buffer: extractParamsBuffer } },
            ],
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
    
    // Pass 2: Threshold value channel
    {
        const bindGroup = device.createBindGroup({
            layout: thresholdPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: valueBuffer1 } },
                { binding: 1, resource: { buffer: valueBuffer2 } },
                { binding: 2, resource: { buffer: thresholdParamsBuffer } },
            ],
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
    
    // Pass 3: Median filter on saturation
    {
        const bindGroup = device.createBindGroup({
            layout: medianPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: saturationBuffer1 } },
                { binding: 1, resource: { buffer: saturationBuffer2 } },
                { binding: 2, resource: { buffer: medianParamsBuffer } },
            ],
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
    
    // Pass 4: Median filter on hue
    {
        const bindGroup = device.createBindGroup({
            layout: medianPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: hueBuffer1 } },
                { binding: 1, resource: { buffer: hueBuffer2 } },
                { binding: 2, resource: { buffer: medianParamsBuffer } },
            ],
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
    
    // Pass 5: Recombine channels
    {
        const bindGroup = device.createBindGroup({
            layout: recombinePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: valueBuffer2 } },
                { binding: 1, resource: { buffer: saturationBuffer2 } },
                { binding: 2, resource: { buffer: hueBuffer2 } },
                { binding: 3, resource: { buffer: outputBuffer } },
                { binding: 4, resource: { buffer: extractParamsBuffer } },
            ],
        });
        
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(recombinePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }
    
    // Wait for completion
    if (typeof window !== 'undefined') {
        await device.queue.onSubmittedWorkDone();
    } else {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Create visualization pipelines
    const grayscaleModule = device.createShaderModule({ code: channelToGrayscaleShader });
    const binaryModule = device.createShaderModule({ code: binaryToGrayscaleShader });
    const hueVisModule = device.createShaderModule({ code: hueToRGBShader });
    
    const grayscalePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: grayscaleModule, entryPoint: "main" },
    });
    
    const binaryPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: binaryModule, entryPoint: "main" },
    });
    
    const hueVisPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: hueVisModule, entryPoint: "main" },
    });
    
    // Create output buffers for visualizations
    const valueVisBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const saturationVisBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const saturationMedianVisBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const hueVisBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const hueMedianVisBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    // Visualize value channel (binary thresholded)
    {
        const bindGroup = device.createBindGroup({
            layout: binaryPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: valueBuffer2 } },
                { binding: 1, resource: { buffer: valueVisBuffer } },
                { binding: 2, resource: { buffer: extractParamsBuffer } },
            ],
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
    
    // Visualize saturation (raw)
    {
        const bindGroup = device.createBindGroup({
            layout: grayscalePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: saturationBuffer1 } },
                { binding: 1, resource: { buffer: saturationVisBuffer } },
                { binding: 2, resource: { buffer: extractParamsBuffer } },
            ],
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
    
    // Visualize saturation (median filtered)
    {
        const bindGroup = device.createBindGroup({
            layout: grayscalePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: saturationBuffer2 } },
                { binding: 1, resource: { buffer: saturationMedianVisBuffer } },
                { binding: 2, resource: { buffer: extractParamsBuffer } },
            ],
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
    
    // Visualize hue (raw)
    {
        const bindGroup = device.createBindGroup({
            layout: hueVisPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: hueBuffer1 } },
                { binding: 1, resource: { buffer: hueVisBuffer } },
                { binding: 2, resource: { buffer: extractParamsBuffer } },
            ],
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
    
    // Visualize hue (median filtered)
    {
        const bindGroup = device.createBindGroup({
            layout: hueVisPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: hueBuffer2 } },
                { binding: 1, resource: { buffer: hueMedianVisBuffer } },
                { binding: 2, resource: { buffer: extractParamsBuffer } },
            ],
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
    
    // Read back all results
    const [finalData, valueData, satData, satMedianData, hueData, hueMedianData] = await Promise.all([
        readGPUBuffer(device, outputBuffer, byteSize),
        readGPUBuffer(device, valueVisBuffer, byteSize),
        readGPUBuffer(device, saturationVisBuffer, byteSize),
        readGPUBuffer(device, saturationMedianVisBuffer, byteSize),
        readGPUBuffer(device, hueVisBuffer, byteSize),
        readGPUBuffer(device, hueMedianVisBuffer, byteSize),
    ]);
    
    console.log(`Cleanup complete: ${finalData.length} bytes`);
    
    // Cleanup buffers (keep valueBuffer2, saturationBuffer2, hueBuffer2 for further processing)
    inputBuffer.destroy();
    valueBuffer1.destroy();
    // valueBuffer2 kept - returned for value processing
    saturationBuffer1.destroy();
    // saturationBuffer2 kept - returned for recombination
    hueBuffer1.destroy();
    // hueBuffer2 kept - returned for recombination
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
            data: new Uint8ClampedArray(valueData.buffer, 0, byteSize),
        },
        saturation: {
            width,
            height,
            data: new Uint8ClampedArray(satData.buffer, 0, byteSize),
        },
        saturationMedian: {
            width,
            height,
            data: new Uint8ClampedArray(satMedianData.buffer, 0, byteSize),
        },
        hue: {
            width,
            height,
            data: new Uint8ClampedArray(hueData.buffer, 0, byteSize),
        },
        hueMedian: {
            width,
            height,
            data: new Uint8ClampedArray(hueMedianData.buffer, 0, byteSize),
        },
        final: {
            width,
            height,
            data: new Uint8ClampedArray(finalData.buffer, 0, byteSize),
        },
        valueBuffer: valueBuffer2,  // Don't destroy - pass to value processing
        saturationBuffer: saturationBuffer2,  // Don't destroy - pass to recombination
        hueBuffer: hueBuffer2,  // Don't destroy - pass to recombination
        width,
        height,
    };
}

/**
 * Recombine channels with a custom value buffer (e.g., skeletonized)
 * Uses the saturation and hue buffers from cleanup, but with processed value
 */
export async function recombineWithValue(
    valueBuffer: GPUBuffer,  // u32 binary buffer (0=line, 1=background)
    saturationBuffer: GPUBuffer,  // f32 buffer
    hueBuffer: GPUBuffer,  // f32 buffer
    width: number,
    height: number,
): Promise<RGBAImage> {
    const { device } = await getGPUContext();
    
    const pixelCount = width * height;
    const byteSize = pixelCount * 4;
    
    // Create output buffer
    const outputBuffer = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    // Create params buffer
    const paramsArray = new ArrayBuffer(8);
    const paramsU32 = new Uint32Array(paramsArray);
    paramsU32[0] = width;
    paramsU32[1] = height;
    
    const paramsBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
    
    // Create pipeline
    const recombineModule = device.createShaderModule({ code: recombineShader });
    const recombinePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: recombineModule, entryPoint: "main" },
    });
    
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    
    // Recombine
    const bindGroup = device.createBindGroup({
        layout: recombinePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: valueBuffer } },
            { binding: 1, resource: { buffer: saturationBuffer } },
            { binding: 2, resource: { buffer: hueBuffer } },
            { binding: 3, resource: { buffer: outputBuffer } },
            { binding: 4, resource: { buffer: paramsBuffer } },
        ],
    });
    
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(recombinePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    
    // Read result
    const finalData = await readGPUBuffer(device, outputBuffer, byteSize);
    
    // Cleanup
    outputBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: new Uint8ClampedArray(finalData.buffer, 0, byteSize),
    };
}
