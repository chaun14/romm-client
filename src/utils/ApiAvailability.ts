export type ApiAvailabilityEffect = "available" | "unavailable" | "unchanged";

/**
 * Decide whether a failed operation says anything about RomM connectivity.
 * Local validation and filesystem errors must not change the connection state.
 */
export function getApiAvailabilityEffect(error: any): ApiAvailabilityEffect {
  const isAxiosError = error?.isAxiosError === true;
  const isHttpClientError = isAxiosError || Boolean(error?.response || error?.request || error?.config);
  if (!isHttpClientError) return "unchanged";

  const status = error?.response?.status;
  if (typeof status === "number") {
    return status === 401 || status === 403 ? "unavailable" : "available";
  }

  return "unavailable";
}
