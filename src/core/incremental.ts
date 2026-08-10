import { analyzeGraph, applyCommunityAssignments } from "./analyze.js";
import { buildGraph, validateGraph, withInferredReferences } from "./build.js";
import { normalizeTextItem } from "./provider.js";
import { createGraphBuilderResult } from "./result.js";
import { mergeSemanticFragment } from "./semantic.js";
import { attachGraphHistory, createUpdateTimeline, diffGraphs } from "./timeline.js";
import type {
  GraphBuilderExtraction,
  GraphBuilderGraph,
  GraphBuilderGraphUpdate,
  GraphBuilderOptions,
  GraphBuilderResult,
  GraphBuilderTextItem,
  SerializedGraphBuilderResult
} from "./types.js";

let defaultExtractorPromise: Promise<typeof import("./extract.js")> | null = null;

async function loadDefaultExtractText() {
  defaultExtractorPromise ??= import("./extract.js");
  const module = await defaultExtractorPromise;
  return module.extractText;
}

function isSerializedResult(
  value: GraphBuilderGraph | GraphBuilderResult | SerializedGraphBuilderResult
): value is SerializedGraphBuilderResult {
  return "graph" in value && "analysis" in value && "diagnostics" in value;
}

function isGraphBuilderResult(
  value: GraphBuilderGraph | GraphBuilderResult | SerializedGraphBuilderResult
): value is GraphBuilderResult {
  return "graph" in value && "index" in value && "query" in value;
}

function resolveGraph(
  value: GraphBuilderGraph | GraphBuilderResult | SerializedGraphBuilderResult
): GraphBuilderGraph {
  if (isGraphBuilderResult(value) || isSerializedResult(value)) {
    return value.graph;
  }

  return value;
}

async function extractItem(item: GraphBuilderTextItem, options: GraphBuilderOptions): Promise<GraphBuilderExtraction> {
  if (typeof options.extractor === "function") {
    return options.extractor(item);
  }

  if (options.extractor) {
    return options.extractor.extract(item);
  }

  const extractText = await loadDefaultExtractText();
  return extractText(item);
}

function edgeKey(edge: GraphBuilderGraph["edges"][number]) {
  return `${edge.source}:${edge.target}:${edge.relation}:${edge.sourceItemId ?? ""}`;
}

function nodeSourceIsAffected(sourceItemId: string | undefined, affectedSourceItemIds: Set<string>) {
  return Boolean(sourceItemId && affectedSourceItemIds.has(sourceItemId));
}

export async function updateGraph(
  previous: GraphBuilderGraph | GraphBuilderResult | SerializedGraphBuilderResult,
  update: GraphBuilderGraphUpdate,
  options: GraphBuilderOptions = {}
): Promise<GraphBuilderResult> {
  const previousGraph = resolveGraph(previous);
  const timestamp = new Date().toISOString();
  const upsertItems = (update.upsert ?? []).map(normalizeTextItem);
  const deleteSourceItemIds = update.deleteSourceItemIds ?? [];
  const affectedSourceItemIds = new Set([
    ...deleteSourceItemIds,
    ...upsertItems.map((item) => item.id)
  ]);

  const extractStartedAt = Date.now();
  const extractions = await Promise.all(upsertItems.map((item) => extractItem(item, options)));
  const timings = {
    extract: Date.now() - extractStartedAt
  } as Record<string, number>;

  const keptNodes = previousGraph.nodes.filter((node) => !nodeSourceIsAffected(node.sourceItemId, affectedSourceItemIds));
  const keptNodeIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges = previousGraph.edges.filter((edge) => {
    if (nodeSourceIsAffected(edge.sourceItemId, affectedSourceItemIds)) {
      return false;
    }

    return keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target);
  });
  const keptHyperedges = (previousGraph.hyperedges ?? []).filter((hyperedge) =>
    hyperedge.nodes.every((nodeId) => keptNodeIds.has(nodeId))
  );

  const buildStartedAt = Date.now();
  const fragment = buildGraph(extractions);
  timings.build = Date.now() - buildStartedAt;

  const nodesById = new Map(keptNodes.map((node) => [node.id, node]));
  for (const node of fragment.nodes) {
    nodesById.set(node.id, node);
  }

  const mergedNodeIds = new Set(nodesById.keys());
  const edges = [...keptEdges];
  const edgeKeys = new Set(edges.map(edgeKey));
  for (const edge of fragment.edges) {
    if (!mergedNodeIds.has(edge.source) || !mergedNodeIds.has(edge.target)) {
      continue;
    }

    const key = edgeKey(edge);
    if (edgeKeys.has(key)) {
      continue;
    }

    edges.push(edge);
    edgeKeys.add(key);
  }

  const hyperedges = [...keptHyperedges];
  const hyperedgeIds = new Set(hyperedges.map((hyperedge) => hyperedge.id));
  for (const hyperedge of fragment.hyperedges ?? []) {
    if (!hyperedge.id || hyperedgeIds.has(hyperedge.id)) {
      continue;
    }

    const validNodes = hyperedge.nodes.filter((nodeId) => mergedNodeIds.has(nodeId));
    if (validNodes.length < 2) {
      continue;
    }

    hyperedges.push({
      ...hyperedge,
      nodes: validNodes
    });
    hyperedgeIds.add(hyperedge.id);
  }

  let graph = withInferredReferences({
    version: previousGraph.version,
    createdAt: previousGraph.createdAt,
    updatedAt: timestamp,
    nodes: [...nodesById.values()],
    edges,
    hyperedges,
    stats: {
      nodeCount: nodesById.size,
      edgeCount: edges.length,
      sourceCount: new Set([...nodesById.values()].map((node) => node.sourceItemId).filter(Boolean)).size,
      communityCount: 0
    }
  });

  const warnings: string[] = [];
  const modelUsage = [];

  if (options.semantic?.enricher && upsertItems.length > 0) {
    const semanticStartedAt = Date.now();
    const fragment = await options.semantic.enricher.enrich({
      items: upsertItems,
      extractions,
      graph,
      options
    });
    graph = mergeSemanticFragment(graph, fragment);
    timings.semantic = Date.now() - semanticStartedAt;
    warnings.push(...(fragment.warnings ?? []));
    if (fragment.usage) {
      modelUsage.push(fragment.usage);
    }
  }

  warnings.push(...validateGraph(graph));
  const analysis = analyzeGraph(graph);
  graph = applyCommunityAssignments(graph, analysis);
  graph = attachGraphHistory(graph, {
    timestamp,
    label: "update",
    previousGraph,
    timelineEntries: createUpdateTimeline(previousGraph, upsertItems, deleteSourceItemIds, timestamp),
    changes: diffGraphs(previousGraph, graph, timestamp)
  });

  return createGraphBuilderResult(graph, {
    warnings,
    skippedItems: [],
    errors: [],
    timings,
    modelUsage
  }, {
    analysis,
    artifactKinds: options.artifacts ?? ["json", "report"]
  });
}
