import { build } from "esbuild";
import { fileURLToPath } from "node:url";

type ClientAsset = {
  content: string | Uint8Array;
  contentType: string;
};

type BundledAsset = {
  content: string | Uint8Array;
  contentType: string;
};

let cachedAssets: Promise<Map<string, BundledAsset>> | undefined;

export function getAppClientBundle(): Promise<string> {
  return getAppClientAsset("/assets/client.js").then((asset) => {
    if (!asset) throw new Error("esbuild produced no client bundle");
    return typeof asset.content === "string" ? asset.content : new TextDecoder().decode(asset.content);
  });
}

export async function getAppClientAsset(pathname: string): Promise<ClientAsset | undefined> {
  const assets = await getBundledAssets();
  return assets.get(pathname);
}

function getBundledAssets(): Promise<Map<string, BundledAsset>> {
  cachedAssets ??= buildClientAssets();
  return cachedAssets;
}

async function buildClientAssets(): Promise<Map<string, BundledAsset>> {
  const entry = fileURLToPath(new URL("./entry.tsx", import.meta.url));
  try {
    const result = await build({
      entryPoints: { client: entry },
      bundle: true,
      format: "esm",
      splitting: true,
      platform: "browser",
      target: "es2022",
      write: false,
      outdir: "/assets",
      logLevel: "silent",
      jsx: "automatic",
      entryNames: "[name]",
      chunkNames: "chunks/[name]-[hash]",
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
    });

    const assets = new Map<string, BundledAsset>();
    for (const output of result.outputFiles) {
      assets.set(output.path, {
        content: output.text,
        contentType: contentTypeFor(output.path),
      });
    }
    if (!assets.has("/assets/client.js")) throw new Error("esbuild produced no client bundle");
    return assets;
  } catch (err) {
    throw err;
  }
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
