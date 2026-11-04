# Grass Valley T3 iDDR Broadcast Controller (Next.js & AMP Protocol)

![Grass Valley T3 Controller](./image.png)

A professional, broadcast-grade software control surface for the **Grass Valley T3 iDDR** (and T2 / K2 media servers) built with **Next.js (JavaScript / React)** and the **Advanced Media Protocol (AMP)** over TCP port **3811**.

![Grass Valley T3 Controller](https://img.shields.io/badge/Grass_Valley-T3_iDDR-0084ff?style=for-the-badge)
![Protocol](https://img.shields.io/badge/Protocol-AMP_over_TCP:3811-00e676?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Next.js-14_App_Router-black?style=for-the-badge)

---

## 🌟 Key Features

### 1. Multi-Channel Deck Architecture
Configured as two recorder channels and one player channel:
- **CH 1: R1 (Recorder 1)**: Recording controls and optional split recording.
- **CH 2: R2 (Recorder 2)**: Recording controls and optional split recording.
- **CH 3: P1 (Player 1)**: Playout controls.

### 2. Broadcast Transport Panel
- **Tactile Illuminated Pushbuttons** with hardware tally feedback:
  - `REC` (Bright illuminated red tally)
  - Per-channel split recording: continuously record into consecutive clips using a configurable interval (10 seconds by default) until stopped
  - `PLAY` (Bright illuminated green tally)
  - `STOP` (Illuminated amber tally)
  - P1 player controls to load a T3 clip by name, cue to SMPTE timecode, jog one frame, shuttle at 2x, and toggle looping
  - `STILL / PAUSE` (Illuminated blue tally)
  - `REW (<<)` & `FF (>>)` (Variable shuttle rewind/fast forward)
  - `LOOP` (Illuminated cyan continuous loop tally)
  - `EJECT`
- **Broadcast Keyboard Shortcuts**:
  - <kbd>1</kbd> / <kbd>2</kbd>: Toggle recording on R1 / R2
  - <kbd>3</kbd>: Toggle playback on P1
  - <kbd>R</kbd>: Record All (R1 + R2)
  - <kbd>P</kbd>: Play All (P1)
  - <kbd>S</kbd> / <kbd>Esc</kbd>: Stop All
  - <kbd>Space</kbd>: Play / Stop toggle
  - <kbd>K</kbd>: Stop
  - <kbd>J</kbd>: Shuttle Reverse (-2x / -4x)
  - <kbd>L</kbd>: Shuttle Forward (+2x / +4x)
  - <kbd>I</kbd>: Mark IN Point
  - <kbd>O</kbd>: Mark OUT Point

### 3. SMPTE Timecode & Precision Scrubbing
- **High-Contrast Digital SMPTE Readout**: Glowing amber/green/red 7-segment style digits (`HH:MM:SS:FF`) supporting Drop-Frame (DF) and Non-Drop-Frame (NDF) at 29.97 / 59.94 / 25 / 50 fps.
- **Secondary Markers**: Live calculation of Mark IN, Mark OUT, Clip Duration, and Countdown Remaining time.
- **Rotary Jog Wheel**: Drag with mouse or scroll with mouse wheel to perform frame-by-frame jog stepping (`-1 Frm`, `+1 Frm`).
- **Variable Shuttle Slider**: Scrub from `-16x` to `+16x` speed with optional auto-center spring return.

### 4. Real-Time Video Screen & Audio VU Meters
- **Simulated Video Monitor**: Live raster and playback bar animation, safe area guides (16:9 / 4:3), center crosshairs, format badge (`1080/59.94i HQX`, `4K ProRes 422`), loaded clip name, and glowing SMPTE timecode burn-in.
- **Dual-Channel Audio VU Meters**: Calibrated stereo scale (-48 dBFS to 0 dBFS) with green/amber/red peak clip indicators.

### 5. Clip Bin & Media Library
- Request the T3 clip directory using AMP `A2.14` / `A1.15`; IDs reported as loaded by the connected decks are also kept in the searchable list if directory listing is unavailable.
- Click a listed clip or drag it onto the P1 deck to load it for playback. Enter a clip name manually when needed.
- `New Rec` creator: Set clip name and immediately trigger recording on Channel 1.

### 6. Live AMP Protocol Inspector
- Terminal view showing raw hex packets exchanged in real time:
  - Direction: `TX` (Client -> T3), `RX` (T3 -> Client), `SYS` (Internal events).
  - Hex codes (`CRAT0007204Vtr1`, `CMDS00042001`, `1001 ACK`, `1111 NAK`, `722002`).
  - Human-readable parsing of every transaction.
  - Persistent JSONL log at `logs/amp.log` (override with `AMP_LOG_PATH`).
- Raw Hex Command Sender with one-click broadcast macro buttons.

### 7. Dual Engine Mode: Real Hardware + Virtual Simulator
- **Physical Grass Valley T3 Hardware**: Connects over a real TCP socket (Node.js `net.Socket`) to port `3811` at your T3's IP address.
- **Virtual T3 iDDR Simulator**: Built-in high-fidelity deck emulation allowing immediate development, demonstration, and testing without requiring physical hardware.

---

## 🛠️ Grass Valley AMP Protocol Implementation Reference

The controller implements Grass Valley's Advanced Media Protocol framing:

| Command | Hex Payload | Description |
| :--- | :--- | :--- |
| **Channel Connect** | `CRAT0007204Vtr1\n` | Create / Bind connection to channel `Vtr1` |
| **Play** | `CMDS00042001\n` | Start playout on active channel |
| **Stop** | `CMDS00042000\n` | Stop transport |
| **Record** | `CMDS00042002\n` | Start recording |
| **Eject** | `CMDS0004200f\n` | Eject loaded media |
| **Loop On / Off** | `CMDS0006414201\n` | Set loop playback enabled (`01`) or disabled (`00`) |
| **Shuttle Forward** | `CMDS0006211374\n` | Shuttle forward at speed hex (`74` = 2x, `83` = 4x, etc.) |
| **Shuttle Reverse** | `CMDS0006212374\n` | Shuttle reverse at speed hex |
| **Jog Forward** | `CMDS0006211101\n` | Jog forward 1 frame |
| **Jog Reverse** | `CMDS0006212101\n` | Jog reverse 1 frame |
| **Cue Timecode** | `CMDS001024310004<BCD>\n` | Cue to specific SMPTE timecode |
| **Load Clip** | `CMDS....4a14<name_hex>\n` | Load clip identifier onto timeline |
| **Record Clip** | `CMDS....ae02<name_hex>\n` | Initialize clip target and trigger recording |
| **Sense Status** | `CMDS0006612002\n` | Query 72.20 transport status bitmask |
| **Sense Timecode**| `CMDS0006610c01\n` | Query current LTC/VITC timecode |
| **List Clips** | `CMDS0008a2140000\n` | Query first clip ID in storage |

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+ (tested on Node v20/v26)
- npm or yarn

### Installation & Run

```bash
# 1. Install dependencies
npm install

# 2. Run the Next.js development server
npm run dev

# 3. Open in your browser
http://localhost:3000 (or http://localhost:3001)
```

### Production Build

```bash
npm run build
npm start
```

---

## ⚙️ Connecting to Physical Grass Valley T3 Hardware

1. In the top right corner of the controller, click **Config** or the **Connection Status Pill**.
2. Select **Physical Grass Valley T3 Hardware (TCP/IP Port 3811)**.
3. Enter your Grass Valley T3's IP address (configured by default to `192.168.145.20`) and Port (`3811`).
4. Select the initial target channel (`Vtr1`, `Vtr2`, or `Vtr3`).
5. Click **Connect to T3 Hardware**.
6. Ensure that **AMP Remote Control** is enabled in Grass Valley T3 Workstation settings under *Remote Protocol Settings*.
7. If a recorder is switched to remote mode after the app starts, the controller detects rejected AMP binds/status queries and retries that recorder's connection automatically.
