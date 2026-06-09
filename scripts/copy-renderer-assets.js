const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererSource = path.join(root, "src", "renderer");
const rendererOut = path.join(root, "out", "renderer");

fs.mkdirSync(rendererOut, { recursive: true });

for (const file of ["loading.html", "login.html"]) {
  fs.copyFileSync(path.join(rendererSource, file), path.join(rendererOut, file));
}

fs.cpSync(path.join(rendererSource, "assets"), path.join(rendererOut, "assets"), {
  recursive: true,
});

fs.copyFileSync(path.join(root, "src", "preload.js"), path.join(root, "out", "preload.js"));
