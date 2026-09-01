/**
 * Extract a single string value from Express 5 params which can be string | string[].
 */
export function strParam(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}
