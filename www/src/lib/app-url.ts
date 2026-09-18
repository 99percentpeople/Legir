type AppLocation = Pick<Location, "protocol" | "host" | "hostname">;

/** Keep the public website independent of the editor's deployment host. */
export function resolveAppUrl(
  configuredUrl?: string,
  location?: AppLocation,
): string {
  const override = configuredUrl?.trim();
  if (override) return override;
  if (!location) return "/";

  const { protocol, host, hostname } = location;
  if (
    ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(hostname)
  ) {
    return "http://localhost:5173";
  }

  const appHost = host.startsWith("www.") ? host.slice(4) : host;
  return `${protocol}//${appHost.startsWith("app.") ? appHost : `app.${appHost}`}`;
}

export const SOURCE_URL = "https://github.com/99percentpeople/Legir";
