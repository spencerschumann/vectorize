import { serveDir } from "@std/http/file-server";

const PORT = 8000;

Deno.serve({ port: PORT }, async (req: Request) => {
    const url = new URL(req.url);

    // Serve static files from browser-app directory
    if (url.pathname === "/") {
        url.pathname = "/index.html";
    }

    return serveDir(req, {
        fsRoot: "./browser-app",
        urlRoot: "",
        showDirListing: false,
    });
});

console.log(`Server running on http://localhost:${PORT}`);
