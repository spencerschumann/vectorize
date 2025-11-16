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
        palette: new Uint8ClampedArray(palette),
    };
}
