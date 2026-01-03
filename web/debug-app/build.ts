/**
 * Build script for debug-app with cache-busting timestamp embedded in bundle.
 * Generates build-info.ts (imported by main.ts) and runs esbuild.
 */

const timestamp = new Date().toISOString();
const timestampMs = Date.now();

// Generate build-info.ts with exported const
const buildInfoTs = `export const BUILD_INFO = {
  timestamp: "${timestamp}",
  timestampMs: ${timestampMs},
};
`;

await Deno.writeTextFile("debug-app/build-info.ts", buildInfoTs);

// Run esbuild
const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "-A",
    "npm:esbuild",
    "debug-app/main.ts",
    "--bundle",
    "--format=esm",
    "--outfile=debug-app/main.js",
    "--platform=browser",
    "--sourcemap",
  ],
  stdout: "inherit",
  stderr: "inherit",
});

console.log(`Building debug-app (${timestamp})...`);
const result = await cmd.spawn().output();

if (result.success) {
  console.log(`✓ Build complete with embedded timestamp`);
} else {
  console.error("Build failed");
  Deno.exit(1);
}
