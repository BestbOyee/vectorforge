export type MaterialId = 'wood' | 'steel' | 'cable' | 'road';

export interface MaterialSpec {
  id: MaterialId;
  name: string;
  shortName: string;
  description: string;
  costPerMeter: number;
  densityKgPerM3: number;
  areaM2: number;
  momentOfInertiaM4: number;
  youngsModulusPa: number;
  yieldStrengthPa: number;
  tensionOnly: boolean;
  color: string;
}

export interface TrussNode {
  id: string;
  x: number;
  y: number;
  fixedX: boolean;
  fixedY: boolean;
  locked?: boolean;
}

export interface TrussMember {
  id: string;
  nodeA: string;
  nodeB: string;
  materialId: MaterialId;
  locked?: boolean;
}

export interface MemberStaticResult {
  memberId: string;
  lengthM: number;
  axialForceN: number;
  stressPa: number;
  eulerCriticalN: number;
  compressionCapacityN: number;
  tensionCapacityN: number;
  utilization: number;
  mode: 'tension' | 'compression' | 'neutral' | 'slack';
  failureMode: 'none' | 'yield' | 'buckling';
  cost: number;
  massKg: number;
}

export interface NodeDisplacement {
  nodeId: string;
  dx: number;
  dy: number;
  rx: number;
  ry: number;
}

export interface StaticSolution {
  valid: boolean;
  reason?: string;
  displacements: Record<string, NodeDisplacement>;
  members: Record<string, MemberStaticResult>;
  totalCost: number;
  totalMassKg: number;
  maxUtilization: number;
  maxDeflectionM: number;
}

export interface DynamicMemberState {
  memberId: string;
  utilization: number;
  axialForceN: number;
  mode: 'tension' | 'compression' | 'neutral' | 'slack';
  broken: boolean;
  failureCause: 'none' | 'yield' | 'buckling';
}

export interface DynamicFrame {
  timeSec: number;
  nodes: Record<string, { x: number; y: number }>;
  members: Record<string, DynamicMemberState>;
  truckX: number;
  truckY: number;
  truckAngleRad: number;
  truckOnDeck: boolean;
  peakUtilization: number;
  maxDeflectionM: number;
}

export interface FailureEvent {
  frameIndex: number;
  timeSec: number;
  memberId: string;
  cause: 'yield' | 'buckling' | 'collapse';
  x: number;
  y: number;
}

export interface DynamicSimulationResult {
  frames: DynamicFrame[];
  passed: boolean;
  failReason?: string;
  failureEvent?: FailureEvent;
  peakUtilization: number;
  maxDeflectionM: number;
  totalCost: number;
  totalMassKg: number;
  strengthToWeight: number;
}

export interface LevelSpec {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  concept: string;
  challenge: string;
  hint: string;
  budget: number;
  truckMassKg: number;
  truckStartX: number;
  truckEndX: number;
  testDurationSec: number;
  gapStartX: number;
  gapEndX: number;
  deckY: number;
  gridMinX: number;
  gridMaxX: number;
  gridMinY: number;
  gridMaxY: number;
  allowedMaterials: MaterialId[];
  initialNodes: TrussNode[];
  initialMembers: TrussMember[];
}