/**
 * WebGPU context management
 * Shared between browser and Deno
 */

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
        
        cachedContext = { device, adapter };
        isInitializing = false;
        return cachedContext;
    })();

    return initPromise;
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
