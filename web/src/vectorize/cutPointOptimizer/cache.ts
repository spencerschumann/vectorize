import type { FitResult } from "./types.ts";

/**
 * A simple cache for storing the results of fitting pixel ranges.
 * This avoids redundant computations during the optimization process.
 */
export class FitCache {
  private cache: Map<string, FitResult> = new Map();

  /**
   * Generates a unique key for a given start and end index.
   * @param start The start index of the pixel range.
   * @param end The end index of the pixel range.
   * @returns A string key.
   */
  private getKey(start: number, end: number): string {
    return `${start}-${end}`;
  }

  /**
   * Retrieves a cached FitResult for a given pixel range.
   * @param start The start index of the pixel range.
   * @param end The end index of the pixel range.
   * @returns The cached FitResult, or undefined if not found.
   */
  get(start: number, end: number): FitResult | undefined {
    return this.cache.get(this.getKey(start, end));
  }

  /**
   * Stores a FitResult in the cache for a given pixel range.
   * @param start The start index of the pixel range.
   * @param end The end index of the pixel range.
   * @param result The FitResult to cache.
   */
  set(start: number, end: number, result: FitResult): void {
    this.cache.set(this.getKey(start, end), result);
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }
}
