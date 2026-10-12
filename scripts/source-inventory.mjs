#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const languages = new Map([
  [".js", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript JSX"],
  [".jsx", "JavaScript JSX"],
  [".css", "CSS"],
  [".scss", "SCSS"],
  [".html", "HTML"],
]);

const excludedDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);

async function* sourceFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) yield* sourceFiles(root, path);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!languages.has(extension)) continue;
    if (entry.name.endsWith(".min.js") || entry.name.endsWith(".min.css")) continue;
    yield path;
  }
}

function classify(lines, extension) {
  const counts = { blank: 0, comment: 0, substantive: 0 };
  let blockComment = false;
  let htmlComment = false;
  for (const line of lines) {
    const value = line.trim();
    if (!value) {
      counts.blank += 1;
      continue;
    }
    if (extension === ".html") {
      if (htmlComment) {
        counts.comment += 1;
        if (value.includes("-->")) htmlComment = false;
        continue;
      }
      if (value.startsWith("<!--")) {
        counts.comment += 1;
        htmlComment = !value.includes("-->");
        continue;
      }
      counts.substantive += 1;
      continue;
    }
    if (blockComment) {
      counts.comment += 1;
      if (value.includes("*/")) blockComment = false;
      continue;
    }
    if (value.startsWith("//")) {
      counts.comment += 1;
      continue;
    }
    if (value.startsWith("/*") || value.startsWith("*")) {
      counts.comment += 1;
      blockComment = !value.includes("*/");
      continue;
    }
    counts.substantive += 1;
  }
  return counts;
}

export async function inventory(rootPath = process.cwd()) {
  const root = resolve(rootPath);
  if (!(await stat(root)).isDirectory()) throw new TypeError("source root must be a directory");
  const files = [];
  for await (const path of sourceFiles(root)) {
    const extension = extname(path).toLowerCase();
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const counts = classify(lines, extension);
    files.push({
      path: relative(root, path).replaceAll("\\", "/"),
      language: languages.get(extension),
      physical: lines.length,
      substantive: counts.substantive,
      blank: counts.blank,
      comments: counts.comment,
    });
  }
  const totals = files.reduce(
    (result, file) => ({
      physical: result.physical + file.physical,
      substantive: result.substantive + file.substantive,
      blank: result.blank + file.blank,
      comments: result.comments + file.comments,
    }),
    { physical: 0, substantive: 0, blank: 0, comments: 0 },
  );
  return { root, files, ...totals };
}

function grouped(result) {
  const values = new Map();
  for (const file of result.files) {
    const current = values.get(file.language) ?? {
      language: file.language,
      files: 0,
      physical: 0,
      substantive: 0,
      blank: 0,
      comments: 0,
    };
    current.files += 1;
    current.physical += file.physical;
    current.substantive += file.substantive;
    current.blank += file.blank;
    current.comments += file.comments;
    values.set(file.language, current);
  }
  return [...values.values()].sort((left, right) => left.language.localeCompare(right.language));
}

function table(result) {
  const rows = [
    ["Language", "Files", "Physical", "Substantive", "Blank", "Comments"],
    ...grouped(result).map((item) => [
      item.language,
      String(item.files),
      String(item.physical),
      String(item.substantive),
      String(item.blank),
      String(item.comments),
    ]),
    ["TOTAL", String(result.files.length), String(result.physical), String(result.substantive), "", ""],
  ];
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => row[index].length)));
  return rows.map((row) => row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd()).join("\n");
}

function parseArguments(arguments_) {
  const options = { root: ".", json: false, files: false, minimum: undefined };
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    if (value === "--json") options.json = true;
    else if (value === "--files") options.files = true;
    else if (value === "--minimum") {
      options.minimum = Number(arguments_[index + 1]);
      index += 1;
      if (!Number.isSafeInteger(options.minimum) || options.minimum < 0) {
        throw new RangeError("minimum must be a non-negative integer");
      }
    } else if (value.startsWith("-")) {
      throw new RangeError(`unknown option: ${value}`);
    } else {
      options.root = value;
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await inventory(options.root);
  if (options.json) {
    const output = options.files ? result : { ...result, files: undefined, fileCount: result.files.length };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(table(result));
  }
  if (options.minimum !== undefined && result.substantive < options.minimum) {
    console.error(`Substantive source is below the required minimum of ${options.minimum}.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`inventory error: ${error.message}`);
    process.exitCode = 2;
  });
}
