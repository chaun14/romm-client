const assert = require("node:assert/strict");
const test = require("node:test");

global.window = { location: { href: "https://client.local/app/" } };
const { asArray, getResultData, pageSize } = require("../out/utils/RendererData.js");
const { buildImageUrl, classNames, formatDateTime, formatSize, platformSlug, romPlatform, romSize } = require("../out/utils/RendererFormat.js");

test("formatSize selects units and precision", () => {
  assert.equal(formatSize(), "Unknown size");
  assert.equal(formatSize(0), "Unknown size");
  assert.equal(formatSize(-1), "Unknown size");
  assert.equal(formatSize(999), "999 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(1024 ** 3), "1.0 GB");
  assert.equal(formatSize(1024 ** 5), "1024.0 TB");
});

test("formatDateTime handles empty, invalid and valid values", () => {
  assert.equal(formatDateTime(), "");
  assert.equal(formatDateTime("not-a-date"), "");
  assert.notEqual(formatDateTime("2026-01-02T03:04:00Z"), "");
});

test("ROM size uses fields in compatibility order", () => {
  assert.equal(romSize({ file_size_bytes: 1, fs_size_bytes: 2, size: 3 }), 1);
  assert.equal(romSize({ fs_size_bytes: 2, size: 3 }), 2);
  assert.equal(romSize({ size: 3 }), 3);
  assert.equal(romSize({ files: [{ file_size_bytes: 4 }] }), 4);
});

test("ROM platform uses the most descriptive available label", () => {
  assert.equal(romPlatform({ platform_display_name: "Sony PSP", platform_name: "PSP", platform_slug: "psp" }), "Sony PSP");
  assert.equal(romPlatform({ platform_name: "PSP", platform_slug: "psp" }), "PSP");
  assert.equal(romPlatform({ platform_slug: "psp" }), "psp");
  assert.equal(romPlatform({}), "Unknown");
});

test("image URLs resolve absolute and relative sources safely", () => {
  assert.equal(buildImageUrl(undefined, "https://romm.test"), "");
  assert.equal(buildImageUrl("/assets/cover.png", "https://romm.test/root"), "https://romm.test/assets/cover.png");
  assert.equal(buildImageUrl("https://cdn.test/a.png", "https://romm.test"), "https://cdn.test/a.png");
  assert.equal(buildImageUrl("http://[invalid", "https://romm.test"), "http://[invalid");
});

test("platformSlug supports identified filesystem slugs", () => {
  assert.equal(platformSlug({ slug: "psp", fs_slug: "sony-psp", is_identified: true }), "psp");
  assert.equal(platformSlug({ fs_slug: "sony-psp", is_identified: true }), "sony-psp");
  assert.equal(platformSlug({ fs_slug: "custom", is_identified: false }), "");
});

test("classNames removes false and undefined values", () => {
  assert.equal(classNames("base", false, undefined, "active"), "base active");
});

test("API response helpers normalize arrays and payload envelopes", () => {
  assert.equal(pageSize, 48);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray({ items: [3] }), [3]);
  assert.deepEqual(asArray({ items: "bad" }), []);
  assert.deepEqual(asArray(null), []);
  assert.equal(getResultData({ success: true, data: 7 }, 0), 7);
  assert.equal(getResultData({ success: false, data: 7 }, 0), 0);
  assert.equal(getResultData("raw", "fallback"), "raw");
  assert.equal(getResultData(null, "fallback"), "fallback");
});
