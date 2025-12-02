/**
 * WebGPU value channel processing
 * - Convert to 1-bit binary format
 * - Weighted 3x3 median filter (cardinal directions weighted 2x)
 * - Skeletonization/thinning
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

// Step 1: Weighted 3x3 median filter on packed binary data
// Cardinals (N/E/S/W) counted twice, diagonals once = 12 total samples
// Input/output: 1 = line (signal), 0 = background
const weightedMedianShader = `
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
`;// Step 2: Pure Zhang-Suen skeletonization algorithm
// Input/output: 1 = line (signal), 0 = background
const skeletonizeShader = `
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

// Helper: Convert packed binary to grayscale RGBA for visualization
// Input: 1 = line (black), 0 = background (white)
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
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let bit = (binary_in[word_idx] >> bit_idx) & 1u;
    
    // 1 = line (black), 0 = background (white)
    let gray = (1u - bit) * 255u;
    
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
    const binaryWordCount = Math.ceil(pixelCount / 32);  // Pack 32 pixels per u32
    const binaryByteSize = binaryWordCount * 4;
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
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    
    const binaryBuffer4 = device.createBuffer({
        size: binaryByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    
    // Create temporary buffer for intermediate pass results
    const binaryBufferTemp = device.createBuffer({
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
    
    // Create change counter buffer for convergence detection
    const changeCounterBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    
    // Create staging buffer for reading back the change counter
    const stagingBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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
    
    // Clear binary buffers (atomic operations require starting at 0)
    device.queue.writeBuffer(binaryBuffer2, 0, new Uint32Array(binaryWordCount));
    device.queue.writeBuffer(binaryBuffer3, 0, new Uint32Array(binaryWordCount));
    device.queue.writeBuffer(binaryBuffer4, 0, new Uint32Array(binaryWordCount));
    
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
    
    // Run up to 20 iterations, but exit early if converged
    let convergedIter = -1;
    for (let iter = 0; iter < 20; iter++) {
        const inputBuffer = (iter % 2 == 0) ? binaryBuffer3 : binaryBuffer4;
        const outputBuffer = (iter % 2 == 0) ? binaryBuffer4 : binaryBuffer3;
        
        // Clear temp buffer and output buffer, reset change counter
        device.queue.writeBuffer(binaryBufferTemp, 0, new Uint32Array(binaryWordCount));
        device.queue.writeBuffer(outputBuffer, 0, new Uint32Array(binaryWordCount));
        device.queue.writeBuffer(changeCounterBuffer, 0, new Uint32Array(1));
        
        // Pass 0 - first pass of Zhang-Suen: input → temp
        {
            const skeletonParams = new Uint32Array([width, height, 0, 0]);
            device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
            
            const bindGroup = device.createBindGroup({
                layout: skeletonPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: inputBuffer } },
                    { binding: 1, resource: { buffer: binaryBufferTemp } },
                    { binding: 2, resource: { buffer: skeletonParamsBuffer } },
                    { binding: 3, resource: { buffer: changeCounterBuffer } },
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
        
        // Pass 1 - second pass of Zhang-Suen: temp → output
        {
            const skeletonParams = new Uint32Array([width, height, 1, 0]);
            device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
            
            const bindGroup = device.createBindGroup({
                layout: skeletonPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: binaryBufferTemp } },
                    { binding: 1, resource: { buffer: outputBuffer } },
                    { binding: 2, resource: { buffer: skeletonParamsBuffer } },
                    { binding: 3, resource: { buffer: changeCounterBuffer } },
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
        
        // Check for convergence by reading the change counter
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
    
    // After iterations, result is in outputBuffer from the last iteration
    // Iter 0: input=buf3, output=buf4
    // Iter 1: input=buf4, output=buf3
    const finalIterCount = convergedIter === -1 ? 19 : convergedIter;
    const finalSkeletonBuffer = finalIterCount % 2 == 0 ? binaryBuffer4 : binaryBuffer3;
    
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
