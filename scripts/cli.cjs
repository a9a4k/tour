#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { resolveBinaryPath } = require("./resolveBinary.cjs");

let binaryPath;
try {
  binaryPath = resolveBinaryPath();
} catch {
  console.error(`tour: no prebuilt binary for ${process.platform}-${process.arch}.`);
  console.error(`Supported: darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64.`);
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const cleanedArgs = rawArgs.filter((arg) => {
  if (arg === binaryPath) return false;
  try {
    const pattern = /node_modules[/\\]tourdiff-(darwin|linux|windows)-[^/\\]+[/\\]tour(\.exe)?$/i;
    return !pattern.test(arg);
  } catch {
    return true;
  }
});

const child = spawn(binaryPath, cleanedArgs, {
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error(`tour: binary not found at ${binaryPath}`);
    console.error(`Re-install for your platform (${process.platform}-${process.arch}).`);
  } else {
    console.error("tour: failed to start:", err);
  }
  process.exit(1);
});
