# Rover tray / menu bar icon

The mark is the Rover pet's antenna and visor, reduced to a silhouette that remains readable at notification-area size. The SVG files are the editable sources.

- `macos-template.svg`: solid alpha mask with a cut-out visor. Tauri sets `icon_as_template(true)`, so macOS chooses the visible color for the menu bar.
- `windows-color.svg`: transparent navy and mint version for the Windows notification area.

The checked-in PNGs are rasterized from these SVGs. On macOS, regenerate them with:

```sh
sips -s format png -z 36 36 macos-template.svg --out macos-template.png
sips -s format png -z 32 32 windows-color.svg --out windows-color.png
```

`preview.png` shows each icon at its actual 18 px or 16 px display size on light and dark surfaces, plus an enlarged pixel view. Keep attention and error indicators separate from this identity mark.
