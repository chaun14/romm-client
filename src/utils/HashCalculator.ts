import crypto from "crypto";
import CRC32 from "crc-32";
import fs from "fs/promises";
import fsSync from "fs";

/**
 * Hash calculation utilities for ROM integrity verification
 * Uses streaming for large files to avoid memory issues
 */
export class HashCalculator {
  /**
   * Calculate CRC32 hash of a file (uses streaming for large files)
   */
  static async calculateCRC32(filePath: string) {
    try {
      const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB chunks
      const fileHandle = await fs.open(filePath, "r");
      const stats = await fileHandle.stat();
      const fileSize = stats.size;

      let crcValue = 0;
      let bytesRead = 0;

      const buffer = Buffer.alloc(CHUNK_SIZE);

      while (bytesRead < fileSize) {
        const { bytesRead: chunkBytes } = await fileHandle.read(buffer, 0, CHUNK_SIZE, bytesRead);
        if (chunkBytes === 0) break;

        const chunk = buffer.slice(0, chunkBytes);
        crcValue = CRC32.buf(chunk, crcValue);
        bytesRead += chunkBytes;
      }

      await fileHandle.close();

      // Convert signed to unsigned 32-bit integer
      const unsignedCrc = crcValue >>> 0;
      const crcHex = unsignedCrc.toString(16).toLowerCase().padStart(8, "0");

      console.log(`[CRC32] Calculated for ${fileSize} bytes: ${crcHex}`);
      return crcHex;
    } catch (error: any) {
      throw new Error(`Failed to calculate CRC32 for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Calculate MD5 hash of a file using streaming
   */
  static async calculateMD5(filePath: string) {
    try {
      return await this.calculateHashStreaming(filePath, "md5");
    } catch (error: any) {
      throw new Error(`Failed to calculate MD5 for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Calculate SHA1 hash of a file using streaming
   */
  static async calculateSHA1(filePath: string) {
    try {
      return await this.calculateHashStreaming(filePath, "sha1");
    } catch (error: any) {
      throw new Error(`Failed to calculate SHA1 for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Generic hash calculation using streaming
   */
  private static async calculateHashStreaming(filePath: string, algorithm: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fsSync.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 }); // 64MB chunks

      stream.on("data", (chunk: Buffer) => {
        hash.update(chunk);
      });

      stream.on("end", () => {
        resolve(hash.digest("hex"));
      });

      stream.on("error", (err: any) => {
        reject(new Error(`Stream error while calculating ${algorithm}: ${err.message}`));
      });
    });
  }

  /**
   * Calculate all hashes for a file
   */
  static async calculateAllHashes(filePath: string) {
    try {
      const [crc32, md5, sha1] = await Promise.all([this.calculateCRC32(filePath), this.calculateMD5(filePath), this.calculateSHA1(filePath)]);

      return {
        crc32,
        md5,
        sha1,
      };
    } catch (error: any) {
      throw new Error(`Failed to calculate hashes for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Verify file integrity against expected hashes
   */
  static async verifyFileIntegrity(filePath: string, expectedHashes: { crc_hash: string; md5_hash: string; sha1_hash: string }) {
    try {
      console.log(`[VERIFY] Starting integrity verification for file: ${filePath}`);
      console.log(`[VERIFY] Expected hashes from RomM:`, {
        crc_hash: expectedHashes.crc_hash,
        md5_hash: expectedHashes.md5_hash,
        sha1_hash: expectedHashes.sha1_hash,
      });

      const actualHashes = await this.calculateAllHashes(filePath);

      console.log(`[VERIFY] Calculated hashes for file:`, actualHashes);

      const results = {
        crc32: {
          expected: expectedHashes.crc_hash,
          actual: actualHashes.crc32,
          valid: actualHashes.crc32 === expectedHashes.crc_hash || actualHashes.crc32.toUpperCase() === expectedHashes.crc_hash.toUpperCase(),
        },
        md5: {
          expected: expectedHashes.md5_hash,
          actual: actualHashes.md5,
          valid: actualHashes.md5 === expectedHashes.md5_hash || actualHashes.md5.toUpperCase() === expectedHashes.md5_hash.toUpperCase(),
        },
        sha1: {
          expected: expectedHashes.sha1_hash,
          actual: actualHashes.sha1,
          valid: actualHashes.sha1 === expectedHashes.sha1_hash || actualHashes.sha1.toUpperCase() === expectedHashes.sha1_hash.toUpperCase(),
        },
      };

      console.log(`[VERIFY] Verification results:`, results);

      const isValid = results.crc32.valid || results.md5.valid || results.sha1.valid;

      console.log(`[VERIFY] Overall verification result: ${isValid ? "VALID" : "INVALID"}`);

      return {
        isValid,
        results,
        filePath,
      };
    } catch (error: any) {
      console.error(`[VERIFY] Error during integrity verification: ${error.message}`);
      return {
        isValid: false,
        error: error.message,
        filePath,
      };
    }
  }
}
