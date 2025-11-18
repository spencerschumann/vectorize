/**
 * Load image from File object in browser
 */

import type { RGBAImage } from "../formats/rgba_image.ts";

export function loadImageFromFile(file: File): Promise<RGBAImage> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            // Create canvas to extract pixel data
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("Could not get 2D context"));
                return;
            }
            
            // Draw image
            ctx.drawImage(img, 0, 0);
            
            // Extract pixel data
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            
            resolve({
                width: img.width,
                height: img.height,
                data: new Uint8ClampedArray(imageData.data),
            });
            
            // Clean up
            URL.revokeObjectURL(img.src);
        };
        
        img.onerror = () => {
            reject(new Error("Failed to load image"));
            URL.revokeObjectURL(img.src);
        };
        
        // Create object URL and load
        img.src = URL.createObjectURL(file);
    });
}
