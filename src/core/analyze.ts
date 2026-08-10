import type {
  GraphBuilderAnalysis,
  GraphBuilderConfidence,
  GraphBuilderGraph,
  GraphBuilderNode
} from "./types.js";
import { buildAdjacency } from "./query.js";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function analyzeGraph(graph: GraphBuilderGraph, topN = 10): GraphBuilderAnalysis {
  const adjacency = buildAdjacency(graph);
  const communities = computeCommunities(graph, adjacency);

  const communityByNodeId = new Map<string, number>();
  for (const community of communities) {
    for (const nodeId of community.nodeIds) {
      communityByNodeId.set(nodeId, community.id);
    }
  }

  const annotatedNodes = graph.nodes.map((node) => ({
    ...node,
    community: communityByNodeId.get(node.id)
  }));

  const degrees = new Map<string, number>(annotatedNodes.map((node) => [node.id, adjacency.get(node.id)?.length ?? 0]));

  const godNodes = [...annotatedNodes]
    .filter((node) => !["tag", "resource"].includes(node.type))
    .sort((left, right) =>
      (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) || compareStrings(left.id, right.id)
    )
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

  const isolatedNodes = annotatedNodes.filter(
    (node) => (degrees.get(node.id) ?? 0) <= 1 && !["tag", "resource"].includes(node.type)
  );

  const nodeMap = new Map(annotatedNodes.map((node) => [node.id, node]));
  const surprisingConnections = [...graph.edges]
    .filter((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      return source?.sourceItemId && target?.sourceItemId && source.sourceItemId !== target.sourceItemId;
    })
    .sort((left, right) =>
      scoreSurprise(right) - scoreSurprise(left) ||
      compareStrings(left.source, right.source) ||
      compareStrings(left.target, right.target) ||
      compareStrings(left.relation, right.relation)
    )
    .slice(0, 5)
    .map((edge) => ({
      source: nodeMap.get(edge.source)?.label ?? edge.source,
      target: nodeMap.get(edge.target)?.label ?? edge.target,
      relation: edge.relation,
      confidence: edge.confidence,
      reason: edge.confidence === "INFERRED" ? "Cross-source inferred reference" : "Cross-source structural connection"
    }));

  return {
    godNodes,
    confidenceBreakdown,
    isolatedNodes,
    surprisingConnections,
    communities
  };
}

export function applyCommunityAssignments(graph: GraphBuilderGraph, analysis: GraphBuilderAnalysis): GraphBuilderGraph {
  const communityByNodeId = new Map<string, number>();
  for (const community of analysis.communities) {
    for (const nodeId of community.nodeIds) {
      communityByNodeId.set(nodeId, community.id);
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      community: communityByNodeId.get(node.id)
    })),
    stats: {
      ...graph.stats,
      communityCount: analysis.communities.length
    }
  };
}

function computeCommunities(
  graph: GraphBuilderGraph,
  adjacency: Map<string, unknown[]>
): GraphBuilderAnalysis["communities"] {
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

  groups.sort((left, right) => right.length - left.length || compareStrings(left[0] ?? "", right[0] ?? ""));

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return groups.map((nodeIds, index) => ({
    id: index,
    label: labelCommunity(nodeIds, nodesById),
    size: nodeIds.length,
    nodeIds
  }));
}

function labelCommunity(nodeIds: string[], nodesById: Map<string, GraphBuilderNode>): string {
  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    if (node && !["tag", "resource"].includes(node.type)) {
      return node.label;
    }
  }
  return "Community";
}

function scoreSurprise(edge: { confidence: GraphBuilderConfidence; relation: string }): number {
  const base = edge.confidence === "AMBIGUOUS" ? 3 : edge.confidence === "INFERRED" ? 2 : 1;
  return base + (edge.relation === "references" ? 1 : 0);
}
