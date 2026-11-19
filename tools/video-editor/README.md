# ClipForge

A browser-based video editor: multi-track timeline, titles and captions, filters, transitions, voiceover, and real video export. No uploads, no accounts, no watermark — media and projects stay in your browser.

![Stack](https://img.shields.io/badge/stack-vanilla%20JS-7c5cff) ![No build](https://img.shields.io/badge/build-none-37d39b)

## Run it

Any static server works. A tiny zero-dependency server is included:

```powershell
node serve.js
# open http://localhost:4173
```

Or use Python:

```powershell
python -m http.server 4173
```

Opening `index.html` directly from disk mostly works too, but `http://localhost` is recommended so IndexedDB, fonts, and media behave consistently across browsers.

## What it does

- **Multi-track timeline** — video, overlay, text, and audio tracks. Add as many tracks as you need.
- **Editing** — drag to move, drag clip edges to trim, split at the playhead, duplicate, delete, snapping, per-track lock/mute/hide, zoom.
- **Canvas** — 16:9, 9:16, 1:1, 4:5, 4:3, 21:9. Background color, position, scale, rotation, opacity, fill/fit.
- **Titles and text** — 10 styled presets (title, subtitle, lower third, caption, karaoke, neon, comic, typewriter, outline, gradient), 16 fonts, colors, alignment, and live editing in the inspector.
- **Captions** — add captions manually, import `.srt`/`.vtt`, or export your text clips back to `.srt`.
- **Look** — 14 color filters plus per-clip in/out transitions (fade, slides, zoom, wipe, blur).
- **Sound** — per-clip volume, fade in/out, track mute, and voiceover recording from the microphone.
- **Media library** — import video, image, and audio by button, drag-and-drop, or timeline drop. Thumbnails and metadata are generated locally.
- **Export** — MP4 (H.264/AAC) where the browser supports it, otherwise WebM (VP9/Opus). 480p–2160p, 24/30/60 fps, quality control, and estimated size.
- **Projects** — autosave to IndexedDB, plus portable `.clipforge.json` project files with media relinking when files are missing.
- **Undo/redo** — snapshot history for edits, tracks, and project settings.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `S` | Split selected clip at playhead |
| `Delete` / `Backspace` | Delete selected clip |
| `Ctrl/Cmd + D` | Duplicate selected clip |
| `←` / `→` | Nudge playhead 0.1s |
| `Shift + ←` / `→` | Nudge playhead 1s |
| `Home` / `End` | Jump to start / end |
| `+` / `-` | Zoom timeline |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + S` | Save project file |
| `M` | Mute / unmute preview |
| `Esc` | Deselect clip |

## How export works

Export composites the same canvas renderer used by the preview and records it with `MediaRecorder` in real time, while the project's audio graph is mixed into the recording stream.

- Keep the tab **visible and focused** during export. Browsers throttle background animation, which slows or pauses real-time capture.
- Export takes roughly the duration of your timeline (plus finalization).
- MP4 output depends on browser support. Chrome/Edge usually support MP4; Firefox and Safari commonly produce WebM. The format menu marks unsupported codecs.
- Long timelines at 4K/60 fps can exceed what a device can encode; drop to 1080p or 30 fps if the recorder fails.
- The file downloads automatically when finished, with a “Download again” link in the dialog.

## Privacy and storage

- Everything runs locally. Nothing is uploaded.
- Media blobs, thumbnails, and the current project are stored in IndexedDB (`clipforge`) in this browser profile.
- “Clear browser storage” in the inspector permanently deletes local projects and media.
- Project files contain the edit plus asset metadata, but **not** the media bytes. Opening a project on another computer asks you to relink the original files.

## Deploying

The app is plain HTML/CSS/JS with no build step. For GitHub Pages:

1. Push the folder to a repository.
2. Settings → Pages → deploy from the branch/folder containing `index.html`.
3. Open the Pages URL. The included `serve.js` is only for local development.

Any static host (Netlify, Cloudflare Pages, S3, nginx) works the same way.

## Limitations

- Automatic speech-to-text is not bundled. Import an SRT/VTT produced by a transcription service, or type captions manually.
- No bundled music library; import your own audio.
- Export is real-time, not offline/faster-than-real-time.
- Transform controls operate on the canvas; there are no draggable on-canvas handles yet.
- Media support depends on the browser's codecs. MOV/MKV may not play everywhere; converting to MP4/WebM is safest.
- Project media is per-browser. Use project files + relinking to move edits between devices.

## File map

```
index.html        editor shell
css/styles.css    dark editor theme and layout
js/constants.js   aspect ratios, filters, transitions, fonts, presets
js/utils.js       icons, formatting, toasts, modals, menus, file helpers
js/db.js          IndexedDB storage and local media probing
js/model.js       project/track/clip factories and undo history
js/renderer.js    canvas compositor, filters, text styles, Web Audio graph
js/timeline.js    timeline rendering and drag/trim/snap interactions
js/inspector.js   project and clip property panels
js/exporter.js    MediaRecorder export flow
js/app.js         state, playback, persistence, project and asset logic
js/app-ui.js      library tabs, presets, captions, voiceover, demo, help
serve.js          zero-dependency local static server
```
