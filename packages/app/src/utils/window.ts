import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export { isTauri as isTauriEnvironment };

export function resolveInitialWindowLabel(searchQuery?: string): string {
  if (isTauri()) {
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
