import { getCurrentWindow } from '@tauri-apps/api/window';

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function resolveInitialWindowLabel(searchQuery?: string): string {
  if (isTauriEnvironment()) {
    try {
      return getCurrentWindow().label;
    } catch {
      // fallback
    }
  }

  // Browser development fallback (?window=main or ?window=dashboard)
  const query =
    searchQuery !== undefined
      ? searchQuery
      : typeof window !== 'undefined'
        ? window.location.search
        : '';

  if (query) {
    const params = new URLSearchParams(query);
    const windowParam = params.get('window');
    if (windowParam) {
      return windowParam;
    }
  }

  return 'dashboard';
}
