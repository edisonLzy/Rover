export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description: string;
}

export async function pollUntil<T>(
  read: () => T | null | undefined | Promise<T | null | undefined>,
  options: PollOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null && value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${options.description} after ${timeoutMs}ms.${suffix}`);
}
