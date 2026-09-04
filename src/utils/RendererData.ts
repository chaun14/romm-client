export const pageSize = 48;

export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as any).items)) return (value as any).items;
  return [];
}

export function getResultData<T>(result: any, fallback: T): T {
  if (result?.success && result.data !== undefined) return result.data as T;
  if (result !== null && result !== undefined && (typeof result !== "object" || !("success" in result))) return result as T;
  return fallback;
}
