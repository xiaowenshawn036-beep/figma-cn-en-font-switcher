# CN EN Font Switcher

A local Figma plugin that maps Chinese characters and Chinese punctuation to **HarmonyOS Sans SC**, and Latin letters and digits to **Poppins**. It changes font names while keeping the text content and existing per-character formatting. / 在 Figma 中批量替换中英文字体，同时尽量保留原有排版属性。

## Features / 功能

- Scans one or more selected Frames and their nested text layers, or selected text layers directly.
- Previews the number of eligible, skipped, and missing-font layers before editing.
- Matches the original weight and italic style when the target family offers them. It skips unsupported weights instead of falling back to Regular.
- Preserves text content, font size, line height, letter spacing, paragraph spacing, fills, opacity, alignment, and layer position. The plugin checks these properties after each layer and attempts to undo a failed layer.
- Offers an explicit recovery mode for unavailable source fonts such as `Microsoft YaHei UI`.

The two target font families must be available in your Figma editor. Changing fonts can change glyph widths, line wraps, and automatic layout, so review the result visually.

## Install / 安装

1. Download or clone this repository. Keep `manifest.json`, `code.js`, and `ui.html` in the same folder.
2. In Figma Design, choose **Plugins → Development → Import plugin from manifest…** and select `manifest.json`.
3. Run **Plugins → Development → CN EN Font Switcher**. The plugin window should show **v1.2.0**.

This is a local development plugin. Publishing the source on GitHub does not automatically list the plugin in Figma Community.

## Use / 使用

1. Start with one short text layer or a small Frame. Keep a backup of important designs.
2. Enter the Chinese and Latin target font family names. Defaults are `HarmonyOS Sans SC` and `Poppins`.
3. If the source text has a missing font, enable **修复原文件缺失字体** (repair missing source fonts).
4. Click **扫描预检** (scan preview), inspect the skipped layers and reasons, then click **确认替换** (apply).
5. Check content, weight, color, overflow, and line wrapping before processing a larger Frame.

Missing-font recovery first assigns an available font to the whole text layer, then restores the planned font for each range. It only proceeds when every character can be handled safely. Whitespace may take the nearest classified font; an unknown symbol with a missing original font causes the entire layer to be skipped.

## Development / 开发

No build step or external packages are required. Run the simulation suite with:

```sh
node test/verify.js
```

The suite covers Chinese, Latin, mixed text, weights, sizes, colors, missing fonts, nested Frames, punctuation, skipped symbols, preview invalidation, and rollback after a simulated partial write. Simulation does not replace testing inside Figma.

Figma API references: [Working with Text](https://developers.figma.com/docs/plugins/working-with-text/), [TextNode](https://developers.figma.com/docs/plugins/api/TextNode/), [Plugin Manifest](https://developers.figma.com/docs/plugins/manifest/).

## License / 许可证

This project is available under the [MIT License](LICENSE). / 本项目采用 MIT 许可证。
