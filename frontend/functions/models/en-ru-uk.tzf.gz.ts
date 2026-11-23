export const onRequestGet: PagesFunction = async (context) => {
  const path = Array.isArray(context.params.path)
    ? context.params.path.join("/")
    : String(context.params.path || "");
  if (!path) return new Response("Missing path", { status: 400 });
  const res = await fetch(
    `https://github.com/n0-Nickname/StagePulse/releases/download/v1.0.0-models/${path}`,
    { headers: { "User-Agent": "Cloudflare-Pages-Proxy" } }
  );
  if (!res.ok || !res.body) {
    return new Response(`Upstream error: ${res.status}`, { status: 502 });
  }
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
};
