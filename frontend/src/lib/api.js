/** Normalize list endpoints that may return either an array or paginated payload. */
export function unwrapListPayload(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}
