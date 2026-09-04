const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

const { RommApi } = require("../out/api/RommApi.js");
const { makeRom, makeTempDir, silenceConsole } = require("./helpers.js");

async function apiWithClient(client, baseUrl = "https://romm.test/") {
  const api = new RommApi(baseUrl);
  await api.initClient();
  api.client = client;
  return api;
}

test("base URL, platform assets and auth headers are normalized", async () => {
  const api = new RommApi("https://romm.test///");
  assert.equal(api.getBaseUrl(), "https://romm.test");
  assert.equal(api.getPlatformImageUrl("psp"), "https://romm.test/assets/platforms/psp.svg");
  assert.equal(api.getPlatformImageUrl(""), null);
  assert.deepEqual(api.getAuthHeaders(), {});
  api.sessionToken = "romm_session=token";
  assert.deepEqual(api.getAuthHeaders(), { Cookie: "romm_session=token" });
  assert.equal(api.sessionTokenValue, "token");
});

test("fetchRoms emits defaults and optional filters", async (t) => {
  silenceConsole(t);
  const calls = [];
  const api = await apiWithClient({ get: async (...args) => { calls.push(args); return { data: { items: [] } }; } });
  await api.fetchRoms();
  await api.fetchRoms({ limit: 25, offset: 50, orderBy: "name", orderDir: "asc", search: "wipeout", platform_id: 7, groupByMetaId: true });
  assert.deepEqual(calls[0], ["/api/roms", { params: { limit: 15, offset: 0, order_by: "id", order_dir: "desc", with_char_index: false } }]);
  assert.deepEqual(calls[1][1].params, {
    limit: 25, offset: 50, order_by: "name", order_dir: "asc", with_char_index: false, search_term: "wipeout", platform_ids: 7, group_by_meta_id: true,
  });
});

test("platform_ids takes precedence over legacy platform_id", async (t) => {
  silenceConsole(t);
  let options;
  const api = await apiWithClient({ get: async (_url, value) => { options = value; return { data: { items: [] } }; } });
  await api.fetchRoms({ platform_id: 1, platform_ids: "2,3" });
  assert.equal(options.params.platform_ids, "2,3");
});

test("endpoint wrappers target current RomM routes", async (t) => {
  silenceConsole(t);
  const calls = [];
  const client = { get: async (url, options) => { calls.push({ url, options }); return { data: { url } }; }, post: async (url, data, options) => { calls.push({ url, data, options }); return { data: { url } }; } };
  const api = await apiWithClient(client);
  await api.getCurrentUser();
  await api.getConfig();
  await api.fetchPlatforms();
  await api.fetchStats();
  await api.getRomDetails(9);
  await api.fetchRomById(10);
  await api.downloadSave(11);
  assert.deepEqual(calls.map((call) => call.url), ["/api/users/me", "/api/config", "/api/platforms", "/api/stats", "/api/roms/9", "/api/roms/10", "/api/saves"]);
  assert.deepEqual(calls.at(-1).options, { params: { rom_id: 11 } });
});

test("search and platform helpers apply their defaults", async (t) => {
  silenceConsole(t);
  const calls = [];
  const api = await apiWithClient({ get: async (_url, options) => { calls.push(options.params); return { data: { items: [] } }; } });
  await api.searchRoms("zelda", { limit: 5 });
  await api.getRomsByPlatform(8);
  assert.equal(calls[0].search_term, "zelda");
  assert.equal(calls[0].limit, 5);
  assert.deepEqual({ platform: calls[1].platform_ids, limit: calls[1].limit, order: calls[1].order_by, dir: calls[1].order_dir, grouped: calls[1].group_by_meta_id }, {
    platform: 8, limit: 72, order: "name", dir: "asc", grouped: true,
  });
});

test("fetchAllRoms paginates and excludes missing filesystem entries", async () => {
  const api = new RommApi();
  const offsets = [];
  api.fetchRoms = async ({ offset, limit }) => {
    offsets.push(offset);
    if (offset === 0) return { success: true, data: { items: Array.from({ length: limit }, (_, id) => makeRom({ id, missing_from_fs: id === 3 })) } };
    return { success: true, data: { items: [makeRom({ id: 101 }), makeRom({ id: 102, missing_from_fs: true })] } };
  };
  const result = await api.fetchAllRoms({ limit: 3 });
  assert.deepEqual(offsets, [0, 3]);
  assert.deepEqual(result.data.map((rom) => rom.id), [0, 1, 2, 101]);
});

test("fetchAllRoms returns accumulated pages after a later failure", async () => {
  const api = new RommApi();
  let page = 0;
  api.fetchRoms = async () => (++page === 1 ? { success: true, data: { items: [makeRom({ id: 1 }), makeRom({ id: 2 })] } } : { success: false, error: "network" });
  const result = await api.fetchAllRoms({ limit: 2 });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.map((rom) => rom.id), [1, 2]);
});

test("single-file ROM download streams atomically and reports progress", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-download-");
  const calls = [];
  const body = Buffer.from("ROM-DATA");
  const api = await apiWithClient({ get: async (...args) => { calls.push(args); return { status: 200, data: Readable.from([body]), headers: { "content-length": String(body.length) } }; } });
  const rom = makeRom({ id: 5, fs_name: "My Game.zip", has_simple_single_file: true, files: [{ id: 50, file_name: "My Game.zip", file_size_bytes: body.length }] });
  const progress = [];
  const result = await api.downloadRom(rom, root, (value) => progress.push(value));
  assert.equal(result.success, true);
  assert.equal(calls[0][0], "/api/roms/5/content/My%20Game.zip");
  assert.deepEqual(calls[0][1], { responseType: "stream", timeout: 0 });
  assert.equal(await fs.readFile(path.join(root, "My Game.zip"), "utf8"), "ROM-DATA");
  assert.equal(fsSync.existsSync(path.join(root, "My Game.zip.part")), false);
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).totalFilesNumber, 1);
});

test("multi-file downloads preserve nested relative paths", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-download-");
  const urls = [];
  const api = await apiWithClient({ get: async (url) => { urls.push(url); const body = Buffer.from(url.endsWith("=1") ? "one" : "two"); return { status: 200, data: Readable.from([body]), headers: { "content-length": body.length } }; } });
  const rom = makeRom({ id: 6, fs_name: "Multi Disc", has_multiple_files: true, files: [
    { id: 1, file_name: "disc1.iso", file_size_bytes: 3 },
    { id: 2, file_name: "sub/disc2.iso", file_size_bytes: 3 },
  ] });
  assert.equal((await api.downloadRom(rom, root)).success, true);
  assert.deepEqual(urls, ["/api/roms/6/content/Multi%20Disc?file_ids=1", "/api/roms/6/content/Multi%20Disc?file_ids=2"]);
  assert.equal(await fs.readFile(path.join(root, "disc1.iso"), "utf8"), "one");
  assert.equal(await fs.readFile(path.join(root, "sub", "disc2.iso"), "utf8"), "two");
});

test("unsafe download paths are rejected before an HTTP request", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-download-");
  let called = false;
  const api = await apiWithClient({ get: async () => { called = true; } });
  api.available = true;
  const rom = makeRom({ has_multiple_files: true, files: [{ id: 1, file_name: "../escape.iso", file_size_bytes: 1 }] });
  const result = await api.downloadRom(rom, root);
  assert.equal(result.success, false);
  assert.match(result.error, /Unsafe ROM file path/);
  assert.equal(called, false);
  assert.equal(api.isAvailable, true);
  assert.equal(fsSync.existsSync(path.join(root, "..", "escape.iso")), false);
});

test("incomplete downloads remove partial files", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-download-");
  const api = await apiWithClient({ get: async () => ({ status: 200, data: Readable.from([Buffer.from("short")]), headers: { "content-length": "10" } }) });
  const rom = makeRom({ has_simple_single_file: true, files: [{ id: 1, file_name: "game.iso", file_size_bytes: 10 }] });
  const result = await api.downloadRom(rom, root);
  assert.equal(result.success, false);
  assert.match(result.error, /incomplete/);
  assert.equal(fsSync.existsSync(path.join(root, "game.iso.part")), false);
  assert.equal(fsSync.existsSync(path.join(root, "game.iso")), false);
});

test("non-200 download responses fail without writing files", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-download-");
  const api = await apiWithClient({ get: async () => ({ status: 206, data: Readable.from([]), headers: {} }) });
  const rom = makeRom({ has_simple_single_file: true, files: [{ id: 1, file_name: "game.iso", file_size_bytes: 1 }] });
  const result = await api.downloadRom(rom, root);
  assert.equal(result.success, false);
  assert.match(result.error, /HTTP 206/);
});

test("save downloads accept path strings and save objects", async (t) => {
  silenceConsole(t);
  const calls = [];
  const api = await apiWithClient({ get: async (...args) => { calls.push(args); return { status: 200, data: Buffer.from("zip"), headers: { "content-type": "application/zip" } }; } });
  assert.equal((await api.downloadSaveFile("/api/saves/1/content")).success, true);
  assert.equal((await api.downloadSaveFile({ id: 2, file_name: "save.zip", download_path: "/api/saves/2/content" })).success, true);
  assert.deepEqual(calls.map((call) => call[0]), ["/api/saves/1/content", "/api/saves/2/content"]);
  assert.deepEqual(calls[0][1], { responseType: "arraybuffer", timeout: 0 });
});

test("save download without a path is a local error", async (t) => {
  silenceConsole(t);
  const api = await apiWithClient({ get: async () => { throw new Error("must not run"); } });
  api.available = true;
  const result = await api.downloadSaveFile({ id: 1 });
  assert.equal(result.success, false);
  assert.match(result.error, /No download_path/);
  assert.equal(api.isAvailable, true);
});

test("uploadSave rejects missing files without changing connectivity", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-upload-");
  const api = await apiWithClient({});
  api.available = true;
  const result = await api.uploadSave(42, path.join(root, "missing.zip"));
  assert.equal(result.success, false);
  assert.match(result.error, /Save file not found/);
  assert.equal(api.isAvailable, true);
});

test("uploadSave sends multipart data, emulator name and refreshed CSRF", async (t) => {
  silenceConsole(t);
  const root = await makeTempDir(t, "romm-api-upload-");
  const save = path.join(root, "save.zip");
  await fs.writeFile(save, "ZIPDATA");
  let posted;
  const client = {
    get: async () => ({ headers: { "set-cookie": ["romm_csrftoken=fresh; Path=/"] } }),
    post: async (...args) => { posted = args; return { data: { id: 99 } }; },
  };
  const api = await apiWithClient(client);
  api.sessionToken = "romm_session=session";
  // Token refresh rebuilds the internal client, so keep this deterministic.
  api.initClient = async () => { api.client = client; };
  const result = await api.uploadSave(42, save, "ppsspp");
  assert.equal(result.success, true);
  assert.equal(posted[0], "/api/saves");
  assert.equal(posted[2].params.rom_id, 42);
  assert.equal(posted[2].headers["X-CSRFToken"], "fresh");
  assert.match(posted[2].headers.Cookie, /romm_session=session/);
  const payload = posted[1].getBuffer().toString("utf8");
  assert.match(payload, /ZIPDATA/);
  assert.match(payload, /ppsspp/);
});

test("testConnection normalizes supported heartbeat response shapes", async (t) => {
  silenceConsole(t);
  let heartbeat = { data: { data: { SYSTEM: { VERSION: "4.0" } } }, status: 200 };
  const client = { get: async (url) => (url === "" ? { data: "", headers: {} } : heartbeat) };
  const api = await apiWithClient(client);
  assert.deepEqual(await api.testConnection(), { success: true, data: { SYSTEM: { VERSION: "4.0" } } });
  heartbeat = { data: { success: false, SYSTEM: { VERSION: "4.1" } }, status: 200 };
  assert.deepEqual(await api.testConnection(), { success: true, data: { SYSTEM: { VERSION: "4.1" } } });
});

test("logout clears authentication after notifying the server", async (t) => {
  silenceConsole(t);
  let logoutCalls = 0;
  const api = await apiWithClient({ post: async (url) => { assert.equal(url, "/api/logout"); logoutCalls++; return {}; } });
  api.sessionToken = "romm_session=token";
  api.csrfToken = "csrf";
  api.initClient = async () => {};
  assert.deepEqual(await api.logout(), { success: true });
  assert.equal(logoutCalls, 1);
  assert.equal(api.sessionToken, null);
  assert.equal(api.csrfTokenValue, null);
  assert.equal(api.isAvailable, false);
});

test("HTTP wrapper errors expose status and update availability", async (t) => {
  silenceConsole(t);
  const api = await apiWithClient({ get: async () => { throw { isAxiosError: true, response: { status: 404, data: { detail: "not found" } }, config: { url: "/api/stats", method: "get" } }; } });
  const result = await api.fetchStats();
  assert.deepEqual(result, { success: false, error: "not found", status: 404, code: undefined });
  assert.equal(api.isAvailable, true);
});

test("credential login combines session and CSRF cookies from both responses", async (t) => {
  silenceConsole(t);
  const calls = [];
  const client = { get: async () => ({ status: 200, data: {} }) };
  const axios = {
    post: async (...args) => {
      calls.push(args);
      return { headers: { "set-cookie": ["romm_session=session-value; Path=/; HttpOnly"] } };
    },
    get: async (...args) => {
      calls.push(args);
      return { headers: { "set-cookie": ["romm_csrftoken=csrf-value; Path=/"] } };
    },
    create: (options) => {
      calls.push(["create", options]);
      return client;
    },
  };
  const api = new RommApi("https://romm.test///");
  await api.initClient();
  api.axiosPromise = Promise.resolve(axios);

  assert.deepEqual(await api.loginWithCredentials("alice", "secret"), { success: true, data: "alice" });
  assert.equal(calls[0][0], "https://romm.test/api/login");
  assert.equal(calls[0][2].headers.Authorization, `Basic ${Buffer.from("alice:secret").toString("base64")}`);
  assert.equal(api.sessionTokenValue, "session-value");
  assert.equal(api.csrfTokenValue, "csrf-value");
  assert.equal(api.isAuthenticated, true);
  assert.equal(api.isAvailable, true);
  const createOptions = calls.find((call) => call[0] === "create")[1];
  assert.equal(createOptions.headers.Cookie, "romm_session=session-value");
  assert.equal(createOptions.headers["X-CSRFToken"], "csrf-value");
});

test("rejected credential login clears authentication and reports the HTTP status", async (t) => {
  silenceConsole(t);
  const failure = { message: "bad login", isAxiosError: true, response: { status: 401, data: { detail: "invalid credentials" } } };
  const axios = { post: async () => { throw failure; }, get: async () => ({}), create: () => ({}) };
  const api = new RommApi("https://romm.test");
  await api.initClient();
  api.axiosPromise = Promise.resolve(axios);
  api.sessionToken = "romm_session=old";
  api.csrfToken = "old-csrf";

  const result = await api.loginWithCredentials("alice", "wrong");
  assert.equal(result.success, false);
  assert.equal(result.error, "invalid credentials");
  assert.equal(result.status, 401);
  assert.equal(api.isAuthenticated, false);
  assert.equal(api.csrfTokenValue, null);
});

test("saved session login installs auth headers and accepts a valid session", async (t) => {
  silenceConsole(t);
  const createOptions = [];
  const axios = {
    create: (options) => {
      createOptions.push(options);
      return { get: async (url) => ({ status: 200, data: { username: "alice", url } }) };
    },
  };
  const api = new RommApi("https://romm.test");
  await api.initClient();
  api.axiosPromise = Promise.resolve(axios);

  assert.deepEqual(await api.loginWithSession("saved-token", "saved-csrf"), { success: true, data: true });
  assert.equal(api.sessionTokenValue, "saved-token");
  assert.equal(api.csrfTokenValue, "saved-csrf");
  assert.equal(createOptions.at(-1).headers.Cookie, "romm_session=saved-token");
  assert.equal(createOptions.at(-1).headers["X-CSRFToken"], "saved-csrf");
  assert.equal(api.isAvailable, true);
});

test("saved session auth failures clear tokens while network failures preserve them", async (t) => {
  silenceConsole(t);
  const api = new RommApi("https://romm.test");
  await api.initClient();
  api.initClient = async () => {};
  api.client = { get: async () => { throw { message: "expired", isAxiosError: true, response: { status: 403 } }; } };
  const rejected = await api.loginWithSession("expired", "csrf");
  assert.equal(rejected.status, 403);
  assert.equal(api.sessionToken, null);

  api.client = { get: async () => { throw { message: "timeout", code: "ETIMEDOUT", isAxiosError: true, request: {} }; } };
  const unreachable = await api.loginWithSession("keep-me", "csrf-2");
  assert.equal(unreachable.code, "ETIMEDOUT");
  assert.equal(api.sessionTokenValue, "keep-me");
  assert.equal(api.csrfTokenValue, "csrf-2");
  assert.equal(api.isAvailable, false);
});

test("OAuth tokens and clearAuth rebuild the client with the right headers", async (t) => {
  silenceConsole(t);
  const options = [];
  const api = new RommApi("https://romm.test");
  await api.initClient();
  api.axiosPromise = Promise.resolve({ create: (value) => { options.push(value); return {}; } });
  api.setOAuthToken("oauth-token");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.sessionTokenValue, "oauth-token");
  assert.equal(options.at(-1).headers.Cookie, "romm_session=oauth-token");
  api.clearAuth();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.isAuthenticated, false);
  assert.deepEqual(options.at(-1).headers, {});
});

test("cookie parsing preserves values containing equals signs", async (t) => {
  silenceConsole(t);
  const api = new RommApi();
  assert.deepEqual(api.parseCookiesFromHeaders([
    "romm_session=abc==; Path=/; HttpOnly",
    "romm_csrftoken=csrf=token; Path=/",
    "malformed-cookie",
  ]), { romm_session: "abc==", romm_csrftoken: "csrf=token" });
});

test("credential login refuses responses without a session cookie", async (t) => {
  silenceConsole(t);
  const axios = {
    post: async () => ({ headers: {} }),
    get: async () => ({ headers: { "set-cookie": ["romm_csrftoken=csrf-only; Path=/"] } }),
    create: () => ({}),
  };
  const api = new RommApi("https://romm.test");
  await api.initClient();
  api.axiosPromise = Promise.resolve(axios);
  const result = await api.loginWithCredentials("alice", "secret");
  assert.equal(result.success, false);
  assert.match(result.error, /session cookie/);
  assert.equal(api.isAuthenticated, false);
});

test("authentication checks clear expired tokens but preserve them during outages", async (t) => {
  silenceConsole(t);
  const api = new RommApi("https://romm.test");
  await api.initClient();
  api.initClient = async () => {};
  api.sessionToken = "romm_session=valid";
  api.client = { get: async () => ({ status: 200, data: { username: "alice" } }) };
  assert.deepEqual(await api.testAuthentication(), { success: true, data: true });
  assert.equal(api.isAvailable, true);

  api.client = { get: async () => { throw { message: "expired", isAxiosError: true, response: { status: 401 } }; } };
  assert.equal((await api.testAuthentication()).status, 401);
  assert.equal(api.sessionToken, null);

  api.sessionToken = "romm_session=preserved";
  api.client = { get: async () => { throw { message: "network down", code: "ENETUNREACH", isAxiosError: true, request: {} }; } };
  assert.equal((await api.testAuthentication()).code, "ENETUNREACH");
  assert.equal(api.sessionTokenValue, "preserved");
  assert.equal(api.isAvailable, false);
});
