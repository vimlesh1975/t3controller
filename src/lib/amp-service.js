/**
 * Grass Valley T3 iDDR Backend Service & Hardware / Simulator Bridge
 * Manages TCP Socket to T3 Deck or High-Fidelity Virtual Deck Simulator
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import {
  buildCratPacket,
  buildCmdsPacket,
  framesToTimecode,
  timecodeToFrames,
  bcdToTimecode,
  hex2str,
  parseTransportStatus,
  AMP_COMMANDS,
  SHUTTLE_SPEEDS,
} from './amp-protocol.js';

// Preloaded broadcast clips for T3 iDDR clip bin
const DEFAULT_CLIPS = [
  {
    id: 'CLIP_001',
    name: 'OPENING_TITLES_4K_HDR',
    duration: '00:00:30:00',
    durationFrames: 900,
    inPoint: '00:00:00:00',
    outPoint: '00:00:30:00',
    format: 'ProRes 422 HQ',
    fps: 29.97,
    resolution: '3840x2160',
    date: '2026-10-21 08:30',
    bin: 'SHOW_ASSETS',
  },
  {
    id: 'CLIP_002',
    name: 'BREAKING_NEWS_PKG_1080i',
    duration: '00:02:15:15',
    durationFrames: 4065,
    inPoint: '00:00:00:00',
    outPoint: '00:02:15:15',
    format: 'Grass Valley HQX',
    fps: 29.97,
    resolution: '1920x1080i',
    date: '2026-10-21 10:15',
    bin: 'NEWS_FEED',
  },
  {
    id: 'CLIP_003',
    name: 'SPORTS_REPLAY_SLOMO_CAM2',
    duration: '00:00:45:00',
    durationFrames: 1350,
    inPoint: '00:00:05:00',
    outPoint: '00:00:40:00',
    format: 'DNxHD 220x',
    fps: 59.94,
    resolution: '1920x1080p',
    date: '2026-10-21 11:02',
    bin: 'REPLAY_BIN',
  },
  {
    id: 'CLIP_004',
    name: 'COMMERCIAL_SPOT_AUTO_30S',
    duration: '00:00:30:00',
    durationFrames: 900,
    inPoint: '00:00:00:00',
    outPoint: '00:00:30:00',
    format: 'XDCAM-HD422',
    fps: 29.97,
    resolution: '1920x1080i',
    date: '2026-10-20 18:00',
    bin: 'COMMERCIALS',
  },
  {
    id: 'CLIP_005',
    name: 'STATION_IDENT_BUMPER',
    duration: '00:00:08:12',
    durationFrames: 252,
    inPoint: '00:00:00:00',
    outPoint: '00:00:08:12',
    format: 'ProRes 4444',
    fps: 29.97,
    resolution: '1920x1080p',
    date: '2026-10-21 07:00',
    bin: 'GRAPHICS',
  },
];

const CHANNEL_MAP = {
  Vtr1: 'vtr_r1',
  Vtr2: 'vtr_r2',
  Vtr3: 'vtr_r3',
};

class GrassValleyAmpService {
  constructor() {
    this.mode = 'hardware'; // 'hardware' | 'simulator'
    this.host = process.env.T3_HOST || process.env.NEXT_PUBLIC_T3_HOST || '192.168.145.20';
    this.port = parseInt(process.env.T3_PORT || process.env.NEXT_PUBLIC_T3_PORT || '3811', 10);
    this.activeChannel = 'Vtr1'; // 'Vtr1' (R1), 'Vtr2' (P1), 'Vtr3' (P2)
    this.isConnected = false;
    this.connectionState = 'connecting'; // 'connected' | 'connecting' | 'disconnected' | 'error'
    this.lastError = null;

    // Multi-channel 3-Recorder state (R1, R2, R3)
    this.channels = {
      Vtr1: {
        id: 'Vtr1',
        label: 'R1 (Recorder 1)',
        type: 'RECORD',
        inputSource: 'SDI IN 1',
        transportStatus: 'STOPPED',
        timecode: '01:00:00:00',
        currentFrames: 108000,
        fps: 29.97,
        dropFrame: false,
        activeClip: {
          id: 'REC_CAM1',
          name: 'CAM1_ISO_001',
          duration: '00:00:00:00',
          durationFrames: 0,
          format: 'Grass Valley HQX',
          fps: 29.97,
          resolution: '1920x1080i',
          bin: 'REC_BIN_R1',
        },
        inPoint: '01:00:00:00',
        outPoint: '01:00:00:00',
        speed: 1.0,
        audioL: -18,
        audioR: -19,
        tally: { onAir: false, recording: false, cued: true },
        intervalRecording: false,
        intervalPhase: null,
        intervalSegment: 0,
      },
      Vtr2: {
        id: 'Vtr2',
        label: 'R2 (Recorder 2)',
        type: 'RECORD',
        inputSource: 'SDI IN 2',
        transportStatus: 'STOPPED',
        timecode: '01:00:00:00',
        currentFrames: 108000,
        fps: 29.97,
        dropFrame: false,
        activeClip: {
          id: 'REC_CAM2',
          name: 'CAM2_ISO_001',
          duration: '00:00:00:00',
          durationFrames: 0,
          format: 'Grass Valley HQX',
          fps: 29.97,
          resolution: '1920x1080i',
          bin: 'REC_BIN_R2',
        },
        inPoint: '01:00:00:00',
        outPoint: '01:00:00:00',
        speed: 1.0,
        audioL: -20,
        audioR: -21,
        tally: { onAir: false, recording: false, cued: true },
        intervalRecording: false,
        intervalPhase: null,
        intervalSegment: 0,
      },
      Vtr3: {
        id: 'Vtr3',
        label: 'R3 (Recorder 3)',
        type: 'RECORD',
        inputSource: 'SDI IN 3',
        transportStatus: 'STOPPED',
        timecode: '01:00:00:00',
        currentFrames: 108000,
        fps: 29.97,
        dropFrame: false,
        activeClip: {
          id: 'REC_CAM3',
          name: 'CAM3_ISO_001',
          duration: '00:00:00:00',
          durationFrames: 0,
          format: 'Grass Valley HQX',
          fps: 29.97,
          resolution: '1920x1080i',
          bin: 'REC_BIN_R3',
        },
        inPoint: '01:00:00:00',
        outPoint: '01:00:00:00',
        speed: 1.0,
        audioL: -22,
        audioR: -22,
        tally: { onAir: false, recording: false, cued: true },
        intervalRecording: false,
        intervalPhase: null,
        intervalSegment: 0,
      },
    };

    this.clips = [...DEFAULT_CLIPS];
    this.packetLogs = [];
    this.subscribers = new Set();
    this.sockets = {};
    this.channelHeartbeats = {};
    this.pendingHardwareCommands = {};
    this.channelReconnectTimers = {};
    this.channelReconnectAttempts = {};
    this.socket = null;
    this.heartbeatTimer = null;
    this.simulationTimer = null;
    this.intervalRecordings = {};

    // Start background simulation clock
    this.startSimulationClock();

    // Auto-connect to hardware T3 on startup
    if (this.mode === 'hardware') {
      setTimeout(() => {
        if (this.mode === 'hardware') this.connectHardwareSocket();
      }, 500);
    }

    // Add initial log
    this.logPacket('SYS', 'INITIALIZED', 'Grass Valley T3 iDDR Controller Engine Ready');
  }

  logPacket(direction, hex, parsed) {
    const entry = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString() + '.' + String(Date.now() % 1000).padStart(3, '0'),
      direction, // 'TX' | 'RX' | 'SYS'
      hex,
      parsed,
    };
    this.packetLogs.unshift(entry);
    if (this.packetLogs.length > 80) {
      this.packetLogs.pop();
    }
    try {
      const isHeartbeatCommand = direction === 'TX'
        && /AMP \[Vtr\d\]: (612002|610c04|a016)$/.test(parsed);
      const isRepeatedNak = direction === 'RX'
        && parsed.startsWith('NAK')
        && Date.now() - (this.persistedNakTimes?.[parsed] || 0) < 5000;
      if (direction === 'RX' && parsed.startsWith('NAK') && !isRepeatedNak) {
        if (!this.persistedNakTimes) this.persistedNakTimes = {};
        this.persistedNakTimes[parsed] = Date.now();
      }
      if (!isHeartbeatCommand && !isRepeatedNak) {
        if (!this.ampLogStream || this.ampLogStream.destroyed) {
          const logPath = process.env.AMP_LOG_PATH || path.join(process.cwd(), 'logs', 'amp.log');
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          this.ampLogStream = fs.createWriteStream(logPath, { flags: 'a' });
          this.ampLogStream.on('error', (err) => {
            console.error(`AMP log write failed (${logPath}):`, err);
          });
        }
        this.ampLogStream.write(`${JSON.stringify(entry)}\n`);
      }
    } catch (err) {
      console.error('AMP log write failed:', err);
    }
    // Only schedule subscriber notification if not already pending
    this.scheduleNotify();
  }

  scheduleNotify() {
    if (this._notifyScheduled) return;
    this._notifyScheduled = true;
    setTimeout(() => {
      this._notifyScheduled = false;
      this.notifySubscribers();
    }, 40);
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    this._notifyScheduled = false;
    const payload = this.getStateSnapshot();
    for (const callback of this.subscribers) {
      try {
        callback(payload);
      } catch (err) {
        console.error('Subscriber error:', err);
      }
    }
  }

  getStateSnapshot() {
    return {
      mode: this.mode,
      host: this.host,
      port: this.port,
      activeChannel: this.activeChannel,
      isConnected: this.isConnected,
      connectionState: this.connectionState,
      lastError: this.lastError,
      channels: this.channels,
      currentChannelState: this.channels[this.activeChannel] || {},
      clips: this.clips,
      recentLogs: this.packetLogs.slice(0, 25),
    };
  }

  // Set Connection Mode: 'simulator' or 'hardware'
  async configureConnection({ mode = 'hardware', host, port, channel = 'Vtr1' }) {
    const nextHost = host || process.env.T3_HOST || process.env.NEXT_PUBLIC_T3_HOST || this.host || '192.168.145.20';
    const nextPort = parseInt(port || process.env.T3_PORT || process.env.NEXT_PUBLIC_T3_PORT || this.port || '3811', 10);
    const endpointChanged = nextHost !== this.host || nextPort !== this.port;
    this.activeChannel = channel;
    this.host = nextHost;
    this.port = nextPort;

    if (mode === 'simulator') {
      if (this.socket) {
        try {
          this.socket.destroy();
        } catch (e) {}
        this.socket = null;
      }
      this.mode = 'simulator';
      this.isConnected = true;
      this.connectionState = 'connected';
      this.lastError = null;
      this.logPacket('SYS', 'MODE_SIMULATOR', `Switched to Virtual T3 iDDR Simulator on Channel ${channel}`);
      this.notifySubscribers();
      return { success: true, mode: 'simulator' };
    }

    // Hardware mode
    this.mode = 'hardware';
    if (endpointChanged || !Object.values(this.sockets).some((socket) => socket && !socket.destroyed)) {
      this.connectionState = 'connecting';
    }
    this.notifySubscribers();
    return this.connectHardwareSocket(endpointChanged);
  }

  // Connect TCP sockets for all active channels (Vtr1, Vtr2, Vtr3) to real Grass Valley T3
  async connectHardwareSocket(forceReconnect = false) {
    if (!this.sockets) this.sockets = {};
    if (!this.channelHeartbeats) this.channelHeartbeats = {};
    this.connectChannelSocket('Vtr1', forceReconnect);
    this.connectChannelSocket('Vtr2', forceReconnect);
    this.connectChannelSocket('Vtr3', forceReconnect);
    return { success: true, mode: 'hardware' };
  }

  connectChannelSocket(channelId, forceReconnect = false) {
    if (!this.sockets) this.sockets = {};
    if (!this.channelHeartbeats) this.channelHeartbeats = {};
    const hwName = CHANNEL_MAP[channelId] || channelId;
    if (this.sockets[channelId]) {
      const old = this.sockets[channelId];
      if (!forceReconnect && !old.destroyed) return;
      // Detach listeners first so the old socket's 'close' cannot clobber the new one
      old.removeAllListeners('close');
      old.removeAllListeners('data');
      old.removeAllListeners('connect');
      try {
        old.destroy();
      } catch (e) {}
      delete this.sockets[channelId];
    }

    this.logPacket('SYS', `TCP_CONNECT_${channelId}`, `Opening socket for ${channelId} (${hwName}) on ${this.host}:${this.port}...`);

    const socket = new net.Socket();
    this.sockets[channelId] = socket;
    if (channelId === this.activeChannel || !this.socket) {
      this.socket = socket;
    }
    socket.setKeepAlive(true, 5000);

    socket.connect(this.port, this.host, () => {
      if (this.sockets[channelId] !== socket) return;
      socket.connectedAt = Date.now();
      this.isConnected = true;
      this.connectionState = 'connected';
      this.lastError = null;
      this.logPacket('SYS', `TCP_CONNECTED_${channelId}`, `Connected to T3 on ${channelId} (${hwName})`);

      // Bind to T3 channel using CRAT
      const crat = buildCratPacket(hwName);
      this.logPacket('TX', crat.trim(), `CRAT [${channelId}]: Connect to ${hwName}`);
      socket.write(crat);
      this.flushPendingHardwareCommands(channelId, socket);

      // Start periodic status, timecode and clip-name polling for this channel
      this.startChannelHeartbeat(channelId);
      this.notifySubscribers();
    });

    socket.on('data', (data) => {
      this.handleHardwareResponse(channelId, data.toString('utf8'), data);
    });

    socket.on('error', (err) => {
      this.lastError = err.message;
      this.logPacket('SYS', 'ERR_SOCKET', `Socket Error [${channelId}]: ${err.message}`);
      this.notifySubscribers();
    });

    socket.on('close', () => {
      // Ignore close events from sockets that have already been replaced
      if (this.sockets[channelId] !== socket) return;

      this.stopChannelHeartbeat(channelId);
      delete this.sockets[channelId];
      if (this.socket === socket) {
        this.socket = Object.values(this.sockets)[0] || null;
      }
      if (Object.keys(this.sockets).length === 0) {
        this.isConnected = false;
        this.connectionState = 'disconnected';
      }
      this.logPacket('SYS', `TCP_CLOSED_${channelId}`, `Socket connection closed on ${channelId}`);
      this.notifySubscribers();

      // Auto-reconnect retry every 2.5s
      if (this.mode === 'hardware') {
        setTimeout(() => {
          if (this.mode === 'hardware' && (!this.sockets[channelId] || this.sockets[channelId].destroyed)) {
            this.connectChannelSocket(channelId);
          }
        }, 2500);
      }
    });
  }

  scheduleChannelReconnect(channelId, reason = 'T3 rejected the channel bind') {
    if (this.channelReconnectTimers[channelId] || this.mode !== 'hardware') return;

    const attempt = (this.channelReconnectAttempts[channelId] || 0) + 1;
    this.channelReconnectAttempts[channelId] = attempt;
    const delay = Math.min(2500 * (2 ** (attempt - 1)), 15000);
    this.logPacket(
      'SYS',
      `REBIND_RETRY_${channelId}`,
      `${reason} on ${channelId}; retrying connection in ${delay} ms (attempt ${attempt})`
    );
    this.channelReconnectTimers[channelId] = setTimeout(() => {
      delete this.channelReconnectTimers[channelId];
      if (this.mode !== 'hardware') return;
      this.logPacket('SYS', `REBIND_CONNECT_${channelId}`, `Retrying T3 channel bind on ${channelId}`);
      this.connectChannelSocket(channelId, true);
    }, delay);
  }

  startChannelHeartbeat(channelId) {
    this.stopChannelHeartbeat(channelId);
    this.channelHeartbeats[channelId] = setInterval(() => {
      const sock = this.sockets[channelId];
      if (sock && !sock.destroyed) {
        this.sendHardwareCommand(AMP_COMMANDS.STATUS_SENSE, channelId);
        setTimeout(() => {
          if (sock && !sock.destroyed) {
            this.sendHardwareCommand(AMP_COMMANDS.TIMECODE_SENSE, channelId);
          }
        }, 120);
        setTimeout(() => {
          if (sock && !sock.destroyed) {
            this.sendHardwareCommand(AMP_COMMANDS.ID_LOADED, channelId);
          }
        }, 240);
      }
    }, 500);
  }

  stopChannelHeartbeat(channelId) {
    if (this.channelHeartbeats[channelId]) {
      clearInterval(this.channelHeartbeats[channelId]);
      delete this.channelHeartbeats[channelId];
    }
  }

  startHardwareHeartbeat() {
    this.startChannelHeartbeat('Vtr1');
    this.startChannelHeartbeat('Vtr2');
    this.startChannelHeartbeat('Vtr3');
  }

  sendHardwareCommand(cmdHex, channelId) {
    if (!this.sockets) this.sockets = {};
    const target = channelId || this.activeChannel || 'Vtr1';
    const sock = this.sockets[target];
    if (!sock || sock.destroyed) {
      this.queueHardwareCommand(target, cmdHex);
      this.logPacket('SYS', 'CMD_QUEUED', `AMP [${target}]: Queued command until channel connects`);
      this.connectChannelSocket(target);
      return true;
    }
    if (sock.connecting) {
      this.queueHardwareCommand(target, cmdHex);
      this.logPacket('SYS', 'CMD_QUEUED', `AMP [${target}]: Queued command until channel connects`);
      return true;
    }
    try {
      return this.writeHardwareCommand(sock, target, cmdHex);
    } catch (err) {
      this.logPacket('SYS', 'ERR_WRITE', `Socket write error [${target}]: ${err.message}`);
      return false;
    }
  }

  queueHardwareCommand(channelId, cmdHex) {
    if (!this.pendingHardwareCommands[channelId]) {
      this.pendingHardwareCommands[channelId] = [];
    }
    this.pendingHardwareCommands[channelId].push(cmdHex);
  }

  flushPendingHardwareCommands(channelId, socket) {
    const commands = this.pendingHardwareCommands[channelId] || [];
    delete this.pendingHardwareCommands[channelId];
    for (const cmdHex of commands) {
      if (this.sockets[channelId] !== socket || socket.destroyed) break;
      this.writeHardwareCommand(socket, channelId, cmdHex);
    }
  }

  writeHardwareCommand(socket, channelId, cmdHex) {
    const packet = buildCmdsPacket(cmdHex);
    if (cmdHex === AMP_COMMANDS.STATUS_SENSE) {
      socket.statusSenseSentAt = Date.now();
    }
    this.logPacket('TX', packet.trim(), `AMP [${channelId}]: ${cmdHex}`);
    socket.write(packet);
    return true;
  }

  createIntervalClip(channelId) {
    const ch = this.channels[channelId];
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const clip = {
      id: `IR_${channelId}_${Date.now()}`,
      name: `${channelId.toUpperCase()}_IR_${timestamp}`,
      duration: '00:00:00:00',
      durationFrames: 0,
      inPoint: ch.timecode,
      outPoint: ch.timecode,
      format: 'Grass Valley HQX',
      fps: ch.fps,
      resolution: '1920x1080i',
      date: new Date().toLocaleString(),
      bin: `REC_BIN_${channelId}`,
    };

    ch.activeClip = clip;
    this.clips.unshift(clip);
    return clip;
  }

  startIntervalSegment(channelId, { initial = false } = {}) {
    const ch = this.channels[channelId];
    const clip = initial && this.mode === 'hardware' ? null : this.createIntervalClip(channelId);
    ch.transportStatus = 'RECORDING';
    ch.speed = 1.0;
    ch.tally.recording = true;
    ch.tally.onAir = false;
    ch.intervalPhase = 'recording';
    ch.intervalSegment = (ch.intervalSegment || 0) + 1;
    this.intervalRecordings[channelId].startedAt = Date.now();
    this.intervalRecordings[channelId].startFrames = ch.currentFrames;

    if (this.mode === 'hardware') {
      if (!this.sendHardwareCommand(AMP_COMMANDS.RECORD, channelId)) {
        this.stopFailedIntervalRecording(channelId, clip);
        return false;
      }
    } else {
      this.logPacket('TX', `CMDS0004${AMP_COMMANDS.RECORD}`, `INTERVAL RECORD [${channelId}]: ${clip?.name || 'current clip'}`);
      this.logPacket('RX', '1001', `ACK: Recording started [${clip.name}]`);
    }
    this.notifySubscribers();
    return true;
  }

  stopFailedIntervalRecording(channelId, clip) {
    const interval = this.intervalRecordings[channelId];
    if (interval?.timer) clearTimeout(interval.timer);
    delete this.intervalRecordings[channelId];

    const ch = this.channels[channelId];
    ch.intervalRecording = false;
    ch.intervalPhase = null;
    ch.intervalSegment = 0;
    ch.transportStatus = 'STOPPED';
    ch.speed = 0;
    ch.tally.recording = false;
    ch.tally.onAir = false;
    if (clip) {
      this.clips = this.clips.filter((item) => item.id !== clip.id);
      if (ch.activeClip?.id === clip.id) ch.activeClip = null;
    }
    this.logPacket('SYS', 'ERR_INTERVAL_RECORD', `Could not start interval recording on ${channelId}; check the channel connection`);
    this.notifySubscribers();
  }

  finishIntervalSegment(channelId) {
    const ch = this.channels[channelId];
    const interval = this.intervalRecordings[channelId];
    if (!ch || !interval) return;

    const elapsedFrames = Math.max(0, Math.round(((Date.now() - interval.startedAt) / 1000) * (ch.fps || 29.97)));
    const clip = ch.activeClip;
    if (clip && clip.id.startsWith(`IR_${channelId}_`)) {
      clip.durationFrames = elapsedFrames;
      clip.duration = framesToTimecode(elapsedFrames, ch.fps);
      clip.outPoint = framesToTimecode((interval.startFrames || 0) + elapsedFrames, ch.fps);
    }

    const stopSent = this.sendHardwareOrSimulatorCommand(
      AMP_COMMANDS.STOP,
      channelId,
      `Split clip stopped on ${channelId}`
    );
    if (!stopSent) {
      this.stopFailedIntervalRecording(channelId, null);
      return;
    }

    ch.intervalPhase = 'restarting';
    const restartDelay = this.mode === 'hardware' ? 500 : 0;
    interval.timer = setTimeout(() => {
      if (this.intervalRecordings[channelId] !== interval) return;
      if (!this.startIntervalSegment(channelId)) return;
      interval.timer = setTimeout(() => this.finishIntervalSegment(channelId), interval.intervalMs);
    }, restartDelay);
  }

  sendHardwareOrSimulatorCommand(cmdHex, channelId, description) {
    const ch = this.channels[channelId];
    ch.transportStatus = 'STOPPED';
    ch.speed = 0;
    ch.tally.recording = false;
    ch.tally.onAir = false;
    if (this.mode === 'hardware') {
      return this.sendHardwareCommand(cmdHex, channelId);
    } else {
      this.logPacket('TX', `CMDS${cmdHex.length.toString(16).padStart(4, '0')}${cmdHex}`, description);
      this.logPacket('RX', '1001', 'ACK: Transport stopped');
      return true;
    }
  }

  stopIntervalRecording(channelId) {
    const interval = this.intervalRecordings[channelId];
    if (!interval) return false;

    clearTimeout(interval.timer);
    delete this.intervalRecordings[channelId];
    const ch = this.channels[channelId];
    const wasRecording = ch.intervalPhase === 'recording';
    ch.intervalRecording = false;
    ch.intervalPhase = null;
    if (wasRecording) {
      this.sendHardwareOrSimulatorCommand(AMP_COMMANDS.STOP, channelId, `Interval recording stopped on ${channelId}`);
    }

    if (wasRecording) {
      const elapsedFrames = Math.max(0, Math.round(((Date.now() - interval.startedAt) / 1000) * (ch.fps || 29.97)));
      const clip = ch.activeClip;
      if (clip && clip.id.startsWith(`IR_${channelId}_`)) {
        clip.durationFrames = elapsedFrames;
        clip.duration = framesToTimecode(elapsedFrames, ch.fps);
        clip.outPoint = framesToTimecode((interval.startFrames || 0) + elapsedFrames, ch.fps);
      }
    }
    ch.intervalSegment = 0;
    this.notifySubscribers();
    return true;
  }

  startIntervalRecording(channelId, requestedIntervalSeconds = 10) {
    const ch = this.channels[channelId];
    if (!ch) return { success: false, error: `Channel ${channelId} not found` };
    if (this.intervalRecordings[channelId]) return { success: true, channelState: ch };
    if (ch.transportStatus === 'RECORDING') {
      return { success: false, error: `${channelId} is already recording` };
    }
    const intervalSeconds = Number(requestedIntervalSeconds);
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 2147483) {
      return { success: false, error: 'Interval must be a whole number between 1 and 2,147,483 seconds' };
    }

    ch.intervalRecording = true;
    ch.intervalPhase = 'recording';
    this.intervalRecordings[channelId] = {
      timer: null,
      startedAt: Date.now(),
      startFrames: ch.currentFrames,
      intervalSeconds,
      intervalMs: intervalSeconds * 1000,
    };
    if (!this.startIntervalSegment(channelId, { initial: true })) {
      return { success: false, error: `Could not start interval recording on ${channelId}; check the channel connection` };
    }
    this.intervalRecordings[channelId].timer = setTimeout(
      () => this.finishIntervalSegment(channelId),
      this.intervalRecordings[channelId].intervalMs
    );
    return { success: true, channelState: ch };
  }

  /**
   * Split a (possibly coalesced) T3 reply into individual AMP frames.
   * Sony/AMP framing: low nibble of CMD1 = data byte count.
   * AMP variable-length replies (CMD1 = 0x8X) carry a 2-byte byte-count after CMD2.
   */
  splitAmpFrames(hex) {
    const frames = [];
    let i = 0;
    while (i + 4 <= hex.length) {
      const head = hex.substr(i, 4).toLowerCase();
      // T3 non-standard error reply
      if (head === '2222' || head === '1111') {
        frames.push(head);
        i += 4;
        continue;
      }
      const cmd1 = parseInt(hex.substr(i, 2), 16);
      let len;
      if ((cmd1 & 0xf0) === 0x80) {
        if (i + 8 > hex.length) break;
        const byteCount = parseInt(hex.substr(i + 4, 4), 16);
        len = 8 + byteCount * 2;
      } else {
        len = 4 + (cmd1 & 0x0f) * 2;
      }
      if (i + len > hex.length) {
        frames.push(hex.substr(i));
        break;
      }
      frames.push(hex.substr(i, len));
      i += len;
    }
    return frames;
  }

  handleHardwareResponse(channelId, str, buffer) {
    const chId = channelId || this.activeChannel;
    const ch = this.channels[chId];
    const hex = str.replace(/[^0-9a-fA-F]/g, '');
    let changed = false;

    for (const frame of this.splitAmpFrames(hex)) {
      const head = frame.substr(0, 4).toLowerCase();

      if (head === '1001') {
        this.logPacket('RX', '1001', `ACK [${chId}] (Command Accepted)`);
      } else if (head === '1111' || head === '2222' || head === '1112') {
        this.logPacket('RX', frame, `NAK [${chId}] (Command Rejected)`);
        const socket = this.sockets[chId];
        const statusSenseRejected = socket?.statusSenseSentAt
          && Date.now() - socket.statusSenseSentAt <= 1000;
        if (socket) socket.statusSenseSentAt = null;
        if (socket && Date.now() - (socket.connectedAt || 0) <= 300) {
          this.scheduleChannelReconnect(chId, 'CRAT channel bind was rejected');
        } else if (statusSenseRejected) {
          this.scheduleChannelReconnect(chId, 'T3 rejected status sense before channel became responsive');
        }
      } else if (head === '7220' && frame.length >= 8) {
        // Status Sense reply: 72 20 <byte0> <byte1> — transport bits in byte1
        const statusByte = parseInt(frame.substr(6, 2), 16);
        const parsed = parseTransportStatus(statusByte);
        if (ch) {
          const socket = this.sockets[chId];
          if (socket) socket.statusSenseSentAt = null;
          const previousHardwareStatus = ch.hardwareTransportStatus;
          if (parsed.isRecording) {
            ch.transportStatus = 'RECORDING';
            ch.tally.recording = true;
            ch.tally.onAir = false;
          } else if (parsed.isPlaying) {
            ch.transportStatus = 'PLAYING';
            ch.tally.recording = false;
            ch.tally.onAir = true;
          } else if (parsed.isFastForward) {
            ch.transportStatus = 'FF';
            ch.tally.recording = false;
          } else if (parsed.isRewind) {
            ch.transportStatus = 'RW';
            ch.tally.recording = false;
          } else {
            ch.transportStatus = 'STOPPED';
            ch.tally.recording = false;
            ch.tally.onAir = false;
          }
          ch.hardwareTransportStatus = ch.transportStatus;
          this.channelReconnectAttempts[chId] = 0;
          const statusChanged = previousHardwareStatus !== ch.hardwareTransportStatus;
          const lastIntervalStatusLog = this.lastIntervalStatusLog?.[chId] || 0;
          if (statusChanged || (ch.intervalRecording && Date.now() - lastIntervalStatusLog >= 1000)) {
            this.logPacket('RX', frame, `STATUS [${chId}]: ${ch.transportStatus}`);
            if (ch.intervalRecording) {
              if (!this.lastIntervalStatusLog) this.lastIntervalStatusLog = {};
              this.lastIntervalStatusLog[chId] = Date.now();
            }
          }
          changed = true;
        }
      } else if ((head === '7404' || head === '7400') && frame.length >= 12) {
        // Timecode Sense reply: 74 04/00 <FF SS MM HH>
        const tc = bcdToTimecode(frame.substr(4, 8));
        if (ch && tc && tc !== '00:00:00:00') {
          ch.timecode = tc;
          ch.currentFrames = timecodeToFrames(tc, ch.fps || 29.97);
          changed = true;
        }
      } else if (head === '8216' && frame.length >= 12) {
        // ID Loaded reply: 82 16 <byteCount:2> <strLen:2> <ascii name>
        const strLen = parseInt(frame.substr(8, 4), 16);
        const name = hex2str(frame.substr(12, strLen * 2));
        if (ch && name) {
          const isIntervalClip = ch.intervalRecording && ch.activeClip?.id.startsWith(`IR_${chId}_`);
          if (!isIntervalClip) {
            if (!ch.activeClip) ch.activeClip = {};
            if (ch.activeClip.name !== name) {
              this.logPacket('RX', frame, `ID Loaded [${chId}]: ${name}`);
            }
            ch.activeClip.name = name;
            ch.activeClip.id = name;
            ch.clipName = name;
          }
          changed = true;
        }
      } else {
        this.logPacket('RX', frame, `AMP Telemetry [${chId}]`);
      }
    }

    if (changed) this.notifySubscribers();
  }

  // High-Fidelity Simulation Clock
  startSimulationClock() {
    if (this.simulationTimer) clearInterval(this.simulationTimer);
    
    // Tick at 10Hz for smooth UI timecode updates (only active in simulation mode or when disconnected)
    this.simulationTimer = setInterval(() => {
      let changed = false;
      const isHw = this.mode === 'hardware' && this.isConnected;

      for (const key of Object.keys(this.channels)) {
        const ch = this.channels[key];
        const fps = ch.fps || 29.97;
        const frameStep = fps / 10; // ~3 frames per 100ms

        if (ch.transportStatus === 'PLAYING') {
          if (!isHw) {
            ch.currentFrames += frameStep * (ch.speed || 1.0);
            ch.timecode = framesToTimecode(ch.currentFrames, fps, ch.dropFrame);
          }
          changed = true;

          // Audio meter bounce
          ch.audioL = Math.max(-42, Math.min(-6, -16 + (Math.random() * 8 - 4)));
          ch.audioR = Math.max(-42, Math.min(-6, -17 + (Math.random() * 8 - 4)));

          // Check outPoint loop
          if (ch.activeClip) {
            const outFrames = timecodeToFrames(ch.outPoint || ch.activeClip.outPoint, fps);
            if (ch.currentFrames >= outFrames) {
              if (ch.loop) {
                const inFrames = timecodeToFrames(ch.inPoint || ch.activeClip.inPoint, fps);
                ch.currentFrames = inFrames;
              } else {
                ch.currentFrames = outFrames;
                ch.transportStatus = 'STOPPED';
              }
            }
          }
          ch.timecode = framesToTimecode(ch.currentFrames, fps, ch.dropFrame);
        } else if (ch.transportStatus === 'RECORDING') {
          if (!isHw) {
            ch.currentFrames += frameStep;
            ch.timecode = framesToTimecode(ch.currentFrames, fps, ch.dropFrame);
          }
          changed = true;
          ch.audioL = Math.max(-36, Math.min(-3, -12 + (Math.random() * 6 - 3)));
          ch.audioR = Math.max(-36, Math.min(-3, -12 + (Math.random() * 6 - 3)));

          if (ch.activeClip) {
            const interval = this.intervalRecordings[key];
            if (interval) {
              ch.activeClip.durationFrames = Math.round(((Date.now() - interval.startedAt) / 1000) * fps);
              ch.activeClip.duration = framesToTimecode(ch.activeClip.durationFrames, fps);
            } else {
              ch.activeClip.durationFrames = Math.max(ch.activeClip.durationFrames, ch.currentFrames);
              ch.activeClip.duration = framesToTimecode(ch.activeClip.durationFrames, fps);
              ch.outPoint = ch.timecode;
            }
          }
        } else if (ch.transportStatus === 'FF' || ch.transportStatus === 'SHUTTLE') {
          const rate = ch.shuttleRate || 2.0;
          if (!isHw) {
            ch.currentFrames += frameStep * rate;
            ch.timecode = framesToTimecode(ch.currentFrames, fps, ch.dropFrame);
          }
          changed = true;
          ch.audioL = -48;
          ch.audioR = -48;
        } else if (ch.transportStatus === 'RW') {
          const rate = Math.abs(ch.shuttleRate || 2.0);
          if (!isHw) {
            ch.currentFrames = Math.max(0, ch.currentFrames - frameStep * rate);
            ch.timecode = framesToTimecode(ch.currentFrames, fps, ch.dropFrame);
          }
          changed = true;
          ch.audioL = -48;
          ch.audioR = -48;
          ch.timecode = framesToTimecode(ch.currentFrames, fps, ch.dropFrame);
        } else if (ch.transportStatus === 'STOPPED' || ch.transportStatus === 'STILL') {
          // Resting audio floor
          if (ch.audioL > -48) {
            ch.audioL = Math.max(-48, ch.audioL - 3);
            ch.audioR = Math.max(-48, ch.audioR - 3);
            changed = true;
          }
        }
      }

      if (changed) {
        this.notifySubscribers();
      }
    }, 100);
  }

  // Execute Transport & Playout Commands
  executeCommand(action, params = {}) {
    const targetChannel = params.channel || this.activeChannel;
    const ch = this.channels[targetChannel];
    if (!ch) return { success: false, error: `Channel ${targetChannel} not found` };

    switch (action) {
      case 'record_all': {
        const cmdHex = AMP_COMMANDS.RECORD;
        this.logPacket('SYS', 'REC_ALL', 'RECORD ALL issued across all recording channels');
        for (const chId of Object.keys(this.intervalRecordings)) {
          this.stopIntervalRecording(chId);
        }
        if (this.mode === 'hardware') {
          for (const chId of ['Vtr1', 'Vtr2', 'Vtr3']) {
            this.sendHardwareCommand(cmdHex, chId);
          }
        }
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').substr(0, 14);
        for (const k of Object.keys(this.channels)) {
          const c = this.channels[k];
          if (c.type === 'RECORD' || c.type === 'RECORD_PLAY') {
            c.transportStatus = 'RECORDING';
            c.speed = 1.0;
            c.tally.recording = true;
            c.tally.onAir = false;

            const isoPrefix = c.id === 'Vtr1' ? 'CAM1' : c.id === 'Vtr2' ? 'CAM2' : 'CAM3';
            c.activeClip = {
              id: 'REC_' + k + '_' + Date.now(),
              name: `${isoPrefix}_ISO_${timestamp}`,
              duration: '00:00:00:00',
              durationFrames: 0,
              inPoint: c.timecode,
              outPoint: c.timecode,
              format: 'Grass Valley HQX',
              fps: c.fps,
              resolution: '1920x1080i',
              date: new Date().toLocaleString(),
              bin: `REC_BIN_${c.id}`,
            };
            this.clips.unshift(c.activeClip);
          }
        }
        this.logPacket('TX', `CMDS0004${cmdHex}`, 'RECORD ALL command sent to T3 (3 Recorders)');
        this.logPacket('RX', '1001', 'ACK: R1, R2, R3 recording in sync');
        break;
      }

      case 'stop_all': {
        const cmdHex = AMP_COMMANDS.STOP;
        this.logPacket('SYS', 'STOP_ALL', 'STOP ALL issued across all channels');
        for (const chId of Object.keys(this.intervalRecordings)) {
          this.stopIntervalRecording(chId);
        }
        if (this.mode === 'hardware') {
          for (const chId of ['Vtr1', 'Vtr2', 'Vtr3']) {
            this.sendHardwareCommand(cmdHex, chId);
          }
        }
        for (const k of Object.keys(this.channels)) {
          const c = this.channels[k];
          if (this.intervalRecordings[k]) {
            clearTimeout(this.intervalRecordings[k].timer);
            delete this.intervalRecordings[k];
          }
          c.transportStatus = 'STOPPED';
          c.speed = 0;
          c.shuttleRate = 0;
          c.tally.recording = false;
          c.tally.onAir = false;
          c.intervalRecording = false;
          c.intervalPhase = null;
          c.intervalSegment = 0;
        }
        this.logPacket('TX', `CMDS0004${cmdHex}`, 'STOP ALL command sent');
        this.logPacket('RX', '1001', 'ACK: All channels stopped');
        break;
      }

      case 'play_all': {
        const cmdHex = AMP_COMMANDS.PLAY;
        this.logPacket('SYS', 'PLAY_ALL', 'PLAY ALL issued across all playout channels');
        if (this.mode === 'hardware') {
          for (const chId of ['Vtr1', 'Vtr2', 'Vtr3']) {
            this.sendHardwareCommand(cmdHex, chId);
          }
        }
        for (const k of Object.keys(this.channels)) {
          const c = this.channels[k];
          c.transportStatus = 'PLAYING';
          c.speed = 1.0;
          c.shuttleRate = 1.0;
          c.tally.recording = false;
          c.tally.onAir = true;
        }
        this.logPacket('TX', `CMDS0004${cmdHex}`, 'PLAY ALL command sent');
        this.logPacket('RX', '1001', 'ACK: Playout started on channels');
        break;
      }

      case 'play': {
        const cmdHex = AMP_COMMANDS.PLAY;
        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex, targetChannel);
        } else {
          ch.transportStatus = 'PLAYING';
          ch.speed = 1.0;
          ch.shuttleRate = 1.0;
          ch.tally.recording = false;
          ch.tally.onAir = true;
          this.logPacket('TX', `CMDS0004${cmdHex}`, `PLAY command on ${ch.id}`);
          this.logPacket('RX', '1001', 'ACK: Playout started');
        }
        break;
      }

      case 'stop': {
        if (this.intervalRecordings[targetChannel]) {
          this.stopIntervalRecording(targetChannel);
          break;
        }
        const cmdHex = AMP_COMMANDS.STOP;
        ch.transportStatus = 'STOPPED';
        ch.speed = 0;
        ch.shuttleRate = 0;
        ch.tally.recording = false;
        ch.tally.onAir = false;
        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex, targetChannel);
        } else {
          this.logPacket('TX', `CMDS0004${cmdHex}`, `STOP command on ${ch.id}`);
          this.logPacket('RX', '1001', 'ACK: Transport stopped');
        }
        break;
      }

      case 'record': {
        if (this.intervalRecordings[targetChannel]) {
          this.stopIntervalRecording(targetChannel);
        }
        const cmdHex = AMP_COMMANDS.RECORD;
        ch.transportStatus = 'RECORDING';
        ch.speed = 1.0;
        ch.tally.recording = true;
        ch.tally.onAir = false;
        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex, targetChannel);
        } else {
          // If no active clip or recording new clip
          if (!ch.activeClip || ch.activeClip.id !== 'REC_ACTIVE') {
            const clipName = params.clipName || `LIVE_REC_${new Date().toISOString().replace(/[-:T.]/g, '').substr(0, 14)}`;
            const newClip = {
              id: 'REC_' + Date.now(),
              name: clipName,
              duration: '00:00:00:00',
              durationFrames: 0,
              inPoint: ch.timecode,
              outPoint: ch.timecode,
              format: 'Grass Valley HQX',
              fps: ch.fps,
              resolution: '1920x1080i',
              date: new Date().toLocaleString(),
              bin: 'RECORDINGS',
            };
            this.clips.unshift(newClip);
            ch.activeClip = newClip;
          }

          this.logPacket('TX', `CMDS0004${cmdHex}`, `RECORD command on ${ch.id}`);
          this.logPacket('RX', '1001', `ACK: Recording started [${ch.activeClip.name}]`);
        }
        break;
      }

      case 'start_interval_recording': {
        return this.startIntervalRecording(targetChannel, params.intervalSeconds);
      }

      case 'stop_interval_recording': {
        if (!this.stopIntervalRecording(targetChannel)) {
          return { success: false, error: `${targetChannel} is not interval recording` };
        }
        break;
      }

      case 'pause':
      case 'still': {
        ch.transportStatus = 'STILL';
        ch.speed = 0;
        ch.shuttleRate = 0;
        this.logPacket('TX', 'CMDS00042000', `PAUSE / STILL command on ${ch.id}`);
        this.logPacket('RX', '1001', 'ACK: Playout paused on still frame');
        break;
      }

      case 'shuttle': {
        const rate = parseFloat(params.rate) || 2.0;
        const speedObj = SHUTTLE_SPEEDS.find((s) => s.rate === Math.abs(rate)) || SHUTTLE_SPEEDS[4];
        const isFwd = rate >= 0;
        const cmdHex = isFwd ? AMP_COMMANDS.shuttleFwd(speedObj.hex) : AMP_COMMANDS.shuttleRev(speedObj.hex);

        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex);
        } else {
          ch.transportStatus = isFwd ? 'FF' : 'RW';
          ch.shuttleRate = rate;
          this.logPacket('TX', `CMDS0006${cmdHex}`, `SHUTTLE ${rate}x command on ${ch.id}`);
          this.logPacket('RX', '1001', `ACK: Shuttle speed ${rate}x`);
        }
        break;
      }

      case 'jog': {
        const frames = parseInt(params.frames, 10) || 1;
        const isFwd = frames > 0;
        const count = Math.min(15, Math.abs(frames));
        const cmdHex = isFwd ? AMP_COMMANDS.jogFwd(count) : AMP_COMMANDS.jogRev(count);

        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex);
        } else {
          ch.transportStatus = 'STILL';
          ch.currentFrames = Math.max(0, ch.currentFrames + frames);
          ch.timecode = framesToTimecode(ch.currentFrames, ch.fps, ch.dropFrame);
          this.logPacket('TX', `CMDS0006${cmdHex}`, `JOG ${frames > 0 ? '+' : ''}${frames} frames on ${ch.id}`);
          this.logPacket('RX', '1001', `ACK: Position ${ch.timecode}`);
        }
        break;
      }

      case 'cue_timecode': {
        const tc = params.timecode || '00:00:00:00';
        const cmdHex = AMP_COMMANDS.cueTimecode(tc);
        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex);
        } else {
          ch.transportStatus = 'STOPPED';
          ch.timecode = tc;
          ch.currentFrames = timecodeToFrames(tc, ch.fps);
          this.logPacket('TX', `CMDS0010${cmdHex}`, `CUE to ${tc} on ${ch.id}`);
          this.logPacket('RX', '1001', `ACK: Cued to ${tc}`);
        }
        break;
      }

      case 'load_clip': {
        const clip = this.clips.find((c) => c.id === params.clipId || c.name === params.clipName);
        if (clip) {
          ch.activeClip = clip;
          ch.timecode = clip.inPoint || '00:00:00:00';
          ch.inPoint = clip.inPoint || '00:00:00:00';
          ch.outPoint = clip.outPoint || clip.duration;
          ch.currentFrames = timecodeToFrames(ch.timecode, ch.fps);
          ch.transportStatus = 'STOPPED';

          const cmdHex = AMP_COMMANDS.loadClip(clip.name);
          if (this.mode === 'hardware') {
            this.sendHardwareCommand(cmdHex);
          } else {
            this.logPacket('TX', `CMDS${cmdHex.length}${cmdHex}`, `LOAD CLIP: "${clip.name}" onto ${ch.id}`);
            this.logPacket('RX', '1001', `ACK: Clip loaded. Duration: ${clip.duration}`);
          }
        }
        break;
      }

      case 'set_loop': {
        const enabled = Boolean(params.enabled);
        ch.loop = enabled;
        const cmdHex = enabled ? AMP_COMMANDS.LOOP_ON : AMP_COMMANDS.LOOP_OFF;
        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex);
        } else {
          this.logPacket('TX', `CMDS0006${cmdHex}`, `SET LOOP: ${enabled ? 'ON' : 'OFF'} on ${ch.id}`);
          this.logPacket('RX', '1001', `ACK: Loop mode ${enabled ? 'active' : 'disabled'}`);
        }
        break;
      }

      case 'set_mark_in': {
        ch.inPoint = params.timecode || ch.timecode;
        this.logPacket('SYS', 'MARK_IN', `Mark IN point set to ${ch.inPoint} on ${ch.id}`);
        break;
      }

      case 'set_mark_out': {
        ch.outPoint = params.timecode || ch.timecode;
        this.logPacket('SYS', 'MARK_OUT', `Mark OUT point set to ${ch.outPoint} on ${ch.id}`);
        break;
      }

      case 'goto_in': {
        ch.timecode = ch.inPoint;
        ch.currentFrames = timecodeToFrames(ch.inPoint, ch.fps);
        ch.transportStatus = 'STOPPED';
        this.logPacket('SYS', 'GOTO_IN', `Cue to IN Point: ${ch.inPoint}`);
        break;
      }

      case 'goto_out': {
        ch.timecode = ch.outPoint;
        ch.currentFrames = timecodeToFrames(ch.outPoint, ch.fps);
        ch.transportStatus = 'STOPPED';
        this.logPacket('SYS', 'GOTO_OUT', `Cue to OUT Point: ${ch.outPoint}`);
        break;
      }

      case 'eject': {
        const cmdHex = AMP_COMMANDS.EJECT;
        if (this.mode === 'hardware') {
          this.sendHardwareCommand(cmdHex);
        } else {
          ch.activeClip = null;
          ch.transportStatus = 'STOPPED';
          this.logPacket('TX', `CMDS0004${cmdHex}`, `EJECT command on ${ch.id}`);
          this.logPacket('RX', '1001', 'ACK: Channel media ejected');
        }
        break;
      }

      case 'send_raw': {
        const rawHex = String(params.rawHex || '').trim();
        if (rawHex) {
          if (this.mode === 'hardware') {
            this.sendHardwareCommand(rawHex);
          } else {
            this.logPacket('TX', `CMDS${rawHex.length}${rawHex}`, `RAW AMP COMMAND: ${rawHex}`);
            this.logPacket('RX', '1001', 'ACK (Simulator Accepted)');
          }
        }
        break;
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }

    this.notifySubscribers();
    return { success: true, channelState: ch };
  }

  // Switch Active Controlled Channel
  setActiveChannel(channelId) {
    if (this.channels[channelId]) {
      this.activeChannel = channelId;
      this.logPacket('SYS', 'CH_SELECT', `Active control switched to ${channelId} (${this.channels[channelId].label})`);
      this.notifySubscribers();
      return true;
    }
    return false;
  }
}

// Global Singleton to preserve state across Next.js API calls
if (!globalThis._gvAmpService) {
  globalThis._gvAmpService = new GrassValleyAmpService();
} else {
  Object.setPrototypeOf(globalThis._gvAmpService, GrassValleyAmpService.prototype);
  if (!globalThis._gvAmpService.sockets) globalThis._gvAmpService.sockets = {};
  if (!globalThis._gvAmpService.channelHeartbeats) globalThis._gvAmpService.channelHeartbeats = {};
  if (!globalThis._gvAmpService.pendingHardwareCommands) globalThis._gvAmpService.pendingHardwareCommands = {};
  if (!globalThis._gvAmpService.channelReconnectTimers) globalThis._gvAmpService.channelReconnectTimers = {};
  if (!globalThis._gvAmpService.channelReconnectAttempts) globalThis._gvAmpService.channelReconnectAttempts = {};
  if (globalThis._gvAmpService.mode === 'hardware') {
    globalThis._gvAmpService.connectHardwareSocket();
  }
}

export const ampService = globalThis._gvAmpService;
