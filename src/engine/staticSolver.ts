import { MATERIALS } from './materials';
import {
  MemberStaticResult,
  NodeDisplacement,
  StaticSolution,
  TrussMember,
  TrussNode,
} from './types';

const GRAVITY = 9.81;

function solveLinearSystem(
  matrix: Float64Array,
  rhs: Float64Array,
  n: number
): Float64Array | null {
  const A = new Float64Array(matrix);
  const b = new Float64Array(rhs);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(A[col * n + col]);

    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row * n + col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = row;
      }
    }

    if (maxAbs < 1e-3) {
      return null;
    }

    if (pivotRow !== col) {
      for (let k = col; k < n; k++) {
        const tmp = A[col * n + k];
        A[col * n + k] = A[pivotRow * n + k];
        A[pivotRow * n + k] = tmp;
      }
      const tmpB = b[col];
      b[col] = b[pivotRow];
      b[pivotRow] = tmpB;
    }

    const pivot = A[col * n + col];
    for (let row = col + 1; row < n; row++) {
      const factor = A[row * n + col] / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) {
        A[row * n + k] -= factor * A[col * n + k];
      }
      b[row] -= factor * b[col];
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let col = row + 1; col < n; col++) {
      sum -= A[row * n + col] * x[col];
    }
    x[row] = sum / A[row * n + row];
    if (!Number.isFinite(x[row])) return null;
  }

  return x;
}

export interface StaticLoadPoint {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

export function solveStaticTruss(
  nodes: TrussNode[],
  members: TrussMember[],
  pointLoad?: StaticLoadPoint,
  includeSelfWeight = true
): StaticSolution {
  const emptyResult = (reason: string): StaticSolution => ({
    valid: false,
    reason,
    displacements: {},
    members: {},
    totalCost: computeBudgetCost(nodes, members),
    totalMassKg: computeTotalMass(nodes, members),
    maxUtilization: 0,
    maxDeflectionM: 0,
  });

  if (nodes.length === 0 || members.length === 0) {
    return emptyResult('Place nodes and members to analyze forces.');
  }

  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, idx) => nodeIndex.set(n.id, idx));

  const connected = new Uint8Array(nodes.length);
  for (const m of members) {
    const iA = nodeIndex.get(m.nodeA);
    const iB = nodeIndex.get(m.nodeB);
    if (iA !== undefined && iB !== undefined && iA !== iB) {
      connected[iA] = 1;
      connected[iB] = 1;
    }
  }

  const nNodes = nodes.length;
  const dof = nNodes * 2;
  const baseF = new Float64Array(dof);

  if (includeSelfWeight) {
    for (const m of members) {
      const iA = nodeIndex.get(m.nodeA);
      const iB = nodeIndex.get(m.nodeB);
      if (iA === undefined || iB === undefined || iA === iB) continue;
      const nA = nodes[iA];
      const nB = nodes[iB];
      const L = Math.hypot(nB.x - nA.x, nB.y - nA.y);
      if (L < 1e-6) continue;
      const mat = MATERIALS[m.materialId];
      const mass = L * mat.areaM2 * mat.densityKgPerM3;
      const halfWeight = -0.5 * mass * GRAVITY;
      baseF[iA * 2 + 1] += halfWeight;
      baseF[iB * 2 + 1] += halfWeight;
    }
  }

  if (pointLoad) {
    let applied = false;
    const roadMembers = members.filter((m) => m.materialId === 'road');
    for (const m of roadMembers) {
      const iA = nodeIndex.get(m.nodeA);
      const iB = nodeIndex.get(m.nodeB);
      if (iA === undefined || iB === undefined) continue;
      const nA = nodes[iA];
      const nB = nodes[iB];
      const minX = Math.min(nA.x, nB.x);
      const maxX = Math.max(nA.x, nB.x);
      if (
        pointLoad.x >= minX - 1e-6 &&
        pointLoad.x <= maxX + 1e-6 &&
        Math.abs(nB.x - nA.x) > 1e-6
      ) {
        const t = Math.max(0, Math.min(1, (pointLoad.x - nA.x) / (nB.x - nA.x)));
        baseF[iA * 2] += pointLoad.fx * (1 - t);
        baseF[iA * 2 + 1] += pointLoad.fy * (1 - t);
        baseF[iB * 2] += pointLoad.fx * t;
        baseF[iB * 2 + 1] += pointLoad.fy * t;
        applied = true;
        break;
      }
    }

    if (!applied) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < nNodes; i++) {
        if (!connected[i]) continue;
        const d = Math.hypot(nodes[i].x - pointLoad.x, nodes[i].y - pointLoad.y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        baseF[bestIdx * 2] += pointLoad.fx;
        baseF[bestIdx * 2 + 1] += pointLoad.fy;
      }
    }
  }

  const slackCables = new Set<string>();
  let u: Float64Array | null = null;
  let KOrig = new Float64Array(dof * dof);

  for (let pass = 0; pass < 6; pass++) {
    const K = new Float64Array(dof * dof);
    const F = new Float64Array(baseF);

    for (const m of members) {
      const iA = nodeIndex.get(m.nodeA);
      const iB = nodeIndex.get(m.nodeB);
      if (iA === undefined || iB === undefined || iA === iB) continue;

      const nA = nodes[iA];
      const nB = nodes[iB];
      const dx = nB.x - nA.x;
      const dy = nB.y - nA.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;

      const mat = MATERIALS[m.materialId];
      const isSlack = slackCables.has(m.id);
      const effectiveE = isSlack ? mat.youngsModulusPa * 1e-7 : mat.youngsModulusPa;
      const k = (effectiveE * mat.areaM2) / L;

      const c = dx / L;
      const s = dy / L;
      const cc = c * c * k;
      const ss = s * s * k;
      const cs = c * s * k;

      const dofs = [iA * 2, iA * 2 + 1, iB * 2, iB * 2 + 1];
      const local = [
        cc, cs, -cc, -cs,
        cs, ss, -cs, -ss,
        -cc, -cs, cc, cs,
        -cs, -ss, cs, ss,
      ];

      for (let r = 0; r < 4; r++) {
        for (let col = 0; col < 4; col++) {
          K[dofs[r] * dof + dofs[col]] += local[r * 4 + col];
        }
      }
    }

    KOrig = new Float64Array(K);

    for (let i = 0; i < nNodes; i++) {
      const node = nodes[i];
      const fixX = node.fixedX || !connected[i];
      const fixY = node.fixedY || !connected[i];

      const applyFix = (d: number) => {
        for (let j = 0; j < dof; j++) {
          K[d * dof + j] = 0;
          K[j * dof + d] = 0;
        }
        K[d * dof + d] = 1;
        F[d] = 0;
      };

      if (fixX) applyFix(i * 2);
      if (fixY) applyFix(i * 2 + 1);
    }

    const solved = solveLinearSystem(K, F, dof);
    if (!solved) {
      return emptyResult('Unstable mechanism — add triangulation or connect supports.');
    }

    u = solved;

    let changed = false;
    for (const m of members) {
      const mat = MATERIALS[m.materialId];
      if (!mat.tensionOnly || slackCables.has(m.id)) continue;
      const iA = nodeIndex.get(m.nodeA);
      const iB = nodeIndex.get(m.nodeB);
      if (iA === undefined || iB === undefined) continue;
      const nA = nodes[iA];
      const nB = nodes[iB];
      const dx = nB.x - nA.x;
      const dy = nB.y - nA.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const c = dx / L;
      const s = dy / L;
      const elong =
        (u[iB * 2] - u[iA * 2]) * c + (u[iB * 2 + 1] - u[iA * 2 + 1]) * s;
      const force = ((mat.youngsModulusPa * mat.areaM2) / L) * elong;
      if (force < -1.0) {
        slackCables.add(m.id);
        changed = true;
      }
    }

    if (!changed) break;
  }

  if (!u) {
    return emptyResult('Solver failed to converge.');
  }

  let maxDeflectionM = 0;
  for (let i = 0; i < nNodes; i++) {
    if (!connected[i]) continue;
    const mag = Math.hypot(u[i * 2], u[i * 2 + 1]);
    if (mag > maxDeflectionM) maxDeflectionM = mag;
  }
  if (maxDeflectionM > 2.5) {
    return emptyResult('Excessive deflection — structure is missing bracing.');
  }

  const displacements: Record<string, NodeDisplacement> = {};
  for (let i = 0; i < nNodes; i++) {
    const node = nodes[i];
    let rx = 0;
    let ry = 0;
    if (node.fixedX) {
      let sum = 0;
      for (let j = 0; j < dof; j++) sum += KOrig[i * 2 * dof + j] * u[j];
      rx = sum - baseF[i * 2];
    }
    if (node.fixedY) {
      let sum = 0;
      for (let j = 0; j < dof; j++) sum += KOrig[(i * 2 + 1) * dof + j] * u[j];
      ry = sum - baseF[i * 2 + 1];
    }
    displacements[node.id] = {
      nodeId: node.id,
      dx: u[i * 2],
      dy: u[i * 2 + 1],
      rx,
      ry,
    };
  }

  const memberResults: Record<string, MemberStaticResult> = {};
  let maxUtilization = 0;
  let totalCost = 0;
  let totalMassKg = 0;

  for (const m of members) {
    const iA = nodeIndex.get(m.nodeA);
    const iB = nodeIndex.get(m.nodeB);
    if (iA === undefined || iB === undefined) continue;
    const nA = nodes[iA];
    const nB = nodes[iB];
    const dx = nB.x - nA.x;
    const dy = nB.y - nA.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;

    const mat = MATERIALS[m.materialId];
    const c = dx / L;
    const s = dy / L;
    const elong =
      (u[iB * 2] - u[iA * 2]) * c + (u[iB * 2 + 1] - u[iA * 2 + 1]) * s;

    const isSlack = slackCables.has(m.id);
    const axialForceN = isSlack ? 0 : ((mat.youngsModulusPa * mat.areaM2) / L) * elong;
    const stressPa = axialForceN / mat.areaM2;

    const tensionCapacityN = mat.yieldStrengthPa * mat.areaM2;
    const eulerCriticalN =
      (Math.PI * Math.PI * mat.youngsModulusPa * mat.momentOfInertiaM4) / (L * L);
    const compressionCapacityN = mat.tensionOnly
      ? 0
      : Math.min(eulerCriticalN, tensionCapacityN);

    let utilization = 0;
    let mode: MemberStaticResult['mode'] = 'neutral';
    let failureMode: MemberStaticResult['failureMode'] = 'none';

    if (isSlack) {
      mode = 'slack';
      utilization = 0;
    } else if (axialForceN > 50) {
      mode = 'tension';
      utilization = axialForceN / tensionCapacityN;
      if (utilization >= 1) failureMode = 'yield';
    } else if (axialForceN < -50) {
      mode = 'compression';
      utilization = Math.abs(axialForceN) / Math.max(1e-6, compressionCapacityN);
      if (utilization >= 1) {
        failureMode = eulerCriticalN < tensionCapacityN ? 'buckling' : 'yield';
      }
    }

    if (utilization > maxUtilization) maxUtilization = utilization;

    const cost = m.locked ? 0 : L * mat.costPerMeter;
    const massKg = L * mat.areaM2 * mat.densityKgPerM3;
    totalCost += cost;
    totalMassKg += massKg;

    memberResults[m.id] = {
      memberId: m.id,
      lengthM: L,
      axialForceN,
      stressPa,
      eulerCriticalN,
      compressionCapacityN,
      tensionCapacityN,
      utilization,
      mode,
      failureMode,
      cost,
      massKg,
    };
  }

  return {
    valid: true,
    displacements,
    members: memberResults,
    totalCost,
    totalMassKg,
    maxUtilization,
    maxDeflectionM,
  };
}

export function computeBudgetCost(nodes: TrussNode[], members: TrussMember[]): number {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let total = 0;
  for (const m of members) {
    if (m.locked) continue;
    const a = nodeMap.get(m.nodeA);
    const b = nodeMap.get(m.nodeB);
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    total += L * MATERIALS[m.materialId].costPerMeter;
  }
  return total;
}

export function computeTotalMass(nodes: TrussNode[], members: TrussMember[]): number {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let total = 0;
  for (const m of members) {
    const a = nodeMap.get(m.nodeA);
    const b = nodeMap.get(m.nodeB);
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const mat = MATERIALS[m.materialId];
    total += L * mat.areaM2 * mat.densityKgPerM3;
  }
  return total;
}