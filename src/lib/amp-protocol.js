/**
 * Grass Valley AMP (Advanced Media Protocol) Definition & Helpers
 * Target: Grass Valley T3 / T2 iDDR & K2 Media Servers
 * Port: 3811 (TCP)
 */

export function zpad(data, length) {
  const str = String(data);
  return ('0'.repeat(length) + str).slice(-length);
}

export function str2hex(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    result += zpad(str.charCodeAt(i).toString(16), 2);
  }
  return result;
}

export function hex2str(hex) {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}

/**
 * Convert HH:MM:SS:FF timecode to BCD hex string (4 bytes = 8 hex chars)
 * AMP / Sony BVW format: FF SS MM HH (low to high byte)
 */
export function timecodeToBcd(tc) {
  if (!tc || typeof tc !== 'string') return '00000000';
  const parts = tc.replace(/;/g, ':').split(':');
  if (parts.length < 4) return '00000000';
  const hh = zpad(parseInt(parts[0], 10) || 0, 2);
  const mm = zpad(parseInt(parts[1], 10) || 0, 2);
  const ss = zpad(parseInt(parts[2], 10) || 0, 2);
  const ff = zpad(parseInt(parts[3], 10) || 0, 2);
  // Returned as FF SS MM HH in BCD
  return `${ff}${ss}${mm}${hh}`;
}

/**
 * Convert BCD hex string to HH:MM:SS:FF
 */
export function bcdToTimecode(bcd) {
  if (!bcd || bcd.length < 8) return '00:00:00:00';
  // FF SS MM HH
  const ff = bcd.substr(0, 2);
  const ss = bcd.substr(2, 2);
  const mm = bcd.substr(4, 2);
  const hh = bcd.substr(6, 2);
  return `${hh}:${mm}:${ss}:${ff}`;
}

/**
 * Convert total frames to SMPTE Timecode
 */
export function framesToTimecode(totalFrames, fps = 29.97, dropFrame = false) {
  const roundedFps = Math.round(fps);
  let frames = Math.max(0, Math.floor(totalFrames));
  
  const ff = frames % roundedFps;
  const totalSeconds = Math.floor(frames / roundedFps);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60) % 24;

  const sep = dropFrame ? ';' : ':';
  return `${zpad(hh, 2)}:${zpad(mm, 2)}:${zpad(ss, 2)}${sep}${zpad(ff, 2)}`;
}

/**
 * Convert SMPTE Timecode to total frames
 */
export function timecodeToFrames(tc, fps = 29.97) {
  if (!tc || typeof tc !== 'string') return 0;
  const parts = tc.replace(/;/g, ':').split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.length < 4) return 0;
  const [hh, mm, ss, ff] = parts;
  const roundedFps = Math.round(fps);
  return (hh * 3600 + mm * 60 + ss) * roundedFps + ff;
}

/**
 * Format CRAT connection packet
 * Example: CRAT0007204Vtr1\n
 */
export function buildCratPacket(channel = 'Vtr1') {
  const chLen = channel.length;
  const totalLen = chLen + 3;
  return `CRAT${zpad(totalLen, 4)}2${zpad(chLen, 2)}${channel}\n`;
}

/**
 * Format CMDS command packet
 * Example: CMDS00042001\n
 */
export function buildCmdsPacket(cmdHex) {
  return `CMDS${zpad(cmdHex.length, 4)}${cmdHex}\n`;
}

/**
 * Build AMP command with structured arguments
 */
export function buildAmpCommand(cmdCode, args = []) {
  let payload = '';
  let byteCount = 0;

  args.forEach((arg) => {
    // [data, fixedHexLen, strPrefixLen]
    if (arg[1] === false) {
      const hexStr = str2hex(arg[0]);
      const prefixHex = zpad(arg[0].length.toString(16), arg[2]);
      byteCount += arg[0].length + arg[2] / 2;
      payload += prefixHex + hexStr;
    } else {
      byteCount += arg[1] / 2;
      payload += zpad(str2hex(arg[0]), arg[1]);
    }
  });

  return `${cmdCode}${zpad(byteCount.toString(16), 4)}${payload}`;
}

/**
 * Speed lookup table for Shuttle controls
 */
export const SHUTTLE_SPEEDS = [
  { id: '10', rate: 0.1, label: '0.1x', hex: '10' },
  { id: '20', rate: 0.25, label: '0.25x', hex: '20' },
  { id: '30', rate: 0.5, label: '0.5x', hex: '30' },
  { id: '48', rate: 1.0, label: '1.0x', hex: '48' },
  { id: '74', rate: 2.0, label: '2.0x', hex: '74' },
  { id: '83', rate: 4.0, label: '4.0x', hex: '83' },
  { id: '93', rate: 8.0, label: '8.0x', hex: '93' },
  { id: '103', rate: 16.0, label: '16.0x', hex: '103' },
  { id: '112', rate: 32.0, label: '32.0x', hex: '112' },
];

/**
 * Standard Grass Valley AMP Command Codes
 */
export const AMP_COMMANDS = {
  PLAY: '2001',
  STOP: '2000',
  RECORD: '2002',
  EJECT: '200f',
  LOOP_ON: '414201',
  LOOP_OFF: '414200',
  STATUS_SENSE: '612005',
  TIMECODE_SENSE: '610c04',
  ID_LOADED: 'a016', // ID Loaded Request -> reply 82.16 <byteCount:2> <strLen:2> <ascii name>
  GET_WORKING_FOLDER: 'a00f', // Get Working Folder -> reply 82.0f <byteCount:2> <strLen:2> <ascii folder>
  LIST_FOLDERS: 'a027', // List Available Folders -> reply 82.27 <byteCount:2> [ <strLen:2> <ascii folder> ... ]
  REMAINING_TIME: 'a01c', // Remaining Record Time -> reply 84.1c <FF SS MM HH>
  SYSTEM_NAME: 'a02c', // System Name -> reply 82.2c <byteCount:2> <strLen:1> <ascii name>
  LIST_FIRST_ID: 'a2140000',
  LIST_NEXT_ID: 'a115ff',
  setWorkingFolder: (folderName) => {
    const hex = str2hex(folderName);
    const len = zpad(folderName.length.toString(16), 4);
    const totalBytes = zpad((folderName.length + 2).toString(16), 4);
    return `a20e${totalBytes}${len}${hex}`;
  },
  shuttleFwd: (speedHex = '74') => `2113${speedHex}`,
  shuttleRev: (speedHex = '74') => `2123${speedHex}`,
  jogFwd: (frames = 1) => `2111${zpad(frames.toString(16), 2)}`,
  jogRev: (frames = 1) => `2121${zpad(frames.toString(16), 2)}`,
  loadClip: (clipName) => {
    const hex = str2hex(clipName);
    const len = zpad(clipName.length.toString(16), 4);
    const totalBytes = zpad((clipName.length + 2).toString(16), 4);
    return `4a14${totalBytes}${len}${hex}`;
  },
  getClipDuration: (clipName) => {
    const hex = str2hex(clipName);
    const len = zpad(clipName.length.toString(16), 4);
    const totalBytes = zpad((clipName.length + 2).toString(16), 4);
    return `a217${totalBytes}${len}${hex}`;
  },
  getClipStartTc: (clipName) => {
    const hex = str2hex(clipName);
    const len = zpad(clipName.length.toString(16), 4);
    const totalBytes = zpad((clipName.length + 2).toString(16), 4);
    return `a225${totalBytes}${len}${hex}`;
  },
  recordClip: (clipName, initialTc = '00000000') => {
    const hex = str2hex(clipName);
    const len = zpad(clipName.length.toString(16), 4);
    const totalBytes = zpad((clipName.length + 6).toString(16), 4);
    return `ae02${totalBytes}${initialTc}${len}${hex}`;
  },
  cueTimecode: (tcString) => {
    const bcd = timecodeToBcd(tcString);
    return `2431${bcd}`;
  },
};

/**
 * Decode Transport Status Bitmask
 * Command 72.20 response from Grass Valley T2/T3
 */
export function parseTransportStatus(byteValue) {
  const byte = typeof byteValue === 'number' ? byteValue : parseInt(byteValue, 16) || 0;
  return {
    isPlaying: (byte & 0x01) !== 0,
    isRecording: (byte & 0x02) !== 0,
    isFastForward: (byte & 0x04) !== 0,
    isRewind: (byte & 0x08) !== 0,
    isShuttle: (byte & 0x10) !== 0,
    isStopped: (byte & 0x20) !== 0 || (byte & 0x03) === 0,
  };
}
