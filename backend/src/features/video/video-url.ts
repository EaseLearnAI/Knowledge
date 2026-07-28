const supportedVideoHosts = [
  "bilibili.com",
  "b23.tv",
  "douyin.com",
  "iesdouyin.com",
  "xiaohongshu.com",
  "xhslink.com",
] as const;

const httpUrlPattern = /https?:\/\/[^\s<>"'`]+/giu;
const trailingSharePunctuation = /[)\]}>.,!?;:，。！？；：、）］】》」』]+$/u;

function parseHttpUrl(candidate: string): URL | null {
  const normalized = candidate
    .replaceAll("&amp;", "&")
    .replace(trailingSharePunctuation, "");
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractHttpUrls(rawValue: string): URL[] {
  return (rawValue.match(httpUrlPattern) ?? [])
    .map(parseHttpUrl)
    .filter((url): url is URL => url !== null);
}

export function isSupportedVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return supportedVideoHosts.some(
    (supportedHost) =>
      host === supportedHost || host.endsWith(`.${supportedHost}`),
  );
}

export function extractSupportedVideoUrl(rawValue: string): string | null {
  return extractHttpUrls(rawValue).find(isSupportedVideoUrl)?.toString() ?? null;
}
