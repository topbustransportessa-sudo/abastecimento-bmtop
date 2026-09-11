const http = require("http");
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const errorLog = path.join(__dirname, "server-error.log");
const apiHandler = require("./api/[...path].js");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function logError(error) {
  fs.appendFileSync(errorLog, `${new Date().toISOString()} ${error.stack || error}\n`);
}

process.on("uncaughtException", logError);
process.on("unhandledRejection", logError);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    req.query = { path: url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean) };
    res.status = (statusCode) => {
      res.statusCode = statusCode;
      return res;
    };
    apiHandler(req, res);
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const safePath = path.normalize(requestedPath || "index.html");
  let filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (!statError && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
      res.end(content);
    });
  });
});

server.on("error", logError);

server.listen(port, "127.0.0.1", () => {
  console.log(`Abastecimento BMTOP disponivel em http://localhost:${port}`);
});

setInterval(() => {}, 60000);
