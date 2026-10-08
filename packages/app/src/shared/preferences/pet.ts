import { useSyncExternalStore } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { isTauriEnvironment } from '../../utils/window.js';

export const DEFAULT_PET_SIZE = 75;
export const MIN_PET_SIZE = 60;
export const MAX_PET_SIZE = 120;
const SIZE_KEY = 'pet.size';
const BROWSER_SIZE_KEY = 'rover.petSize';

export interface PetPreferencesSnapshot {
  readonly size: number;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: string | null;
}

interface PreferencesStorage {
  read(): Promise<unknown>;
  write(size: number): Promise<void>;
  subscribe(listener: (size: unknown) => void): Promise<() => void>;
}

function normalizeSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(size) && size >= MIN_PET_SIZE && size <= MAX_PET_SIZE
    ? Math.round(size / 5) * 5
    : DEFAULT_PET_SIZE;
}

async function openStorage(): Promise<PreferencesStorage> {
  if (isTauriEnvironment()) {
    const store = await load('preferences.json', { autoSave: false, defaults: {} });
    return {
      read: () => store.get(SIZE_KEY),
      write: async (size) => {
        await store.set(SIZE_KEY, size);
        // Explicit saving lets the UI report persistence failures.
        await store.save();
      },
      subscribe: (listener) => store.onKeyChange(SIZE_KEY, listener),
    };
  }

  // Browser preview only. Native windows share the Rust-backed store above.
  const browser = window;
  return {
    read: async () => browser.localStorage.getItem(BROWSER_SIZE_KEY),
    write: async (size) => browser.localStorage.setItem(BROWSER_SIZE_KEY, String(size)),
    subscribe: async (listener) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === BROWSER_SIZE_KEY || event.key === null) {
          listener(browser.localStorage.getItem(BROWSER_SIZE_KEY));
        }
      };
      browser.addEventListener('storage', onStorage);
      return () => browser.removeEventListener('storage', onStorage);
    },
  };
}

const initialSnapshot: PetPreferencesSnapshot = {
  size: DEFAULT_PET_SIZE,
  status: 'loading',
  error: null,
};

export class PetPreferencesStore {
  private snapshot = initialSnapshot;
  private listeners = new Set<() => void>();
  private storage?: PreferencesStorage;
  private initialization?: Promise<void>;
  private unlisten?: () => void;
  private revision = 0;
  private disposed = false;
  private writes: Promise<void> = Promise.resolve();

  getSnapshot = (): PetPreferencesSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.initialize().catch(() => {});
    return () => this.listeners.delete(listener);
  };

  initialize = (): Promise<void> => {
    if (this.disposed) return Promise.reject(new Error('Pet preferences store is disposed'));
    if (!this.initialization) {
      this.initialization = this.connect().catch((error: unknown) => {
        this.unlisten?.();
        this.unlisten = undefined;
        this.storage = undefined;
        this.initialization = undefined;
        this.reportError(error);
        throw error;
      });
    }
    return this.initialization;
  };

  private async connect(): Promise<void> {
    this.update({ ...this.snapshot, status: 'loading', error: null });
    const storage = await openStorage();
    if (this.disposed) return;
    const unlisten = await storage.subscribe((size) => {
      if (this.disposed) return;
      this.revision += 1;
      this.update({ ...this.snapshot, size: normalizeSize(size) });
    });
    if (this.disposed) {
      unlisten();
      return;
    }
    this.unlisten = unlisten;
    // Subscribe before reading, and do not replace a newer event with an old read.
    const revision = this.revision;
    const size = await storage.read();
    if (this.disposed) return;
    this.storage = storage;
    this.update({
      size: revision === this.revision ? normalizeSize(size) : this.snapshot.size,
      status: 'ready',
      error: null,
    });
  }

  setSize = (size: number): Promise<void> => {
    const next = normalizeSize(size);
    // Keep rapid slider writes in order within this WebView.
    const write = this.writes
      .then(async () => {
        await this.initialize();
        if (this.disposed || !this.storage) throw new Error('Pet preferences store is disposed');
        await this.storage.write(next);
        const revision = this.revision;
        const current = await this.storage.read();
        if (this.disposed) return;
        this.update({
          size: revision === this.revision ? normalizeSize(current) : this.snapshot.size,
          status: 'ready',
          error: null,
        });
      })
      .catch((error: unknown) => {
        this.reportError(error);
        throw error;
      });
    this.writes = write.catch(() => {});
    return write;
  };

  private reportError(error: unknown): void {
    if (!this.disposed) {
      this.update({
        ...this.snapshot,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private update(snapshot: PetPreferencesSnapshot): void {
    if (
      snapshot.size === this.snapshot.size &&
      snapshot.status === this.snapshot.status &&
      snapshot.error === this.snapshot.error
    )
      return;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  dispose(): void {
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = undefined;
    this.listeners.clear();
    // Do not close the plugin resource: other WebViews still use it.
  }
}

const petPreferencesStore = new PetPreferencesStore();
import.meta.hot?.dispose(() => petPreferencesStore.dispose());

export function usePetPreferences() {
  const snapshot = useSyncExternalStore(
    petPreferencesStore.subscribe,
    petPreferencesStore.getSnapshot,
    () => initialSnapshot
  );
  return { ...snapshot, setSize: petPreferencesStore.setSize };
}
