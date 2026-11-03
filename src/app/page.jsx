'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Circle, Square, Disc } from 'lucide-react';

const DEFAULT_HOST = process.env.NEXT_PUBLIC_T3_HOST || '192.168.145.20';
const DEFAULT_PORT = parseInt(process.env.NEXT_PUBLIC_T3_PORT || '3811', 10);

export default function CompactTripleChannelRecordPage() {
  const [deckState, setDeckState] = useState(null);
  const [commandError, setCommandError] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState({
    Vtr1: '10',
    Vtr2: '10',
    Vtr3: '10',
  });

  // Poll or SSE Stream connection
  useEffect(() => {
    let eventSource = null;
    let pollInterval = null;

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/amp/status');
        const data = await res.json();
        if (data && data.channels) {
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
        if (data && data.channels) setDeckState(data);
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
    } else if (action === 'record_all' || action === 'stop_all') {
      const isRec = action === 'record_all';
      setDeckState((prev) => {
        if (!prev?.channels) return prev;
        const newChannels = {};
        for (const [k, v] of Object.entries(prev.channels)) {
          newChannels[k] = {
            ...v,
            transportStatus: isRec ? 'RECORDING' : 'STOPPED',
            tally: { ...v.tally, recording: isRec, onAir: false },
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

  // Keyboard shortcuts (1: Ch1, 2: Ch2, 3: Ch3, R: Rec All, S/Esc: Stop All)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === '1') {
        e.preventDefault();
        const ch1Rec = deckState?.channels?.['Vtr1']?.transportStatus === 'RECORDING' || deckState?.channels?.['Vtr1']?.tally?.recording;
        if (ch1Rec) stopRecord('Vtr1');
        else startRecord('Vtr1');
      } else if (key === '2') {
        e.preventDefault();
        const ch2Rec = deckState?.channels?.['Vtr2']?.transportStatus === 'RECORDING' || deckState?.channels?.['Vtr2']?.tally?.recording;
        if (ch2Rec) stopRecord('Vtr2');
        else startRecord('Vtr2');
      } else if (key === '3') {
        e.preventDefault();
        const ch3Rec = deckState?.channels?.['Vtr3']?.transportStatus === 'RECORDING' || deckState?.channels?.['Vtr3']?.tally?.recording;
        if (ch3Rec) stopRecord('Vtr3');
        else startRecord('Vtr3');
      } else if (key === 'r') {
        e.preventDefault();
        recordAll();
      } else if (key === 's' || e.key === 'Escape') {
        e.preventDefault();
        stopAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deckState, startRecord, stopRecord, recordAll, stopAll]);

  const ch1 = deckState?.channels?.['Vtr1'] || {};
  const ch2 = deckState?.channels?.['Vtr2'] || {};
  const ch3 = deckState?.channels?.['Vtr3'] || {};

  const ch1Recording = ch1.transportStatus === 'RECORDING' || ch1.tally?.recording === true;
  const ch2Recording = ch2.transportStatus === 'RECORDING' || ch2.tally?.recording === true;
  const ch3Recording = ch3.transportStatus === 'RECORDING' || ch3.tally?.recording === true;

  const host = deckState?.host || DEFAULT_HOST;
  const port = deckState?.port || DEFAULT_PORT;
  const isConnected = deckState?.isConnected;

  const renderChannelDeck = (chId, label, ch, isRec, hotkeyNum) => (
    <div key={chId} style={{
      background: '#0d1019',
      borderRadius: '10px',
      border: `1.5px solid ${isRec ? '#ef4444' : 'rgba(255, 255, 255, 0.08)'}`,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxShadow: isRec
        ? '0 0 20px rgba(239, 68, 68, 0.25), inset 0 0 10px rgba(239, 68, 68, 0.06)'
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
            background: isRec ? '#ef4444' : '#334155',
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
          color: isRec ? '#f87171' : '#64748b',
        }}>
          <span style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            backgroundColor: isRec ? '#ef4444' : '#475569',
            boxShadow: isRec ? '0 0 8px #ef4444' : 'none',
          }} />
          <span>{isRec ? '● REC' : 'IDLE'}</span>
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
        border: `1px solid ${isRec ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255, 255, 255, 0.05)'}`,
      }}>
        <div style={{
          fontFamily: "'Share Tech Mono', 'JetBrains Mono', monospace",
          fontSize: '24px',
          fontWeight: 700,
          color: isRec ? '#ef4444' : '#ffaa00',
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
        {/* Record Button */}
        <button
          type="button"
          id={`btn-${chId.toLowerCase()}-record`}
          onClick={() => startRecord(chId)}
          style={{
            background: isRec
              ? 'linear-gradient(180deg, #dc2626 0%, #991b1b 100%)'
              : 'linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)',
            border: `1.5px solid ${isRec ? '#fca5a5' : '#ef4444'}`,
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: '#ffffff',
            cursor: 'pointer',
            boxShadow: isRec
              ? '0 0 15px rgba(239, 68, 68, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.4)'
              : '0 4px 10px rgba(0, 0, 0, 0.35)',
            transition: 'all 0.1s ease',
            userSelect: 'none',
          }}
        >
          <Circle size={15} fill="#ffffff" />
          <span style={{
            fontSize: '13px',
            fontWeight: 800,
            letterSpacing: '0.6px',
          }}>
            REC [{hotkeyNum}]
          </span>
        </button>

        {/* Stop Button */}
        <button
          type="button"
          id={`btn-${chId.toLowerCase()}-stop`}
          onClick={() => stopRecord(chId)}
          style={{
            background: isRec
              ? 'linear-gradient(180deg, #475569 0%, #1e293b 100%)'
              : 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
            border: `1.5px solid ${isRec ? '#f87171' : 'rgba(255, 255, 255, 0.12)'}`,
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: isRec ? '#ffffff' : '#94a3b8',
            cursor: 'pointer',
            boxShadow: isRec
              ? '0 0 12px rgba(248, 113, 113, 0.3)'
              : '0 4px 10px rgba(0, 0, 0, 0.35)',
            transition: 'all 0.1s ease',
            userSelect: 'none',
          }}
        >
          <Square size={14} fill={isRec ? '#ffffff' : '#94a3b8'} />
          <span style={{
            fontSize: '13px',
            fontWeight: 800,
            letterSpacing: '0.6px',
          }}>
            STOP
          </span>
        </button>
      </div>

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
            setIntervalSeconds((previous) => ({ ...previous, [chId]: value }));
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
        disabled={isRec && !ch.intervalRecording}
        title={isRec && !ch.intervalRecording
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
          color: isRec && !ch.intervalRecording ? '#64748b' : '#f8fafc',
          cursor: isRec && !ch.intervalRecording ? 'not-allowed' : 'pointer',
          fontSize: '12px',
          fontWeight: 800,
          letterSpacing: '0.5px',
          opacity: isRec && !ch.intervalRecording ? 0.6 : 1,
        }}
      >
        <Disc size={14} />
        <span>
          {ch.intervalRecording
            ? `STOP SPLIT RECORDING · CLIP ${ch.intervalSegment || 1}`
            : `START ${intervalSeconds[chId] || 0}s SPLIT RECORDING`}
        </span>
      </button>
    </div>
  );

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
              GRASS VALLEY T3 • 3-RECORDER CONSOLE
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
          gridTemplateColumns: '1fr 1fr',
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
            <span>RECORD ALL (R1 + R2 + R3) [R]</span>
          </button>

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
            <span>STOP ALL (R1 + R2 + R3) [S]</span>
          </button>
        </div>

        {/* 3-Channel Deck Grid: R1, R2, R3 (Ultra-Compact) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          width: '100%',
        }}>
          {renderChannelDeck('Vtr1', 'RECORDER 1', ch1, ch1Recording, '1')}
          {renderChannelDeck('Vtr2', 'RECORDER 2', ch2, ch2Recording, '2')}
          {renderChannelDeck('Vtr3', 'RECORDER 3', ch3, ch3Recording, '3')}
        </div>
      </div>
    </main>
  );
}
