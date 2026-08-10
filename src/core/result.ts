import { analyzeGraph, applyCommunityAssignments } from "./analyze.js";
import { buildArtifacts } from "./artifacts.js";
import {
  createQueryContext,
  getCommunityNodes,
  getNeighbors,
  getNode,
  queryGraph,
  shortestPath,
  type GraphQueryContext
} from "./query.js";
import { sanitizeSerializableValue } from "./security.js";
import type {
  GraphBuilderAnalysis,
  GraphBuilderArtifactKind,
  GraphBuilderArtifacts,
  GraphBuilderDiagnostics,
  GraphBuilderGraph,
  GraphBuilderIndex,
  GraphBuilderNode,
  GraphBuilderResult,
  SerializedGraphBuilderResult
} from "./types.js";

export interface CreateGraphBuilderResultOptions {
  /** Precomputed analysis to reuse. The graph is assumed to carry matching community assignments. */
  analysis?: GraphBuilderAnalysis;
  /** Precomputed artifacts to reuse verbatim. Takes precedence over artifactKinds. */
  artifacts?: GraphBuilderArtifacts;
  /** Artifact kinds to build. Empty or omitted means no artifacts are built. */
  artifactKinds?: GraphBuilderArtifactKind[];
  /** Set to false to skip the sanitize deep-clone when the input is already trusted/sanitized. */
  sanitize?: boolean;
}

export function createGraphBuilderResult(
  graph: GraphBuilderGraph,
  diagnostics: GraphBuilderDiagnostics,
  options: CreateGraphBuilderResultOptions = {}
): GraphBuilderResult {
  const sanitize = options.sanitize !== false;
  let resultGraph = sanitize ? sanitizeSerializableValue(graph) : graph;
  const resultDiagnostics = sanitize ? sanitizeSerializableValue(diagnostics) : diagnostics;

  let analysis: GraphBuilderAnalysis;
  if (options.analysis) {
    analysis = sanitize ? sanitizeSerializableValue(options.analysis) : options.analysis;
  } else {
    analysis = analyzeGraph(resultGraph);
    resultGraph = applyCommunityAssignments(resultGraph, analysis);
  }

  let artifacts: GraphBuilderArtifacts;
  if (options.artifacts) {
    artifacts = sanitize ? sanitizeSerializableValue(options.artifacts) : options.artifacts;
  } else if (options.artifactKinds && options.artifactKinds.length > 0) {
    artifacts = buildArtifacts(resultGraph, analysis, options.artifactKinds);
  } else {
    artifacts = {};
  }

  let queryContext: GraphQueryContext | undefined;
  const context = () => (queryContext ??= createQueryContext(resultGraph));
  let index: GraphBuilderIndex | undefined;

  return {
    graph: resultGraph,
    get index() {
      return (index ??= createIndex(resultGraph, context()));
    },
    analysis,
    artifacts,
    diagnostics: resultDiagnostics,
    query: {
      getNode: (query) => getNode(context(), query),
      query: (question, queryOptions) => queryGraph(context(), question, queryOptions),
      path: (source, target) => shortestPath(context(), source, target),
      neighbors: (node) => getNeighbors(context(), node),
      community: (id) => getCommunityNodes(resultGraph, id),
      timeline: (sourceItemId) => sourceItemId
        ? (resultGraph.timeline ?? []).filter((entry) => entry.sourceItemId === sourceItemId)
        : resultGraph.timeline ?? [],
      changes: () => resultGraph.changes
    },
    toJSON() {
      return {
        graph: resultGraph,
        analysis,
        artifacts,
        diagnostics: resultDiagnostics
      };
    }
  };
}

export interface LoadGraphBuilderResultOptions {
  /**
   * Artifact kinds to (re)build while loading. Defaults to none: a serialized
   * result keeps its persisted artifacts verbatim, a bare graph loads with no artifacts.
   */
  artifacts?: GraphBuilderArtifactKind[];
  /** Set to false to skip the sanitize deep-clone for graphs this library already sanitized. */
  sanitize?: boolean;
}

export function loadGraphBuilderResult(
  input: string | GraphBuilderGraph | SerializedGraphBuilderResult,
  options: LoadGraphBuilderResultOptions = {}
): GraphBuilderResult {
  const parsed = typeof input === "string" ? (JSON.parse(input) as GraphBuilderGraph | SerializedGraphBuilderResult) : input;
  if ("graph" in parsed && "analysis" in parsed && "diagnostics" in parsed) {
    const artifacts = options.artifacts && options.artifacts.length > 0
      ? { ...parsed.artifacts, ...buildArtifacts(parsed.graph, parsed.analysis, options.artifacts) }
      : parsed.artifacts ?? {};
    return createGraphBuilderResult(parsed.graph, parsed.diagnostics, {
      analysis: parsed.analysis,
      artifacts,
      sanitize: options.sanitize
    });
  }

  return createGraphBuilderResult(parsed, {
    warnings: [],
    skippedItems: [],
    errors: [],
    timings: {},
    modelUsage: []
  }, {
    artifactKinds: options.artifacts ?? [],
    sanitize: options.sanitize
  });
}

function createIndex(graph: GraphBuilderGraph, context: GraphQueryContext): GraphBuilderIndex {
  const nodesBySourceItemId = new Map<string, GraphBuilderNode[]>();
  for (const node of graph.nodes) {
    if (!node.sourceItemId) {
      continue;
    }
    const existing = nodesBySourceItemId.get(node.sourceItemId);
    if (existing) {
      existing.push(node);
    } else {
      nodesBySourceItemId.set(node.sourceItemId, [node]);
    }
  }

  return {
    nodesById: context.nodesById,
    edgesByNodeId: context.adjacency,
    nodesBySourceItemId
  };
}
