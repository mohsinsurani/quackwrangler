# README visual assets

The overview and demo are captures of the actual standalone React development preview, not generated product mockups.

1. Run `npm --prefix webview-ui run dev -- --host 127.0.0.1 --port 5199` and leave it running.
2. Run `node scripts/capture-readme-assets.cjs`. It needs Playwright's Chromium (`npx playwright-core install chromium-headless-shell`) and `ffmpeg`, opens the preview at 1280×720, and writes both assets.
3. It captures four states: the default grid with the header table switcher and column profiles, the nested-value inspector opened from a `metadata` STRUCT cell (saved as `quackwrangler-overview.jpg`), the Tools drawer on the multi-column Sort form, and the correlation heatmap in the Charts tab. These are assembled into a 960×540 looping `quackwrangler-demo.gif`.
4. Open the rendered assets and look at every frame. Update the alt text in the README if the demonstrated features change.

The capture must show the current column profiles, resizable grid, the database table switcher, nested-value inspection, the current Tools drawer and Visualize controls, and at least one applied transform. Do not reuse an image that shows an older operations layout or removed engine/code-preview controls. Command-driven workflows such as AI planning, remote URLs, and schema comparison belong in separate focused documentation captures rather than simulated editor state.

The development preview data and extension messages live in `webview-ui/src/main.tsx`. Keep that fixture aligned with the protocol and current visible components so documentation captures exercise the real UI.
