import crypto from "crypto";
import CRC32 from "crc-32";
import fs from "fs/promises";

/**
 * Hash calculation utilities for ROM integrity verification
 */
export class HashCalculator {
  /**
   * Calculate CRC32 hash of a file
   */
  static async calculateCRC32(filePath: string) {
    try {
      const data = await fs.readFile(filePath);

      // Use crc-32 package (returns signed 32-bit integer)
      const crcValue = CRC32.buf(data);

      // Convert signed to unsigned 32-bit integer
      const unsignedCrc = crcValue >>> 0;

      // Apply crc32_to_hex conversion (same as RomM)
      const crcHex = unsignedCrc.toString(16).toLowerCase().padStart(8, "0");

      console.log(`[CRC32] crc-32 result: ${crcValue} (signed), ${unsignedCrc} (unsigned), hex: ${crcHex}`);

      return crcHex;
    } catch (error: any) {
      throw new Error(`Failed to calculate CRC32 for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Calculate MD5 hash of a file
   */
  static async calculateMD5(filePath: string) {
    try {
      const data = await fs.readFile(filePath);
      return crypto.createHash("md5").update(data).digest("hex");
    } catch (error: any) {
      throw new Error(`Failed to calculate MD5 for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Calculate SHA1 hash of a file
   */
  static async calculateSHA1(filePath: string) {
    try {
      const data = await fs.readFile(filePath);
      return crypto.createHash("sha1").update(data).digest("hex");
    } catch (error: any) {
      throw new Error(`Failed to calculate SHA1 for ${filePath}: ${error.message}`);
    }
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
