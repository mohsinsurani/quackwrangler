# README visual assets

The overview and demo are captures of the actual standalone React development preview, not generated product mockups.

1. Run `npm --prefix webview-ui run dev -- --host 127.0.0.1`.
2. Open the printed local URL at a 1280×720 viewport.
3. Capture three readable states: the default grid/profile view with the labelled Operations rail collapsed, the nested-value inspector opened from a `metadata` STRUCT cell, and the correlation heatmap expanded.
4. Save the visualization frame as `quackwrangler-overview.jpg`.
5. Assemble the three states into a 960×540 looping `quackwrangler-demo.gif`.
6. Inspect both rendered assets and update their alt text if the demonstrated features change.

The capture must show the current column profiles, resizable grid, nested-value inspection affordance, current Data Quality/Visualize controls, and at least one applied transform. Do not reuse an image that shows an older operations layout or removed engine/code-preview controls. Command-driven workflows such as AI planning, remote URLs, and schema comparison belong in separate focused documentation captures rather than simulated editor state.

The development preview data and extension messages live in `webview-ui/src/main.tsx`. Keep that fixture aligned with the protocol and current visible components so documentation captures exercise the real UI.
