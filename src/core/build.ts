import { sanitizeLabel } from "./security.js";
import type {
  GraphBuilderEdge,
  GraphBuilderExtraction,
  GraphBuilderGraph,
  GraphBuilderNode
} from "./types.js";
import { attachGraphHistory, createInitialTimeline } from "./timeline.js";
import { basename, normalizeLabel, normalizePath, withoutExtension } from "./utils.js";

export function buildGraph(extractions: GraphBuilderExtraction[]): GraphBuilderGraph {
  const timestamp = new Date().toISOString();
  const nodesById = new Map<string, GraphBuilderNode>();
  const rawEdges: GraphBuilderEdge[] = [];

  for (const extraction of extractions) {
    for (const node of extraction.nodes) {
      nodesById.set(node.id, {
        ...node,
        label: sanitizeLabel(node.label),
        normalizedLabel: normalizeLabel(node.label)
      });
    }
    rawEdges.push(...extraction.edges);
  }

  const aliasMap = buildAliasMap([...nodesById.values()]);
  const edgeKeys = new Set<string>();
  const edges: GraphBuilderEdge[] = [];

  for (const edge of rawEdges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      continue;
    }
    const normalizedEdge = normalizeEdge(edge);
    const edgeKey = `${normalizedEdge.source}:${normalizedEdge.target}:${normalizedEdge.relation}:${normalizedEdge.sourceItemId ?? ""}`;
    if (!edgeKeys.has(edgeKey)) {
      edges.push(normalizedEdge);
      edgeKeys.add(edgeKey);
    }

    if (["links_to", "imports"].includes(normalizedEdge.relation)) {
      const targetNode = nodesById.get(normalizedEdge.target);
      const alias = targetNode?.metadata?.href;
      if (typeof alias === "string") {
        const documentTarget = aliasMap.get(normalizeAlias(alias));
        if (documentTarget && documentTarget !== normalizedEdge.source) {
          const inferred: GraphBuilderEdge = {
            source: normalizedEdge.source,
            target: documentTarget,
            relation: "references",
            confidence: "INFERRED",
            confidenceScore: 0.9,
            sourceItemId: normalizedEdge.sourceItemId,
            sourceLocation: normalizedEdge.sourceLocation,
            context: "markdown_link"
          };
          const inferredKey = `${inferred.source}:${inferred.target}:${inferred.relation}:${inferred.sourceItemId ?? ""}`;
          if (!edgeKeys.has(inferredKey)) {
            edges.push(inferred);
            edgeKeys.add(inferredKey);
          }
        }
      }
    }
  }

  const graph: GraphBuilderGraph = {
    version: "0.1.0",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [...nodesById.values()],
    edges,
    stats: {
      nodeCount: nodesById.size,
      edgeCount: edges.length,
      sourceCount: new Set([...nodesById.values()].map((node) => node.sourceItemId).filter(Boolean)).size,
      communityCount: 0
    }
  };

  return attachGraphHistory(graph, {
    timestamp,
    label: "build",
    timelineEntries: createInitialTimeline(extractions, timestamp)
  });
}

const MERGE_ELIGIBLE_TYPES = new Set(["function", "class", "interface", "type", "enum", "method", "symbol"]);

export function resolveEntities(graph: GraphBuilderGraph): GraphBuilderGraph {
  const groups = new Map<string, GraphBuilderNode[]>();
  const utility = new Set(["tag", "resource", "package", "document", "code_file"]);

  for (const node of graph.nodes) {
    if (utility.has(node.type) || !MERGE_ELIGIBLE_TYPES.has(node.type)) {
      continue;
    }
    const key = `${node.normalizedLabel ?? normalizeLabel(node.label)}:${node.type}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  const mergeMap = new Map<string, string>();
  const processedIds = new Set<string>();
  const mergedNodes: GraphBuilderNode[] = [];

  for (const [, members] of groups) {
    const multiSource = new Set(members.map((m) => m.sourceItemId).filter(Boolean)).size > 1;
    if (!multiSource || members.length < 2) {
      for (const m of members) {
        if (!processedIds.has(m.id)) {
          mergedNodes.push(m);
          processedIds.add(m.id);
        }
      }
      continue;
    }

    const canonical = members[0]!;
    const mergedFrom = members.map((m) => m.id);
    mergedNodes.push({ ...canonical, mergedFrom });
    for (const m of members) {
      mergeMap.set(m.id, canonical.id);
      processedIds.add(m.id);
    }
  }

  for (const node of graph.nodes) {
    if (!processedIds.has(node.id)) {
      mergedNodes.push(node);
      processedIds.add(node.id);
    }
  }

  const remapId = (id: string) => mergeMap.get(id) ?? id;
  const edgeKeys = new Set<string>();
  const remappedEdges: GraphBuilderEdge[] = [];

  for (const edge of graph.edges) {
    const source = remapId(edge.source);
    const target = remapId(edge.target);
    if (source === target) {
      continue;
    }
    const key = `${source}:${target}:${edge.relation}:${edge.sourceItemId ?? ""}`;
    if (!edgeKeys.has(key)) {
      remappedEdges.push({ ...edge, source, target });
      edgeKeys.add(key);
    }
  }

  return {
    ...graph,
    nodes: mergedNodes,
    edges: remappedEdges,
    stats: {
      ...graph.stats,
      nodeCount: mergedNodes.length,
      edgeCount: remappedEdges.length
    }
  };
}

export function validateGraph(graph: GraphBuilderGraph): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push("Node missing id.");
    }
    if (!node.label) {
      errors.push(`Node ${node.id} missing label.`);
    }
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge source '${edge.source}' does not match any node.`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge target '${edge.target}' does not match any node.`);
    }
  }

  return errors;
}

export function withInferredReferences(graph: GraphBuilderGraph): GraphBuilderGraph {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const aliasMap = buildAliasMap([...nodesById.values()]);
  const edges = graph.edges.filter((edge) => !(edge.relation === "references" && edge.context === "markdown_link" && edge.confidence === "INFERRED"));
  const edgeKeys = new Set(edges.map((edge) => `${edge.source}:${edge.target}:${edge.relation}:${edge.sourceItemId ?? ""}`));

  for (const edge of edges) {
    if (!["links_to", "imports"].includes(edge.relation)) {
      continue;
    }

    const targetNode = nodesById.get(edge.target);
    const alias = targetNode?.metadata?.href;
    if (typeof alias !== "string") {
      continue;
    }

    const documentTarget = aliasMap.get(normalizeAlias(alias));
    if (!documentTarget || documentTarget === edge.source) {
      continue;
    }

    const inferred: GraphBuilderEdge = {
      source: edge.source,
      target: documentTarget,
      relation: "references",
      confidence: "INFERRED",
      confidenceScore: 0.9,
      sourceItemId: edge.sourceItemId,
      sourceLocation: edge.sourceLocation,
      context: "markdown_link"
    };
    const inferredKey = `${inferred.source}:${inferred.target}:${inferred.relation}:${inferred.sourceItemId ?? ""}`;
    if (!edgeKeys.has(inferredKey)) {
      edges.push(inferred);
      edgeKeys.add(inferredKey);
    }
  }

  return {
    ...graph,
    edges,
    stats: {
      ...graph.stats,
      edgeCount: edges.length
    }
  };
}

function normalizeEdge(edge: GraphBuilderEdge): GraphBuilderEdge {
  return {
    ...edge,
    sourceLocation: edge.sourceLocation,
    metadata: edge.metadata ? { ...edge.metadata } : undefined
  };
}

function buildAliasMap(nodes: GraphBuilderNode[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const node of nodes) {
    if (node.type !== "document") {
      continue;
    }

    map.set(normalizeAlias(node.id), node.id);

    const path = typeof node.metadata?.path === "string" ? normalizePath(node.metadata.path) : undefined;
    if (path) {
      map.set(normalizeAlias(path), node.id);
      map.set(normalizeAlias(withoutExtension(path)), node.id);
      const file = basename(path);
      if (file) {
        map.set(normalizeAlias(file), node.id);
        map.set(normalizeAlias(withoutExtension(file)), node.id);
      }
      const indexLess = path.replace(/\/index\.[^.]+$/i, "");
      if (indexLess !== path) {
        map.set(normalizeAlias(indexLess), node.id);
      }
    }

    if (node.sourceUrl) {
      map.set(normalizeAlias(node.sourceUrl), node.id);
    }
  }

  return map;
}

function normalizeAlias(value: string): string {
  return normalizeLabel(normalizePath(value) ?? value).replace(/\s+/g, "-");
}