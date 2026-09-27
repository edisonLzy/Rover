# Rover menu bar / tray icon

`source.png` is the borderless version of the selected Rover artwork. It keeps the cyan panel, Rover, and pink envelope, but removes the white outer frame and surrounding whitespace. `icon.png` is the 36 px export used by both the macOS menu bar and Windows notification area. Regenerate the runtime icon with:

```sh
sips -s format png -z 36 36 source.png --out icon.png
```

The white-framed version remains the macOS Dock and Windows taskbar icon in `../app-icon.png`.
