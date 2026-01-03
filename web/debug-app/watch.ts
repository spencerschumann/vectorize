/**
 * Watch script for debug-app that regenerates build-info.ts on each rebuild.
 * Runs esbuild with --watch and writes build-info.ts whenever the bundle changes.
 */

async function writeBuildInfo() {
  const timestamp = new Date().toISOString();
  const timestampMs = Date.now();
  const buildInfoTs = `export const BUILD_INFO = {
  timestamp: "${timestamp}",
  timestampMs: ${timestampMs},
};
`;
  await Deno.writeTextFile("debug-app/build-info.ts", buildInfoTs);
  console.log(`[${new Date().toLocaleTimeString()}] Build timestamp updated`);
}

// Initial build-info write (before watch starts)
console.log("Writing initial build-info.ts...");
await writeBuildInfo();

// Start esbuild in watch mode - capture output to detect rebuilds
const cmd = [
  "deno",
  "run",
  "-A",
  "npm:esbuild",
  "debug-app/main.ts",
  "--bundle",
  "--format=esm",
  "--outfile=debug-app/main.js",
  "--platform=browser",
  "--sourcemap",
  "--watch",
];

console.log("Starting debug-app watch mode...");
const process = new Deno.Command("deno", {
  args: cmd.slice(1),
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Read stdout/stderr and watch for build completion
const decoder = new TextDecoder();

// Process stdout
(async () => {
  for await (const chunk of process.stdout) {
    const text = decoder.decode(chunk);
    console.log(text);
    // esbuild outputs "Done in XXms" when watch rebuild completes
    if (text.includes("Done in")) {
      await writeBuildInfo();
    }
  }
})();

// Process stderr
(async () => {
  for await (const chunk of process.stderr) {
    const text = decoder.decode(chunk);
    console.error(text);
  }
})();

// Keep running
await process.status;
