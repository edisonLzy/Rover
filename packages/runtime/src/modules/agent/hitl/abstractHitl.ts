import crypto from 'node:crypto';
import type { PendingRequest } from './types.js';

export class CancelledError extends Error {
  constructor(message = 'Request cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export type HitlRequestListener<TPayload, TResult> = (
  pending: PendingRequest<TPayload, TResult>
) => void;

export abstract class AbstractHumanInTheLoop<TKind extends string, TPayload, TResult> {
  protected pendingRequests = new Map<string, PendingRequest<TPayload, TResult>>();
  private listeners: HitlRequestListener<TPayload, TResult>[] = [];
  public abstract readonly kind: TKind;

  public request(payload: TPayload): Promise<TResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    return new Promise<TResult>((resolve, reject) => {
      const pending: PendingRequest<TPayload, TResult> = {
        requestId,
        payload,
        createdAt: Date.now(),
        resolve,
        reject,
      };
      this.pendingRequests.set(requestId, pending);
      this.notifyListeners(pending);
    });
  }

  public resolve(requestId: string, result: TResult): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }
    this.pendingRequests.delete(requestId);
    pending.resolve(result);
    return true;
  }

  public reject(requestId: string, error: Error): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }
    this.pendingRequests.delete(requestId);
    pending.reject(error);
    return true;
  }

  public cancelAll(reason = 'Operation aborted'): void {
    const error = new CancelledError(reason);
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  public getPendingRequests(): Array<{
    requestId: string;
    payload: TPayload;
    createdAt: number;
  }> {
    return Array.from(this.pendingRequests.values()).map(({ requestId, payload, createdAt }) => ({
      requestId,
      payload,
      createdAt,
    }));
  }

  public hasPending(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }

  public onRequest(listener: HitlRequestListener<TPayload, TResult>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(pending: PendingRequest<TPayload, TResult>): void {
    for (const listener of this.listeners) {
      try {
        listener(pending);
      } catch (err) {
        console.error(`[AbstractHumanInTheLoop] Listener error:`, err);
      }
    }
  }
}
