'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LEVELS } from '@/engine/levels';
import { MATERIALS } from '@/engine/materials';
import { runDynamicSimulation } from '@/engine/dynamicSolver';
import { solveStaticTruss } from '@/engine/staticSolver';
import {
  DynamicSimulationResult,
  MaterialId,
  TrussMember,
  TrussNode,
} from '@/engine/types';
import TrussCanvas, { EditorTool } from './TrussCanvas';
import MathInspector from './MathInspector';
import TelemetryPanel from './TelemetryPanel';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  HelpCircle,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  Trash2,
  Trophy,
  Undo2,
  Zap,
} from 'lucide-react';

interface DesignSnapshot {
  nodes: TrussNode[];
  members: TrussMember[];
}

export default function TrussLabApp() {
  const [levelIdx, setLevelIdx] = useState(0);
  const level = LEVELS[levelIdx];

  const [nodes, setNodes] = useState<TrussNode[]>(level.initialNodes);
  const [members, setMembers] = useState<TrussMember[]>(level.initialMembers);
  const [history, setHistory] = useState<DesignSnapshot[]>([]);

  const [tool, setTool] = useState<EditorTool>('build');
  const [activeMaterial, setActiveMaterial] = useState<MaterialId>('wood');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [showXRay, setShowXRay] = useState(true);
  const [showForceVectors, setShowForceVectors] = useState(true);
  const [showHint, setShowHint] = useState(false);

  const [simResult, setSimResult] = useState<DynamicSimulationResult | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<0.25 | 0.5 | 1>(1);
  const [frameIndex, setFrameIndex] = useState(0);
  const [copiedShare, setCopiedShare] = useState(false);

  const [bestScores, setBestScores] = useState<
    Record<string, { cost: number; stw: number }>
  >({});

  const idCounterRef = useRef(1);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vectorforge_bests_v1');
      if (saved) setBestScores(JSON.parse(saved));

      if (window.location.hash.startsWith('#design=')) {
        const raw = window.location.hash.slice('#design='.length);
        const parsed = JSON.parse(atob(decodeURIComponent(raw)));
        const targetIdx = LEVELS.findIndex((l) => l.id === parsed.levelId);
        if (targetIdx >= 0 && Array.isArray(parsed.nodes) && Array.isArray(parsed.members)) {
          setLevelIdx(targetIdx);
          setNodes(parsed.nodes);
          setMembers(parsed.members);
        }
      }
    } catch {
      // Ignore malformed storage or URL hash
    }
  }, []);

  const loadLevel = (idx: number) => {
    const next = LEVELS[idx];
    setLevelIdx(idx);
    setNodes(next.initialNodes);
    setMembers(next.initialMembers);
    setHistory([]);
    setSimResult(null);
    setIsPlaying(false);
    setFrameIndex(0);
    setSelectedMemberId(null);
    setShowHint(false);
    setActiveMaterial(next.allowedMaterials[0]);
  };

  const pushHistory = () => {
    setHistory((prev) => [...prev.slice(-25), { nodes, members }]);
  };

  const handleUndo = () => {
    if (history.length === 0 || simResult) return;
    const prev = history[history.length - 1];
    setNodes(prev.nodes);
    setMembers(prev.members);
    setHistory((h) => h.slice(0, -1));
  };

  const handleReset = () => {
    pushHistory();
    setNodes(level.initialNodes);
    setMembers(level.initialMembers);
    setSimResult(null);
    setIsPlaying(false);
    setFrameIndex(0);
    setSelectedMemberId(null);
  };

  const handleAddNodeAndMember = (
    fromNodeId: string,
    newPos: { x: number; y: number } | null,
    existingTargetNodeId: string | null
  ) => {
    pushHistory();
    let targetId = existingTargetNodeId;

    if (!targetId && newPos) {
      const duplicate = nodes.find(
        (n) => Math.hypot(n.x - newPos.x, n.y - newPos.y) < 0.25
      );
      if (duplicate) {
        targetId = duplicate.id;
      } else {
        targetId = `u_n_${Date.now()}_${idCounterRef.current++}`;
        setNodes((prev) => [
          ...prev,
          { id: targetId!, x: newPos.x, y: newPos.y, fixedX: false, fixedY: false },
        ]);
      }
    }

    if (!targetId || targetId === fromNodeId) return;

    const exists = members.some(
      (m) =>
        (m.nodeA === fromNodeId && m.nodeB === targetId) ||
        (m.nodeA === targetId && m.nodeB === fromNodeId)
    );
    if (exists) return;

    const newMemberId = `u_m_${Date.now()}_${idCounterRef.current++}`;
    setMembers((prev) => [
      ...prev,
      { id: newMemberId, nodeA: fromNodeId, nodeB: targetId!, materialId: activeMaterial },
    ]);
    setSelectedMemberId(newMemberId);
  };

  const handleMoveNode = (nodeId: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, x, y } : n)));
  };

  const handleDeleteNode = (nodeId: string) => {
    pushHistory();
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setMembers((prev) => prev.filter((m) => m.nodeA !== nodeId && m.nodeB !== nodeId));
  };

  const handleDeleteMember = (memberId: string) => {
    pushHistory();
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    if (selectedMemberId === memberId) setSelectedMemberId(null);
  };

  const staticSolution = useMemo(() => {
    const midX = (level.gapStartX + level.gapEndX) * 0.5;
    return solveStaticTruss(
      nodes,
      members,
      { x: midX, y: level.deckY, fx: 0, fy: -level.truckMassKg * 9.81 },
      true
    );
  }, [nodes, members, level]);

  const handleRunTest = () => {
    const result = runDynamicSimulation(level, nodes, members);
    setSimResult(result);
    setFrameIndex(0);
    setPlaybackSpeed(1);
    setIsPlaying(true);

    if (result.passed) {
      setBestScores((prev) => {
        const cur = prev[level.id];
        const nextBest = {
          cost: cur ? Math.min(cur.cost, Math.round(result.totalCost)) : Math.round(result.totalCost),
          stw: cur ? Math.max(cur.stw, result.strengthToWeight) : result.strengthToWeight,
        };
        const updated = { ...prev, [level.id]: nextBest };
        try {
          localStorage.setItem('vectorforge_bests_v1', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    }
  };

  const handleExitSim = () => {
    setSimResult(null);
    setIsPlaying(false);
    setFrameIndex(0);
  };

  useEffect(() => {
    if (!simResult || !isPlaying) return;
    let rafId = 0;
    let accum = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      setFrameIndex((prev) => {
        const nearFailure =
          simResult.failureEvent &&
          prev >= simResult.failureEvent.frameIndex - 10 &&
          prev <= simResult.failureEvent.frameIndex + 40;
        const effectiveSpeed = nearFailure && playbackSpeed === 1 ? 0.35 : playbackSpeed;

        accum += dt * 60 * effectiveSpeed;
        if (accum < 1) return prev;

        const step = Math.floor(accum);
        accum -= step;
        const next = prev + step;
        if (next >= simResult.frames.length - 1) {
          setIsPlaying(false);
          return simResult.frames.length - 1;
        }
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [simResult, isPlaying, playbackSpeed]);

  const handleShare = async () => {
    const payload = { levelId: level.id, nodes, members };
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)));
    const url = `${window.location.origin}${window.location.pathname}#design=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch {
      window.location.hash = `design=${encoded}`;
    }
  };

  const isSimMode = simResult !== null;
  const currentFrame = simResult ? simResult.frames[frameIndex] ?? null : null;
  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null;
  const budgetPct = (staticSolution.totalCost / level.budget) * 100;
  const overBudget = staticSolution.totalCost > level.budget;

  return (
    <div className="flex min-h-screen flex-col bg-[#060a13] text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-white">VectorForge</span>
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                STRUCTURAL LAB
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Explore First, Formalize Second · 2D FEA + Dynamic Fracture Engine
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-2 py-1">
          <button
            onClick={() => loadLevel(Math.max(0, levelIdx - 1))}
            disabled={levelIdx === 0}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-2 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
              Level {level.number} / {LEVELS.length}
            </div>
            <div className="text-xs font-semibold text-slate-100">{level.title}</div>
          </div>
          <button
            onClick={() => loadLevel(Math.min(LEVELS.length - 1, levelIdx + 1))}
            disabled={levelIdx === LEVELS.length - 1}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 sm:flex">
            <div>
              <div className="text-[10px] uppercase text-slate-500">Budget</div>
              <div
                className={`font-mono text-xs font-bold ${
                  overBudget ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                ${Math.round(staticSolution.totalCost)} / ${level.budget}
              </div>
              <div className="mt-0.5 h-1 w-24 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all ${
                    overBudget ? 'bg-rose-500' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, budgetPct)}%` }}
                />
              </div>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <div className="text-[10px] uppercase text-slate-500">Mass</div>
              <div className="font-mono text-xs font-semibold text-slate-200">
                {Math.round(staticSolution.totalMassKg)} kg
              </div>
            </div>
          </div>

          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <Share2 className="h-3.5 w-3.5 text-cyan-400" />
            {copiedShare ? 'Link Copied!' : 'Share'}
          </button>

          {!isSimMode ? (
            <button
              onClick={handleRunTest}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Run Stress Test
            </button>
          ) : (
            <button
              onClick={handleExitSim}
              className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/25"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Back to Blueprint
            </button>
          )}
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[240px_1fr_300px]">
        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5 backdrop-blur">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              CAD Tools
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => setTool('build')}
                disabled={isSimMode}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] font-medium transition ${
                  tool === 'build'
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className="h-4 w-4" />
                Build
              </button>
              <button
                onClick={() => setTool('select')}
                disabled={isSimMode}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] font-medium transition ${
                  tool === 'select'
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <MousePointer2 className="h-4 w-4" />
                Move
              </button>
              <button
                onClick={() => setTool('delete')}
                disabled={isSimMode}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] font-medium transition ${
                  tool === 'delete'
                    ? 'border-rose-500/60 bg-rose-500/15 text-rose-300'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Trash2 className="h-4 w-4" />
                Erase
              </button>
            </div>

            <div className="mt-2.5 flex gap-1.5">
              <button
                onClick={handleUndo}
                disabled={history.length === 0 || isSimMode}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-35"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
              <button
                onClick={handleReset}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5 backdrop-blur">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Structural Materials
            </div>
            <div className="space-y-2">
              {level.allowedMaterials.map((matId) => {
                const mat = MATERIALS[matId];
                const active = activeMaterial === matId;
                return (
                  <button
                    key={matId}
                    onClick={() => {
                      setActiveMaterial(matId);
                      setTool('build');
                    }}
                    disabled={isSimMode}
                    className={`w-full rounded-lg border p-2.5 text-left transition ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-500/10'
                        : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: mat.color }}
                        />
                        <span className="text-xs font-semibold text-slate-100">
                          {mat.name}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-cyan-300">
                        ${mat.costPerMeter}/m
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-slate-400">
                      {mat.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5 backdrop-blur">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Eye className="h-3.5 w-3.5 text-cyan-400" />
              Visual Overlays
            </div>
            <label className="flex cursor-pointer items-center justify-between py-1 text-xs text-slate-300">
              <span>Live Stress X-Ray</span>
              <input
                type="checkbox"
                checked={showXRay}
                onChange={(e) => setShowXRay(e.target.checked)}
                className="accent-cyan-500"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between py-1 text-xs text-slate-300">
              <span>Reaction Vectors</span>
              <input
                type="checkbox"
                checked={showForceVectors}
                onChange={(e) => setShowForceVectors(e.target.checked)}
                className="accent-cyan-500"
              />
            </label>
          </div>
        </aside>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-900/70 px-4 py-2.5">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                <span>{level.challenge}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                <span className="font-semibold text-cyan-300">Concept:</span> {level.concept}
              </p>
            </div>
            <button
              onClick={() => setShowHint((h) => !h)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white"
            >
              <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
              {showHint ? 'Hide Hint' : 'Hint'}
            </button>
          </div>

          {showHint && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
              <strong>Engineering Hint:</strong> {level.hint}
            </div>
          )}

          <div className="relative h-[460px] flex-1 overflow-hidden rounded-xl border border-slate-800/90 shadow-2xl">
            <TrussCanvas
              level={level}
              nodes={nodes}
              members={members}
              tool={tool}
              activeMaterial={activeMaterial}
              selectedMemberId={selectedMemberId}
              staticSolution={staticSolution}
              showForceVectors={showForceVectors}
              showXRay={showXRay}
              isSimMode={isSimMode}
              currentFrame={currentFrame}
              failureEvent={simResult?.failureEvent}
              currentFrameIndex={frameIndex}
              onAddNodeAndMember={handleAddNodeAndMember}
              onMoveNode={handleMoveNode}
              onDeleteNode={handleDeleteNode}
              onDeleteMember={handleDeleteMember}
              onSelectMember={setSelectedMemberId}
            />

            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
              {!isSimMode ? (
                staticSolution.valid ? (
                  <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-slate-950/85 px-3 py-1 text-[11px] font-medium text-emerald-300 backdrop-blur">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Static FEA Stable · Peak {Math.round(staticSolution.maxUtilization * 100)}%
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-slate-950/85 px-3 py-1 text-[11px] font-medium text-amber-300 backdrop-blur">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {staticSolution.reason}
                  </div>
                )
              ) : (
                <div
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold backdrop-blur ${
                    simResult.passed
                      ? 'border-emerald-500/40 bg-emerald-950/80 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-950/80 text-rose-300'
                  }`}
                >
                  {simResult.passed ? (
                    <>
                      <Trophy className="h-3.5 w-3.5" />
                      PASSED! Cost ${Math.round(simResult.totalCost)} · S/W{' '}
                      {simResult.strengthToWeight.toFixed(2)}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {simResult.failReason}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/80 px-3 py-1.5 text-[10px] text-slate-300 backdrop-blur">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> Compression
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-orange-400" /> Tension
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Critical / Failure
              </span>
              <span className="hidden text-slate-500 sm:inline">
                Drag from any joint to build · 0.5m snap
              </span>
            </div>
          </div>

          {simResult && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 backdrop-blur">
              <button
                onClick={() => {
                  if (frameIndex >= simResult.frames.length - 1) setFrameIndex(0);
                  setIsPlaying((p) => !p);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              <div className="flex items-center gap-1">
                {([0.25, 0.5, 1] as const).map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`rounded px-2 py-1 font-mono text-[11px] font-semibold ${
                      playbackSpeed === spd
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              <div className="relative flex flex-1 items-center">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, simResult.frames.length - 1)}
                  value={frameIndex}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setFrameIndex(Number(e.target.value));
                  }}
                  className="w-full accent-cyan-400"
                />
                {simResult.failureEvent && (
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setFrameIndex(simResult.failureEvent!.frameIndex);
                    }}
                    title="Jump to failure moment"
                    className="ml-2 shrink-0 rounded bg-rose-500/20 px-2 py-1 font-mono text-[10px] font-bold text-rose-300 hover:bg-rose-500/30"
                  >
                    Failure @{simResult.failureEvent.timeSec.toFixed(2)}s
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-3">
          <TelemetryPanel
            frames={simResult?.frames ?? []}
            currentFrameIndex={frameIndex}
            failureFrameIndex={simResult?.failureEvent?.frameIndex}
            staticPeakUtil={staticSolution.maxUtilization}
          />

          <MathInspector
            selectedMember={selectedMember}
            nodes={nodes}
            staticSolution={staticSolution}
            dynamicMember={
              selectedMember && currentFrame
                ? currentFrame.members[selectedMember.id]
                : undefined
            }
            isSimMode={isSimMode}
          />

          {bestScores[level.id] && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3.5 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-emerald-300">
                <Trophy className="h-4 w-4" />
                Personal Best (Level {level.number})
              </div>
              <div className="flex justify-between font-mono text-[11px] text-emerald-100">
                <span>Lowest Cost: ${bestScores[level.id].cost}</span>
                <span>S/W Score: {bestScores[level.id].stw.toFixed(2)}</span>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}