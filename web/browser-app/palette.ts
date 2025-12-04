/**
 * Palette management and color editor
 */

import { DEFAULT_PALETTE } from "../src/formats/palettized.ts";
import { u32ToHex, hexToRGBA } from "./utils.ts";
import { state } from "./state.ts";
import { updateFile } from "./storage.ts";

// Local state for color editor
let colorEditorIndex: number | null = null;
let eyedropperMode: 'input' | 'output' | null = null;
let eyedropperActive = false;

// Callbacks that must be provided by main.ts
let showStatusCallback: (msg: string, isError?: boolean) => void = () => {};
let mainCanvasRef: HTMLCanvasElement | null = null;

// Auto-save palette to the current file's storage
async function autosavePaletteToFile() {
  if (state.currentFileId) {
    try {
      const palette = JSON.stringify(state.userPalette);
      await updateFile(state.currentFileId, { palette });
      console.log("Auto-saved palette to file storage");
    } catch (err) {
      console.error("Failed to auto-save palette:", err);
    }
  }
}

export function initPaletteModule(callbacks: {
  showStatus: (msg: string, isError?: boolean) => void;
  mainCanvas: HTMLCanvasElement;
}) {
  showStatusCallback = callbacks.showStatus;
  mainCanvasRef = callbacks.mainCanvas;
}

// IndexedDB for palette storage
export function initPaletteDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PalettesDB", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("palettes")) {
        db.createObjectStore("palettes", { keyPath: "name" });
      }
    };
  });
}

export async function savePalette(name: string) {
  if (!name || name.trim() === "") {
    showStatusCallback("Please enter a palette name", true);
    return;
  }
  
  try {
    const db = await initPaletteDB();
    const transaction = db.transaction(["palettes"], "readwrite");
    const store = transaction.objectStore("palettes");
    
    await store.put({
      name: name.trim(),
      palette: JSON.parse(JSON.stringify(state.userPalette)),
      timestamp: Date.now(),
    });
    
    showStatusCallback(`✓ Palette "${name.trim()}" saved`);
  } catch (error) {
    showStatusCallback(`Error saving palette: ${error}`, true);
  }
}

export async function loadPalette(name?: string) {
  try {
    const db = await initPaletteDB();
    const transaction = db.transaction(["palettes"], "readonly");
    const store = transaction.objectStore("palettes");
    
    if (name) {
      const request = store.get(name);
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          if (request.result) {
            state.userPalette.length = 0;
            state.userPalette.push(...request.result.palette);
            state.currentPaletteName = name;
            renderPaletteUI();
            showStatusCallback(`✓ Loaded palette "${name}"`);
            resolve(request.result);
          } else {
            showStatusCallback(`Palette "${name}" not found`, true);
            reject(new Error("Not found"));
          }
        };
        request.onerror = () => reject(request.error);
      });
    } else {
      // List all palettes for selection
      const allRequest = store.getAll();
      return new Promise((resolve, reject) => {
        allRequest.onsuccess = () => {
          const palettes = allRequest.result;
          if (palettes.length === 0) {
            showStatusCallback("No saved palettes", true);
            resolve([]);
            return;
          }
          
          // Create selection dialog
          const names = palettes.map((p: { name: string }) => p.name).join("\n");
          const selected = prompt(`Available palettes:\n${names}\n\nEnter name to load:`);
          
          if (selected && palettes.some((p: { name: string }) => p.name === selected)) {
            loadPalette(selected);
          }
          resolve(palettes);
        };
        allRequest.onerror = () => reject(allRequest.error);
      });
    }
  } catch (error) {
    showStatusCallback(`Error loading palette: ${error}`, true);
  }
}

export async function setDefaultPalette() {
  const name = state.currentPaletteName || prompt("Enter name for this palette:");
  if (!name) return;
  
  localStorage.setItem("defaultPalette", name);
  await savePalette(name);
  showStatusCallback(`✓ Set "${name}" as default palette`);
}

export async function loadDefaultPalette() {
  const defaultName = localStorage.getItem("defaultPalette");
  if (defaultName) {
    try {
      await loadPalette(defaultName);
      showStatusCallback(`✓ Loaded default palette "${defaultName}"`);
    } catch {
      showStatusCallback("Default palette not found", true);
    }
  }
}

export function renderPaletteUI() {
  const paletteDisplay = document.getElementById("paletteDisplay") as HTMLDivElement;
  if (!paletteDisplay) {
    console.error("paletteDisplay not found in DOM!");
    return;
  }
  paletteDisplay.innerHTML = "";
  
  state.userPalette.forEach((color, index) => {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-bottom: 1px solid #3a3a3a; cursor: pointer; transition: background 0.2s;";
    item.onmouseover = () => item.style.background = "#333";
    item.onmouseout = () => item.style.background = "transparent";
    item.onclick = () => openColorEditor(index);
    
    // Input color swatch
    const inputSwatch = document.createElement("div");
    inputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.inputColor}; flex-shrink: 0;`;
    item.appendChild(inputSwatch);
    
    // Status indicator and output
    if (color.mapToBg) {
      const statusIcon = document.createElement("span");
      statusIcon.textContent = "✕";
      statusIcon.style.cssText = "font-size: 0.9rem; color: #ef4444; flex-shrink: 0; width: 16px; text-align: center;";
      statusIcon.title = "Remove";
      item.appendChild(statusIcon);
    } else if (color.inputColor.toLowerCase() !== color.outputColor.toLowerCase()) {
      const arrow = document.createElement("span");
      arrow.textContent = "→";
      arrow.style.cssText = "font-size: 0.9rem; color: #999; flex-shrink: 0;";
      item.appendChild(arrow);
      
      const outputSwatch = document.createElement("div");
      outputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.outputColor}; flex-shrink: 0;`;
      item.appendChild(outputSwatch);
    }
    
    // Hex value
    const hexLabel = document.createElement("div");
    hexLabel.style.cssText = "font-family: 'Courier New', monospace; font-size: 0.8rem; color: #aaa; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;";
    hexLabel.textContent = color.inputColor.toUpperCase();
    hexLabel.title = color.inputColor.toUpperCase();
    item.appendChild(hexLabel);
    
    // Index indicator
    if (index === 0) {
      const bgLabel = document.createElement("span");
      bgLabel.textContent = "BG";
      bgLabel.style.cssText = "font-size: 0.7rem; color: #4f46e5; font-weight: 600; flex-shrink: 0; padding: 0.1rem 0.3rem; background: rgba(79, 70, 229, 0.2); border-radius: 3px;";
      item.appendChild(bgLabel);
    }
    
    paletteDisplay.appendChild(item);
  });
}

function openColorEditor(index: number) {
  colorEditorIndex = index;
  const color = state.userPalette[index];
  
  // Create or get color editor modal
  let modal = document.getElementById("colorEditorModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "colorEditorModal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px);
      z-index: 3000; display: flex; align-items: center; justify-content: center;
    `;
    document.body.appendChild(modal);
  }
  
  modal.innerHTML = `
    <div style="background: #1a1a1a; border: 2px solid #4f46e5; border-radius: 8px; padding: 1.5rem; min-width: 400px; max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="margin: 0; color: #fff;">Edit Color ${index}${index === 0 ? ' (Background)' : ''}</h3>
        <button id="closeColorEditor" style="background: none; border: none; color: #999; font-size: 1.5rem; cursor: pointer; padding: 0; width: 32px; height: 32px;">×</button>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- Input Color -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Input Color (from document)</label>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.inputColor}; flex-shrink: 0;"></div>
            <input type="text" id="inputColorHex" value="${color.inputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperInput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">💧</button>
          </div>
        </div>
        
        <!-- Output Options -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Output (in vectorized result)</label>
          
          <div style="display: flex; gap: 0.75rem; margin-bottom: 0.5rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="same" ${!color.mapToBg && color.inputColor === color.outputColor ? 'checked' : ''} style="cursor: pointer;">
              <span>Keep same color</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="different" ${!color.mapToBg && color.inputColor !== color.outputColor ? 'checked' : ''} style="cursor: pointer;">
              <span>Transform to:</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="remove" ${color.mapToBg ? 'checked' : ''} style="cursor: pointer;">
              <span style="color: #ef4444;">Remove</span>
            </label>
          </div>
          
          <div id="outputColorSection" style="display: flex; gap: 0.5rem; align-items: center; ${color.mapToBg || color.inputColor === color.outputColor ? 'opacity: 0.4; pointer-events: none;' : ''}">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.outputColor}; flex-shrink: 0;"></div>
            <input type="text" id="outputColorHex" value="${color.outputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperOutput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">💧</button>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button id="saveColorEdit" style="flex: 1; padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: 600;">Save</button>
          ${index !== 0 ? '<button id="deleteColor" style="padding: 0.75rem 1.25rem; background: #ef4444; border: none; border-radius: 4px; color: white; cursor: pointer;">Delete</button>' : ''}
          <button id="cancelColorEdit" style="padding: 0.75rem 1.25rem; background: #3a3a3a; border: none; border-radius: 4px; color: white; cursor: pointer;">Cancel</button>
        </div>
      </div>
    </div>
  `;
  
  modal.style.display = "flex";
  
  // Setup event listeners
  const inputHexField = document.getElementById("inputColorHex") as HTMLInputElement;
  const outputHexField = document.getElementById("outputColorHex") as HTMLInputElement;
  const outputSection = document.getElementById("outputColorSection") as HTMLDivElement;
  const outputModeRadios = document.getElementsByName("outputMode") as NodeListOf<HTMLInputElement>;
  
  // Update output section visibility based on mode
  outputModeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (radio.value === "different") {
        outputSection.style.opacity = "1";
        outputSection.style.pointerEvents = "auto";
      } else {
        outputSection.style.opacity = "0.4";
        outputSection.style.pointerEvents = "none";
      }
    });
  });
  
  // Eyedropper buttons
  document.getElementById("eyedropperInput")!.addEventListener("click", () => {
    eyedropperMode = 'input';
    activateEyedropper();
    modal!.style.display = "none";
  });
  
  document.getElementById("eyedropperOutput")!.addEventListener("click", () => {
    eyedropperMode = 'output';
    activateEyedropper();
    modal!.style.display = "none";
  });
  
  // Save button
  document.getElementById("saveColorEdit")!.addEventListener("click", () => {
    const inputColor = inputHexField.value;
    const outputColor = outputHexField.value;
    const selectedMode = Array.from(outputModeRadios).find(r => r.checked)?.value;
    
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
      alert("Invalid input color format. Use #RRGGBB");
      return;
    }
    
    if (selectedMode === 'different' && !/^#[0-9A-Fa-f]{6}$/.test(outputColor)) {
      alert("Invalid output color format. Use #RRGGBB");
      return;
    }
    
    state.userPalette[index].inputColor = inputColor;
    
    if (selectedMode === 'remove') {
      state.userPalette[index].mapToBg = true;
      state.userPalette[index].outputColor = inputColor; // Keep it same for display
    } else if (selectedMode === 'different') {
      state.userPalette[index].mapToBg = false;
      state.userPalette[index].outputColor = outputColor;
    } else { // same
      state.userPalette[index].mapToBg = false;
      state.userPalette[index].outputColor = inputColor;
    }
    
    renderPaletteUI();
    autosavePaletteToFile();
    closeColorEditor();
  });
  
  // Delete button
  const deleteBtn = document.getElementById("deleteColor");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (index !== 0 && confirm("Delete this color?")) {
        state.userPalette.splice(index, 1);
        renderPaletteUI();
        autosavePaletteToFile();
        closeColorEditor();
      }
    });
  }
  
  // Cancel/Close buttons
  document.getElementById("cancelColorEdit")!.addEventListener("click", closeColorEditor);
  document.getElementById("closeColorEditor")!.addEventListener("click", closeColorEditor);
  
  // Click outside to close
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeColorEditor();
  });
}

function closeColorEditor() {
  const modal = document.getElementById("colorEditorModal");
  if (modal) modal.style.display = "none";
  colorEditorIndex = null;
  eyedropperMode = null;
}

export function addPaletteColor() {
  if (state.userPalette.length >= 16) {
    showStatusCallback("Maximum 16 colors allowed", true);
    return;
  }
  
  const newIndex = state.userPalette.length;
  state.userPalette.push({
    inputColor: "#808080",
    outputColor: "#808080",
    mapToBg: false,
  });
  
  renderPaletteUI();
  autosavePaletteToFile();
  
  // Immediately open editor for the new color
  openColorEditor(newIndex);
}

export function resetPaletteToDefault() {
  state.userPalette.length = 0;
  Array.from(DEFAULT_PALETTE).forEach(color => {
    state.userPalette.push({
      inputColor: u32ToHex(color),
      outputColor: u32ToHex(color),
      mapToBg: false,
    });
  });
  renderPaletteUI();
  autosavePaletteToFile();
  showStatusCallback("Palette reset to default");
}

function activateEyedropper() {
  if (!state.currentImage) {
    showStatusCallback("No image loaded", true);
    return;
  }
  
  if (!mainCanvasRef) {
    showStatusCallback("Canvas not initialized", true);
    return;
  }
  
  eyedropperActive = true;
  document.body.classList.add("eyedropper-active");
  mainCanvasRef.style.cursor = "crosshair";
  showStatusCallback("💧 Click on the image to pick a color (ESC to cancel)");
}

function deactivateEyedropper() {
  if (!mainCanvasRef) return;
  
  eyedropperActive = false;
  document.body.classList.remove("eyedropper-active");
  mainCanvasRef.style.cursor = "";
  showStatusCallback("Eyedropper cancelled");
}

export function pickColorFromCanvas(x: number, y: number) {
  if (!state.currentImage || !mainCanvasRef) return;
  
  // Convert canvas coordinates to image coordinates
  const rect = mainCanvasRef.getBoundingClientRect();
  const scaleX = state.currentImage.width / rect.width;
  const scaleY = state.currentImage.height / rect.height;
  const imgX = Math.floor((x - rect.left) * scaleX);
  const imgY = Math.floor((y - rect.top) * scaleY);
  
  // Check bounds
  if (imgX < 0 || imgX >= state.currentImage.width || imgY < 0 || imgY >= state.currentImage.height) {
    return;
  }
  
  // Get pixel color
  const pixelIndex = (imgY * state.currentImage.width + imgX) * 4;
  const r = state.currentImage.data[pixelIndex];
  const g = state.currentImage.data[pixelIndex + 1];
  const b = state.currentImage.data[pixelIndex + 2];
  
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  
  deactivateEyedropper();
  
  // If we're in color editor mode, update the color editor
  if (colorEditorIndex !== null && eyedropperMode) {
    if (eyedropperMode === 'input') {
      state.userPalette[colorEditorIndex].inputColor = hex;
    } else if (eyedropperMode === 'output') {
      state.userPalette[colorEditorIndex].outputColor = hex;
      state.userPalette[colorEditorIndex].mapToBg = false; // Ensure it's not set to remove
    }
    autosavePaletteToFile();
    // Reopen the color editor with updated values
    openColorEditor(colorEditorIndex);
    showStatusCallback(`Picked ${hex.toUpperCase()}`);
  } else {
    // Old behavior: add to palette
    addColorToPalette(hex);
    showStatusCallback(`Added ${hex.toUpperCase()} to palette`);
  }
}

function addColorToPalette(hex: string) {
  if (state.userPalette.length >= 16) {
    showStatusCallback("Maximum 16 colors - remove one first", true);
    return;
  }
  
  state.userPalette.push({
    inputColor: hex,
    outputColor: hex,
    mapToBg: false,
  });
  
  renderPaletteUI();
  showStatusCallback(`Added ${hex} to palette`);
}

// Convert state.userPalette to RGBA format for GPU processing
export function buildPaletteRGBA(): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(16 * 4);
  
  for (let i = 0; i < state.userPalette.length && i < 16; i++) {
    const color = state.userPalette[i];
    // Use INPUT color for matching - GPU will find nearest input color
    // The palette stored with the result contains OUTPUT colors for display
    const [r, g, b, a] = hexToRGBA(color.inputColor);
    
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  
  // Fill remaining slots with background color
  for (let i = state.userPalette.length; i < 16; i++) {
    const [r, g, b, a] = hexToRGBA(state.userPalette[0].inputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  
  return palette;
}

// Check if eyedropper is active (for event handling in main.ts)
export function isEyedropperActive(): boolean {
  return eyedropperActive;
}

// Force deactivate (e.g., on ESC key)
export function forceDeactivateEyedropper() {
  if (eyedropperActive) {
    deactivateEyedropper();
  }
}
