export type GraphBuilderConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export type GraphBuilderArtifactKind = "json" | "report" | "wiki" | "html" | "timeline" | "manifest" | "dot" | "graphml" | "cypher";

export type GraphBuilderTimelineEvent = "added" | "updated" | "removed" | "seen";

export interface GraphBuilderModelUsage {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StorageRef {
  provider: string;
  namespace?: string;
  physicalId?: string;
  logicalPath?: string;
  revision?: string;
  permissionKey?: string;
}

export interface GraphBuilderTextItem {
  id: string;
  text: string;
  title?: string;
  path?: string;
  url?: string;
  mimeType?: string;
  sourceType?: string;
  parentId?: string;
  storageRef?: StorageRef;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
  hash?: string;
}

export interface GraphBuilderSourceDescriptor {
  id: string;
  title?: string;
  path?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphBuilderProvider<TDescriptor extends GraphBuilderSourceDescriptor = GraphBuilderSourceDescriptor> {
  name?: string;
  list(options?: unknown):
    | Iterable<TDescriptor>
    | AsyncIterable<TDescriptor>
    | Promise<Iterable<TDescriptor> | AsyncIterable<TDescriptor>>;
  read(item: TDescriptor):
    | GraphBuilderTextItem
    | GraphBuilderTextItem[]
    | Promise<GraphBuilderTextItem | GraphBuilderTextItem[]>;
  get?(id: string): GraphBuilderTextItem | Promise<GraphBuilderTextItem>;
  changes?(cursor?: string):
    | Iterable<TDescriptor>
    | AsyncIterable<TDescriptor>
    | Promise<Iterable<TDescriptor> | AsyncIterable<TDescriptor>>;
  getPermissions?(item: TDescriptor): unknown;
}

export interface GraphBuilderNode {
  id: string;
  label: string;
  type: string;
  sourceItemId?: string;
  sourceLocation?: string;
  sourceUrl?: string;
  storageRef?: StorageRef;
  community?: number;
  normalizedLabel?: string;
  mergedFrom?: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphBuilderEdge {
  source: string;
  target: string;
  relation: string;
  confidence: GraphBuilderConfidence;
  confidenceScore?: number;
  sourceItemId?: string;
  sourceLocation?: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphBuilderGraphStats {
  nodeCount: number;
  edgeCount: number;
  sourceCount: number;
  communityCount: number;
  snapshotCount?: number;
  timelineEventCount?: number;
}

export interface GraphBuilderTimelineEntry {
  id: string;
  timestamp: string;
  event: GraphBuilderTimelineEvent;
  sourceItemId?: string;
  label?: string;
  hash?: string;
  previousHash?: string;
  nodeIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphBuilderSnapshot {
  id: string;
  timestamp: string;
  label?: string;
  nodeCount: number;
  edgeCount: number;
  sourceCount: number;
  communityCount: number;
  sourceHashes: Record<string, string>;
}

export interface GraphBuilderChangeSet {
  timestamp: string;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  changedSourceItemIds: string[];
  summary: {
    addedNodeCount: number;
    removedNodeCount: number;
    changedNodeCount: number;
    addedEdgeCount: number;
    removedEdgeCount: number;
    changedSourceCount: number;
  };
}

export interface GraphBuilderGraph {
  version: string;
  createdAt: string;
  updatedAt?: string;
  nodes: GraphBuilderNode[];
  edges: GraphBuilderEdge[];
  hyperedges?: GraphBuilderHyperedge[];
  timeline?: GraphBuilderTimelineEntry[];
  snapshots?: GraphBuilderSnapshot[];
  changes?: GraphBuilderChangeSet;
  stats: GraphBuilderGraphStats;
}

export interface GraphBuilderHyperedge {
  id: string;
  label: string;
  nodes: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphBuilderExtraction {
  item: GraphBuilderTextItem;
  nodes: GraphBuilderNode[];
  edges: GraphBuilderEdge[];
}

export interface GraphBuilderExtractor {
  name?: string;
  extract(item: GraphBuilderTextItem): GraphBuilderExtraction | Promise<GraphBuilderExtraction>;
}

export interface GraphBuilderCommunity {
  id: number;
  label: string;
  size: number;
  nodeIds: string[];
}

export interface GraphBuilderAnalysis {
  godNodes: Array<{ id: string; label: string; degree: number }>;
  confidenceBreakdown: Record<GraphBuilderConfidence, number>;
  isolatedNodes: GraphBuilderNode[];
  surprisingConnections: Array<{
    source: string;
    target: string;
    relation: string;
    confidence: GraphBuilderConfidence;
    reason: string;
  }>;
  communities: GraphBuilderCommunity[];
  pageRank?: Record<string, number>;
  betweenness?: Record<string, number>;
  bridgeNodes?: Array<{ id: string; label: string; degree: number }>;
}

export interface GraphBuilderArtifacts {
  json?: string;
  report?: string;
  wiki?: Record<string, string>;
  html?: string;
  timeline?: string;
  manifest?: string;
  dot?: string;
  graphml?: string;
  cypher?: string;
}

export interface GraphBuilderSemanticFragment {
  nodes?: GraphBuilderNode[];
  edges?: GraphBuilderEdge[];
  hyperedges?: GraphBuilderHyperedge[];
  warnings?: string[];
  usage?: GraphBuilderModelUsage;
}

export interface GraphBuilderSemanticContext {
  items: GraphBuilderTextItem[];
  extractions: GraphBuilderExtraction[];
  graph: GraphBuilderGraph;
  options: GraphBuilderOptions;
}

export interface GraphBuilderSemanticEnricher {
  name?: string;
  enrich(context: GraphBuilderSemanticContext): Promise<GraphBuilderSemanticFragment> | GraphBuilderSemanticFragment;
}

export interface GraphBuilderSemanticOptions {
  enricher: GraphBuilderSemanticEnricher;
}

export interface GraphBuilderDiagnostics {
  warnings: string[];
  skippedItems: Array<{ id: string; reason: string }>;
  errors: Array<{ id?: string; message: string }>;
  timings: Record<string, number>;
  modelUsage: GraphBuilderModelUsage[];
}

export interface GraphBuilderQueryResult {
  question: string;
  seeds: GraphBuilderNode[];
  nodes: GraphBuilderNode[];
  edges: GraphBuilderEdge[];
}

export interface GraphBuilderPathResult {
  nodes: GraphBuilderNode[];
  edges: GraphBuilderEdge[];
  totalWeight?: number;
}

export interface GraphBuilderNeighbor {
  node: GraphBuilderNode;
  edge: GraphBuilderEdge;
  direction: "outgoing" | "incoming";
}

export interface GraphBuilderIndex {
  nodesById: Map<string, GraphBuilderNode>;
  edgesByNodeId: Map<string, GraphBuilderEdge[]>;
  nodesBySourceItemId: Map<string, GraphBuilderNode[]>;
}

export interface GraphBuilderQueryHelpers {
  getNode(query: string): GraphBuilderNode | undefined;
  query(question: string, options?: { depth?: number; maxSeeds?: number }): GraphBuilderQueryResult;
  path(source: string, target: string): GraphBuilderPathResult | null;
  neighbors(node: string): GraphBuilderNeighbor[];
  community(id: number): GraphBuilderNode[];
  timeline(sourceItemId?: string): GraphBuilderTimelineEntry[];
  changes(): GraphBuilderChangeSet | undefined;
}

export interface GraphBuilderGraphUpdate {
  upsert?: GraphBuilderTextItem[];
  deleteSourceItemIds?: string[];
  cursor?: string;
}

export interface SerializedGraphBuilderResult {
  graph: GraphBuilderGraph;
  analysis: GraphBuilderAnalysis;
  artifacts: GraphBuilderArtifacts;
  diagnostics: GraphBuilderDiagnostics;
}

export interface GraphBuilderResult {
  graph: GraphBuilderGraph;
  index: GraphBuilderIndex;
  query: GraphBuilderQueryHelpers;
  analysis: GraphBuilderAnalysis;
  artifacts: GraphBuilderArtifacts;
  diagnostics: GraphBuilderDiagnostics;
  toJSON(): SerializedGraphBuilderResult;
}

export interface GraphBuilderOptions {
  artifacts?: GraphBuilderArtifactKind[];
  queryDepth?: number;
  maxQuerySeeds?: number;
  permissionFilter?: (item: GraphBuilderTextItem) => boolean | Promise<boolean>;
  providerOptions?: unknown;
  extractor?: GraphBuilderExtractor | ((item: GraphBuilderTextItem) => GraphBuilderExtraction | Promise<GraphBuilderExtraction>);
  semantic?: GraphBuilderSemanticOptions;
  concurrency?: number;
  entityResolution?: boolean;
}

export type GraphBuilderInput =
  | string
  | GraphBuilderTextItem
  | GraphBuilderTextItem[]
  | Iterable<GraphBuilderTextItem>
  | AsyncIterable<GraphBuilderTextItem>
  | GraphBuilderProvider;

export interface GraphBuilderConfig {
  defaultArtifacts?: GraphBuilderArtifactKind[];
  logger?: Pick<Console, "debug" | "info" | "warn">;
}