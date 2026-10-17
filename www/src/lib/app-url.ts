type AppLocation = Pick<Location, "hostname">;

/** Keep the public website independent of the editor's deployment host. */
export function resolveAppUrl(
  configuredUrl?: string,
  location?: AppLocation,
): string {
  const override = configuredUrl?.trim();
  if (override) return override;
  if (
    location &&
    ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(
      location.hostname,
    )
  ) {
    return "http://localhost:5173";
  }

  return "https://legir.app";
}

export const SOURCE_URL = "https://github.com/99percentpeople/Legir";
