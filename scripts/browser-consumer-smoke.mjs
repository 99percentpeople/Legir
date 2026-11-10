import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

/** Optional real-browser check of the independently installed/built example.
 * Chromium's debugging pipe avoids a new browser automation dependency. */
const [distArg, fixture] = process.argv.slice(2);
if (!distArg || !fixture || !process.env.LEGIR_BROWSER_BIN)
  throw new Error(
    "Usage: LEGIR_BROWSER_BIN=chromium node browser-consumer-smoke.mjs DIST PDF",
  );
const dist = path.resolve(distArg);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url, "http://localhost").pathname,
  );
  const file = path.resolve(
    dist,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader(
    "Content-Type",
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".wasm": "application/wasm",
      ".css": "text/css",
    }[path.extname(file)] ?? "application/octet-stream",
  );
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = fs.mkdtempSync(
  path.join(path.dirname(dist), "chrome-profile-"),
);
const browser = spawn(
  process.env.LEGIR_BROWSER_BIN,
  [
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let sequence = 0;
let buffer = "";
let browserErrors = "";
const pending = new Map();
browser.stderr.on("data", (chunk) => {
  browserErrors = (browserErrors + chunk).slice(-4000);
});
browser.on("error", (error) => {
  for (const item of pending.values()) item.reject(error);
});
browser.on("exit", (code) => {
  for (const item of pending.values())
    item.reject(new Error(`Browser exited (${code}): ${browserErrors}`));
});
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    const item = pending.get(message.id);
    if (!item) continue;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser command timed out: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });

try {
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const value = await evaluate(expression);
      if (value) return value;
      await delay(100);
    }
    throw new Error(`Browser condition timed out: ${expression}`);
  };
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  await waitFor(
    "!!document.querySelector('#file') && !document.querySelector('#file').disabled",
  );
  const { root } = await call("DOM.getDocument");
  const { nodeId } = await call("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#file",
  });
  await call("DOM.setFileInputFiles", {
    nodeId,
    files: [path.resolve(fixture)],
  });
  const state = await waitFor(
    "['ready','error'].includes(document.querySelector('#status')?.dataset.state) && document.querySelector('#status').dataset.state",
  );
  if (state !== "ready")
    throw new Error(
      await evaluate("document.querySelector('#status').textContent"),
    );
  const result = await evaluate(`(() => {
    const canvas = document.querySelector('#page');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] && (pixels[i] < 240 || pixels[i+1] < 240 || pixels[i+2] < 240)) ink++;
    return { width: canvas.width, height: canvas.height, ink };
  })()`);
  if (!result.width || !result.height || !result.ink)
    throw new Error(`Empty raster output: ${JSON.stringify(result)}`);
  console.log(
    `Real browser Worker/WASM consumer passed: ${JSON.stringify(result)}`,
  );
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  pending.clear();
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGKILL");
    await exited;
  }
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
