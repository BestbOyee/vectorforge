'use client';

import React from 'react';
import { DynamicFrame } from '@/engine/types';
import { Gauge } from 'lucide-react';

interface TelemetryPanelProps {
  frames: DynamicFrame[];
  currentFrameIndex: number;
  failureFrameIndex?: number;
  staticPeakUtil: number;
}

export default function TelemetryPanel({
  frames,
  currentFrameIndex,
  failureFrameIndex,
  staticPeakUtil,
}: TelemetryPanelProps) {
  const width = 260;
  const height = 74;
  const pad = 6;

  const hasSim = frames.length > 1;
  const current = hasSim ? frames[Math.min(currentFrameIndex, frames.length - 1)] : null;
  const displayUtil = current ? current.peakUtilization : staticPeakUtil;

  const pointsUtil = hasSim
    ? frames
        .map((f, idx) => {
          const x = pad + (idx / (frames.length - 1)) * (width - pad * 2);
          const clamped = Math.min(1.3, f.peakUtilization);
          const y = height - pad - (clamped / 1.3) * (height - pad * 2);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ')
    : '';

  const cursorX =
    hasSim && frames.length > 1
      ? pad + (currentFrameIndex / (frames.length - 1)) * (width - pad * 2)
      : pad;

  const thresholdY = height - pad - (1.0 / 1.3) * (height - pad * 2);

  const failX =
    hasSim && failureFrameIndex !== undefined
      ? pad + (failureFrameIndex / (frames.length - 1)) * (width - pad * 2)
      : null;

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-4 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
          <Gauge className="h-4 w-4" />
          Live Telemetry
        </div>
        <span
          className={`font-mono text-xs font-bold ${
            displayUtil >= 1
              ? 'text-rose-400'
              : displayUtil >= 0.75
              ? 'text-amber-300'
              : 'text-emerald-400'
          }`}
        >
          Peak {Math.round(displayUtil * 100)}%
        </span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950/90 p-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full">
          <line
            x1={pad}
            y1={thresholdY}
            x2={width - pad}
            y2={thresholdY}
            stroke="#f43f5e"
            strokeDasharray="3 3"
            strokeWidth={1}
            opacity={0.6}
          />
          <text x={width - 52} y={thresholdY - 3} fill="#fb7185" fontSize={8}>
            100% LIMIT
          </text>

          {hasSim ? (
            <>
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth={1.75}
                points={pointsUtil}
              />
              {failX !== null && (
                <circle cx={failX} cy={thresholdY} r={3.5} fill="#f43f5e" />
              )}
              <line
                x1={cursorX}
                y1={pad}
                x2={cursorX}
                y2={height - pad}
                stroke="#e2e8f0"
                strokeWidth={1}
                opacity={0.75}
              />
            </>
          ) : (
            <text
              x={width / 2}
              y={height / 2 + 3}
              textAnchor="middle"
              fill="#64748b"
              fontSize={9}
            >
              Run Stress Test to record load curve
            </text>
          )}
        </svg>
      </div>

      {current && (
        <div className="mt-2 flex justify-between font-mono text-[11px] text-slate-400">
          <span>t = {current.timeSec.toFixed(2)}s</span>
          <span>Deflection: {(current.maxDeflectionM * 1000).toFixed(1)} mm</span>
        </div>
      )}
    </div>
  );
}