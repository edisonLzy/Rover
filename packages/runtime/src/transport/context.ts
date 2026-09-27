import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CreateContextOptions {
  req: IncomingMessage;
  res: ServerResponse;
  expectedToken: string;
}

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  token: string | null;
  isAuthenticated: boolean;
}

/**
 * Extracts Bearer token from Authorization header or URL query parameters.
 */
export function extractAuthToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // Fallback: check query parameter
  if (req.url) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const queryToken = url.searchParams.get('token');
      if (queryToken) {
        return queryToken.trim();
      }
    } catch {
      // Ignore invalid URL
    }
  }

  return null;
}

/**
 * Creates the tRPC context for an incoming HTTP request.
 */
export function createContext({ req, res, expectedToken }: CreateContextOptions): Context {
  const token = extractAuthToken(req);
  const isAuthenticated = Boolean(token && token === expectedToken);

  return {
    req,
    res,
    token,
    isAuthenticated,
  };
}
