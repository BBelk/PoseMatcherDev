# Time Lapse Generator with Pose Matcher

[Link to tool](https://bbelk.github.io/PoseMatcherDev/)

## Table of Contents
1. [Description](#description)
2. [How To Use](#how-to-use)
3. [How It Works](#how-it-works)
4. [Keyboard Shortcuts](#keyboard-shortcuts)
5. [Limitations](#limitations)
6. [Potential Future Development](#potential-future-development)

![Alt text](./images/readme-images/HandiRokuRemoteGif2.gif "Time Lapse Generator Demo")

## Description
Turn a series of images into a time lapse (GIF or video) with automatic pose-based alignment. No downloads, no accounts, no hoops to jump through - just a simple browser-based tool. It includes a pose-estimation model that automatically aligns photos based on a person's body parts (nose, left knee, right eye, whatever). The tool also supports custom keypoints for non-human subjects.

All of this is because my wife and I are expecting our first baby. We wanted to take photos of her baby bump along the way and create a time lapse at the end. Pretty cute right? After the first dozen photos, all slightly off base, the thought of manually aligning hundreds of photos made me physically ill. So I whipped up this little tool, and maybe it can help you as well. 

## How To Use

### Getting Started
1. **Upload a Reference Image** - Drop or click to upload your first image. This sets the alignment target.
2. **Add Comparison Images** - Add the rest of your images to the comparison grid below.
3. **Click Generate** - Creates your GIF or MP4.

### Alignment Modes

**Human Pose Mode** (default)
- Automatically detects people in each image
- Click an image to select which person to track (if multiple detected)
- Choose which body part to use as the position anchor (nose, shoulder, hip, etc.)
- Optionally match scale and rotation based on body part pairs (shoulders, hips, eyes)

**Custom Point Mode**
- For non-human subjects or when pose detection doesn't work
- Click each image to place a custom alignment point
- Images align based on these manual points

### Output Options
- **Format**: GIF or MP4
- **Include Reference**: Toggle whether the reference image appears in the output
- **Loop**: Enable/disable looping
- **Frame Duration**: Set timing per frame, or customize first/middle/last frames separately
- **Transitions**: Add fade transitions between frames

### Tips
- Images persist in your browser (IndexedDB) - refresh won't lose your work
- Drag comparison cards to reorder them
- Click "Clear All" to start fresh

![Alt text](./images/readme-images/handiRokuRemote-GUI.jpg "Time Lapse Generator Interface")

## How It Works

### Pose Detection
The app uses [RTMO](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmo) (Real-Time Multi-Person Pose Estimation), a one-stage pose detector running entirely in-browser via [ONNX Runtime Web](https://onnxruntime.ai/). It detects 17 COCO keypoints per person (nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles).

### Video/GIF Encoding
- **Video (MP4/WebM/MOV)**: [mediabunny](https://github.com/Vanilagy/mediabunny) - a lightweight WebCodecs-based encoder with streaming support. Hardware-accelerated, no WASM overhead.
- **GIF**: [gifenc](https://github.com/mattdesl/gifenc) - streaming GIF encoder with global palette optimization and frame differencing for smaller files.

### Tech Stack
- **Runtime**: 100% browser-based, deployable as a static site (GitHub Pages)
- **Framework**: Vanilla JavaScript, no build tools or bundlers
- **Persistence**: IndexedDB for storing uploaded images across sessions
- **Pose Model**: RTMO-s via ONNX Runtime Web (WASM backend)
- **Video Encoding**: mediabunny (WebCodecs + muxers)
- **GIF Encoding**: gifenc with lossy compression options

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Delete` / `Backspace` | Remove selected comparison image |
| `Escape` | Close modal |

## Limitations
- Pose detection works best with clearly visible, unobstructed people
- Very small figures in images may not be detected reliably
- First-time load downloads the pose model (~10MB)
- WebCodecs required for video encoding (Safari 16.4+, Chrome 94+, Edge 94+)
- GIFs of photographic content will always be larger than video equivalents

## Potential Future Development
- Batch export options
- Additional transition types (wipe, slide, etc.)
- Onion skinning preview
- Video input support (extract frames automatically)

## Thanks To
- [RTMO / MMPose](https://github.com/open-mmlab/mmpose) for the pose estimation model
- [ONNX Runtime](https://onnxruntime.ai/) for browser-based ML inference
- [mediabunny](https://github.com/Vanilagy/mediabunny) for WebCodecs-based video encoding
- [gifenc](https://github.com/mattdesl/gifenc) for streaming GIF encoding
