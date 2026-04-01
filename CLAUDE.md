# PoseMatcherDev

## Overview
A browser-based pose matching application. Users upload two images — a reference pose and a comparison image — and the app detects poses in both, overlays skeletons, and compares them. Strict image-to-image comparison, no live camera.

## Tech Stack
- **Runtime**: Browser (must deploy to GitHub Pages as a static site)
- **Bundler**: None — keep it lean, plain JS only
- **Pose Detection**: RTMO-s via ONNX Runtime Web (multi-person, one-stage)
- **Language**: Vanilla JavaScript, HTML, CSS
- **No Python** — all tooling and scripting must be JS/Node

## Key Constraints
- Everything runs client-side — no server/backend
- Must work as a GitHub Pages deployment (static files only)
- No bundlers, transpilers, or build tools — serve files as-is
- No TensorFlow, MediaPipe, or Ultralytics
- Use only models with permissive licenses (Apache 2.0, MIT, etc.)
- Load libraries via CDN or direct script tags

## Working Rules
- **Follow instructions literally.** If the user says "do X in file Y", do exactly that — don't expand scope, don't add UI, don't build features that weren't asked for.
- Keep everything lean and minimal. Don't over-engineer.

## Development
- `npm start` — serves files locally via `npx serve .`
