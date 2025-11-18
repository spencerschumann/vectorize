/**
 * WebGPU white threshold operation
 * Converts near-white pixels to pure white
 */

import type { RGBAImage } from "../formats/rgba_image.ts";
import { getGPUContext, createGPUBuffer, readGPUBuffer } from "./gpu_context.ts";

const shaderCode = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
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
    
    // Read pixel from input
    let pixel = input[pixel_idx];
    
    // Extract RGBA bytes (little-endian: R is lowest byte)
    let r = (pixel & 0xFFu);
    let g = (pixel >> 8u) & 0xFFu;
    let b = (pixel >> 16u) & 0xFFu;
    let a = (pixel >> 24u) & 0xFFu;
    
    // Calculate average brightness
    let avg = (f32(r) + f32(g) + f32(b)) / (3.0 * 255.0);
    
    var out_r: u32;
    var out_g: u32;
    var out_b: u32;
    var out_a: u32;
    
    if (avg >= params.threshold) {
        // Set to pure white
        out_r = 255u;
        out_g = 255u;
        out_b = 255u;
        out_a = 255u;
    } else {
        // Keep original
        out_r = r;
        out_g = g;
        out_b = b;
        out_a = a;
    }
    
    // Pack back into u32
    output[pixel_idx] = out_r | (out_g << 8u) | (out_b << 16u) | (out_a << 24u);
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
    const byteSize = pixelCount * 4;
    
    console.log(`Image: ${width}x${height}, ${pixelCount} pixels, ${byteSize} bytes`);
    console.log(`Input data length: ${data.length}, byteLength: ${data.byteLength}`);
    
    // Data is RGBA format: 4 bytes per pixel = 1 u32 per pixel
    // Shader accesses as array<u32> where each u32 holds one RGBA pixel
    
    // Create GPU buffers (all sized in bytes)
    const inputBuffer = createGPUBuffer(
        device,
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    console.log(`Input buffer created: ${byteSize} bytes`);
    
    const outputBuffer = device.createBuffer({
        size: byteSize,  // Size in bytes (= pixelCount * 4)
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        mappedAtCreation: false,
    });
    console.log(`Output buffer created: ${byteSize} bytes`);
    
    // Create params buffer with proper types: u32, u32, f32, f32
    const paramsBuffer = device.createBuffer({
        size: 16, // 4 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Write width and height as u32, threshold and padding as f32
    const paramsArrayBuffer = new ArrayBuffer(16);
    const paramsU32View = new Uint32Array(paramsArrayBuffer);
    const paramsF32View = new Float32Array(paramsArrayBuffer);
    paramsU32View[0] = width;   // u32
    paramsU32View[1] = height;  // u32
    paramsF32View[2] = threshold; // f32
    paramsF32View[3] = 0;       // f32 padding
    
    device.queue.writeBuffer(paramsBuffer, 0, paramsArrayBuffer);
    
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
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    console.log(`Dispatching ${workgroupsX} x ${workgroupsY} workgroups for ${width}x${height} image`);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
    
    console.log("Submitted compute shader");
    
    // Wait for GPU to finish - this works in browsers but hangs in Deno
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
        console.log("Browser detected, using onSubmittedWorkDone()");
        await device.queue.onSubmittedWorkDone();
        console.log("GPU work completed");
    } else {
        console.log("Deno detected, using delay workaround");
        // WORKAROUND for Deno: Add delay since onSubmittedWorkDone() hangs
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Read back results
    const outputData = await readGPUBuffer(device, outputBuffer, byteSize);
    console.log(`Read back white threshold output data: ${outputData.length} bytes`);
    
    // Check first few pixels
    console.log(`First 10 u32 values from output: ${Array.from(new Uint32Array(outputData.buffer, 0, 10))}`);
    console.log(`First 10 RGBA pixels: ${Array.from(outputData.slice(0, 40))}`);
    
    // Check pixel at row 123 (first failing row) and row 124
    const row123Start = 123 * 6800 * 4;
    const row124Start = 124 * 6800 * 4;
    console.log(`Row 123 first 10 pixels: ${Array.from(outputData.slice(row123Start, row123Start + 40))}`);
    console.log(`Row 124 first 10 pixels: ${Array.from(outputData.slice(row124Start, row124Start + 40))}`);

    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();
    
    return {
        width,
        height,
        data: new Uint8ClampedArray(outputData.buffer, 0, byteSize),
    };
}
