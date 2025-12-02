/**
 * WebGPU palettization operation
 * Quantizes RGBA image to nearest colors in palette
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import type { PalettizedImage } from "../formats/palettized.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

const shaderCode = `
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

/**
 * Palettize RGBA image using WebGPU
 * Returns palettized image with 4 bits per pixel
 */
export async function palettizeGPU(
    image: RGBAImage,
    palette: Uint8ClampedArray, // RGBA palette, length = paletteSize * 4
): Promise<PalettizedImage> {
    const { device } = await getGPUContext();
    const { width, height, data } = image;
    
    const paletteSize = palette.length / 4;
    if (paletteSize !== 16) {
        throw new Error("GPU palettization currently only supports 16-color palettes");
    }
    
    // Convert RGBA bytes to u32 arrays - must copy to ensure alignment
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
    
    // Create GPU buffers
    const inputBuffer = createGPUBuffer(
        device,
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const outputBuffer = device.createBuffer({
        size: pixelCount * 4, // Temporary: one u32 per pixel
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const paletteBuffer = createGPUBuffer(
        device,
        new Uint8Array(paletteU32.buffer, paletteU32.byteOffset, paletteU32.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const paramsData = new Uint32Array([width, height, paletteSize, 0]);
    const paramsBuffer = createGPUBuffer(
        device,
        paramsData,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    
    // Create shader module and pipeline
    const shaderModule = device.createShaderModule({ code: shaderCode });
    
    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });
    
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
            { binding: 1, resource: { buffer: outputBuffer } },
            { binding: 2, resource: { buffer: paletteBuffer } },
            { binding: 3, resource: { buffer: paramsBuffer } },
        ],
    });
    
    // Execute compute shader
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(
        Math.ceil(width / 8),
        Math.ceil(height / 8),
    );
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
    
    // Read back results (unpacked indices)
    const indices = await readGPUBuffer(device, outputBuffer, pixelCount * 4);
    const indicesU32 = new Uint32Array(indices.buffer);
    
    // Pack 2 pixels per byte (4 bits each)
    const packedSize = Math.ceil(pixelCount / 2);
    const packed = new Uint8Array(packedSize);
    
    for (let i = 0; i < pixelCount; i++) {
        const byteIdx = Math.floor(i / 2);
        const isHighNibble = (i % 2) === 0;
        const paletteIdx = indicesU32[i] & 0xF;
        
        if (isHighNibble) {
            packed[byteIdx] = (paletteIdx << 4);
        } else {
            packed[byteIdx] |= paletteIdx;
        }
    }
    
    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    paletteBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: packed,
        palette: new Uint32Array(palette),
    };
}
