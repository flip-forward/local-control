# flip forward — local control

A desktop app for discovering and controlling [flip forward](https://www.flipforward.de) split-flap displays on your local network.

<video src="https://github.com/user-attachments/assets/f38f5285-1c4f-401e-8c42-181897c1672a" controls autoplay loop muted playsinline width="720">
Demo video
</video>

## Features

- **Auto-discovery** — finds displays on your network via mDNS/Bonjour (`splitflap` service type), with manual add-by-IP as a fallback.
- **Send text** — push a word or phrase straight to a display, optionally cycling through a list on a repeat interval.
- **Module commands** — target individual flap modules to reboot, blink, display a single character, or run smart homing.
- **Smart homing** — a guided, step-by-step calibration flow for aligning a module's flaps.
- **Firmware updates** — flash new firmware to one or more modules, either from a local `.bin` file (served from a built-in HTTP server on your machine) or from a public URL.
- **Activity log** — a live log of every command sent and request received, for debugging.

## Getting started

```bash
npm install
npm start
```

## Building

```bash
make mac     # or: npm run build:mac
make linux   # or: npm run build:linux
make win     # or: npm run build:win
```

Builds are emitted to `dist/` via [electron-builder](https://www.electron.build/).

## Community

Questions, feedback, or showing off your build? Join the Discord: https://discord.gg/nZwyE4vh
