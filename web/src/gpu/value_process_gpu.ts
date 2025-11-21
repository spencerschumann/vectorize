/**
 * WebGPU value channel processing
 * - Convert to 1-bit binary format
 * - Weighted 3x3 median filter (cardinal directions weighted 2x)
 * - Skeletonization/thinning
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

// Step 1: Convert grayscale value channel to unpacked binary (u32 per pixel)
const valueToBinaryShader = `
@group(0) @binding(0) var<storage, read> value_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> binary_out: array<u32>;
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
    let value = value_in[pixel_idx];
    
    // Convert to 1-bit: 1 = background (white), 0 = line (black)
    // Store unpacked (one u32 per pixel for now - will pack later if needed)
    binary_out[pixel_idx] = u32(value >= 0.5);
}
`;

// Step 2: Weighted 3x3 median filter on unpacked binary data
// Cardinals (N/E/S/W) counted twice, diagonals once = 12 total samples
const weightedMedianShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn get_bit(data: ptr<storage, array<u32>, read>, x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 1u; // Background outside bounds
    }
    let pixel_idx = y * w + x;
    return (*data)[pixel_idx];
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
    
    // Gather 3x3 neighborhood with cardinal directions weighted 2x
    var sum = 0u;
    
    // Corners (1x each) = 4 samples
    sum += get_bit(&input, max(x, 1u) - 1u, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), min(y + 1u, h - 1u), w, h);
    
    // Cardinals (2x each) = 8 samples
    let north = get_bit(&input, x, max(y, 1u) - 1u, w, h);
    let south = get_bit(&input, x, min(y + 1u, h - 1u), w, h);
    let west = get_bit(&input, max(x, 1u) - 1u, y, w, h);
    let east = get_bit(&input, min(x + 1u, w - 1u), y, w, h);
    sum += north * 2u;
    sum += south * 2u;
    sum += west * 2u;
    sum += east * 2u;
    
    // Center = 0 samples (not included in median calculation)
    
    // Total: 12 samples, median is at position 6 (>= 6 means set to 1)
    let median_bit = u32(sum >= 6u);
    
    let pixel_idx = y * w + x;
    output[pixel_idx] = median_bit;
}
`;

// Step 3: Zhang-Suen skeletonization (one iteration)
// This is a thinning algorithm that preserves connectivity
const skeletonizeShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    iteration: u32,  // 0 or 1 for two-pass algorithm
    _padding: u32,
}

fn get_bit(data: ptr<storage, array<u32>, read>, x: i32, y: i32, w: u32, h: u32) -> u32 {
    if (x < 0 || y < 0 || x >= i32(w) || y >= i32(h)) {
        return 1u; // Background outside bounds
    }
    let pixel_idx = u32(y) * w + u32(x);
    return (*data)[pixel_idx];
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
    
    // Get center pixel (0 = line, 1 = background)
    let center = get_bit(&input, x, y, w, h);
    
    // Only process line pixels
    if (center == 1u) {
        // Keep background as-is
        let pixel_idx = u32(y) * w + u32(x);
        output[pixel_idx] = 1u;
        return;
    }
    
    // Get 8-neighborhood (using standard labeling)
    // P9 P2 P3
    // P8 P1 P4
    // P7 P6 P5
    let p2 = get_bit(&input, x,     y - 1, w, h);
    let p3 = get_bit(&input, x + 1, y - 1, w, h);
    let p4 = get_bit(&input, x + 1, y,     w, h);
    let p5 = get_bit(&input, x + 1, y + 1, w, h);
    let p6 = get_bit(&input, x,     y + 1, w, h);
    let p7 = get_bit(&input, x - 1, y + 1, w, h);
    let p8 = get_bit(&input, x - 1, y,     w, h);
    let p9 = get_bit(&input, x - 1, y - 1, w, h);
    
    // Count black neighbors (0 = line)
    let black_neighbors = (1u - p2) + (1u - p3) + (1u - p4) + (1u - p5) + 
                          (1u - p6) + (1u - p7) + (1u - p8) + (1u - p9);
    
    // Count transitions from white to black (0->1 in circular order)
    var transitions = 0u;
    if (p2 == 1u && p3 == 0u) { transitions += 1u; }
    if (p3 == 1u && p4 == 0u) { transitions += 1u; }
    if (p4 == 1u && p5 == 0u) { transitions += 1u; }
    if (p5 == 1u && p6 == 0u) { transitions += 1u; }
    if (p6 == 1u && p7 == 0u) { transitions += 1u; }
    if (p7 == 1u && p8 == 0u) { transitions += 1u; }
    if (p8 == 1u && p9 == 0u) { transitions += 1u; }
    if (p9 == 1u && p2 == 0u) { transitions += 1u; }
    
    // Zhang-Suen conditions
    var should_delete = false;
    
    // Common conditions for both iterations
    if (black_neighbors >= 2u && black_neighbors <= 6u && transitions == 1u) {
        if (params.iteration == 0u) {
            // Iteration 1: Check P2 * P4 * P6 = 0 and P4 * P6 * P8 = 0
            if ((p2 * p4 * p6) == 0u && (p4 * p6 * p8) == 0u) {
                should_delete = true;
            }
        } else {
            // Iteration 2: Check P2 * P4 * P8 = 0 and P2 * P6 * P8 = 0
            if ((p2 * p4 * p8) == 0u && (p2 * p6 * p8) == 0u) {
                should_delete = true;
            }
        }
    }
    
    let output_bit = select(0u, 1u, should_delete); // Delete = set to white (1)
    
    let pixel_idx = u32(y) * w + u32(x);
    output[pixel_idx] = output_bit;
}
`;

// Helper: Convert binary back to grayscale RGBA for visualization
const binaryToRGBAShader = `
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
    let bit = binary_in[pixel_idx]; // Unpacked: 0 or 1
    let gray = bit * 255u; // 1 = white (255), 0 = black (0)
    
    rgba_out[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;

export interface ValueProcessResults {
    median: RGBAImage;           // After weighted median filter
    skeleton: RGBAImage;         // After skeletonization
    skeletonBuffer: GPUBuffer;   // Binary skeleton buffer (u32: 0=line, 1=background)
}

/**
 * Process value channel: weighted median, skeletonization
 * Input valueBuffer is already binary (u32: 0=line, 1=background)
 */
export async function processValueChannel(
    valueBuffer: GPUBuffer,  // u32 array (binary) from cleanup
    width: number,
    height: number,
): Promise<ValueProcessResults> {
    const { device } = await getGPUContext();
    
    const pixelCount = width * height;
    const binaryByteSize = pixelCount * 4;  // u32 per pixel (unpacked)
    const rgbaByteSize = pixelCount * 4;
    
    console.log(`Value processing: ${width}x${height}`);
    
    // Create binary buffers (unpacked: u32 per pixel)
    // Input valueBuffer is already binary, use it directly
    
    const binaryBuffer2 = device.createBuffer({
        size: binaryByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    
    const binaryBuffer3 = device.createBuffer({
        size: binaryByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    const binaryBuffer4 = device.createBuffer({
        size: binaryByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    // Create RGBA output buffers for visualization
    const rgbaBuffer1 = device.createBuffer({
        size: rgbaByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const rgbaBuffer2 = device.createBuffer({
        size: rgbaByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    // Create params buffer
    const params = new Uint32Array([width, height]);
    const paramsBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramsBuffer, 0, params);
    
    // Create skeleton params buffer (with iteration field)
    const skeletonParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Create shader modules
    const medianModule = device.createShaderModule({ code: weightedMedianShader });
    const skeletonModule = device.createShaderModule({ code: skeletonizeShader });
    const toRGBAModule = device.createShaderModule({ code: binaryToRGBAShader });
    
    // Create pipelines
    const medianPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: medianModule, entryPoint: "main" },
    });    const skeletonPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: skeletonModule, entryPoint: "main" },
    });
    
    const toRGBAPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: toRGBAModule, entryPoint: "main" },
    });
    
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    
    // Clear binary buffers
    device.queue.writeBuffer(binaryBuffer2, 0, new Uint32Array(pixelCount));
    device.queue.writeBuffer(binaryBuffer3, 0, new Uint32Array(pixelCount));
    device.queue.writeBuffer(binaryBuffer4, 0, new Uint32Array(pixelCount));
    
    // Pass 1: Weighted median filter (input is valueBuffer - already binary)
    {
        const bindGroup = device.createBindGroup({
            layout: medianPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: valueBuffer } },
                { binding: 1, resource: { buffer: binaryBuffer2 } },
                { binding: 2, resource: { buffer: paramsBuffer } },
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
    
    // Pass 2: Skeletonization (Zhang-Suen algorithm - needs multiple iterations)
    // Start from binaryBuffer2 (median output), copy to binaryBuffer3, then ping-pong between 3 and 4
    // Run 4 iterations (2 passes each)
    
    // First, copy median result to binaryBuffer3 so we don't modify binaryBuffer2
    {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(binaryBuffer2, 0, binaryBuffer3, 0, binaryByteSize);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
    }
    
    for (let iter = 0; iter < 4; iter++) {
        const inputBuffer = (iter % 2 == 0) ? binaryBuffer3 : binaryBuffer4;
        const outputBuffer = (iter % 2 == 0) ? binaryBuffer4 : binaryBuffer3;
        
        // Clear output buffer
        device.queue.writeBuffer(outputBuffer, 0, new Uint32Array(pixelCount));
        
        // Iteration 0 (even)
        {
            const skeletonParams = new Uint32Array([width, height, 0, 0]);
            device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
            
            const bindGroup = device.createBindGroup({
                layout: skeletonPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: inputBuffer } },
                    { binding: 1, resource: { buffer: outputBuffer } },
                    { binding: 2, resource: { buffer: skeletonParamsBuffer } },
                ],
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
        
        // Clear temp buffer for next iteration's second pass
        const nextTempBuffer = (iter % 2 == 0) ? binaryBuffer3 : binaryBuffer4;
        device.queue.writeBuffer(nextTempBuffer, 0, new Uint32Array(pixelCount));
        
        // Iteration 1 (odd)
        {
            const skeletonParams = new Uint32Array([width, height, 1, 0]);
            device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
            
            const bindGroup = device.createBindGroup({
                layout: skeletonPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: outputBuffer } },
                    { binding: 1, resource: { buffer: nextTempBuffer } },
                    { binding: 2, resource: { buffer: skeletonParamsBuffer } },
                ],
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
    }
    
    // After 4 iterations with ping-pong: iter 0->buf4, iter 1->buf3, iter 2->buf4, iter 3->buf3
    const finalSkeletonBuffer = binaryBuffer3;
    
    // Convert binary stages to RGBA for visualization
    // Median stage (binaryBuffer2 preserved from Pass 1)
    {
        const bindGroup = device.createBindGroup({
            layout: toRGBAPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: binaryBuffer2 } },
                { binding: 1, resource: { buffer: rgbaBuffer1 } },
                { binding: 2, resource: { buffer: paramsBuffer } },
            ],
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
    
    // Skeleton stage
    {
        const bindGroup = device.createBindGroup({
            layout: toRGBAPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: finalSkeletonBuffer } },
                { binding: 1, resource: { buffer: rgbaBuffer2 } },
                { binding: 2, resource: { buffer: paramsBuffer } },
            ],
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
    
    // Read back results
    const [medianData, skeletonData] = await Promise.all([
        readGPUBuffer(device, rgbaBuffer1, rgbaByteSize),
        readGPUBuffer(device, rgbaBuffer2, rgbaByteSize),
    ]);
    
    console.log(`Value processing complete`);
    
    // Cleanup (keep binaryBuffer3 (finalSkeletonBuffer) for recombination)
    binaryBuffer2.destroy();
    // binaryBuffer3 (finalSkeletonBuffer) kept - returned for recombination
    binaryBuffer4.destroy();
    rgbaBuffer1.destroy();
    rgbaBuffer2.destroy();
    paramsBuffer.destroy();
    skeletonParamsBuffer.destroy();
    
    return {
        median: {
            width,
            height,
            data: new Uint8ClampedArray(medianData.buffer, 0, rgbaByteSize),
        },
        skeleton: {
            width,
            height,
            data: new Uint8ClampedArray(skeletonData.buffer, 0, rgbaByteSize),
        },
        skeletonBuffer: finalSkeletonBuffer,  // Don't destroy - pass to recombination
    };
}
