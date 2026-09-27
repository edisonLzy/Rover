# Rover application icon

`app-icon.png` is the source artwork for the selected pixel-art Rover icon with its white frame. The `.icns`, `.ico`, and size-specific PNG files in this directory are generated from it with Tauri's icon command and are used by `tauri.conf.json` for the macOS Dock and Windows taskbar/application icon.

To regenerate desktop assets from the source:

```sh
pnpm tauri icon src-tauri/icons/app-icon.png --output /tmp/rover-app-icons
cp /tmp/rover-app-icons/32x32.png /tmp/rover-app-icons/128x128.png /tmp/rover-app-icons/128x128@2x.png /tmp/rover-app-icons/icon.icns /tmp/rover-app-icons/icon.ico src-tauri/icons/
```

The borderless menu bar and notification-area artwork lives in `tray/`.
