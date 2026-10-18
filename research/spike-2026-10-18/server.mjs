import { createServer } from "node:http";
import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
const page = readFileSync(join(dir, "index.html"));

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      appendFileSync(join(dir, "sessions.jsonl"), body.replace(/\n/g, " ") + "\n");
      res.writeHead(204).end();
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
}).listen(4777, "127.0.0.1", () => console.log("http://127.0.0.1:4777"));
