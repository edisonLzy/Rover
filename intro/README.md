# Rover 产品发布短片

27 秒、1920 × 1080、30 fps 的中文产品概念短片。画面用 Remotion 绘制，配乐由仓库内的脚本合成；使用 `packages/app/src-tauri/icons/app-icon.png` 作为主视觉，`tray/source.png` 作为无边框小图标。片中界面是依据产品设计文档制作的动效示意，不代表当前 MVP 的功能已经全部交付。

## 文件

- `rover-launch.mp4`：可直接播放的成片，含原创配乐。
- `poster.png`：片尾封面。
- `src/`：可编辑的 Remotion 工程。
- `public/`：图标副本及配乐。
- `make_music.py`：可重复生成配乐的脚本。
- `STORYBOARD.md`：分镜与文案。

## 重新渲染

在此目录运行：

```sh
npm install
python3 make_music.py
npm run render
npm run poster
```

预览时间轴：`npm run studio`。图标源文件位于 `../packages/app/src-tauri/icons/`；若源图更新，重新复制到 `public/` 后再渲染。
