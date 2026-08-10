import type {
  GraphBuilderEdge,
  GraphBuilderGraph,
  GraphBuilderNeighbor,
  GraphBuilderNode,
  GraphBuilderPathResult,
  GraphBuilderQueryResult
} from "./types.js";
import { normalizeLabel } from "./utils.js";

export interface GraphQueryContext {
  graph: GraphBuilderGraph;
  nodesById: Map<string, GraphBuilderNode>;
  adjacency: Map<string, GraphBuilderEdge[]>;
}

export type GraphQueryInput = GraphBuilderGraph | GraphQueryContext;

// Deliberately not localeCompare: ordering must not depend on the host locale.
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildAdjacency(graph: GraphBuilderGraph): Map<string, GraphBuilderEdge[]> {
  const adjacency = new Map<string, GraphBuilderEdge[]>();
  const append = (nodeId: string, edge: GraphBuilderEdge) => {
    const existing = adjacency.get(nodeId);
    if (existing) {
      existing.push(edge);
    } else {
      adjacency.set(nodeId, [edge]);
    }
  };

  for (const edge of graph.edges) {
    append(edge.source, edge);
    if (edge.target !== edge.source) {
      append(edge.target, edge);
    }
  }
  return adjacency;
}

export function createQueryContext(graph: GraphBuilderGraph): GraphQueryContext {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(graph);

  // Sort adjacency lists so traversal order stays stable even when the
  // node/edge arrays are reordered between rebuilds of the same content.
  for (const [nodeId, edges] of adjacency) {
    edges.sort((left, right) => {
      const leftNeighbor = left.source === nodeId ? left.target : left.source;
      const rightNeighbor = right.source === nodeId ? right.target : right.source;
      return (
        compareStrings(leftNeighbor, rightNeighbor) ||
        compareStrings(left.relation, right.relation) ||
        compareStrings(left.sourceItemId ?? "", right.sourceItemId ?? "")
      );
    });
  }

  return { graph, nodesById, adjacency };
}

function isQueryContext(value: GraphQueryInput): value is GraphQueryContext {
  return "nodesById" in value && "adjacency" in value;
}

function resolveContext(value: GraphQueryInput): GraphQueryContext {
  return isQueryContext(value) ? value : createQueryContext(value);
}

export function getNode(input: GraphQueryInput, query: string): GraphBuilderNode | undefined {
  return scoreNodes(resolveContext(input), query)[0]?.node;
}

export function queryGraph(
  input: GraphQueryInput,
  question: string,
  options: { depth?: number; maxSeeds?: number } = {}
): GraphBuilderQueryResult {
  const context = resolveContext(input);
  const depth = options.depth ?? 2;
  const maxSeeds = options.maxSeeds ?? 3;
  const seeds = scoreNodes(context, question).slice(0, maxSeeds).map((entry) => entry.node);
  if (seeds.length === 0) {
    return { question, seeds: [], nodes: [], edges: [] };
  }

  const visited = new Set<string>(seeds.map((seed) => seed.id));
  const edges: GraphBuilderEdge[] = [];
  let frontier = seeds.map((seed) => seed.id);

  for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of context.adjacency.get(nodeId) ?? []) {
        edges.push(edge);
        const neighbor = edge.source === nodeId ? edge.target : edge.source;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    question,
    seeds,
    nodes: [...visited]
      .map((id) => context.nodesById.get(id))
      .filter((value): value is GraphBuilderNode => Boolean(value)),
    edges: dedupeEdges(edges)
  };
}

export function shortestPath(
  input: GraphQueryInput,
  sourceQuery: string,
  targetQuery: string
): GraphBuilderPathResult | null {
  const context = resolveContext(input);
  const source = getNode(context, sourceQuery);
  const target = getNode(context, targetQuery);

  if (!source || !target) {
    return null;
  }

  const queue: string[] = [source.id];
  const visited = new Set<string>([source.id]);
  const parentNode = new Map<string, string>();
  const parentEdge = new Map<string, GraphBuilderEdge>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target.id) {
      break;
    }
    for (const edge of context.adjacency.get(current) ?? []) {
      const neighbor = edge.source === current ? edge.target : edge.source;
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      parentNode.set(neighbor, current);
      parentEdge.set(neighbor, edge);
      queue.push(neighbor);
    }
  }

  if (!visited.has(target.id)) {
    return null;
  }

  const nodeIds: string[] = [];
  const edges: GraphBuilderEdge[] = [];
  let current = target.id;

  while (current !== source.id) {
    nodeIds.push(current);
    const edge = parentEdge.get(current);
    const previous = parentNode.get(current);
    if (!edge || !previous) {
      break;
    }
    edges.push(edge);
    current = previous;
  }
  nodeIds.push(source.id);

  return {
    nodes: nodeIds
      .reverse()
      .map((id) => context.nodesById.get(id))
      .filter((value): value is GraphBuilderNode => Boolean(value)),
    edges: edges.reverse()
  };
}

export function getNeighbors(input: GraphQueryInput, nodeQuery: string): GraphBuilderNeighbor[] {
  const context = resolveContext(input);
  const node = getNode(context, nodeQuery);
  if (!node) {
    return [];
  }

  return (context.adjacency.get(node.id) ?? []).map((edge) => {
    const outgoing = edge.source === node.id;
    const neighborId = outgoing ? edge.target : edge.source;
    return {
      node: context.nodesById.get(neighborId)!,
      edge,
      direction: outgoing ? "outgoing" : "incoming"
    };
  });
}

export function getCommunityNodes(input: GraphQueryInput, id: number): GraphBuilderNode[] {
  const graph = isQueryContext(input) ? input.graph : input;
  return graph.nodes.filter((node) => node.community === id);
}

function scoreNodes(context: GraphQueryContext, query: string): Array<{ node: GraphBuilderNode; score: number }> {
  const terms = normalizeLabel(query).split(/\s+/).filter(Boolean);
  const scored: Array<{ node: GraphBuilderNode; score: number }> = [];
  for (const node of context.graph.nodes) {
    const label = node.normalizedLabel ?? normalizeLabel(node.label);
    const path = typeof node.metadata?.path === "string" ? normalizeLabel(node.metadata.path) : "";
    const score = terms.reduce((accumulator, term) => {
      let next = accumulator;
      if (label === term) {
        next += 100;
      }
      if (label.includes(term)) {
        next += 10;
      }
      if (path.includes(term)) {
        next += 5;
      }
      return next;
    }, 0);
    if (score > 0) {
      scored.push({ node, score });
    }
  }
  return scored.sort((left, right) => right.score - left.score || compareStrings(left.node.id, right.node.id));
}

function dedupeEdges(edges: GraphBuilderEdge[]): GraphBuilderEdge[] {
  const seen = new Set<string>();
  const result: GraphBuilderEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}:${edge.target}:${edge.relation}:${edge.sourceItemId ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }
  return result;
}
