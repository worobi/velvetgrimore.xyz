fetch(`http://127.0.0.1:${process.env.PORT || 8080}/api/health`, { signal: AbortSignal.timeout(4000) })
  .then(async response => { const body = await response.json(); process.exit(response.ok && body.ok ? 0 : 1); })
  .catch(() => process.exit(1));
