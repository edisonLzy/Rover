import { loadModelsConfig, resolveApiKey } from './config.js';
import type { ModelConnectionTestResult } from './types.js';

export interface TestModelConnectionOptions {
  provider: string;
  model: string;
  customConfigPath?: string;
  timeoutMs?: number;
}

/**
 * Executes a minimal ping / completion request to verify provider and model connectivity.
 */
export async function testModelConnection(
  options: TestModelConnectionOptions
): Promise<ModelConnectionTestResult> {
  const { provider: providerId, model: modelId, customConfigPath, timeoutMs = 8000 } = options;

  const config = loadModelsConfig(customConfigPath);
  const provider = config.providers[providerId];
  if (!provider) {
    return {
      success: false,
      latencyMs: 0,
      error: `提供商 "${providerId}" 未在配置中找到`,
    };
  }

  const model = provider.models?.find((m) => m.id === modelId);
  if (!model) {
    return {
      success: false,
      latencyMs: 0,
      error: `模型 "${modelId}" 未在提供商 "${providerId}" 中找到`,
    };
  }

  const apiKey = resolveApiKey(provider.apiKey);
  if (!apiKey) {
    return {
      success: false,
      latencyMs: 0,
      error: 'API Key 为空或绑定的环境变量未设置',
    };
  }

  const cleanBaseUrl = provider.baseUrl.replace(/\/+$/, '');
  const start = Date.now();

  try {
    let url: string;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...provider.headers,
    };
    let body: string;

    if (provider.api === 'anthropic-messages') {
      url = `${cleanBaseUrl}/messages`;
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
    } else {
      // Default to OpenAI compatible chat completions
      url = `${cleanBaseUrl}/chat/completions`;
      headers['authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - start;

    if (response.ok) {
      return {
        success: true,
        latencyMs,
        statusCode: response.status,
      };
    }

    const errorBody = await response.text();
    let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed?.error?.message) {
        errorMsg = parsed.error.message;
      } else if (parsed?.message) {
        errorMsg = parsed.message;
      }
    } catch {
      if (errorBody) {
        errorMsg = `${errorMsg} - ${errorBody.slice(0, 150)}`;
      }
    }

    return {
      success: false,
      latencyMs,
      statusCode: response.status,
      error: errorMsg,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout =
      (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
    return {
      success: false,
      latencyMs,
      error: isTimeout ? `请求超时 (${timeoutMs}ms)` : (err as Error).message || String(err),
    };
  }
}
