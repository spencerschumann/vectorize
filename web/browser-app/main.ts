// Browser application entry point
import { BrowserCanvasBackend } from "../src/pdf/browser_canvas.ts";
import { renderPdfPage } from "../src/pdf/pdf_render.ts";

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");

// Initialize PDF.js
const pdfjsLib = window["pdfjsLib"];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js";

const backend = new BrowserCanvasBackend();

// Set up event listeners
dropZone?.addEventListener("click", () => fileInput?.click());

dropZone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    processPDF(files[0]);
  }
});

fileInput?.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    processPDF(files[0]);
  }
});

async function processPDF(file: File) {
  try {
    showStatus(`Processing: ${file.name}...`);

    const arrayBuffer = await file.arrayBuffer();

    const rgba = await renderPdfPage(
      {
        file: arrayBuffer,
        pageNumber: 1,
        scale: 2.0,
      },
      backend,
      pdfjsLib,
    );

    showStatus(`Rendered: ${rgba.width} x ${rgba.height} pixels`);

    // Display on canvas
    const ctx = (canvas as HTMLCanvasElement).getContext("2d");
    if (ctx) {
      (canvas as HTMLCanvasElement).width = rgba.width;
      (canvas as HTMLCanvasElement).height = rgba.height;
      
      const imageData = new ImageData(rgba.data, rgba.width, rgba.height);
      ctx.putImageData(imageData, 0, 0);
      
      canvas?.classList.remove("hidden");
    }

    console.log("PDF processed successfully");
    console.log("Image dimensions:", rgba.width, "x", rgba.height);
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, true);
    console.error("Error processing PDF:", error);
  }
}

function showStatus(message: string, isError = false) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.remove("hidden");
    statusEl.classList.toggle("error", isError);
  }
}
