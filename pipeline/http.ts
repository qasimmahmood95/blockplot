/** Shared HTTP layer for pipeline fetchers: retries on 429/5xx and network errors. */
export async function get(url: string, accept = 'application/json', attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept } });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.ok) return res;
    lastError = new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw lastError;
  }
  throw lastError instanceof Error ? lastError : new Error(`GET ${url} failed`);
}

export async function getText(url: string): Promise<string> {
  const res = await get(url, 'text/csv,text/plain,*/*');
  return res.text();
}
