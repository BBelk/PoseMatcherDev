# PoseMatcherDev

## Overview
A browser-based pose matching application. Users load a reference pose image, then use their camera (or upload another image) to match the pose. The app overlays detected poses and scores how well they align.

## Tech Stack
- **Runtime**: Browser (must deploy to GitHub Pages as a static site)
- **Bundler**: None — keep it lean, plain JS only
- **Pose Detection**: Free/open-licensed models (e.g., MoveNet, BlazePose via TensorFlow.js)
- **Image Processing**: OpenCV.js (loaded via CDN)
- **Language**: Vanilla JavaScript, HTML, CSS

## Key Constraints
- Everything runs client-side — no server/backend
- Must work as a GitHub Pages deployment (static files only)
- No bundlers, transpilers, or build tools — serve files as-is
- Use only models with permissive licenses (Apache 2.0, MIT, etc.)
- Load libraries via CDN or direct script tags

## Development
- `npm start` — serves files locally via `npx serve .`
