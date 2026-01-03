import { serveDir } from "@std/http/file-server";

const PORT = 8083;

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/" || url.pathname === "/debug-app/" || url.pathname === "/debug-app") {
    const html = await Deno.readTextFile("./debug-app/index.html");
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return serveDir(req, {
    fsRoot: ".",
    urlRoot: "",
    showDirListing: false,
  });
});

console.log(`Debug app server running on http://localhost:${PORT}`);
