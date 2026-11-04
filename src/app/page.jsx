'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Circle, Square, Disc, RefreshCw } from 'lucide-react';

const DEFAULT_HOST = process.env.NEXT_PUBLIC_T3_HOST || '192.168.145.20';
const DEFAULT_PORT = parseInt(process.env.NEXT_PUBLIC_T3_PORT || '3811', 10);
const INTERVAL_STORAGE_KEY = 't3_interval_seconds';

export default function CompactTripleChannelRecordPage() {
  const [deckState, setDeckState] = useState(null);
  const [commandError, setCommandError] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState({
    Vtr1: '10',
    Vtr2: '10',
    Vtr3: '10',
  });
  const [playerClipNames, setPlayerClipNames] = useState({
    Vtr1: '',
    Vtr2: '',
    Vtr3: '',
  });
  const [playerCueTimecodes, setPlayerCueTimecodes] = useState({
    Vtr1: '00:00:00:00',
    Vtr2: '00:00:00:00',
    Vtr3: '00:00:00:00',
  });
  const [clipSearch, setClipSearch] = useState('');
  const [dragOverChannel, setDragOverChannel] = useState(null);

  // Restore saved interval recording durations from localStorage on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(INTERVAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setIntervalSeconds((prev) => ({
            Vtr1: parsed.Vtr1 ? String(parsed.Vtr1) : prev.Vtr1,
            Vtr2: parsed.Vtr2 ? String(parsed.Vtr2) : prev.Vtr2,
            Vtr3: parsed.Vtr3 ? String(parsed.Vtr3) : prev.Vtr3,
          }));
        }
      }
    } catch (err) {}
  }, []);

  // Poll or SSE Stream connection
  useEffect(() => {
    let eventSource = null;
    let pollInterval = null;
    let hydratedIntervals = false;

    const syncSavedIntervalsFromServer = (data) => {
      if (hydratedIntervals || !data?.channels) return;
      hydratedIntervals = true;
      try {
        const hasLocal = Boolean(window.localStorage.getItem(INTERVAL_STORAGE_KEY));
        if (!hasLocal) {
          const fromServer = {
            Vtr1: String(data.channels.Vtr1?.intervalSeconds || 10),
            Vtr2: String(data.channels.Vtr2?.intervalSeconds || 10),
            Vtr3: String(data.channels.Vtr3?.intervalSeconds || 10),
          };
          setIntervalSeconds(fromServer);
          window.localStorage.setItem(INTERVAL_STORAGE_KEY, JSON.stringify(fromServer));
        }
      } catch (err) {}
    };

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/amp/status');
        const data = await res.json();
        if (data && data.channels) {
          syncSavedIntervalsFromServer(data);
          setDeckState(data);
        }
      } catch (err) {}
    };

    const initConnection = async () => {
      try {
        const res = await fetch('/api/amp/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'hardware', host: DEFAULT_HOST, port: DEFAULT_PORT, channel: 'Vtr1' }),
        });
        const data = await res.json();
        if (data && data.channels) {
          syncSavedIntervalsFromServer(data);
          setDeckState(data);
        }
      } catch (err) {}
    };

    initConnection();
    fetchStatus();

    try {
      eventSource = new EventSource('/api/amp/stream');
      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setDeckState(data);
        } catch (err) {}
      };
      eventSource.onerror = () => {
        eventSource.close();
        if (!pollInterval) {
          pollInterval = setInterval(fetchStatus, 300);
        }
      };
    } catch (err) {
      pollInterval = setInterval(fetchStatus, 300);
    }

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Send Command to Backend for specific channel or all with instant optimistic UI feedback
  const sendCommand = useCallback(async (action, channel, params = {}) => {
    // Instant optimistic update so UI is immediately responsive
    if (channel) {
      setDeckState((prev) => {
        if (!prev?.channels?.[channel]) return prev;
        const updatedCh = { ...prev.channels[channel] };
        if (action === 'record') {
          updatedCh.transportStatus = 'RECORDING';
          updatedCh.tally = { ...updatedCh.tally, recording: true, onAir: false };
        } else if (action === 'play') {
          updatedCh.transportStatus = 'PLAYING';
          updatedCh.tally = { ...updatedCh.tally, recording: false, onAir: true };
        } else if (action === 'stop') {
          updatedCh.transportStatus = 'STOPPED';
          updatedCh.tally = { ...updatedCh.tally, recording: false, onAir: false };
          updatedCh.intervalRecording = false;
          updatedCh.intervalPhase = null;
          updatedCh.intervalSegment = 0;
        } else if (action === 'start_interval_recording') {
          updatedCh.transportStatus = 'RECORDING';
          updatedCh.tally = { ...updatedCh.tally, recording: true, onAir: false };
          updatedCh.intervalRecording = true;
          updatedCh.intervalPhase = 'recording';
          updatedCh.intervalSegment = (updatedCh.intervalSegment || 0) + 1;
        } else if (action === 'stop_interval_recording') {
          updatedCh.transportStatus = 'STOPPED';
          updatedCh.tally = { ...updatedCh.tally, recording: false, onAir: false };
          updatedCh.intervalRecording = false;
          updatedCh.intervalPhase = null;
          updatedCh.intervalSegment = 0;
        }
        return {
          ...prev,
          channels: {
            ...prev.channels,
            [channel]: updatedCh,
          },
        };
      });
    } else if (action === 'record_all' || action === 'play_all' || action === 'stop_all') {
      const isRec = action === 'record_all';
      const isPlaying = action === 'play_all';
      setDeckState((prev) => {
        if (!prev?.channels) return prev;
        const newChannels = {};
        for (const [k, v] of Object.entries(prev.channels)) {
          const isRecorder = v.type === 'RECORD' || v.type === 'RECORD_PLAY';
          const isPlayer = v.type === 'PLAY' || v.type === 'RECORD_PLAY';
          const isTarget = action === 'stop_all' || (isRec ? isRecorder : isPlayer);
          newChannels[k] = {
            ...v,
            transportStatus: isTarget
              ? (isRec ? 'RECORDING' : isPlaying ? 'PLAYING' : 'STOPPED')
              : v.transportStatus,
            tally: isTarget
              ? { ...v.tally, recording: isRec, onAir: isPlaying }
              : v.tally,
          };
        }
        return { ...prev, channels: newChannels };
      });
    }

    try {
      const res = await fetch('/api/amp/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, channel, params }),
      });
      const data = await res.json();
      if (!data.success) {
        setCommandError(data.error || 'Command failed');
        if (data.state) setDeckState(data.state);
        return;
      }
      setCommandError('');
      if (data.state) {
        setDeckState(data.state);
      }
    } catch (err) {
      console.error('Command failed:', err);
      setCommandError(err.message || 'Command failed');
    }
  }, []);

  const startRecord = useCallback((channel) => {
    sendCommand('record', channel);
  }, [sendCommand]);

  const startPlayback = useCallback((channel) => {
    sendCommand('play', channel);
  }, [sendCommand]);

  const loadPlayerClip = useCallback((channel = 'Vtr3') => {
    const clipName = (playerClipNames[channel] || '').trim();
    if (clipName) sendCommand('load_clip', channel, { clipName });
  }, [playerClipNames, sendCommand]);

  const loadClipToPlayer = useCallback((clip, targetChannel) => {
    const fallbackPlayer = ['Vtr1', 'Vtr2', 'Vtr3'].find(
      (id) => deckState?.channels?.[id]?.type === 'PLAY'
    ) || 'Vtr3';
    const chId = targetChannel || fallbackPlayer;
    setPlayerClipNames((prev) => ({ ...prev, [chId]: clip.name }));
    sendCommand('load_clip', chId, { clipName: clip.name });
  }, [deckState, sendCommand]);

  const syncClipList = useCallback(() => {
    sendCommand('sync_clips', 'Vtr1');
  }, [sendCommand]);

  const cuePlayer = useCallback((channel = 'Vtr3') => {
    sendCommand('cue_timecode', channel, { timecode: playerCueTimecodes[channel] || '00:00:00:00' });
  }, [playerCueTimecodes, sendCommand]);

  const stopRecord = useCallback((channel) => {
    sendCommand('stop', channel);
  }, [sendCommand]);

  const toggleIntervalRecording = useCallback((channel, isActive, seconds) => {
    sendCommand(
      isActive ? 'stop_interval_recording' : 'start_interval_recording',
      channel,
      isActive ? {} : { intervalSeconds: Number(seconds) }
    );
  }, [sendCommand]);

  const recordAll = useCallback(() => {
    sendCommand('record_all');
  }, [sendCommand]);

  const stopAll = useCallback(() => {
    sendCommand('stop_all');
  }, [sendCommand]);

  const playAll = useCallback(() => {
    sendCommand('play_all');
  }, [sendCommand]);

  // Keyboard shortcuts (1: CH1, 2: CH2, 3: CH3, R: Rec All, P: Play All, S/Esc: Stop All)
  useEffect(() => {
    const toggleChannelTransport = (chId) => {
      const ch = deckState?.channels?.[chId];
      const isRec = (ch?.type || 'RECORD') === 'RECORD';
      if (isRec) {
        const active = ch?.transportStatus === 'RECORDING' || ch?.tally?.recording;
        if (active) stopRecord(chId);
        else startRecord(chId);
      } else {
        const active = ch?.transportStatus === 'PLAYING' || ch?.tally?.onAir;
        if (active) stopRecord(chId);
        else startPlayback(chId);
      }
    };
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === '1') {
        e.preventDefault();
        toggleChannelTransport('Vtr1');
      } else if (key === '2') {
        e.preventDefault();
        toggleChannelTransport('Vtr2');
      } else if (key === '3') {
        e.preventDefault();
        toggleChannelTransport('Vtr3');
      } else if (key === 'r') {
        e.preventDefault();
        recordAll();
      } else if (key === 'p') {
        e.preventDefault();
        playAll();
      } else if (key === 's' || e.key === 'Escape') {
        e.preventDefault();
        stopAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deckState, startRecord, startPlayback, stopRecord, recordAll, playAll, stopAll]);

  const ch1 = deckState?.channels?.['Vtr1'] || { type: 'RECORD', deckLabel: 'RECORDER 1', shortCode: 'R1' };
  const ch2 = deckState?.channels?.['Vtr2'] || { type: 'RECORD', deckLabel: 'RECORDER 2', shortCode: 'R2' };
  const ch3 = deckState?.channels?.['Vtr3'] || { type: 'PLAY', deckLabel: 'PLAYER 1', shortCode: 'P1' };

  const isChActive = (ch) =>
    ch.type === 'PLAY'
      ? ch.transportStatus === 'PLAYING' || ch.tally?.onAir === true
      : ch.transportStatus === 'RECORDING' || ch.tally?.recording === true;

  const ch1Active = isChActive(ch1);
  const ch2Active = isChActive(ch2);
  const ch3Active = isChActive(ch3);

  const allChannels = [
    { id: 'Vtr1', ch: ch1 },
    { id: 'Vtr2', ch: ch2 },
    { id: 'Vtr3', ch: ch3 },
  ];
  const recorderCodes = allChannels.filter(({ ch }) => ch.type !== 'PLAY').map(({ ch }) => ch.shortCode || 'R');
  const playerCodes = allChannels.filter(({ ch }) => ch.type === 'PLAY').map(({ ch }) => ch.shortCode || 'P');
  const allCodes = allChannels.map(({ ch }) => ch.shortCode || ch.id);

  const host = deckState?.host || DEFAULT_HOST;
  const port = deckState?.port || DEFAULT_PORT;
  const isConnected = deckState?.isConnected;
  const hwConfigLabel = deckState?.hardwareConfig?.label || '2-RECORDER / 1-PLAYER CONSOLE';

  const renderChannelDeck = (chId, label, ch, isActive, hotkeyNum) => {
    const isRecorder = ch.type === 'RECORD' || ch.type === 'RECORD_PLAY';
    const activeColor = isRecorder ? '#ef4444' : '#22c55e';
    const isDragOver = dragOverChannel === chId;
    const shortCode = ch.shortCode || (isRecorder ? 'R' : 'P1');

    return (
    <div
      key={chId}
      id={`deck-${chId.toLowerCase()}`}
      role={!isRecorder ? 'group' : undefined}
      aria-label={!isRecorder ? `${shortCode} player drop target` : undefined}
      onDragOver={!isRecorder ? (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDragOverChannel(chId);
      } : undefined}
      onDrop={!isRecorder ? (event) => {
        event.preventDefault();
        setDragOverChannel(null);
        const clipName = event.dataTransfer.getData('text/plain').trim();
        if (clipName) loadClipToPlayer({ name: clipName }, chId);
      } : undefined}
      onDragLeave={!isRecorder ? (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOverChannel(null);
      } : undefined}
      style={{
      background: '#0d1019',
      borderRadius: '10px',
      border: `1.5px solid ${!isRecorder && isDragOver ? '#22c55e' : isActive ? activeColor : 'rgba(255, 255, 255, 0.08)'}`,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxShadow: isActive
        ? `0 0 20px ${isRecorder ? 'rgba(239, 68, 68, 0.25)' : 'rgba(34, 197, 94, 0.25)'}, inset 0 0 10px ${isRecorder ? 'rgba(239, 68, 68, 0.06)' : 'rgba(34, 197, 94, 0.06)'}`
        : '0 4px 12px rgba(0, 0, 0, 0.35)',
      transition: 'all 0.15s ease',
    }}>
      {/* Deck Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: '4px',
            background: isActive ? activeColor : '#334155',
            color: '#fff',
            letterSpacing: '0.8px',
          }}>
            {chId === 'Vtr1' ? 'CH 1' : chId === 'Vtr2' ? 'CH 2' : 'CH 3'}
          </span>
          <span style={{ fontWeight: 800, fontSize: '12px', color: '#f8fafc', letterSpacing: '0.4px' }}>
            {label}
          </span>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          fontSize: '10px',
          fontWeight: 700,
          color: isActive ? (isRecorder ? '#f87171' : '#4ade80') : '#64748b',
        }}>
          <span style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            backgroundColor: isActive ? activeColor : '#475569',
            boxShadow: isActive ? `0 0 8px ${activeColor}` : 'none',
          }} />
          <span>{isActive ? (isRecorder ? '● REC' : '● PLAY') : 'IDLE'}</span>
        </div>
      </div>

      {/* Timecode Readout */}
      <div style={{
        background: '#04060a',
        borderRadius: '6px',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '5px',
        border: `1px solid ${isActive ? (isRecorder ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.35)') : 'rgba(255, 255, 255, 0.05)'}`,
      }}>
        <div style={{
          fontFamily: "'Share Tech Mono', 'JetBrains Mono', monospace",
          fontSize: '24px',
          fontWeight: 700,
          color: isActive ? activeColor : '#ffaa00',
          letterSpacing: '1.5px',
          lineHeight: 1,
          userSelect: 'none',
        }}>
          {ch.timecode || '00:00:00:00'}
        </div>
        <div
          title={ch.activeClip?.name || `${chId}_001`}
          style={{ fontSize: '10px', color: '#94a3b8', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          <strong style={{ color: '#e2e8f0' }}>{ch.activeClip?.name || `${chId}_001`}</strong>
        </div>
      </div>

      {/* Compact Action Buttons */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
      }}>
        {/* Recorder / player transport button */}
        <button
          type="button"
          id={`btn-${chId.toLowerCase()}-${isRecorder ? 'record' : 'play'}`}
          onClick={() => (isRecorder ? startRecord(chId) : startPlayback(chId))}
          style={{
            background: isRecorder
              ? (isActive ? 'linear-gradient(180deg, #dc2626 0%, #991b1b 100%)' : 'linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)')
              : (isActive ? 'linear-gradient(180deg, #16a34a 0%, #166534 100%)' : 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)'),
            border: `1.5px solid ${isRecorder ? '#ef4444' : '#22c55e'}`,
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: '#ffffff',
            cursor: 'pointer',
            boxShadow: isActive
              ? `0 0 15px ${isRecorder ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.6)'}, inset 0 1px 2px rgba(255, 255, 255, 0.4)`
              : '0 4px 10px rgba(0, 0, 0, 0.35)',
            transition: 'all 0.1s ease',
            userSelect: 'none',
          }}
        >
          {isRecorder ? <Circle size={15} fill="#ffffff" /> : <Disc size={15} />}
          <span style={{
            fontSize: '13px',
            fontWeight: 800,
            letterSpacing: '0.6px',
          }}>
            {isRecorder ? 'REC' : 'PLAY'} [{hotkeyNum}]
          </span>
        </button>

        {/* Stop Button */}
        <button
          type="button"
          id={`btn-${chId.toLowerCase()}-stop`}
          onClick={() => stopRecord(chId)}
          style={{
            background: isActive
              ? 'linear-gradient(180deg, #475569 0%, #1e293b 100%)'
              : 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
            border: `1.5px solid ${isActive ? activeColor : 'rgba(255, 255, 255, 0.12)'}`,
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: isActive ? '#ffffff' : '#94a3b8',
            cursor: 'pointer',
            boxShadow: isActive
              ? `0 0 12px ${isRecorder ? 'rgba(248, 113, 113, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`
              : '0 4px 10px rgba(0, 0, 0, 0.35)',
            transition: 'all 0.1s ease',
            userSelect: 'none',
          }}
        >
          <Square size={14} fill={isActive ? '#ffffff' : '#94a3b8'} />
          <span style={{
            fontSize: '13px',
            fontWeight: 800,
            letterSpacing: '0.6px',
          }}>
            STOP
          </span>
        </button>
      </div>

      {isRecorder && <>
      <label
        htmlFor={`${chId.toLowerCase()}-interval-seconds`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          marginTop: '8px',
          color: '#cbd5e1',
          fontSize: '12px',
          fontWeight: 700,
        }}
      >
        <span>Clip interval (seconds)</span>
        <input
          id={`${chId.toLowerCase()}-interval-seconds`}
          type="number"
          min="1"
          max="2147483"
          step="1"
          value={intervalSeconds[chId]}
          disabled={Boolean(ch.intervalRecording)}
          onChange={(event) => {
            const value = event.target.value;
            setIntervalSeconds((previous) => {
              const next = { ...previous, [chId]: value };
              try {
                window.localStorage.setItem(INTERVAL_STORAGE_KEY, JSON.stringify(next));
              } catch (err) {}
              return next;
            });
            const num = Number(value);
            if (Number.isSafeInteger(num) && num >= 1 && num <= 2147483) {
              sendCommand('set_interval_seconds', chId, { intervalSeconds: num });
            }
          }}
          style={{
            width: '84px',
            padding: '6px 8px',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: '6px',
            background: '#04060a',
            color: '#f8fafc',
            fontSize: '13px',
          }}
        />
      </label>

      <button
        type="button"
        id={`btn-${chId.toLowerCase()}-interval-record`}
        onClick={() => toggleIntervalRecording(chId, Boolean(ch.intervalRecording), intervalSeconds[chId])}
        disabled={isActive && !ch.intervalRecording}
        title={isActive && !ch.intervalRecording
          ? 'Stop the current recording before starting interval recording'
          : `Continuously record, splitting the recording into ${intervalSeconds[chId]}-second clips`}
        style={{
          background: ch.intervalPhase === 'recording'
            ? 'linear-gradient(180deg, #7f1d1d 0%, #450a0a 100%)'
            : 'linear-gradient(180deg, #334155 0%, #1e293b 100%)',
          border: `1.5px solid ${ch.intervalPhase === 'recording' ? '#f87171' : 'rgba(255, 255, 255, 0.18)'}`,
          borderRadius: '8px',
          padding: '9px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: isActive && !ch.intervalRecording ? '#64748b' : '#f8fafc',
          cursor: isActive && !ch.intervalRecording ? 'not-allowed' : 'pointer',
          fontSize: '12px',
          fontWeight: 800,
          letterSpacing: '0.5px',
          opacity: isActive && !ch.intervalRecording ? 0.6 : 1,
        }}
      >
        <Disc size={14} />
        <span>
          {ch.intervalRecording
            ? `STOP SPLIT RECORDING · CLIP ${ch.intervalSegment || 1}`
            : `START ${intervalSeconds[chId] || 0}s SPLIT RECORDING`}
        </span>
      </button>
      </>}

      {!isRecorder && (
        <section
          aria-label="Player media and transport controls"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {isDragOver ? `Drop to load on ${shortCode}` : 'Loaded media:'}{' '}
            <strong style={{ color: ch.activeClip?.name ? '#e2e8f0' : '#fbbf24' }}>
              {ch.activeClip?.name || 'No clip loaded'}
            </strong>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadPlayerClip(chId);
            }}
            style={{ display: 'flex', gap: '6px' }}
          >
            <input
              aria-label="T3 clip name"
              type="text"
              maxLength={128}
              value={playerClipNames[chId] || ''}
              onChange={(event) => {
                const val = event.target.value;
                setPlayerClipNames((prev) => ({ ...prev, [chId]: val }));
              }}
              placeholder="Enter T3 clip name"
              style={{
                minWidth: 0,
                flex: 1,
                padding: '7px 8px',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '6px',
                background: '#04060a',
                color: '#f8fafc',
                fontSize: '12px',
              }}
            />
            <button
              type="submit"
              disabled={!(playerClipNames[chId] || '').trim()}
              style={{
                border: '1px solid #22c55e',
                borderRadius: '6px',
                padding: '7px 10px',
                background: '#14532d',
                color: '#fff',
                fontWeight: 700,
                cursor: (playerClipNames[chId] || '').trim() ? 'pointer' : 'not-allowed',
                opacity: (playerClipNames[chId] || '').trim() ? 1 : 0.55,
              }}
            >
              LOAD
            </button>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              cuePlayer(chId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <label htmlFor={`player-cue-timecode-${chId}`} style={{ fontSize: '11px', color: '#cbd5e1' }}>
              Cue
            </label>
            <input
              id={`player-cue-timecode-${chId}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}:[0-9]{2}"
              maxLength={11}
              value={playerCueTimecodes[chId] || '00:00:00:00'}
              onChange={(event) => {
                const val = event.target.value;
                setPlayerCueTimecodes((prev) => ({ ...prev, [chId]: val }));
              }}
              aria-label="Cue timecode in HH:MM:SS:FF format"
              style={{
                width: '120px',
                padding: '7px 8px',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '6px',
                background: '#04060a',
                color: '#f8fafc',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}
            />
            <button
              type="submit"
              style={{
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '6px',
                padding: '7px 10px',
                background: '#1e293b',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              CUE
            </button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
            {[
              { label: '−1 FRAME', action: 'jog', params: { frames: -1 } },
              { label: '−2×', action: 'shuttle', params: { rate: -2 } },
              { label: 'LOOP', action: 'set_loop', params: { enabled: !ch.loop }, active: Boolean(ch.loop) },
              { label: '+2×', action: 'shuttle', params: { rate: 2 } },
              { label: '+1 FRAME', action: 'jog', params: { frames: 1 } },
            ].map((control) => (
              <button
                key={control.label}
                type="button"
                onClick={() => sendCommand(control.action, chId, control.params)}
                aria-pressed={control.action === 'set_loop' ? Boolean(ch.loop) : undefined}
                style={{
                  border: `1px solid ${control.active ? '#22c55e' : 'rgba(255, 255, 255, 0.14)'}`,
                  borderRadius: '6px',
                  padding: '8px 4px',
                  background: control.active ? '#14532d' : '#111827',
                  color: '#e2e8f0',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {control.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
  };

  return (
    <main style={{
      minHeight: '100vh',
      backgroundColor: '#07090e',
      color: '#e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px 12px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: '960px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {/* Compact Top Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#0d1019',
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: '11px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Disc size={15} color="#ef4444" />
            <span style={{ fontWeight: 800, color: '#fff', letterSpacing: '0.5px' }}>
              GRASS VALLEY T3 • {hwConfigLabel}
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: isConnected ? '#4ade80' : '#f87171',
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: '11px',
          }}>
            <span style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: isConnected ? '#22c55e' : '#ef4444',
              boxShadow: `0 0 6px ${isConnected ? '#22c55e' : '#ef4444'}`,
            }} />
            <span>{host}:{port}</span>
          </div>
        </div>

        {commandError && (
          <div role="alert" style={{
            padding: '9px 12px',
            border: '1px solid rgba(248, 113, 113, 0.5)',
            borderRadius: '6px',
            background: 'rgba(127, 29, 29, 0.25)',
            color: '#fca5a5',
            fontSize: '12px',
          }}>
            {commandError}
          </div>
        )}

        {/* Global Master Quick Controls (Compact Row) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '8px',
        }}>
          <button
            type="button"
            id="btn-rec-all"
            onClick={recordAll}
            style={{
              background: 'linear-gradient(180deg, #b91c1c 0%, #7f1d1d 100%)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 800,
              letterSpacing: '0.6px',
              cursor: 'pointer',
              userSelect: 'none',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          >
            <Circle size={12} fill="#ffffff" />
            <span>RECORD ALL ({recorderCodes.join(' + ') || 'NONE'}) [R]</span>
          </button>

          {playerCodes.length > 0 && (
            <button
              type="button"
              id="btn-play-all"
              onClick={playAll}
              style={{
                background: 'linear-gradient(180deg, #16a34a 0%, #166534 100%)',
                border: '1px solid #22c55e',
                borderRadius: '6px',
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 800,
                letterSpacing: '0.6px',
                cursor: 'pointer',
                userSelect: 'none',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
              }}
            >
              <Disc size={12} />
              <span>PLAY ALL ({playerCodes.join(' + ')}) [P]</span>
            </button>
          )}

          <button
            type="button"
            id="btn-stop-all"
            onClick={stopAll}
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '6px',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              color: '#cbd5e1',
              fontSize: '12px',
              fontWeight: 800,
              letterSpacing: '0.6px',
              cursor: 'pointer',
              userSelect: 'none',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          >
            <Square size={12} fill="#cbd5e1" />
            <span>STOP ALL ({allCodes.join(' + ')}) [S]</span>
          </button>
        </div>

        {/* Dynamic three-channel decks */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          width: '100%',
        }}>
          {renderChannelDeck('Vtr1', ch1.deckLabel || 'RECORDER 1', ch1, ch1Active, '1')}
          {renderChannelDeck('Vtr2', ch2.deckLabel || 'RECORDER 2', ch2, ch2Active, '2')}
          {renderChannelDeck('Vtr3', ch3.deckLabel || 'PLAYER 1', ch3, ch3Active, '3')}
        </div>

        <section
          aria-label="Clip list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            background: '#0d1019',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc' }}>CLIP LIST</div>
              <div style={{ marginTop: '3px', fontSize: '10px', color: '#94a3b8' }}>
                {deckState?.clipListSource === 'simulator'
                  ? 'Drag a clip onto the P1 deck to load it.'
                  : 'T3 clip IDs seen on connected decks · drag a clip onto P1 to load it.'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="search"
                aria-label="Search clip list"
                placeholder="Search clips"
                value={clipSearch}
                onChange={(event) => setClipSearch(event.target.value)}
                style={{
                  width: 'min(180px, 38vw)',
                  padding: '7px 9px',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: '6px',
                  background: '#04060a',
                  color: '#f8fafc',
                  fontSize: '12px',
                }}
              />
              <button
                type="button"
                onClick={syncClipList}
                disabled={Boolean(deckState?.clipListLoading)}
                title="Refresh clip list from the T3 media server"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '7px 9px',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: '6px',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: deckState?.clipListLoading ? 'wait' : 'pointer',
                }}
              >
                <RefreshCw size={12} />
                {deckState?.clipListLoading ? 'SYNCING' : 'SYNC'}
              </button>
            </div>
          </div>

          {deckState?.clipListError && (
            <div role="alert" style={{ color: '#fca5a5', fontSize: '11px' }}>
              {deckState.clipListError}
            </div>
          )}

          {deckState?.clipListUpdatedAt && (
            <div style={{ color: '#64748b', fontSize: '10px' }}>
              Last synced: {new Date(deckState.clipListUpdatedAt).toLocaleTimeString()}
            </div>
          )}

          <div style={{ display: 'grid', gap: '5px', maxHeight: '240px', overflowY: 'auto' }}>
            {(deckState?.clips || [])
              .filter((clip) => clip.name?.toLowerCase().includes(clipSearch.trim().toLowerCase()))
              .map((clip, index) => (
                <button
                  key={clip.id || clip.name}
                  id={`clip-list-item-${index + 1}`}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', clip.name);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDragEnd={() => setDragOverChannel(null)}
                  onClick={() => loadClipToPlayer(clip)}
                  title={`Drag to P1 or click to load ${clip.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '8px 10px',
                    border: `1px solid ${ch3.activeClip?.name === clip.name ? 'rgba(34, 197, 94, 0.55)' : 'rgba(255, 255, 255, 0.07)'}`,
                    borderRadius: '6px',
                    background: ch3.activeClip?.name === clip.name ? 'rgba(20, 83, 45, 0.3)' : '#090c13',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    cursor: 'grab',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 700 }}>
                    {clip.name}
                  </span>
                  <span style={{ flexShrink: 0, color: '#94a3b8', fontSize: '10px' }}>
                    {clip.duration || 'Duration unknown'} · LOAD
                  </span>
                </button>
              ))}
            {!(deckState?.clips || []).some((clip) => clip.name?.toLowerCase().includes(clipSearch.trim().toLowerCase())) && (
              <div style={{ padding: '14px 8px', color: '#94a3b8', fontSize: '11px', textAlign: 'center' }}>
                {deckState?.clipListLoading
                  ? 'Reading the T3 clip directory…'
                  : clipSearch
                    ? 'No clips match your search.'
                    : deckState?.clipListSource === 'simulator'
                      ? 'No clips in the simulator library.'
                      : 'No T3 clip IDs received yet. Sync the directory or enter a clip name above.'}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
