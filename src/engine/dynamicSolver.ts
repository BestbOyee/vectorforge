import { MATERIALS } from './materials';
import { computeBudgetCost, computeTotalMass, solveStaticTruss } from './staticSolver';
import {
  DynamicFrame,
  DynamicMemberState,
  DynamicSimulationResult,
  FailureEvent,
  LevelSpec,
  TrussMember,
  TrussNode,
} from './types';

const GRAVITY = 9.81;
const FPS = 60;
const SUBSTEPS = 40;
const MIN_NODE_MASS = 320;

export function runDynamicSimulation(
  level: LevelSpec,
  nodes: TrussNode[],
  members: TrussMember[]
): DynamicSimulationResult {
  const totalCost = computeBudgetCost(nodes, members);
  const totalMassKg = computeTotalMass(nodes, members);

  const staticInit = solveStaticTruss(nodes, members, undefined, true);

  const nNodes = nodes.length;
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));

  const x0 = new Float64Array(nNodes);
  const y0 = new Float64Array(nNodes);
  const x = new Float64Array(nNodes);
  const y = new Float64Array(nNodes);
  const vx = new Float64Array(nNodes);
  const vy = new Float64Array(nNodes);
  const fx = new Float64Array(nNodes);
  const fy = new Float64Array(nNodes);
  const mass = new Float64Array(nNodes);
  const fixedX = new Uint8Array(nNodes);
  const fixedY = new Uint8Array(nNodes);

  for (let i = 0; i < nNodes; i++) {
    const n = nodes[i];
    x0[i] = n.x;
    y0[i] = n.y;
    const disp = staticInit.valid ? staticInit.displacements[n.id] : undefined;
    x[i] = n.x + (disp ? disp.dx : 0);
    y[i] = n.y + (disp ? disp.dy : 0);
    mass[i] = MIN_NODE_MASS;
    fixedX[i] = n.fixedX ? 1 : 0;
    fixedY[i] = n.fixedY ? 1 : 0;
  }

  interface DynMember {
    id: string;
    iA: number;
    iB: number;
    L0: number;
    k: number;
    c: number;
    tensionOnly: boolean;
    tensionCapN: number;
    compressionCapN: number;
    eulerCriticalN: number;
    isRoad: boolean;
    broken: boolean;
    failureCause: 'none' | 'yield' | 'buckling';
    overloadFrames: number;
  }

  const dynMembers: DynMember[] = [];
  for (const m of members) {
    const iA = nodeIndex.get(m.nodeA);
    const iB = nodeIndex.get(m.nodeB);
    if (iA === undefined || iB === undefined || iA === iB) continue;
    const L0 = Math.hypot(x0[iB] - x0[iA], y0[iB] - y0[iA]);
    if (L0 < 1e-6) continue;
    const mat = MATERIALS[m.materialId];
    const mBeam = L0 * mat.areaM2 * mat.densityKgPerM3;
    mass[iA] += 0.5 * mBeam;
    mass[iB] += 0.5 * mBeam;

    const k = (mat.youngsModulusPa * mat.areaM2) / L0;
    const effMass = Math.min(mass[iA], mass[iB]);
    const c = 0.08 * Math.sqrt(k * effMass);

    const tensionCapN = mat.yieldStrengthPa * mat.areaM2;
    const eulerCriticalN =
      (Math.PI * Math.PI * mat.youngsModulusPa * mat.momentOfInertiaM4) / (L0 * L0);
    const compressionCapN = mat.tensionOnly ? 0 : Math.min(eulerCriticalN, tensionCapN);

    dynMembers.push({
      id: m.id,
      iA,
      iB,
      L0,
      k,
      c,
      tensionOnly: mat.tensionOnly,
      tensionCapN,
      compressionCapN,
      eulerCriticalN,
      isRoad: m.materialId === 'road',
      broken: false,
      failureCause: 'none',
      overloadFrames: 0,
    });
  }

  const nodeWeightN = new Float64Array(nNodes);
  for (const dm of dynMembers) {
    const mObj = members.find((mm) => mm.id === dm.id)!;
    const mat = MATERIALS[mObj.materialId];
    const beamWeight = dm.L0 * mat.areaM2 * mat.densityKgPerM3 * GRAVITY;
    nodeWeightN[dm.iA] += 0.5 * beamWeight;
    nodeWeightN[dm.iB] += 0.5 * beamWeight;
  }

  const dtFrame = 1 / FPS;
  const dtSub = dtFrame / SUBSTEPS;
  const totalFrames = Math.round(level.testDurationSec * FPS);
  const truckWeightN = level.truckMassKg * GRAVITY;

  let truckX = level.truckStartX;
  let truckY = level.deckY;
  let truckVy = 0;
  let truckAngle = 0;
  let truckOnDeck = true;

  const frames: DynamicFrame[] = [];
  let failureEvent: FailureEvent | undefined;
  let postFailureFrames = 0;
  let peakUtilization = 0;
  let maxDeflectionM = 0;

  for (let frameIdx = 0; frameIdx <= totalFrames; frameIdx++) {
    const timeSec = frameIdx * dtFrame;
    const progress = Math.min(1, timeSec / level.testDurationSec);
    truckX = level.truckStartX + (level.truckEndX - level.truckStartX) * progress;

    let roadSupport: { dm: DynMember; t: number } | null = null;
    if (truckOnDeck) {
      for (const dm of dynMembers) {
        if (!dm.isRoad || dm.broken) continue;
        const ax = x[dm.iA];
        const bx = x[dm.iB];
        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        if (truckX >= minX - 0.05 && truckX <= maxX + 0.05 && Math.abs(bx - ax) > 1e-4) {
          const t = Math.max(0, Math.min(1, (truckX - ax) / (bx - ax)));
          roadSupport = { dm, t };
          break;
        }
      }
      if (!roadSupport) {
        if (truckX > level.gapStartX + 0.25 && truckX < level.gapEndX - 0.25) {
          truckOnDeck = false;
          if (!failureEvent) {
            failureEvent = {
              frameIndex: frameIdx,
              timeSec,
              memberId: '',
              cause: 'collapse',
              x: truckX,
              y: truckY,
            };
          }
        } else {
          truckY = level.deckY;
          truckAngle = 0;
        }
      }
    }

    if (roadSupport) {
      const { dm, t } = roadSupport;
      const ax = x[dm.iA];
      const ay = y[dm.iA];
      const bx = x[dm.iB];
      const by = y[dm.iB];
      truckY = ay + (by - ay) * t;
      truckAngle = bx >= ax ? Math.atan2(by - ay, bx - ax) : Math.atan2(ay - by, ax - bx);
      if (truckY < level.deckY - 1.35 && !failureEvent) {
        failureEvent = {
          frameIndex: frameIdx,
          timeSec,
          memberId: dm.id,
          cause: 'collapse',
          x: truckX,
          y: truckY,
        };
      }
    } else if (!truckOnDeck) {
      truckVy -= GRAVITY * dtFrame;
      truckY += truckVy * dtFrame;
      truckAngle += 0.04;
    }

    const avgForce = new Float64Array(dynMembers.length);

    for (let sub = 0; sub < SUBSTEPS; sub++) {
      fx.fill(0);
      fy.fill(0);

      for (let i = 0; i < nNodes; i++) {
        fy[i] -= nodeWeightN[i];
      }

      if (roadSupport && truckOnDeck) {
        const { dm, t } = roadSupport;
        fy[dm.iA] -= truckWeightN * (1 - t);
        fy[dm.iB] -= truckWeightN * t;
      }

      for (let mIdx = 0; mIdx < dynMembers.length; mIdx++) {
        const dm = dynMembers[mIdx];
        if (dm.broken) continue;

        const dx = x[dm.iB] - x[dm.iA];
        const dy = y[dm.iB] - y[dm.iA];
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;

        const stretch = L - dm.L0;
        if (dm.tensionOnly && stretch <= 0) {
          continue;
        }

        const ux = dx / L;
        const uy = dy / L;
        const vRel = (vx[dm.iB] - vx[dm.iA]) * ux + (vy[dm.iB] - vy[dm.iA]) * uy;

        const forceElastic = dm.k * stretch;
        const forceTotal = forceElastic + dm.c * vRel;
        avgForce[mIdx] += forceElastic / SUBSTEPS;

        const fAx = forceTotal * ux;
        const fAy = forceTotal * uy;

        fx[dm.iA] += fAx;
        fy[dm.iA] += fAy;
        fx[dm.iB] -= fAx;
        fy[dm.iB] -= fAy;
      }

      for (let i = 0; i < nNodes; i++) {
        if (fixedX[i]) {
          vx[i] = 0;
          x[i] = x0[i];
        } else {
          const ax = fx[i] / mass[i];
          vx[i] = (vx[i] + ax * dtSub) * 0.9994;
          x[i] += vx[i] * dtSub;
        }

        if (fixedY[i]) {
          vy[i] = 0;
          y[i] = y0[i];
        } else {
          const ay = fy[i] / mass[i];
          vy[i] = (vy[i] + ay * dtSub) * 0.9994;
          y[i] += vy[i] * dtSub;
        }
      }
    }

    const memberStates: Record<string, DynamicMemberState> = {};
    let framePeakUtil = 0;

    for (let mIdx = 0; mIdx < dynMembers.length; mIdx++) {
      const dm = dynMembers[mIdx];
      if (dm.broken) {
        memberStates[dm.id] = {
          memberId: dm.id,
          utilization: 1,
          axialForceN: 0,
          mode: 'neutral',
          broken: true,
          failureCause: dm.failureCause,
        };
        continue;
      }

      const f = avgForce[mIdx];
      let util = 0;
      let mode: DynamicMemberState['mode'] = 'neutral';

      if (dm.tensionOnly && f <= 1) {
        mode = 'slack';
      } else if (f > 50) {
        mode = 'tension';
        util = f / dm.tensionCapN;
      } else if (f < -50) {
        mode = 'compression';
        util = Math.abs(f) / Math.max(1e-6, dm.compressionCapN);
      }

      if (util >= 1.0) {
        dm.overloadFrames += 1;
        if (dm.overloadFrames >= 2 || util >= 1.15) {
          dm.broken = true;
          dm.failureCause =
            f < 0 && dm.eulerCriticalN < dm.tensionCapN ? 'buckling' : 'yield';

          if (!failureEvent) {
            failureEvent = {
              frameIndex: frameIdx,
              timeSec,
              memberId: dm.id,
              cause: dm.failureCause,
              x: (x[dm.iA] + x[dm.iB]) * 0.5,
              y: (y[dm.iA] + y[dm.iB]) * 0.5,
            };
          }
        }
      } else {
        dm.overloadFrames = 0;
      }

      if (util > framePeakUtil) framePeakUtil = util;
      if (util > peakUtilization) peakUtilization = util;

      memberStates[dm.id] = {
        memberId: dm.id,
        utilization: util,
        axialForceN: f,
        mode,
        broken: dm.broken,
        failureCause: dm.failureCause,
      };
    }

    const nodeSnapshot: Record<string, { x: number; y: number }> = {};
    let frameMaxDefl = 0;
    for (let i = 0; i < nNodes; i++) {
      nodeSnapshot[nodes[i].id] = { x: x[i], y: y[i] };
      const d = Math.hypot(x[i] - x0[i], y[i] - y0[i]);
      if (d > frameMaxDefl) frameMaxDefl = d;
    }
    if (frameMaxDefl > maxDeflectionM) maxDeflectionM = frameMaxDefl;

    frames.push({
      timeSec,
      nodes: nodeSnapshot,
      members: memberStates,
      truckX,
      truckY,
      truckAngleRad: truckAngle,
      truckOnDeck,
      peakUtilization: framePeakUtil,
      maxDeflectionM: frameMaxDefl,
    });

    if (failureEvent) {
      postFailureFrames += 1;
      if (postFailureFrames > 110) {
        break;
      }
    }
  }

  let failReason: string | undefined;
  if (failureEvent) {
    failReason =
      failureEvent.cause === 'buckling'
        ? `Euler buckling failure at t = ${failureEvent.timeSec.toFixed(2)}s`
        : failureEvent.cause === 'yield'
        ? `Tensile/Yield fracture at t = ${failureEvent.timeSec.toFixed(2)}s`
        : `Deck collapse at t = ${failureEvent.timeSec.toFixed(2)}s`;
  } else if (totalCost > level.budget) {
    failReason = `Over budget: $${Math.round(totalCost)} / $${level.budget}`;
  }

  const passed = !failureEvent && totalCost <= level.budget;
  const strengthToWeight =
    totalMassKg > 0 ? (level.truckMassKg / totalMassKg) * (1 / Math.max(0.2, peakUtilization)) : 0;

  return {
    frames,
    passed,
    failReason,
    failureEvent,
    peakUtilization,
    maxDeflectionM,
    totalCost,
    totalMassKg,
    strengthToWeight,
  };
}