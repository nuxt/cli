import { describe, expect, it, vi } from "vitest";
import * as utils from "../../../../src/commands/module/_utils";
// import * as c12 from "c12/update";
import commands from "../../../../src/commands/module";
import * as runCommands from "../../../../src/run";

const updateConfig = vi.fn(() => Promise.resolve());
const addDependency = vi.fn(() => Promise.resolve());

const applyMocks = () => {
  vi.mock("c12/update", async (importOriginal) => {
    return {
      updateConfig,
    };
  });
  vi.mock("nypm", async (importOriginal) => {
    return {
      addDependency,
    };
  });
  vi.mock("pkg-types", async (importOriginal) => {
    return {
      readPackageJSON: () => {
        return new Promise((resolve) => {
          resolve({
            devDependencies: {
              nuxt: "3.0.0",
            },
          });
        });
      },
    };
  });
};
describe("module add", () => {
  applyMocks();
  vi.spyOn(runCommands, "runCommand").mockImplementation(vi.fn());
  vi.spyOn(utils, "getNuxtVersion").mockResolvedValue("3.0.0");
  vi.spyOn(utils, "fetchModules").mockResolvedValue([
    {
      name: "content",
      npm: "@nuxt/content",
      compatibility: {
        nuxt: "3.0.0",
      },
    },
  ]);


  it("should  install Nuxt module", async () => {
    const addCommand = await commands.subCommands.add();
    await addCommand.setup({
      args: {
        cwd: "/fake-dir",
        _: ["content"],
      },
    });

    expect(addDependency).toHaveBeenCalledWith(["@nuxt/content@3.0.0"], {
      cwd: "/fake-dir",
      dev: true,
      installPeerDependencies: true,
    });
  });

  it("should convert versioned module to Nuxt module", async () => {
    const addCommand = await commands.subCommands.add();
    await addCommand.setup({
      args: {
        cwd: "/fake-dir",
        _: ["content@2.9.0"],
      },
    });

    expect(addDependency).toHaveBeenCalledWith(["@nuxt/content@2.9.0"], {
      cwd: "/fake-dir",
      dev: true,
      installPeerDependencies: true,
    });
  });
});
