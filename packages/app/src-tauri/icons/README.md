# Rover application icon

`app-icon.png` is the source artwork for the selected pixel-art Rover icon (white-background variant). The `.icns`, `.ico`, and size-specific PNG files in this directory are generated from it with Tauri's icon command and are used by `tauri.conf.json` for the macOS and Windows application icon.

To regenerate desktop assets from the source:

```sh
pnpm tauri icon src-tauri/icons/app-icon.png --output /tmp/rover-app-icons
cp /tmp/rover-app-icons/*.png /tmp/rover-app-icons/icon.icns /tmp/rover-app-icons/icon.ico src-tauri/icons/
```

`previous-rounded-icon.svg` preserves the earlier flat concept. The small menu bar and notification-area icons have separate sources in `tray/`.
