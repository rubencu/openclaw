import fsPromises from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILD_ALL_PROFILES,
  BUILD_ALL_STEPS,
  createBuildAllControlUiSnapshot,
  resolveBuildAllStep,
  resolveBuildAllSteps,
  restoreBuildAllControlUiSnapshot,
} from "../../scripts/build-all.mjs";
import { createScriptTestHarness } from "./test-helpers.ts";

const { createTempDir } = createScriptTestHarness();

describe("resolveBuildAllStep", () => {
  it("routes pnpm steps through the npm_execpath pnpm runner on Windows", () => {
    const step = BUILD_ALL_STEPS.find((entry) => entry.label === "canvas:a2ui:bundle");
    expect(step).toBeTruthy();

    const result = resolveBuildAllStep(step, {
      platform: "win32",
      nodeExecPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "C:/Users/test/AppData/Local/pnpm/10.32.1/bin/pnpm.cjs",
      env: {},
    });

    expect(result).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:/Users/test/AppData/Local/pnpm/10.32.1/bin/pnpm.cjs", "canvas:a2ui:bundle"],
      options: {
        stdio: "inherit",
        env: {},
        shell: false,
        windowsVerbatimArguments: undefined,
      },
    });
  });

  it("keeps node steps on the current node binary", () => {
    const step = BUILD_ALL_STEPS.find((entry) => entry.label === "runtime-postbuild");
    expect(step).toBeTruthy();

    const result = resolveBuildAllStep(step, {
      nodeExecPath: "/custom/node",
      env: { FOO: "bar" },
    });

    expect(result).toEqual({
      command: "/custom/node",
      args: ["scripts/runtime-postbuild.mjs"],
      options: {
        stdio: "inherit",
        env: { FOO: "bar" },
      },
    });
  });

  it("adds heap headroom for plugin-sdk dts on Windows", () => {
    const step = BUILD_ALL_STEPS.find((entry) => entry.label === "build:plugin-sdk:dts");
    expect(step).toBeTruthy();

    const result = resolveBuildAllStep(step, {
      platform: "win32",
      nodeExecPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "C:/Users/test/AppData/Local/pnpm/10.32.1/bin/pnpm.cjs",
      env: { FOO: "bar" },
    });

    expect(result).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:/Users/test/AppData/Local/pnpm/10.32.1/bin/pnpm.cjs", "build:plugin-sdk:dts"],
      options: {
        stdio: "inherit",
        env: {
          FOO: "bar",
          NODE_OPTIONS: "--max-old-space-size=4096",
        },
        shell: false,
        windowsVerbatimArguments: undefined,
      },
    });
  });
});

describe("resolveBuildAllSteps", () => {
  it("keeps the full profile aligned with the declared steps", () => {
    expect(resolveBuildAllSteps("full")).toEqual(BUILD_ALL_STEPS);
    expect(BUILD_ALL_PROFILES.full).toEqual(BUILD_ALL_STEPS.map((step) => step.label));
  });

  it("uses a runtime-only profile for ci artifacts", () => {
    expect(resolveBuildAllSteps("ciArtifacts").map((step) => step.label)).toEqual([
      "canvas:a2ui:bundle",
      "tsdown",
      "runtime-postbuild",
      "write-npm-update-compat-sidecars",
      "build-stamp",
      "canvas-a2ui-copy",
      "copy-hook-metadata",
      "copy-export-html-templates",
      "write-build-info",
      "write-cli-startup-metadata",
      "write-cli-compat",
    ]);
  });

  it("rejects unknown build profiles", () => {
    expect(() => resolveBuildAllSteps("wat")).toThrow("Unknown build profile: wat");
  });
});

describe("control-ui preservation", () => {
  it("restores a prebuilt control-ui bundle when build cleanup removes it", async () => {
    const rootDir = createTempDir("openclaw-build-all-");
    const controlUiDir = path.join(rootDir, "dist", "control-ui");
    await fsPromises.mkdir(path.join(controlUiDir, "assets"), { recursive: true });
    await fsPromises.writeFile(path.join(controlUiDir, "index.html"), "<html>ui</html>\n", "utf8");
    await fsPromises.writeFile(path.join(controlUiDir, "assets", "index.js"), "asset\n", "utf8");

    const snapshot = createBuildAllControlUiSnapshot({ cwd: rootDir });

    expect(snapshot).toBeTruthy();
    await fsPromises.rm(controlUiDir, { recursive: true, force: true });

    expect(restoreBuildAllControlUiSnapshot(snapshot)).toBe(true);
    await expect(fsPromises.readFile(path.join(controlUiDir, "index.html"), "utf8")).resolves.toBe(
      "<html>ui</html>\n",
    );
    await expect(
      fsPromises.readFile(path.join(controlUiDir, "assets", "index.js"), "utf8"),
    ).resolves.toBe("asset\n");
  });
});
