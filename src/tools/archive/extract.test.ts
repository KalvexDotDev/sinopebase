/**
 * Tests for ExtractZipArchive.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { CreateZipArchive } from "./create";
import { ExtractZipArchive } from "./extract";

describe("ExtractZipArchive", () => {
  let testDir: string;
  let extractDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pb_extract_test_"));
    extractDir = mkdtempSync(join(tmpdir(), "pb_extract_dest_"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(extractDir, { recursive: true, force: true });
  });

  it("extracts a zip archive from a file path", async () => {
    writeFileSync(join(testDir, "file.txt"), "hello world");

    const zipPath = join(testDir, "archive.zip");
    await CreateZipArchive([{ path: join(testDir, "file.txt") }], zipPath);

    await ExtractZipArchive(zipPath, extractDir);

    const extractedFile = join(extractDir, "file.txt");
    expect(existsSync(extractedFile)).toBe(true);
    expect(readFileSync(extractedFile, "utf-8")).toBe("hello world");
  });

  it("extracts a zip archive from a Uint8Array buffer", async () => {
    writeFileSync(join(testDir, "file.txt"), "buffer content");

    const zipPath = join(testDir, "archive.zip");
    await CreateZipArchive([{ path: join(testDir, "file.txt") }], zipPath);

    const zipBuffer = readFileSync(zipPath);
    await ExtractZipArchive(new Uint8Array(zipBuffer), extractDir);

    const extractedFile = join(extractDir, "file.txt");
    expect(existsSync(extractedFile)).toBe(true);
    expect(readFileSync(extractedFile, "utf-8")).toBe("buffer content");
  });

  it("extracts nested directory structure", async () => {
    mkdirSync(join(testDir, "a", "b"), { recursive: true });
    writeFileSync(join(testDir, "a", "b", "nested.txt"), "nested content");
    writeFileSync(join(testDir, "root.txt"), "root content");

    const zipPath = join(testDir, "archive.zip");
    // Using a custom name for the archive root to make test stable
    await CreateZipArchive([{ path: testDir, name: "root" }], zipPath);

    const extractSubdir = join(extractDir, "out");
    await ExtractZipArchive(zipPath, extractSubdir);

    expect(
      existsSync(join(extractSubdir, "root", "a", "b", "nested.txt")),
    ).toBe(true);
    expect(
      readFileSync(join(extractSubdir, "root", "root.txt"), "utf-8"),
    ).toBe("root content");
    expect(
      readFileSync(join(extractSubdir, "root", "a", "b", "nested.txt"), "utf-8"),
    ).toBe("nested content");
  });

  it("creates the destination directory if it does not exist", async () => {
    writeFileSync(join(testDir, "file.txt"), "content");

    const zipPath = join(testDir, "archive.zip");
    await CreateZipArchive([{ path: join(testDir, "file.txt") }], zipPath);

    const deepExtract = join(extractDir, "deep", "nested", "out");
    await ExtractZipArchive(zipPath, deepExtract);

    expect(existsSync(join(deepExtract, "file.txt"))).toBe(true);
  });

  it("safely handles path traversal entries (adm-zip normalizes them)", async () => {
    // adm-zip automatically normalizes paths like "../../../etc/passwd"
    // to "etc/passwd", so they end up safely inside the dest dir.
    const maliciousZip = new AdmZip();
    maliciousZip.addFile(
      "../../../etc/passwd",
      Buffer.from("content"),
    );
    const zipBuffer = maliciousZip.toBuffer();

    // Should not throw -- adm-zip normalizes the path
    await ExtractZipArchive(new Uint8Array(zipBuffer), extractDir);

    // The file should be safely inside the dest dir, not at /etc/passwd
    expect(existsSync(join(extractDir, "etc", "passwd"))).toBe(true);
    expect(readFileSync(join(extractDir, "etc", "passwd"), "utf-8")).toBe("content");
  });

  it("throws on invalid zip data", async () => {
    const invalidData = new Uint8Array([0, 1, 2, 3, 4, 5]);

    expect(
      ExtractZipArchive(invalidData, extractDir),
    ).rejects.toThrow();
  });

  it("throws when zip file does not exist", async () => {
    const missingPath = join(testDir, "nonexistent.zip");

    expect(
      ExtractZipArchive(missingPath, extractDir),
    ).rejects.toThrow();
  });
});
