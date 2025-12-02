/**
 * WebGPU black pixel extraction operation
 * Extracts black pixels from RGBA image based on luminosity threshold
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import type { BinaryImage } from "../formats/binary.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

const shaderCode = `
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

/**
 * Extract black pixels from RGBA image using WebGPU
 * Pixels with luminosity below threshold are marked as black (1)
 */
export async function extractBlackGPU(
    image: RGBAImage,
    luminosityThreshold: number = 0.20,
): Promise<BinaryImage> {
    const { device } = await getGPUContext();
    const { width, height, data } = image;
    
    const pixelCount = width * height;
    
    // Convert RGBA to u32 array
    const inputU32 = new Uint32Array(pixelCount);
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < pixelCount; i++) {
        inputU32[i] = dataView.getUint32(i * 4, true);
    }
    
    // Create output buffer for bit-packed binary image
    const byteCount = Math.ceil(pixelCount / 8);
    const u32Count = Math.ceil(byteCount / 4);
    
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
    
    // Create params buffer with proper types: u32, u32, f32, padding
    const paramsArray = new ArrayBuffer(16); // 3 values + padding
    const paramsU32 = new Uint32Array(paramsArray);
    const paramsF32 = new Float32Array(paramsArray);
    paramsU32[0] = width;  // u32
    paramsU32[1] = height; // u32
    paramsF32[2] = luminosityThreshold; // f32
    
    const paramsBuffer = createGPUBuffer(
        device,
        new Uint8Array(paramsArray),
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
