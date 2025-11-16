/**
 * WebGPU white threshold operation
 * Converts near-white pixels to pure white
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

const shaderCode = `
@group(0) @binding(0) var<storage, read> input: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
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
    
    let idx = y * params.width + x;
    let pixel = input[idx];
    
    // Check if pixel is above threshold (near-white)
    let avg = (pixel.r + pixel.g + pixel.b) / 3.0;
    
    var out_pixel: vec4<f32>;
    if (avg >= params.threshold) {
        // Set to pure white
        out_pixel = vec4<f32>(1.0, 1.0, 1.0, 1.0);
    } else {
        // Keep original
        out_pixel = pixel;
    }
    
    output[idx] = out_pixel;
}
`;

/**
 * Apply white threshold using WebGPU
 * Pixels above threshold (e.g. 0.85) are set to pure white
 */
export async function whiteThresholdGPU(
    image: RGBAImage,
    threshold: number = 0.85,
): Promise<RGBAImage> {
    const { device } = await getGPUContext();
    const { width, height, data } = image;
    
    const pixelCount = width * height;
    
    // Convert Uint8ClampedArray to Float32Array (0-1 range)
    const inputFloat = new Float32Array(pixelCount * 4);
    for (let i = 0; i < data.length; i++) {
        inputFloat[i] = data[i] / 255.0;
    }
    
    // Create GPU buffers
    const inputBuffer = createGPUBuffer(
        device,
        inputFloat,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    
    const outputBuffer = device.createBuffer({
        size: inputFloat.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    const paramsData = new Float32Array([width, height, threshold, 0]); // 0 is padding
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
    const outputData = await readGPUBuffer(device, outputBuffer, inputFloat.byteLength);
    const outputFloat = new Float32Array(outputData.buffer);
    
    // Convert back to Uint8ClampedArray
    const result = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < outputFloat.length; i++) {
        result[i] = Math.round(outputFloat[i] * 255);
    }
    
    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: result,
    };
}
