export const onRequestGet: PagesFunction = async () => {
  const res = await fetch(
    "https://github.com/n0-Nickname/stagepulse/releases/download/v1.0.0-models/en-ru-uk.tzf.gz"
  );
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/gzip",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
};
