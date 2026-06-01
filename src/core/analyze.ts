import type {
  GraphBuilderAnalysis,
  GraphBuilderConfidence,
  GraphBuilderEdge,
  GraphBuilderGraph,
  GraphBuilderNode
} from "./types.js";
import { buildAdjacency } from "./query.js";

const BETWEENNESS_NODE_LIMIT = 500;

export function analyzeGraph(graph: GraphBuilderGraph, topN = 10): GraphBuilderAnalysis {
  const adjacency = buildAdjacency(graph);
  const communities = assignCommunities(graph, adjacency);
  graph.stats.communityCount = communities.length;

  const degrees = new Map<string, number>(graph.nodes.map((node) => [node.id, adjacency.get(node.id)?.length ?? 0]));

  const godNodes = [...graph.nodes]
    .filter((node) => !["tag", "resource"].includes(node.type))
    .sort((left, right) => (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0))
    .slice(0, topN)
    .map((node) => ({
      id: node.id,
      label: node.label,
      degree: degrees.get(node.id) ?? 0
    }));

  const confidenceBreakdown: Record<GraphBuilderConfidence, number> = {
    EXTRACTED: 0,
    INFERRED: 0,
    AMBIGUOUS: 0
  };
  for (const edge of graph.edges) {
    confidenceBreakdown[edge.confidence] += 1;
  }

  const isolatedNodes = graph.nodes.filter((node) => (degrees.get(node.id) ?? 0) <= 1 && !["tag", "resource"].includes(node.type));

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const surprisingConnections = [...graph.edges]
    .filter((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      return source?.sourceItemId && target?.sourceItemId && source.sourceItemId !== target.sourceItemId;
    })
    .sort((left, right) => scoreSurprise(right) - scoreSurprise(left))
    .slice(0, 5)
    .map((edge) => ({
      source: nodeMap.get(edge.source)?.label ?? edge.source,
      target: nodeMap.get(edge.target)?.label ?? edge.target,
      relation: edge.relation,
      confidence: edge.confidence,
      reason: edge.confidence === "INFERRED" ? "Cross-source inferred reference" : "Cross-source structural connection"
    }));

  const pageRank = computePageRank(graph);
  const betweenness = graph.nodes.length <= BETWEENNESS_NODE_LIMIT ? computeBetweenness(graph, adjacency) : undefined;
  const bridgeNodeIds = detectBridgeNodes(graph, adjacency);
  const bridgeNodes = bridgeNodeIds
    .map((id) => {
      const node = nodeMap.get(id);
      return node ? { id, label: node.label, degree: degrees.get(id) ?? 0 } : null;
    })
    .filter((entry): entry is { id: string; label: string; degree: number } => entry !== null)
    .sort((left, right) => right.degree - left.degree);

  return {
    godNodes,
    confidenceBreakdown,
    isolatedNodes,
    surprisingConnections,
    communities,
    pageRank,
    betweenness,
    bridgeNodes
  };
}

function computePageRank(graph: GraphBuilderGraph, iterations = 30, damping = 0.85): Record<string, number> {
  const nodeIds = graph.nodes.map((node) => node.id);
  const N = nodeIds.length;
  if (N === 0) {
    return {};
  }

  const pr: Record<string, number> = {};
  const outDegree: Record<string, number> = {};
  const inLinks: Record<string, string[]> = {};

  for (const id of nodeIds) {
    pr[id] = 1 / N;
    outDegree[id] = 0;
    inLinks[id] = [];
  }

  for (const edge of graph.edges) {
    if (pr[edge.source] !== undefined && pr[edge.target] !== undefined) {
      outDegree[edge.source] = (outDegree[edge.source] ?? 0) + 1;
      inLinks[edge.target] = [...(inLinks[edge.target] ?? []), edge.source];
    }
  }

  for (let i = 0; i < iterations; i++) {
    const next: Record<string, number> = {};
    for (const id of nodeIds) {
      let rank = (1 - damping) / N;
      for (const inId of (inLinks[id] ?? [])) {
        const deg = outDegree[inId] ?? 1;
        rank += damping * (pr[inId] ?? 0) / Math.max(deg, 1);
      }
      next[id] = rank;
    }
    for (const id of nodeIds) {
      pr[id] = next[id] ?? (1 / N);
    }
  }

  return pr;
}

function computeBetweenness(graph: GraphBuilderGraph, adjacency: Map<string, GraphBuilderEdge[]>): Record<string, number> {
  const nodeIds = graph.nodes.map((node) => node.id);
  const bc: Record<string, number> = {};
  for (const id of nodeIds) {
    bc[id] = 0;
  }

  for (const s of nodeIds) {
    const stack: string[] = [];
    const pred: Record<string, string[]> = {};
    const sigma: Record<string, number> = {};
    const dist: Record<string, number> = {};

    for (const id of nodeIds) {
      pred[id] = [];
      sigma[id] = 0;
      dist[id] = -1;
    }
    sigma[s] = 1;
    dist[s] = 0;

    const queue: string[] = [s];
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      for (const edge of (adjacency.get(v) ?? [])) {
        const w = edge.source === v ? edge.target : edge.source;
        if (dist[w] < 0) {
          queue.push(w);
          dist[w] = dist[v]! + 1;
        }
        if (dist[w] === dist[v]! + 1) {
          sigma[w] += sigma[v]!;
          pred[w]!.push(v);
        }
      }
    }

    const delta: Record<string, number> = {};
    for (const id of nodeIds) {
      delta[id] = 0;
    }
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of (pred[w] ?? [])) {
        delta[v] += (sigma[v]! / Math.max(sigma[w]!, 1)) * (1 + delta[w]!);
      }
      if (w !== s) {
        bc[w] += delta[w]!;
      }
    }
  }

  const n = nodeIds.length;
  if (n > 2) {
    const factor = 2 / ((n - 1) * (n - 2));
    for (const id of nodeIds) {
      bc[id] *= factor;
    }
  }

  return bc;
}

function detectBridgeNodes(graph: GraphBuilderGraph, adjacency: Map<string, GraphBuilderEdge[]>): string[] {
  const nodeIds = graph.nodes.map((node) => node.id);
  const nodeSet = new Set(nodeIds);
  const visited = new Set<string>();
  const disc: Record<string, number> = {};
  const low: Record<string, number> = {};
  const parent: Record<string, string | null> = {};
  const ap = new Set<string>();
  let timer = 0;

  const dfs = (u: string): void => {
    visited.add(u);
    disc[u] = low[u] = timer++;
    let childCount = 0;

    for (const edge of (adjacency.get(u) ?? [])) {
      const v = edge.source === u ? edge.target : edge.source;
      if (!nodeSet.has(v)) {
        continue;
      }
      if (!visited.has(v)) {
        childCount++;
        parent[v] = u;
        dfs(v);
        low[u] = Math.min(low[u]!, low[v]!);
        if (parent[u] === null && childCount > 1) {
          ap.add(u);
        }
        if (parent[u] !== null && low[v]! >= disc[u]!) {
          ap.add(u);
        }
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u]!, disc[v]!);
      }
    }
  };

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      parent[id] = null;
      dfs(id);
    }
  }

  return [...ap];
}

function assignCommunities(graph: GraphBuilderGraph, adjacency: Map<string, unknown[]>): GraphBuilderAnalysis["communities"] {
  const visited = new Set<string>();
  const groups: string[][] = [];

  for (const node of graph.nodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const component: string[] = [];
    const stack = [node.id];
    visited.add(node.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const edge of adjacency.get(current) ?? []) {
        const typedEdge = edge as { source: string; target: string };
        const neighbor = typedEdge.source === current ? typedEdge.target : typedEdge.source;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    groups.push(component);
  }

  groups.sort((left, right) => right.length - left.length);
  const communities = groups.map((nodeIds, index) => ({
    id: index,
    label: labelCommunity(nodeIds, graph.nodes),
    size: nodeIds.length,
    nodeIds
  }));

  const communityMap = new Map<string, number>();
  for (const community of communities) {
    for (const nodeId of community.nodeIds) {
      communityMap.set(nodeId, community.id);
    }
  }

  graph.nodes = graph.nodes.map((node) => ({
    ...node,
    community: communityMap.get(node.id)
  }));

  return communities;
}

function labelCommunity(nodeIds: string[], nodes: GraphBuilderNode[]): string {
  const members = nodes.filter((node) => nodeIds.includes(node.id) && !["tag", "resource"].includes(node.type));
  return members[0]?.label ?? "Community";
}

function scoreSurprise(edge: { confidence: GraphBuilderConfidence; relation: string }): number {
  const base = edge.confidence === "AMBIGUOUS" ? 3 : edge.confidence === "INFERRED" ? 2 : 1;
  return base + (edge.relation === "references" ? 1 : 0);
}