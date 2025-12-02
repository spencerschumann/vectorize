/**
 * WebGPU black subtraction operation
 * Subtracts bloom-filtered black from RGBA image by setting black pixels to white
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import type { BinaryImage } from "../formats/binary.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

const shaderCode = `
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

/**
 * Subtract bloom-filtered black from RGBA image using WebGPU
 * Sets pixels to white where bloom mask is black (1)
 */
export async function subtractBlackGPU(
    image: RGBAImage,
    bloomFiltered: BinaryImage,
): Promise<RGBAImage> {
    if (image.width !== bloomFiltered.width || image.height !== bloomFiltered.height) {
        throw new Error("Image dimensions must match");
    }
    
    const { device } = await getGPUContext();
    const { width, height, data } = image;
    
    const pixelCount = width * height;
    
    // Convert RGBA to u32 array
    const inputU32 = new Uint32Array(pixelCount);
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < pixelCount; i++) {
        inputU32[i] = dataView.getUint32(i * 4, true);
    }
    
    // Convert binary image to u32 array
    const byteCount = bloomFiltered.data.length;
    const u32Count = Math.ceil(byteCount / 4);
    const maskU32 = new Uint32Array(u32Count);
    for (let i = 0; i < byteCount; i++) {
        const u32Idx = Math.floor(i / 4);
        const byteInU32 = i % 4;
        const shift = byteInU32 * 8;
        maskU32[u32Idx] |= (bloomFiltered.data[i] << shift);
    }
    
    // Create GPU buffers
    const inputBuffer = createGPUBuffer(
        device,
        new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const maskBuffer = createGPUBuffer(
        device,
        new Uint8Array(maskU32.buffer, maskU32.byteOffset, maskU32.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const outputBuffer = device.createBuffer({
        size: pixelCount * 4,
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
            { binding: 1, resource: { buffer: maskBuffer } },
            { binding: 2, resource: { buffer: outputBuffer } },
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
    
    // Read back results
    const resultBytes = await readGPUBuffer(device, outputBuffer, pixelCount * 4);
    const resultData = new Uint8ClampedArray(resultBytes);
    
    // Cleanup
    inputBuffer.destroy();
    maskBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: resultData,
    };
}
