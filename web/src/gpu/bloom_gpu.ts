/**
 * WebGPU bloom filter operation for binary images
 * For each pixel, if any pixel in its 3x3 neighborhood is black (1), set it to black
 */

import type { BinaryImage } from "../formats/binary.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

const shaderCode = `
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

/**
 * Apply 3x3 bloom filter to binary image using WebGPU
 * Sets a pixel to black (1) if any pixel in its 3x3 neighborhood is black
 */
export async function bloomFilter3x3GPU(image: BinaryImage): Promise<BinaryImage> {
    const { device } = await getGPUContext();
    const { width, height, data } = image;
    
    const pixelCount = width * height;
    const byteCount = Math.ceil(pixelCount / 8);
    
    // Convert to u32 array for GPU (pad to 4-byte alignment)
    const u32Count = Math.ceil(byteCount / 4);
    const inputU32 = new Uint32Array(u32Count);
    for (let i = 0; i < byteCount; i++) {
        const u32Idx = Math.floor(i / 4);
        const byteInU32 = i % 4;
        const shift = byteInU32 * 8;
        inputU32[u32Idx] |= (data[i] << shift);
    }
    
    // Create GPU buffers
    const inputBuffer = createGPUBuffer(
        device,
        new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const outputBuffer = device.createBuffer({
        size: u32Count * 4,
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
    const resultU32 = await readGPUBuffer(device, outputBuffer, u32Count * 4);
    const resultU32Array = new Uint32Array(resultU32.buffer);
    
    // Convert back to byte array
    const resultData = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) {
        const u32Idx = Math.floor(i / 4);
        const byteInU32 = i % 4;
        const shift = byteInU32 * 8;
        resultData[i] = (resultU32Array[u32Idx] >> shift) & 0xff;
    }
    
    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: resultData,
    };
}
