/**
 * WebGPU context management
 * Shared between browser and Deno
 */

// Extend Navigator interface for WebGPU support
declare global {
    interface Navigator {
        gpu?: GPU;
    }
}

export interface GPUContext {
    device: GPUDevice;
    adapter: GPUAdapter;
}

let cachedContext: GPUContext | null = null;
let isInitializing = false;
let initPromise: Promise<GPUContext> | null = null;

/**
 * Initialize WebGPU context (works in both browser and Deno)
 * Caches context and pipelines for reuse
 */
export async function getGPUContext(): Promise<GPUContext> {
    if (cachedContext) {
        return cachedContext;
    }

    // Prevent multiple simultaneous initializations
    if (isInitializing && initPromise) {
        return initPromise;
    }

    isInitializing = true;
    initPromise = (async () => {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported in this environment");
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No WebGPU adapter found");
        }

        const device = await adapter.requestDevice();
        
        // Set up error handling
        device.addEventListener('uncapturederror', (event: Event) => {
            const gpuEvent = event as GPUUncapturedErrorEvent;
            console.error('WebGPU uncaptured error:');
            console.error('  Type:', gpuEvent.error.constructor.name);
            console.error('  Message:', gpuEvent.error.message);
            console.error('  Full error:', gpuEvent.error);
        });
        
        // Log adapter limits for debugging
        console.log("WebGPU Adapter Limits:");
        console.log(`  maxStorageBufferBindingSize: ${adapter.limits.maxStorageBufferBindingSize}`);
        console.log(`  maxBufferSize: ${adapter.limits.maxBufferSize}`);
        console.log(`  maxComputeWorkgroupStorageSize: ${adapter.limits.maxComputeWorkgroupStorageSize}`);
        console.log(`  maxComputeInvocationsPerWorkgroup: ${adapter.limits.maxComputeInvocationsPerWorkgroup}`);
        console.log(`  maxComputeWorkgroupsPerDimension: ${adapter.limits.maxComputeWorkgroupsPerDimension}`);
        console.log(`  maxComputeWorkgroupSizeX: ${adapter.limits.maxComputeWorkgroupSizeX}`);
        console.log(`  maxComputeWorkgroupSizeY: ${adapter.limits.maxComputeWorkgroupSizeY}`);
        console.log(`  maxComputeWorkgroupSizeZ: ${adapter.limits.maxComputeWorkgroupSizeZ}`);
        
        cachedContext = { device, adapter };
        isInitializing = false;
        return cachedContext;
    })();

    return await initPromise;
}

/**
 * Create a GPU buffer from typed array data
 */
export function createGPUBuffer(
    device: GPUDevice,
    data: Uint8Array | Uint32Array | Float32Array,
    usage: GPUBufferUsageFlags,
): GPUBuffer {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage,
        mappedAtCreation: true,
    });
    
    const arrayBuffer = buffer.getMappedRange();
    if (data instanceof Uint8Array) {
        new Uint8Array(arrayBuffer).set(data);
    } else if (data instanceof Uint32Array) {
        new Uint32Array(arrayBuffer).set(data);
    } else {
        new Float32Array(arrayBuffer).set(data);
    }
    buffer.unmap();
    
    return buffer;
}

/**
 * Read data back from GPU buffer
 */
export async function readGPUBuffer(
    device: GPUDevice,
    buffer: GPUBuffer,
    size: number,
): Promise<Uint8Array> {
    const readBuffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
    device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(readBuffer.getMappedRange()).slice();
    readBuffer.unmap();
    readBuffer.destroy();

    return data;
}
