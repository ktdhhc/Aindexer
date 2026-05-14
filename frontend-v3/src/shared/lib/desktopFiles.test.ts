import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const writeFileMock = vi.fn();
const statMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: writeFileMock,
  stat: statMock,
}));

import { confirmDesktopAction, pickDesktopOpenPath, pickDesktopSavePath, writeDownloadedFileToPath } from "./desktopFiles";

describe("desktopFiles", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    invokeMock.mockReset();
    writeFileMock.mockReset();
    statMock.mockReset();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI__: {} },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("uses the Rust pick_save_path command in desktop mode", async () => {
    invokeMock.mockResolvedValue("D:/exports/backup_all.zip");

    const result = await pickDesktopSavePath({
      title: "Save backup",
      defaultPath: "backup_all.zip",
      filters: [{ name: "Archive", extensions: ["zip"] }],
    });

    expect(result).toBe("D:/exports/backup_all.zip");
    expect(invokeMock).toHaveBeenCalledWith("pick_save_path", {
      title: "Save backup",
      defaultPath: "backup_all.zip",
      filters: [{ name: "Archive", extensions: ["zip"] }],
    });
  });

  it("writes downloaded bytes to the chosen file path", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/zip" });
    writeFileMock.mockResolvedValue(undefined);
    statMock.mockResolvedValue({ size: 4 });

    const result = await writeDownloadedFileToPath(
      {
        blob,
        filename: "backup_all.zip",
      },
      "D:/exports/backup_all.zip",
    );

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(statMock).toHaveBeenCalledWith("D:/exports/backup_all.zip");
    expect(result).toBe("D:/exports/backup_all.zip");
  });

  it("uses the Rust pick_open_file command in desktop mode", async () => {
    invokeMock.mockResolvedValue("D:/imports/restore.zip");

    const path = await pickDesktopOpenPath({
      title: "选择数据备份",
      filters: [{ name: "Backup", extensions: ["zip"] }],
    });

    expect(invokeMock).toHaveBeenCalledWith("pick_open_file", {
      title: "选择数据备份",
      filters: [{ name: "Backup", extensions: ["zip"] }],
    });
    expect(path).toBe("D:/imports/restore.zip");
  });

  it("uses the Rust confirm_desktop_action command in desktop mode", async () => {
    invokeMock.mockResolvedValue(true);

    const accepted = await confirmDesktopAction("覆盖当前数据并恢复 Chat？", "恢复数据");

    expect(accepted).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("confirm_desktop_action", {
      message: "覆盖当前数据并恢复 Chat？",
      title: "恢复数据",
    });
  });
});
