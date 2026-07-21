/**
 * Tests for CreateZipArchive.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { CreateZipArchive } from "./create";

describe("CreateZipArchive", () => {
  let testDir: string;
  let destDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pb_create_test_"));
    destDir = mkdtempSync(join(tmpdir(), "pb_create_dest_"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
  });

  it("creates a zip archive from a single file", async () => {
    const filePath = join(testDir, "test.txt");
    writeFileSync(filePath, "hello world");

    const zipPath = join(destDir, "output.zip");
    await CreateZipArchive([{ path: filePath }], zipPath);

    expect(existsSync(zipPath)).toBe(true);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.entryName).toBe("test.txt");
    expect(entries[0]?.getData()?.toString()).toBe("hello world");
  });

  it("creates a zip archive from a single file with a custom name", async () => {
    const filePath = join(testDir, "test.txt");
    writeFileSync(filePath, "hello world");

    const zipPath = join(destDir, "output.zip");
    await CreateZipArchive([{ path: filePath, name: "renamed.txt" }], zipPath);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.entryName).toBe("renamed.txt");
  });

  it("creates a zip archive from a directory with a stable name", async () => {
    // Create directory structure
    mkdirSync(join(testDir, "subdir"), { recursive: true });
    writeFileSync(join(testDir, "file1.txt"), "content1");
    writeFileSync(join(testDir, "subdir", "file2.txt"), "content2");

    const zipPath = join(destDir, "output.zip");
    // Use a custom name to avoid temp dir random suffix issues
    await CreateZipArchive([{ path: testDir, name: "root" }], zipPath);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    expect(entries.length).toBe(2);

    const entryNames = entries.map((e) => e.entryName).sort();
    expect(entryNames).toEqual(["root/file1.txt", "root/subdir/file2.txt"]);
  });

  it("creates a zip archive from a directory with a custom archive name", async () => {
    writeFileSync(join(testDir, "file.txt"), "content");

    const zipPath = join(destDir, "output.zip");
    await CreateZipArchive([{ path: testDir, name: "archive_root" }], zipPath);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.entryName).toBe(
      "archive_root/file.txt",
    );
  });

  it("skips a directory listed in skipPaths", async () => {
    mkdirSync(join(testDir, "skip_me"), { recursive: true });
    mkdirSync(join(testDir, "keep_me"), { recursive: true });
    writeFileSync(join(testDir, "keep_me", "file.txt"), "keep");
    writeFileSync(join(testDir, "skip_me", "file.txt"), "skip");

    const zipPath = join(destDir, "output.zip");
    await CreateZipArchive([{ path: testDir, name: "root" }], zipPath, [
      "skip_me",
    ]);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.entryName).toBe("root/keep_me/file.txt");
  });

  it("skips a file listed in skipPaths", async () => {
    writeFileSync(join(testDir, "keep.txt"), "keep");
    writeFileSync(join(testDir, "skip.txt"), "skip");

    const zipPath = join(destDir, "output.zip");
    await CreateZipArchive([{ path: testDir, name: "root" }], zipPath, [
      "skip.txt",
    ]);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.entryName).toBe("root/keep.txt");
  });

  it("creates the destination directory if it does not exist", async () => {
    writeFileSync(join(testDir, "file.txt"), "content");

    const nestedDest = join(destDir, "nested", "deep", "output.zip");
    await CreateZipArchive([{ path: join(testDir, "file.txt") }], nestedDest);

    expect(existsSync(nestedDest)).toBe(true);
  });

  it("throws if a source path does not exist", async () => {
    const missingPath = join(testDir, "nonexistent.txt");

    expect(
      CreateZipArchive([{ path: missingPath }], join(destDir, "out.zip")),
    ).rejects.toThrow();
  });

  it("creates an archive from multiple sources", async () => {
    writeFileSync(join(testDir, "a.txt"), "aaa");

    const dir2 = mkdtempSync(join(tmpdir(), "pb_src2_"));
    try {
      writeFileSync(join(dir2, "b.txt"), "bbb");

      const zipPath = join(destDir, "multi.zip");
      await CreateZipArchive(
        [
          { path: join(testDir, "a.txt") },
          { path: dir2, name: "source2" },
        ],
        zipPath,
      );

      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      expect(entries.length).toBe(2);

      const names = entries.map((e) => e.entryName).sort();
      expect(names).toEqual([
        "a.txt",
        "source2/b.txt",
      ]);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
