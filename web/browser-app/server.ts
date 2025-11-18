import { serveDir } from "@std/http/file-server";

const PORT = 8000;

Deno.serve({ port: PORT }, async (req: Request) => {
    const url = new URL(req.url);

    // Serve index.html for root
    if (url.pathname === "/") {
        try {
            const html = await Deno.readTextFile("./browser-app/index.html");
            return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        } catch (error) {
            console.error("Error reading index.html:", error);
            return new Response("Not found", { status: 404 });
        }
    }

    // Serve static files from project root
    return serveDir(req, {
        fsRoot: ".",
        urlRoot: "",
        showDirListing: false,
    });
});

console.log(`Server running on http://localhost:${PORT}`);


