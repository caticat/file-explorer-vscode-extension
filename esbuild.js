const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info"
};

async function main() {
  if (production) {
    const outputDirectory = path.resolve(__dirname, "dist");
    if (outputDirectory.startsWith(path.resolve(__dirname) + path.sep)) {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  }

  const extension = await esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"]
  });

  const webview = await esbuild.context({
    ...common,
    entryPoints: ["src/webview.ts"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife"
  });

  if (watch) {
    await Promise.all([extension.watch(), webview.watch()]);
    console.log("Watching extension and webview sources...");
    return;
  }

  await Promise.all([extension.rebuild(), webview.rebuild()]);
  await Promise.all([extension.dispose(), webview.dispose()]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
