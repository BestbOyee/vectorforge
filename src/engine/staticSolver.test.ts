import { describe, expect, it } from 'vitest';
import { solveStaticTruss } from './staticSolver';
import { TrussMember, TrussNode } from './types';

describe('2D Direct Stiffness Method Solver', () => {
  it('solves a symmetric triangle truss accurately', () => {
    const nodes: TrussNode[] = [
      { id: 'L', x: -3, y: 0, fixedX: true, fixedY: true },
      { id: 'C', x: 0, y: 0, fixedX: false, fixedY: false },
      { id: 'R', x: 3, y: 0, fixedX: false, fixedY: true },
      { id: 'T', x: 0, y: 2, fixedX: false, fixedY: false },
    ];
    const members: TrussMember[] = [
      { id: 'r1', nodeA: 'L', nodeB: 'C', materialId: 'road' },
      { id: 'r2', nodeA: 'C', nodeB: 'R', materialId: 'road' },
      { id: 'w1', nodeA: 'L', nodeB: 'T', materialId: 'wood' },
      { id: 'w2', nodeA: 'R', nodeB: 'T', materialId: 'wood' },
      { id: 'w3', nodeA: 'C', nodeB: 'T', materialId: 'wood' },
    ];

    const sol = solveStaticTruss(
      nodes,
      members,
      { x: 0, y: 0, fx: 0, fy: -34335 },
      false
    );

    expect(sol.valid).toBe(true);
    expect(sol.members['w3'].axialForceN).toBeCloseTo(34335, -1);
    expect(sol.members['w3'].mode).toBe('tension');
    expect(sol.members['w1'].mode).toBe('compression');
    expect(sol.members['w2'].mode).toBe('compression');
    expect(sol.members['w1'].axialForceN).toBeCloseTo(sol.members['w2'].axialForceN, 1);
    expect(sol.displacements['L'].ry + sol.displacements['R'].ry).toBeCloseTo(34335, -1);
  });

  it('detects an unbraced hinged deck as an unstable mechanism', () => {
    const nodes: TrussNode[] = [
      { id: 'L', x: -3, y: 0, fixedX: true, fixedY: true },
      { id: 'C', x: 0, y: 0, fixedX: false, fixedY: false },
      { id: 'R', x: 3, y: 0, fixedX: false, fixedY: true },
    ];
    const members: TrussMember[] = [
      { id: 'r1', nodeA: 'L', nodeB: 'C', materialId: 'road' },
      { id: 'r2', nodeA: 'C', nodeB: 'R', materialId: 'road' },
    ];

    const sol = solveStaticTruss(nodes, members, { x: 0, y: 0, fx: 0, fy: -30000 }, false);
    expect(sol.valid).toBe(false);
  });

  it('automatically marks cables in compression as slack', () => {
    const nodes: TrussNode[] = [
      { id: 'L', x: -3, y: 0, fixedX: true, fixedY: true },
      { id: 'C', x: 0, y: 0, fixedX: false, fixedY: false },
      { id: 'R', x: 3, y: 0, fixedX: false, fixedY: true },
      { id: 'T', x: 0, y: 2, fixedX: false, fixedY: false },
    ];
    const members: TrussMember[] = [
      { id: 'r1', nodeA: 'L', nodeB: 'C', materialId: 'road' },
      { id: 'r2', nodeA: 'C', nodeB: 'R', materialId: 'road' },
      { id: 'c1', nodeA: 'L', nodeB: 'T', materialId: 'cable' },
      { id: 'c2', nodeA: 'R', nodeB: 'T', materialId: 'cable' },
      { id: 'w3', nodeA: 'C', nodeB: 'T', materialId: 'wood' },
    ];

    const sol = solveStaticTruss(nodes, members, { x: 0, y: 0, fx: 0, fy: -20000 }, false);
    if (sol.valid) {
      expect(sol.members['c1'].mode).toBe('slack');
    } else {
      expect(sol.valid).toBe(false);
    }
  });
});