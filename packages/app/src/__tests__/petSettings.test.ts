import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '@tauri-apps/plugin-store';
import { DEFAULT_PET_SIZE, PetPreferencesStore } from '../shared/preferences/pet.js';

vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));

class SettingsWindow extends EventTarget {
  private stored = new Map<string, string>();
  localStorage = {
    getItem: vi.fn((key: string) => this.stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      this.stored.set(key, value);
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pluginStorage() {
  let value: unknown;
  const listeners = new Set<(value: unknown) => void>();
  const change = (next: unknown) => {
    value = next;
    listeners.forEach((listener) => listener(next));
  };
  const unlisten = vi.fn();
  const store = {
    get: vi.fn(async () => value),
    set: vi.fn(async (_key: string, next: unknown) => {
      change(next);
    }),
    save: vi.fn(async () => {}),
    onKeyChange: vi.fn(async (_key: string, listener: (value: unknown) => void) => {
      listeners.add(listener);
      return () => {
        unlisten();
        listeners.delete(listener);
      };
    }),
  };
  vi.mocked(load).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof load>>);
  return { store, change, unlisten };
}

let browser: SettingsWindow;
const stores: PetPreferencesStore[] = [];
function createStore() {
  const store = new PetPreferencesStore();
  stores.push(store);
  return store;
}

beforeEach(() => {
  vi.resetAllMocks();
  browser = new SettingsWindow();
  // Simulate the marker used by the official isTauri() API.
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('window', browser);
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  vi.unstubAllGlobals();
});

describe('PetPreferencesStore', () => {
  it('caches initialization, snapshots and one plugin subscription per WebView', async () => {
    const backend = pluginStorage();
    const store = createStore();
    const initial = store.getSnapshot();
    expect(initial.size).toBe(DEFAULT_PET_SIZE);
    expect(store.getSnapshot()).toBe(initial);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.subscribe(() => {});
    await Promise.all([store.initialize(), store.initialize()]);
    expect(load).toHaveBeenCalledOnce();
    expect(backend.store.onKeyChange).toHaveBeenCalledOnce();
    const ready = store.getSnapshot();
    backend.change(75);
    expect(store.getSnapshot()).toBe(ready);
    unsubscribe();
    listener.mockClear();
    backend.change(90);
    expect(listener).not.toHaveBeenCalled();
  });

  it('shares native state and lets a newly opened window read the latest value', async () => {
    const backend = pluginStorage();
    const dashboard = createStore();
    const pet = createStore();
    await Promise.all([dashboard.initialize(), pet.initialize()]);
    await dashboard.setSize(90);
    expect(pet.getSnapshot().size).toBe(90);
    const reopened = createStore();
    await reopened.initialize();
    expect(reopened.getSnapshot().size).toBe(90);
    expect(backend.store.save).toHaveBeenCalledOnce();
    expect(browser.localStorage.getItem).not.toHaveBeenCalled();
    expect(browser.localStorage.setItem).not.toHaveBeenCalled();
    backend.change(120);
    expect(dashboard.getSnapshot().size).toBe(120);
    expect(backend.store.set).toHaveBeenCalledOnce();
  });

  it('keeps a newer change received while the initial read is pending', async () => {
    const backend = pluginStorage();
    const read = deferred<unknown>();
    backend.store.get.mockImplementationOnce(() => read.promise);
    const store = createStore();
    const initialization = store.initialize();
    await vi.waitFor(() => expect(backend.store.get).toHaveBeenCalledOnce());
    backend.change(110);
    read.resolve(75);
    await initialization;
    expect(store.getSnapshot()).toMatchObject({ size: 110, status: 'ready' });
  });

  it('validates persisted values and serializes rapid writes', async () => {
    const backend = pluginStorage();
    backend.change(500);
    const store = createStore();
    await store.initialize();
    expect(store.getSnapshot().size).toBe(75);
    await Promise.all([store.setSize(91), store.setSize(105)]);
    expect(backend.store.set.mock.calls).toEqual([
      ['pet.size', 90],
      ['pet.size', 105],
    ]);
    expect(store.getSnapshot().size).toBe(105);
  });

  it('reports persistence failures and recovers on the next write', async () => {
    const backend = pluginStorage();
    const store = createStore();
    await store.initialize();
    backend.store.save.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(store.setSize(90)).rejects.toThrow('disk unavailable');
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'disk unavailable' });
    await store.setSize(100);
    expect(store.getSnapshot()).toMatchObject({ size: 100, status: 'ready', error: null });
  });

  it('can retry initialization after the plugin fails to load', async () => {
    pluginStorage();
    vi.mocked(load).mockRejectedValueOnce(new Error('load failed'));
    const store = createStore();
    await expect(store.initialize()).rejects.toThrow('load failed');
    expect(store.getSnapshot().status).toBe('error');
    await store.setSize(85);
    expect(store.getSnapshot()).toMatchObject({ size: 85, status: 'ready' });
  });

  it('cleans up a listener that finishes registering after disposal', async () => {
    const backend = pluginStorage();
    const subscription = deferred<() => void>();
    backend.store.onKeyChange.mockReturnValueOnce(subscription.promise);
    const store = createStore();
    const initialization = store.initialize();
    await vi.waitFor(() => expect(backend.store.onKeyChange).toHaveBeenCalledOnce());
    store.dispose();
    const unlisten = vi.fn();
    subscription.resolve(unlisten);
    await initialization;
    expect(unlisten).toHaveBeenCalledOnce();
    expect(backend.store.get).not.toHaveBeenCalled();
  });

  it('supports browser persistence and storage notifications without the plugin', async () => {
    vi.stubGlobal('isTauri', false);
    browser.localStorage.setItem('rover.petSize', '80');
    const store = createStore();
    await store.initialize();
    expect(store.getSnapshot().size).toBe(80);
    await store.setSize(95);
    expect(browser.localStorage.getItem('rover.petSize')).toBe('95');
    expect(store.getSnapshot().size).toBe(95);
    browser.localStorage.setItem('rover.petSize', '60');
    browser.dispatchEvent(Object.assign(new Event('storage'), { key: 'rover.petSize' }));
    expect(store.getSnapshot().size).toBe(60);
    store.dispose();
    browser.localStorage.setItem('rover.petSize', '120');
    browser.dispatchEvent(Object.assign(new Event('storage'), { key: 'rover.petSize' }));
    expect(store.getSnapshot().size).toBe(60);
    expect(load).not.toHaveBeenCalled();
  });
});
