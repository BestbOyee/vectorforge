'use client';

import React, { useMemo } from 'react';
import katex from 'katex';
import { MATERIALS } from '@/engine/materials';
import {
  DynamicMemberState,
  MemberStaticResult,
  StaticSolution,
  TrussMember,
  TrussNode,
} from '@/engine/types';
import { Sigma, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

function KaTeXBlock({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return tex;
    }
  }, [tex]);

  return (
    <div
      className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-100"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface MathInspectorProps {
  selectedMember: TrussMember | null;
  nodes: TrussNode[];
  staticSolution: StaticSolution;
  dynamicMember?: DynamicMemberState;
  isSimMode: boolean;
}

export default function MathInspector({
  selectedMember,
  nodes,
  staticSolution,
  dynamicMember,
  isSimMode,
}: MathInspectorProps) {
  if (!selectedMember) {
    return (
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 backdrop-blur">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
          <Sigma className="h-4 w-4" />
          Under-the-Hood Math
        </div>
        <p className="text-xs leading-relaxed text-slate-400">
          Click any <span className="font-medium text-slate-200">beam or cable</span> in the
          viewport to inspect its live axial stress, Euler buckling capacity, and equilibrium equations.
        </p>
        <div className="mt-3 space-y-2">
          <KaTeXBlock tex="\mathbf{K}\mathbf{u} = \mathbf{F}, \qquad \sigma = \frac{F_{\text{axial}}}{A}" />
          <KaTeXBlock tex="P_{\text{cr}} = \frac{\pi^2 E I}{L^2}" />
        </div>
      </div>
    );
  }

  const nA = nodes.find((n) => n.id === selectedMember.nodeA);
  const nB = nodes.find((n) => n.id === selectedMember.nodeB);
  const mat = MATERIALS[selectedMember.materialId];
  const L = nA && nB ? Math.hypot(nB.x - nA.x, nB.y - nA.y) : 1;

  const staticMember: MemberStaticResult | undefined =
    staticSolution.members[selectedMember.id];

  const forceN = isSimMode
    ? dynamicMember?.axialForceN ?? 0
    : staticMember?.axialForceN ?? 0;

  const util = isSimMode
    ? dynamicMember?.utilization ?? 0
    : staticMember?.utilization ?? 0;

  const mode = isSimMode
    ? dynamicMember?.mode ?? 'neutral'
    : staticMember?.mode ?? 'neutral';

  const forceKN = forceN / 1000;
  const stressMPa = forceN / mat.areaM2 / 1e6;
  const eulerKN =
    ((Math.PI * Math.PI * mat.youngsModulusPa * mat.momentOfInertiaM4) / (L * L)) / 1000;
  const yieldKN = (mat.yieldStrengthPa * mat.areaM2) / 1000;
  const compCapKN = mat.tensionOnly ? 0 : Math.min(eulerKN, yieldKN);
  const fos = util > 0.01 ? 1 / util : Infinity;

  const statusColor =
    dynamicMember?.broken || util >= 1
      ? 'text-rose-400 border-rose-500/40 bg-rose-500/10'
      : util >= 0.75
      ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
      : 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
          <Sigma className="h-4 w-4" />
          Element Inspector
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusColor}`}>
          {dynamicMember?.broken ? 'FRACTURED' : `${Math.round(util * 100)}% Load`}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="text-slate-500">Material</div>
          <div className="font-semibold text-slate-200">{mat.name}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="text-slate-500">Length (L)</div>
          <div className="font-mono font-semibold text-slate-200">{L.toFixed(2)} m</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="text-slate-500">State</div>
          <div
            className={`font-semibold capitalize ${
              mode === 'tension'
                ? 'text-amber-400'
                : mode === 'compression'
                ? 'text-cyan-400'
                : 'text-slate-400'
            }`}
          >
            {mode}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="text-slate-500">Safety Factor</div>
          <div className="font-mono font-semibold text-slate-200">
            {fos === Infinity ? '∞' : `${fos.toFixed(2)}×`}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-slate-400">1. Axial Stress</div>
        <KaTeXBlock
          tex={`\\sigma = \\frac{F}{A} = \\frac{${forceKN.toFixed(1)}\\text{ kN}}{${(
            mat.areaM2 * 1e4
          ).toFixed(1)}\\text{ cm}^2} = ${stressMPa.toFixed(2)}\\text{ MPa}`}
        />

        {!mat.tensionOnly ? (
          <>
            <div className="text-[11px] font-medium text-slate-400">
              2. Euler Buckling vs. Yield Limit
            </div>
            <KaTeXBlock
              tex={`P_{\\text{cr}} = \\frac{\\pi^2 E I}{L^2} = ${eulerKN.toFixed(
                1
              )}\\text{ kN}, \\quad P_{\\text{cap}} = ${compCapKN.toFixed(1)}\\text{ kN}`}
            />
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 p-2.5 text-[11px] text-sky-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span>
              Tension-only cable: carries up to <strong>{yieldKN.toFixed(0)} kN</strong> in
              tension, <strong>0 kN</strong> in compression.
            </span>
          </div>
        )}

        {util >= 1 || dynamicMember?.broken ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <span>
              {mode === 'compression' && eulerKN < yieldKN
                ? `Euler buckling triggered! Shorten length L (${L.toFixed(1)}m) or upgrade to Steel.`
                : 'Material yield limit exceeded! Increase truss depth or use Steel.'}
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>Member is operating safely within elastic limits.</span>
          </div>
        )}
      </div>
    </div>
  );
}