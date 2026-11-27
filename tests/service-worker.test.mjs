import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { contentSecurityPolicy } from "../next.config.ts";

const ORIGIN = "https://pwa.test";
const CACHE = "app-big-v3";
const LEGACY = "app-big-v2";
const FALLBACK = "/pwa-offline";
const MANIFEST = "/manifest.webmanifest";
const SPLASH_ICON = "/icons/premios-ao-vivo-icon-512.png";
const FALLBACK_CSS = "/_next/static/immutable/chunks/fallback.css";
const FALLBACK_JS = "/_next/static/immutable/chunks/fallback.js?dpl=dpl_fixture";
const JSONP_CSP = contentSecurityPolicy + "; script-src-elem 'self' https://api.onesignal.com/sync/123e4567-e89b-42d3-a456-426614174000/web";
const swSource = readFileSync("public/sw.js", "utf8");

function requestFor(path, overrides = {}) {
  return {
    destination: "",
    headers: new Headers(),
    method: "GET",
    mode: "cors",
    url: new URL(path, ORIGIN).href,
    ...overrides,
  };
}

function responseFor(path, body, { headers, status, redirected = false } = {}) {
  const response = new Response(body, {
    status,
    headers: {
      "Content-Type": path === MANIFEST ? "application/manifest+json" : "text/html; charset=utf-8",
      "Content-Security-Policy": contentSecurityPolicy,
      ...headers,
    },
  });
  return Object.defineProperties(response, {
    url: { value: new URL(path, ORIGIN).href },
    redirected: { value: redirected },
  });
}

function fallbackDocument(text) {
  return `<link data-precedence="next" href="${FALLBACK_CSS}" rel="stylesheet">
    <script async src="${FALLBACK_JS}"></script><main>${text}</main>`;
}

function publicResource(url, text) {
  const path = url.slice(ORIGIN.length);
  if (path === FALLBACK) {
    return responseFor(FALLBACK, fallbackDocument(text));
  }
  const types = {
    [FALLBACK_CSS]: "text/css",
    [FALLBACK_JS]: "application/javascript",
    [SPLASH_ICON]: "image/png",
    [MANIFEST]: "application/manifest+json",
  };
  assert.ok(types[path], "Unexpected fetch " + path);
  return responseFor(path, text, { headers: { "Content-Type": types[path] } });
}

function cacheKey(input) {
  return new URL(typeof input === "string" ? input : input.url, ORIGIN).href;
}

function cloneResponse(response) {
  return Object.defineProperties(response.clone(), {
    url: { value: response.url },
    redirected: { value: response.redirected },
  });
}

class MemoryCache {
  entries = new Map();

  async match(input) {
    const response = this.entries.get(cacheKey(input));
    return response && cloneResponse(response);
  }

  async put(input, response) {
    this.entries.set(cacheKey(input), cloneResponse(response));
  }
}

class MemoryCacheStorage {
  caches = new Map();

  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MemoryCache());
    }
    return this.caches.get(name);
  }

  async match(input, { cacheName }) {
    return this.caches.get(cacheName)?.match(input);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name) {
    return this.caches.delete(name);
  }
}

function loadServiceWorker(fetchImpl) {
  const listeners = new Map();
  const cacheStorage = new MemoryCacheStorage();
  const calls = { claim: 0, skipWaiting: 0 };
  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      async claim() {
        calls.claim += 1;
      },
    },
    location: { origin: ORIGIN },
    skipWaiting() {
      calls.skipWaiting += 1;
    },
  };

  vm.runInNewContext(swSource, { URL, caches: cacheStorage, fetch: fetchImpl, self });

  function dispatch(type, request) {
    let pending;
    let response;
    listeners.get(type)({
      request,
      waitUntil(promise) {
        pending = promise;
      },
      respondWith(promise) {
        response = promise;
      },
    });
    return { pending, response };
  }

  return {
    cacheStorage,
    calls,
    dispatchLifecycle: (type) => dispatch(type).pending,
    dispatchFetch: (request) => dispatch("fetch", request),
  };
}

async function seed(worker, cacheName, path, response) {
  const cache = await worker.cacheStorage.open(cacheName);
  await cache.put(path, response);
}

test("root navigation returns online HTML before the uncredentialed fallback refresh", async () => {
  let completeRefresh;
  const calls = [];
  const worker = loadServiceWorker((request, options) => {
    calls.push([request, options]);
    if (request === ORIGIN + FALLBACK) {
      return new Promise((resolve) => { completeRefresh = resolve; });
    }
    if (typeof request === "string") {
      return Promise.resolve(publicResource(request, "asset"));
    }
    return Promise.resolve(responseFor("/", "online", {
      headers: { "Cache-Control": "private, no-store", "Content-Security-Policy": JSONP_CSP },
    }));
  });
  await seed(worker, CACHE, FALLBACK, responseFor(FALLBACK, "previous"));
  const request = requestFor("/", { mode: "navigate" });
  const { response, pending } = worker.dispatchFetch(request);
  assert.equal(await (await response).text(), "online");
  assert.equal(await (await worker.cacheStorage.match(FALLBACK, { cacheName: CACHE })).text(), "previous");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], request);
  assert.equal(calls[1][0], ORIGIN + FALLBACK);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), {
    headers: { Accept: "*/*" },
    credentials: "omit",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  completeRefresh(publicResource(ORIGIN + FALLBACK, "fresh offline document"));
  await pending;
  const cached = await worker.cacheStorage.match(FALLBACK, { cacheName: CACHE });
  assert.equal(await cached.text(), fallbackDocument("fresh offline document"));
  assert.equal(cached.headers.get("content-security-policy"), contentSecurityPolicy);
  assert.equal(await worker.cacheStorage.match("/", { cacheName: CACHE }), undefined);
});

for (const path of ["/", "/instalar", "/other-public-page"]) {
  test(path + " uses only the validated public document offline", async () => {
    const worker = loadServiceWorker(async () => { throw new TypeError("offline"); });
    await seed(worker, CACHE, FALLBACK, responseFor(FALLBACK, "public shell"));
    await seed(worker, CACHE, path, responseFor(path, "incorrect document", {
      headers: { "Content-Security-Policy": JSONP_CSP },
    }));
    const { response } = worker.dispatchFetch(requestFor(path, { mode: "navigate" }));
    assert.equal(await (await response).text(), "public shell");
    assert.equal((await response).headers.get("content-security-policy"), contentSecurityPolicy);
  });
}

test("migration preserves the v2 fallback and its versioned assets until a v3 document is ready", async () => {
  let offline = true;
  const worker = loadServiceWorker(async (request) => {
    if (offline) throw new TypeError("offline");
    return typeof request === "string" ? publicResource(request, "v3") : responseFor("/", "online");
  });
  const chunk = "/_next/static/chunks/app.js";
  await seed(worker, LEGACY, "/", responseFor("/", "v2"));
  await seed(worker, LEGACY, chunk, responseFor(chunk, "legacy chunk"));
  for (const name of ["app-big-v0", "app-big-v1", "OneSignal", "other-app-v1"]) {
    await worker.cacheStorage.open(name);
  }

  await worker.dispatchLifecycle("install");
  await worker.dispatchLifecycle("activate");
  assert.equal(worker.calls.skipWaiting, 1);
  assert.equal(worker.calls.claim, 1);
  assert.deepEqual((await worker.cacheStorage.keys()).sort(), ["OneSignal", LEGACY, "other-app-v1"]);
  const reopen = worker.dispatchFetch(requestFor("/instalar", { mode: "navigate" }));
  assert.equal(await (await reopen.response).text(), "v2");
  const script = worker.dispatchFetch(requestFor(chunk, { destination: "script" }));
  assert.equal(await (await script.response).text(), "legacy chunk");

  offline = false;
  const recovery = worker.dispatchFetch(requestFor("/", { mode: "navigate" }));
  assert.equal(await (await recovery.response).text(), "online");
  await recovery.pending;
  offline = true;
  const updated = worker.dispatchFetch(requestFor("/", { mode: "navigate" }));
  assert.equal(await (await updated.response).text(), fallbackDocument("v3"));
  assert.ok(await worker.cacheStorage.match("/", { cacheName: LEGACY }));
});

test("versioned static assets preserve cache-first behavior", async () => {
  let fetchCount = 0;
  const worker = loadServiceWorker(async () => {
    fetchCount += 1;
    return new Response("network asset");
  });
  const request = requestFor("/_next/static/chunks/app.js", { destination: "script" });
  await seed(worker, CACHE, request, new Response("cached asset"));
  assert.equal(await (await worker.dispatchFetch(request).response).text(), "cached asset");
  assert.equal(fetchCount, 0);
});

test("static cache misses are anonymous and private responses stay out of the cache", async () => {
  const worker = loadServiceWorker(async (_request, options) => {
    assert.equal(options.credentials, "omit");
    return new Response("network asset", { headers: { "Cache-Control": "private, no-store" } });
  });
  const request = requestFor("/_next/static/chunks/app.js", { destination: "script" });
  assert.equal(await (await worker.dispatchFetch(request).response).text(), "network asset");
  assert.equal(await worker.cacheStorage.match(request, { cacheName: CACHE }), undefined);
});

for (const path of ["/admin", "/admin/settings", "/api", "/api/settings", "/api/admin/settings"]) {
  test(path + " bypasses the fallback and service worker caching", async () => {
    const worker = loadServiceWorker(() => assert.fail("worker intercepted private path"));
    assert.deepEqual(worker.dispatchFetch(requestFor(path, { mode: "navigate" })), {
      pending: undefined,
      response: undefined,
    });
    assert.deepEqual(await worker.cacheStorage.keys(), []);
  });
}

test("non-GET, other origins, authenticated, RSC and prefetch requests bypass the worker", async () => {
  const worker = loadServiceWorker(() => assert.fail("worker intercepted an excluded request"));
  const requests = [
    requestFor("/", { method: "POST", mode: "navigate" }),
    requestFor("https://outside.test/", { mode: "navigate" }),
    requestFor("/", { headers: new Headers({ Authorization: "Bearer test-only" }), mode: "navigate" }),
    requestFor("/", { headers: new Headers({ Cookie: "session=test-only" }), mode: "navigate" }),
    requestFor("/", { headers: new Headers({ RSC: "1" }), mode: "navigate" }),
    requestFor("/", { headers: new Headers({ "Next-Router-Prefetch": "1" }), mode: "navigate" }),
    requestFor("/", { headers: new Headers({ "Next-Router-Segment-Prefetch": "/_tree" }), mode: "navigate" }),
    requestFor("/private-image", { destination: "image" }),
  ];
  for (const request of requests) {
    assert.equal(worker.dispatchFetch(request).response, undefined);
  }
  assert.deepEqual(await worker.cacheStorage.keys(), []);
});

const badFallbacks = [
  ["private", () => responseFor(FALLBACK, "invalid", { headers: { "Cache-Control": "private" } })],
  ["no-store", () => responseFor(FALLBACK, "invalid", { headers: { "Cache-Control": "no-store" } })],
  ["Vary Cookie", () => responseFor(FALLBACK, "invalid", { headers: { Vary: "RSC, Cookie" } })],
  ["Vary Authorization", () => responseFor(FALLBACK, "invalid", { headers: { Vary: "Authorization" } })],
  ["Vary *", () => responseFor(FALLBACK, "invalid", { headers: { Vary: "*" } })],
  ["Set-Cookie", () => responseFor(FALLBACK, "invalid", { headers: { "Set-Cookie": "session=test-only" } })],
  ["redirected response", () => responseFor(FALLBACK, "invalid", { redirected: true })],
  ["different path", () => responseFor("/instalar", "invalid")],
  ["different origin", () => responseFor("https://outside.test/pwa-offline", "invalid")],
  ["JSONP CSP", () => responseFor(FALLBACK, "invalid", { headers: { "Content-Security-Policy": JSONP_CSP } })],
  ["missing CSP", () => {
    const response = responseFor(FALLBACK, "invalid");
    response.headers.delete("content-security-policy");
    return response;
  }],
  ["multiple CSPs", () => responseFor(FALLBACK, "invalid", {
    headers: { "Content-Security-Policy": contentSecurityPolicy + ", " + contentSecurityPolicy },
  })],
  ["RSC body", () => responseFor(FALLBACK, "invalid", { headers: { "Content-Type": "text/x-component" } })],
  ["304", () => responseFor(FALLBACK, null, { status: 304 })],
  ["206", () => responseFor(FALLBACK, "partial", { status: 206 })],
  ["fetch failure", () => { throw new TypeError("offline"); }],
];

for (const [label, invalidResponse] of badFallbacks) {
  test(label + " never replaces the last valid fallback", async () => {
    const worker = loadServiceWorker(async (request) =>
      typeof request === "string" ? invalidResponse() : responseFor("/", "online"));
    await seed(worker, CACHE, FALLBACK, responseFor(FALLBACK, "public shell"));
    const { response, pending } = worker.dispatchFetch(requestFor("/", { mode: "navigate" }));
    assert.equal(await (await response).text(), "online");
    await pending;
    assert.equal(await (await worker.cacheStorage.match(FALLBACK, { cacheName: CACHE })).text(), "public shell");
  });
}

test("install validates precache and refuses to activate without a valid fallback", async () => {
  const worker = loadServiceWorker(async (url) => url.endsWith(MANIFEST)
    ? responseFor(MANIFEST, "private manifest", { headers: { "Cache-Control": "private" } })
    : responseFor(FALLBACK, "wrong policy", { headers: { "Content-Security-Policy": JSONP_CSP } }));
  await seed(worker, LEGACY, "/", responseFor("/", "wrong legacy policy", {
    headers: { "Content-Security-Policy": JSONP_CSP },
  }));
  await assert.rejects(worker.dispatchLifecycle("install"), /No valid public offline document/);
  assert.equal(await worker.cacheStorage.match(FALLBACK, { cacheName: CACHE }), undefined);
  assert.equal(await worker.cacheStorage.match(MANIFEST, { cacheName: CACHE }), undefined);
  assert.equal(worker.calls.skipWaiting, 0);
});

test("fresh install prepares the fallback CSS, JS and icon before allowing first navigation offline", async () => {
  let online = true;
  let releaseStyle;
  let requestStyle;
  const stylesheetRequested = new Promise((resolve) => { requestStyle = resolve; });
  const worker = loadServiceWorker(async (url, options) => {
    if (!online) throw new TypeError("offline");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    if (url === ORIGIN + FALLBACK_CSS) {
      await new Promise((resolve) => { releaseStyle = resolve; requestStyle(); });
    }
    if (url === ORIGIN + FALLBACK) {
      return responseFor(FALLBACK, fallbackDocument("precache") + `
        <script src="https://outside.test/_next/static/chunks/no.js"></script>
        <script src="/api/unsafe.js"></script>
        <link rel="prefetch" href="/_next/static/chunks/unused.css">`);
    }
    return publicResource(url, "precache");
  });
  const installing = worker.dispatchLifecycle("install");
  await stylesheetRequested;
  assert.equal(await worker.cacheStorage.match(FALLBACK, { cacheName: CACHE }), undefined);
  assert.equal(worker.calls.skipWaiting, 0);
  releaseStyle();
  await installing;
  assert.ok(await worker.cacheStorage.match(FALLBACK, { cacheName: CACHE }));
  assert.ok(await worker.cacheStorage.match(MANIFEST, { cacheName: CACHE }));
  assert.equal(worker.calls.skipWaiting, 1);
  online = false;
  const offlineDocument = await worker.dispatchFetch(requestFor("/", { mode: "navigate" })).response;
  assert.match(await offlineDocument.text(), /<main>precache<\/main>/);
  for (const [path, destination, type] of [
    [FALLBACK_CSS, "style", "text/css"],
    [FALLBACK_JS, "script", "application/javascript"],
  ]) {
    const asset = await worker.dispatchFetch(requestFor(path, { destination })).response;
    assert.equal(asset.headers.get("Content-Type"), type);
  }
  const offlineIcon = await worker.dispatchFetch(requestFor(SPLASH_ICON, { destination: "image" })).response;
  assert.equal(offlineIcon.headers.get("Content-Type"), "image/png");
  assert.equal(await offlineIcon.text(), "precache");

  const registerSource = readFileSync("components/service-worker-register.tsx", "utf8");
  const layoutSource = readFileSync("app/layout.tsx", "utf8");
  assert.match(registerSource, /process\.env\.NODE_ENV === "production"/);
  assert.match(registerSource, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(layoutSource, /<ServiceWorkerRegister\s*\/>/);
});

for (const [name, rejected] of [
  ["unavailable asset", () => { throw new TypeError("offline"); }],
  ["untrusted cache policy", () => responseFor(FALLBACK_CSS, "private CSS", {
    headers: { "Content-Type": "text/css", "Cache-Control": "private" },
  })],
  ["wrong content type", () => responseFor(FALLBACK_CSS, "HTML masquerading as CSS")],
  ["wrong asset URL", () => responseFor("/other.css", "CSS", { headers: { "Content-Type": "text/css" } })],
]) {
  test(name + " prevents replacing the previous offline document or activating a fresh worker", async () => {
    const useFetch = async (request) => {
      if (typeof request !== "string") return responseFor("/", "online");
      if (request === ORIGIN + FALLBACK_CSS) return rejected();
      return publicResource(request, "new");
    };
    const fresh = loadServiceWorker(useFetch);
    await assert.rejects(fresh.dispatchLifecycle("install"), /No valid public offline document/);
    assert.equal(fresh.calls.skipWaiting, 0);

    const existing = loadServiceWorker(useFetch);
    await seed(existing, CACHE, FALLBACK, responseFor(FALLBACK, "previous"));
    const { response, pending } = existing.dispatchFetch(requestFor("/", { mode: "navigate" }));
    assert.equal(await (await response).text(), "online");
    await pending;
    assert.equal(await (await existing.cacheStorage.match(FALLBACK, { cacheName: CACHE })).text(), "previous");
  });
}
