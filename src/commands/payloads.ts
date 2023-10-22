import { resolve } from "pathe";
import { defineCommand } from "citty";
import fs from "node:fs"

import { legacyRootDirArgs, sharedArgs } from './_shared'

export default defineCommand({
  meta: {
    name: "payloads",
    description: "Used to analyse size of generated payloads"
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || ".");

    const outputDir = resolve(cwd, ".output");
    const publicDir = resolve(outputDir, "public");

    // List payloads files in .output/public (can be in subfolders so we call the function recursively)
    const listPayloads = (sourceDir: string): string[] => {
      const payloads: string[] = [];
      const files = fs.readdirSync(sourceDir);
      files.forEach(file => {
        const filePath = resolve(sourceDir, file);

        const isFile = fs.statSync(filePath).isFile();
        if (isFile && file === "_payload.json") {
          payloads.push(filePath);
          return
        }

        const isDirectory = fs.statSync(filePath).isDirectory();
        if (isDirectory) {
          const subPayloads = listPayloads(filePath);
          payloads.push(...subPayloads);
          return
        }
      });
      return payloads;
    }

    const payloads = listPayloads(publicDir);

    // Get size of each payload
    const payloadsSizes = payloads.map(payload => {
      const payloadSize = fs.statSync(payload).size;
      return {
        payload,
        payloadSize
      }
    });

    // Sort payloads by size
    const sortedPayloads = payloadsSizes.sort((a, b) => b.payloadSize - a.payloadSize);

    // Display sorted payloads
    sortedPayloads.forEach(payload => {
      console.log(`${payload.payload} ${toHumainSize(payload.payloadSize)}`);
    });
    // TODO: improve output. We could use a table like or a tree like output (waiting for https://github.com/unjs/consola/pull/223).
  },
})

function toHumanSize(bytes: number): string {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Byte";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round(bytes / Math.pow(1024, i))} ${sizes[i]}`;
}
