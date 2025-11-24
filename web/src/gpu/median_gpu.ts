/**
 * WebGPU 3x3 median filter operation
 * Operates on palettized images (4-bit per pixel)
 */

import type { PalettizedImage } from "../formats/palettized.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";
import { getPixelPal } from "../formats/palettized.ts";

const shaderCode = `
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

/**
 * Apply 3x3 median filter using WebGPU
 * Operates on palettized images
 */
export async function median3x3GPU(
    image: PalettizedImage,
): Promise<PalettizedImage> {
    const { device } = await getGPUContext();
    const { width, height, data, palette } = image;
    
    const pixelCount = width * height;
    
    // Unpack to u32 array (one pixel per u32 for easier GPU access)
    const unpacked = new Uint32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        unpacked[i] = getPixelPal(image, i % width, Math.floor(i / width));
    }
    
    // Create GPU buffers
    const inputBuffer = createGPUBuffer(
        device,
        new Uint8Array(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const outputBuffer = device.createBuffer({
        size: unpacked.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const paramsData = new Uint32Array([width, height]);
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
            { binding: 2, resource: { buffer: paramsBuffer } },
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
    
    // Read back results
    const outputData = await readGPUBuffer(device, outputBuffer, unpacked.byteLength);
    const outputU32 = new Uint32Array(outputData.buffer);
    
    // Pack back to 4-bit format
    const packedSize = Math.ceil(pixelCount / 2);
    const packed = new Uint8Array(packedSize);
    
    for (let i = 0; i < pixelCount; i++) {
        const byteIdx = Math.floor(i / 2);
        const isHighNibble = (i % 2) === 0;
        const paletteIdx = outputU32[i] & 0xF;
        
        if (isHighNibble) {
            packed[byteIdx] = (paletteIdx << 4);
        } else {
            packed[byteIdx] |= paletteIdx;
        }
    }
    
    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: packed,
        palette: palette ? new Uint32Array(palette) : undefined,
    };
}
