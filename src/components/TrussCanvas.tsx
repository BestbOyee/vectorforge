'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MATERIALS } from '@/engine/materials';
import {
  DynamicFrame,
  FailureEvent,
  LevelSpec,
  MaterialId,
  StaticSolution,
  TrussMember,
  TrussNode,
} from '@/engine/types';

export type EditorTool = 'build' | 'select' | 'delete';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface TrussCanvasProps {
  level: LevelSpec;
  nodes: TrussNode[];
  members: TrussMember[];
  tool: EditorTool;
  activeMaterial: MaterialId;
  selectedMemberId: string | null;
  staticSolution: StaticSolution;
  showForceVectors: boolean;
  showXRay: boolean;
  isSimMode: boolean;
  currentFrame: DynamicFrame | null;
  failureEvent?: FailureEvent;
  currentFrameIndex: number;
  onAddNodeAndMember: (
    fromNodeId: string,
    newPos: { x: number; y: number } | null,
    existingTargetNodeId: string | null
  ) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteMember: (memberId: string) => void;
  onSelectMember: (memberId: string | null) => void;
}

function utilToHeatColor(util: number, mode: string, broken?: boolean): string {
  if (broken) return '#f43f5e';
  if (mode === 'slack') return '#475569';
  if (util >= 0.95) return '#f43f5e';
  if (util >= 0.72) return '#f59e0b';
  if (mode === 'tension') return '#fb923c';
  if (mode === 'compression') return '#38bdf8';
  return '#94a3b8';
}

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

export default function TrussCanvas({
  level,
  nodes,
  members,
  tool,
  activeMaterial,
  selectedMemberId,
  staticSolution,
  showForceVectors,
  showXRay,
  isSimMode,
  currentFrame,
  failureEvent,
  currentFrameIndex,
  onAddNodeAndMember,
  onMoveNode,
  onDeleteNode,
  onDeleteMember,
  onSelectMember,
}: TrussCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastSparkFrameRef = useRef<number>(-1);
  const shakeRef = useRef<number>(0);

  const [dragState, setDragState] = useState<{
    kind: 'connect' | 'move';
    fromNodeId: string;
    cursorWorld: { x: number; y: number };
  } | null>(null);

  const [hoverWorld, setHoverWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoverMemberId, setHoverMemberId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSimMode || !failureEvent) {
      lastSparkFrameRef.current = -1;
      return;
    }
    if (
      currentFrameIndex >= failureEvent.frameIndex &&
      currentFrameIndex <= failureEvent.frameIndex + 2 &&
      lastSparkFrameRef.current !== failureEvent.frameIndex
    ) {
      lastSparkFrameRef.current = failureEvent.frameIndex;
      shakeRef.current = 12;
      for (let i = 0; i < 28; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 5.5;
        particlesRef.current.push({
          x: failureEvent.x,
          y: failureEvent.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed + 2,
          life: 1,
          maxLife: 0.6 + Math.random() * 0.5,
          color: i % 2 === 0 ? '#fb7185' : '#fbbf24',
          size: 2 + Math.random() * 3,
        });
      }
    }
  }, [isSimMode, failureEvent, currentFrameIndex]);

  const getTransform = useCallback(
    (width: number, height: number) => {
      const spanX = level.gridMaxX - level.gridMinX;
      const spanY = level.gridMaxY - level.gridMinY;
      const scale = Math.min((width - 60) / spanX, (height - 60) / spanY);
      const centerX = (level.gridMinX + level.gridMaxX) * 0.5;
      const centerY = (level.gridMinY + level.gridMaxY) * 0.5;

      const toScreen = (wx: number, wy: number) => ({
        sx: width * 0.5 + (wx - centerX) * scale,
        sy: height * 0.5 - (wy - centerY) * scale,
      });

      const toWorld = (sx: number, sy: number) => ({
        wx: centerX + (sx - width * 0.5) / scale,
        wy: centerY - (sy - height * 0.5) / scale,
      });

      return { scale, toScreen, toWorld };
    },
    [level]
  );

  useEffect(() => {
    let rafId = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.max(1, Math.floor(rect.width * dpr));
      const targetH = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      const w = rect.width;
      const h = rect.height;

      if (shakeRef.current > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * shakeRef.current,
          (Math.random() - 0.5) * shakeRef.current
        );
        shakeRef.current *= 0.86;
      } else {
        shakeRef.current = 0;
      }

      const { toScreen } = getTransform(w, h);

      const bg = ctx.createRadialGradient(w * 0.5, h * 0.35, 30, w * 0.5, h * 0.5, w * 0.8);
      bg.addColorStop(0, '#0f172a');
      bg.addColorStop(1, '#050811');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 1;
      for (let gx = Math.ceil(level.gridMinX); gx <= Math.floor(level.gridMaxX); gx++) {
        const p = toScreen(gx, 0);
        ctx.strokeStyle = gx === 0 ? 'rgba(56, 189, 248, 0.16)' : 'rgba(148, 163, 184, 0.07)';
        ctx.beginPath();
        ctx.moveTo(p.sx, 0);
        ctx.lineTo(p.sx, h);
        ctx.stroke();
      }
      for (let gy = Math.ceil(level.gridMinY); gy <= Math.floor(level.gridMaxY); gy++) {
        const p = toScreen(0, gy);
        ctx.strokeStyle = gy === 0 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(148, 163, 184, 0.07)';
        ctx.beginPath();
        ctx.moveTo(0, p.sy);
        ctx.lineTo(w, p.sy);
        ctx.stroke();
      }

      const leftCliff = toScreen(level.gapStartX, level.deckY);
      const rightCliff = toScreen(level.gapEndX, level.deckY);
      const bottomY = h + 20;

      const chasmGrad = ctx.createLinearGradient(0, leftCliff.sy + 40, 0, h);
      chasmGrad.addColorStop(0, 'rgba(14, 165, 233, 0)');
      chasmGrad.addColorStop(1, 'rgba(14, 165, 233, 0.12)');
      ctx.fillStyle = chasmGrad;
      ctx.fillRect(leftCliff.sx, leftCliff.sy, rightCliff.sx - leftCliff.sx, h - leftCliff.sy);

      ctx.fillStyle = '#0b1220';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20, leftCliff.sy);
      ctx.lineTo(leftCliff.sx, leftCliff.sy);
      ctx.lineTo(leftCliff.sx - 18, bottomY);
      ctx.lineTo(-20, bottomY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (level.id !== 'cantilever-pier') {
        ctx.beginPath();
        ctx.moveTo(rightCliff.sx, rightCliff.sy);
        ctx.lineTo(w + 20, rightCliff.sy);
        ctx.lineTo(w + 20, bottomY);
        ctx.lineTo(rightCliff.sx + 18, bottomY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      const dispScale = 18;
      const nodePos = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        if (isSimMode && currentFrame && currentFrame.nodes[n.id]) {
          nodePos.set(n.id, currentFrame.nodes[n.id]);
        } else if (!isSimMode && showXRay && staticSolution.valid && staticSolution.displacements[n.id]) {
          const d = staticSolution.displacements[n.id];
          nodePos.set(n.id, {
            x: n.x + d.dx * dispScale,
            y: n.y + d.dy * dispScale,
          });
        } else {
          nodePos.set(n.id, { x: n.x, y: n.y });
        }
      }

      if (!isSimMode && showXRay && staticSolution.valid) {
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        for (const m of members) {
          const a = nodes.find((n) => n.id === m.nodeA);
          const b = nodes.find((n) => n.id === m.nodeB);
          if (!a || !b) continue;
          const pA = toScreen(a.x, a.y);
          const pB = toScreen(b.x, b.y);
          ctx.beginPath();
          ctx.moveTo(pA.sx, pA.sy);
          ctx.lineTo(pB.sx, pB.sy);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const m of members) {
        const pWorldA = nodePos.get(m.nodeA);
        const pWorldB = nodePos.get(m.nodeB);
        if (!pWorldA || !pWorldB) continue;

        const pA = toScreen(pWorldA.x, pWorldA.y);
        const pB = toScreen(pWorldB.x, pWorldB.y);
        const mat = MATERIALS[m.materialId];

        const dynState = isSimMode && currentFrame ? currentFrame.members[m.id] : undefined;
        const statState = !isSimMode ? staticSolution.members[m.id] : undefined;

        const broken = dynState?.broken ?? false;
        const util = isSimMode ? dynState?.utilization ?? 0 : statState?.utilization ?? 0;
        const mode = isSimMode ? dynState?.mode ?? 'neutral' : statState?.mode ?? 'neutral';

        if (broken) {
          const midX = (pA.sx + pB.sx) * 0.5;
          const midY = (pA.sy + pB.sy) * 0.5;
          ctx.save();
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.7)';
          ctx.lineWidth = 4;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(pA.sx, pA.sy);
          ctx.lineTo(midX - 6, midY + 8);
          ctx.moveTo(pB.sx, pB.sy);
          ctx.lineTo(midX + 6, midY + 8);
          ctx.stroke();
          ctx.restore();
          continue;
        }

        const isSelected = selectedMemberId === m.id;
        const isHovered = hoverMemberId === m.id;

        const baseColor =
          showXRay || isSimMode ? utilToHeatColor(util, mode, broken) : mat.color;

        ctx.save();
        ctx.lineCap = 'round';

        if (isSelected) {
          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 16;
        } else if ((showXRay || isSimMode) && util > 0.65) {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = Math.min(20, util * 16);
        }

        const thickness =
          m.materialId === 'road'
            ? 8
            : m.materialId === 'steel'
            ? 7
            : m.materialId === 'cable'
            ? 3
            : 5.5;

        if (m.materialId === 'cable' && mode === 'slack') {
          ctx.setLineDash([4, 4]);
        }

        ctx.strokeStyle = isHovered ? '#f8fafc' : baseColor;
        ctx.lineWidth = isSelected ? thickness + 2.5 : thickness;
        ctx.beginPath();
        ctx.moveTo(pA.sx, pA.sy);
        ctx.lineTo(pB.sx, pB.sy);
        ctx.stroke();

        if (m.materialId === 'road') {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pA.sx, pA.sy - 3.5);
          ctx.lineTo(pB.sx, pB.sy - 3.5);
          ctx.stroke();
        }

        if ((isHovered || isSelected) && (statState || dynState)) {
          const forceKN = ((isSimMode ? dynState?.axialForceN : statState?.axialForceN) ?? 0) / 1000;
          const mx = (pA.sx + pB.sx) * 0.5;
          const my = (pA.sy + pB.sy) * 0.5 - 14;
          const label = `${Math.round(util * 100)}% (${forceKN >= 0 ? '+' : ''}${forceKN.toFixed(1)} kN)`;
          ctx.shadowBlur = 0;
          ctx.font = '600 11px ui-monospace, monospace';
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
          ctx.beginPath();
          ctx.roundRect(mx - tw / 2 - 6, my - 10, tw + 12, 18, 5);
          ctx.fill();
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.fillText(label, mx, my + 3);
        }

        ctx.restore();
      }

      if (showForceVectors && !isSimMode && staticSolution.valid) {
        for (const n of nodes) {
          if (!n.fixedX && !n.fixedY) continue;
          const d = staticSolution.displacements[n.id];
          if (!d) continue;
          const p = toScreen(n.x, n.y);
          const ryKN = d.ry / 1000;
          if (Math.abs(ryKN) > 0.5) {
            const arrowLen = Math.min(55, Math.max(18, Math.abs(ryKN) * 0.65));
            const dir = ryKN > 0 ? -1 : 1;
            ctx.save();
            ctx.strokeStyle = '#34d399';
            ctx.fillStyle = '#34d399';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(p.sx, p.sy + arrowLen * -dir + 14);
            ctx.lineTo(p.sx, p.sy + 14);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p.sx, p.sy + 12);
            ctx.lineTo(p.sx - 5, p.sy + 20);
            ctx.lineTo(p.sx + 5, p.sy + 20);
            ctx.closePath();
            ctx.fill();
            ctx.font = '600 10px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`R=${ryKN.toFixed(1)}kN`, p.sx, p.sy + arrowLen + 26);
            ctx.restore();
          }
        }
      }

      if (dragState && dragState.kind === 'connect') {
        const fromNode = nodes.find((n) => n.id === dragState.fromNodeId);
        if (fromNode) {
          const pA = toScreen(fromNode.x, fromNode.y);
          const snapped = {
            x: Math.round(dragState.cursorWorld.x * 2) / 2,
            y: Math.round(dragState.cursorWorld.y * 2) / 2,
          };
          const pB = toScreen(snapped.x, snapped.y);
          const len = Math.hypot(snapped.x - fromNode.x, snapped.y - fromNode.y);
          const mat = MATERIALS[activeMaterial];

          ctx.save();
          ctx.strokeStyle = mat.color;
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(pA.sx, pA.sy);
          ctx.lineTo(pB.sx, pB.sy);
          ctx.stroke();

          if (len > 0.1) {
            const mx = (pA.sx + pB.sx) * 0.5;
            const my = (pA.sy + pB.sy) * 0.5 - 12;
            const label = `${len.toFixed(1)}m · $${Math.round(len * mat.costPerMeter)}`;
            ctx.setLineDash([]);
            ctx.font = '600 11px ui-monospace, monospace';
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.beginPath();
            ctx.roundRect(mx - tw / 2 - 6, my - 10, tw + 12, 18, 5);
            ctx.fill();
            ctx.fillStyle = '#38bdf8';
            ctx.textAlign = 'center';
            ctx.fillText(label, mx, my + 3);
          }
          ctx.restore();
        }
      }

      const truckX =
        isSimMode && currentFrame
          ? currentFrame.truckX
          : (level.gapStartX + level.gapEndX) * 0.5;
      const truckY = isSimMode && currentFrame ? currentFrame.truckY : level.deckY;
      const truckAngle = isSimMode && currentFrame ? currentFrame.truckAngleRad : 0;
      const truckScreen = toScreen(truckX, truckY);

      ctx.save();
      ctx.translate(truckScreen.sx, truckScreen.sy);
      ctx.rotate(-truckAngle);
      ctx.globalAlpha = isSimMode ? 1 : 0.45;

      ctx.fillStyle = '#0ea5e9';
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-24, -26, 34, 18, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.roundRect(10, -21, 14, 13, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      for (const wx of [-14, 15]) {
        ctx.beginPath();
        ctx.arc(wx, -5, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.font = '700 10px ui-monospace, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(`${(level.truckMassKg / 1000).toFixed(1)}t`, -6, -13);
      ctx.restore();

      for (const n of nodes) {
        const pos = nodePos.get(n.id) ?? { x: n.x, y: n.y };
        const p = toScreen(pos.x, pos.y);
        const isAnchor = n.fixedX || n.fixedY;
        const isHover = hoverNodeId === n.id;

        if (isAnchor) {
          ctx.save();
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.sx, p.sy);
          ctx.lineTo(p.sx - 10, p.sy + 14);
          ctx.lineTo(p.sx + 10, p.sy + 14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, isHover ? 7.5 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = isAnchor ? '#38bdf8' : n.locked ? '#94a3b8' : '#f8fafc';
        ctx.fill();
        ctx.strokeStyle = isHover ? '#22d3ee' : '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      if (!isSimMode && hoverWorld && tool === 'build' && !dragState) {
        const sx = Math.round(hoverWorld.x * 2) / 2;
        const sy = Math.round(hoverWorld.y * 2) / 2;
        const p = toScreen(sx, sy);
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (particlesRef.current.length > 0) {
        const nextParticles: Particle[] = [];
        for (const pt of particlesRef.current) {
          pt.x += pt.vx * 0.016;
          pt.y += pt.vy * 0.016;
          pt.vy -= 9.8 * 0.016;
          pt.life -= 0.016 / pt.maxLife;
          if (pt.life > 0) {
            nextParticles.push(pt);
            const sp = toScreen(pt.x, pt.y);
            ctx.save();
            ctx.globalAlpha = Math.max(0, pt.life);
            ctx.fillStyle = pt.color;
            ctx.shadowColor = pt.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(sp.sx, sp.sy, pt.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
        particlesRef.current = nextParticles;
      }

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [
    level,
    nodes,
    members,
    tool,
    activeMaterial,
    selectedMemberId,
    staticSolution,
    showForceVectors,
    showXRay,
    isSimMode,
    currentFrame,
    dragState,
    hoverWorld,
    hoverMemberId,
    hoverNodeId,
    getTransform,
  ]);

  const getPointerWorld = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { scale, toWorld } = getTransform(rect.width, rect.height);
    const { wx, wy } = toWorld(sx, sy);
    return { wx, wy, scale };
  };

  const findNearestNode = (wx: number, wy: number, scale: number) => {
    const threshold = 16 / scale;
    let best: TrussNode | null = null;
    let bestDist = threshold;
    for (const n of nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  };

  const findNearestMember = (wx: number, wy: number, scale: number) => {
    const threshold = 12 / scale;
    let best: TrussMember | null = null;
    let bestDist = threshold;
    for (const m of members) {
      const a = nodes.find((n) => n.id === m.nodeA);
      const b = nodes.find((n) => n.id === m.nodeB);
      if (!a || !b) continue;
      const d = pointToSegmentDist(wx, wy, a.x, a.y, b.x, b.y);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { wx, wy, scale } = getPointerWorld(e);
    const hitNode = findNearestNode(wx, wy, scale);
    const hitMember = hitNode ? null : findNearestMember(wx, wy, scale);

    if (isSimMode) {
      if (hitMember) onSelectMember(hitMember.id);
      return;
    }

    if (tool === 'delete') {
      if (hitNode && !hitNode.locked) {
        onDeleteNode(hitNode.id);
      } else if (hitMember && !hitMember.locked) {
        onDeleteMember(hitMember.id);
      }
      return;
    }

    if (tool === 'select') {
      if (hitNode && !hitNode.locked) {
        setDragState({
          kind: 'move',
          fromNodeId: hitNode.id,
          cursorWorld: { x: wx, y: wy },
        });
      } else if (hitMember) {
        onSelectMember(hitMember.id);
      } else {
        onSelectMember(null);
      }
      return;
    }

    if (tool === 'build') {
      if (hitNode) {
        setDragState({
          kind: 'connect',
          fromNodeId: hitNode.id,
          cursorWorld: { x: wx, y: wy },
        });
      } else if (hitMember) {
        onSelectMember(hitMember.id);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { wx, wy, scale } = getPointerWorld(e);
    setHoverWorld({ x: wx, y: wy });

    const hitNode = findNearestNode(wx, wy, scale);
    setHoverNodeId(hitNode ? hitNode.id : null);

    if (!hitNode) {
      const hitMember = findNearestMember(wx, wy, scale);
      setHoverMemberId(hitMember ? hitMember.id : null);
    } else {
      setHoverMemberId(null);
    }

    if (!dragState || isSimMode) return;

    if (dragState.kind === 'move') {
      const snappedX = Math.max(
        level.gridMinX,
        Math.min(level.gridMaxX, Math.round(wx * 2) / 2)
      );
      const snappedY = Math.max(
        level.gridMinY,
        Math.min(level.gridMaxY, Math.round(wy * 2) / 2)
      );
      onMoveNode(dragState.fromNodeId, snappedX, snappedY);
    } else {
      setDragState({ ...dragState, cursorWorld: { x: wx, y: wy } });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragState) return;
    if (dragState.kind === 'connect') {
      const { wx, wy, scale } = getPointerWorld(e);
      const targetNode = findNearestNode(wx, wy, scale);
      if (targetNode) {
        if (targetNode.id !== dragState.fromNodeId) {
          onAddNodeAndMember(dragState.fromNodeId, null, targetNode.id);
        }
      } else {
        const snappedX = Math.max(
          level.gridMinX,
          Math.min(level.gridMaxX, Math.round(wx * 2) / 2)
        );
        const snappedY = Math.max(
          level.gridMinY,
          Math.min(level.gridMaxY, Math.round(wy * 2) / 2)
        );
        onAddNodeAndMember(dragState.fromNodeId, { x: snappedX, y: snappedY }, null);
      }
    }
    setDragState(null);
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        setHoverWorld(null);
        setHoverNodeId(null);
        setHoverMemberId(null);
        setDragState(null);
      }}
      className="h-full w-full cursor-crosshair touch-none select-none rounded-xl"
    />
  );
}