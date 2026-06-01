import { buildGraph, resolveEntities, validateGraph, withInferredReferences } from "./core/build.js";
import { updateGraph } from "./core/incremental.js";
import { createArrayProvider } from "./core/provider.js";
import { getNeighbors, getNode, queryGraph, shortestPath } from "./core/query.js";
import { analyzeGraph } from "./core/analyze.js";
import { buildArtifacts, generateHtml, generateReport, generateWiki, serializeGraph } from "./core/artifacts.js";
import { createGraphBuilder } from "./core/graph-builder.js";
import { loadGraphBuilderResult } from "./core/result.js";
import { mergeSemanticFragment } from "./core/semantic.js";
import type {
  GraphBuilderExtraction,
  GraphBuilderInput,
  GraphBuilderOptions,
  GraphBuilderTextItem
} from "./core/types.js";

let extractModulePromise: Promise<typeof import("./core/extract.js")> | null = null;

async function loadExtractModule() {
  extractModulePromise ??= import("./core/extract.js");
  return extractModulePromise;
}

export async function extractText(item: GraphBuilderTextItem): Promise<GraphBuilderExtraction> {
  const module = await loadExtractModule();
  return module.extractText(item);
}

export async function extractMarkdown(item: GraphBuilderTextItem): Promise<GraphBuilderExtraction> {
  const module = await loadExtractModule();
  return module.extractMarkdown(item);
}

const graphBuilderInstance = createGraphBuilder();

type GraphBuilderFunction = ((input: GraphBuilderInput, options?: GraphBuilderOptions) => ReturnType<typeof graphBuilderInstance.build>) & {
  build: (input: GraphBuilderInput, options?: GraphBuilderOptions) => ReturnType<typeof graphBuilderInstance.build>;
  fromTexts: (items: GraphBuilderTextItem[], options?: GraphBuilderOptions) => ReturnType<typeof graphBuilderInstance.fromTexts>;
  fromProvider: (input: GraphBuilderInput, options?: GraphBuilderOptions) => ReturnType<typeof graphBuilderInstance.fromProvider>;
  fromChanges: typeof graphBuilderInstance.fromChanges;
  updateGraph: typeof graphBuilderInstance.updateGraph;
  loadGraph: typeof graphBuilderInstance.loadGraph;
};

export const graphBuilder = Object.assign(
  (input: GraphBuilderInput, options?: GraphBuilderOptions) => graphBuilderInstance.build(input, options),
  {
    build: (input: GraphBuilderInput, options?: GraphBuilderOptions) => graphBuilderInstance.build(input, options),
    fromTexts: (items: GraphBuilderTextItem[], options?: GraphBuilderOptions) => graphBuilderInstance.fromTexts(items, options),
    fromProvider: (input: GraphBuilderInput, options?: GraphBuilderOptions) => graphBuilderInstance.fromProvider(input, options),
    fromChanges: graphBuilderInstance.fromChanges,
    updateGraph: graphBuilderInstance.updateGraph,
    loadGraph: graphBuilderInstance.loadGraph
  }
) as GraphBuilderFunction;

export {
  analyzeGraph,
  buildArtifacts,
  buildGraph,
  createArrayProvider,
  createGraphBuilder,
  generateHtml,
  generateReport,
  generateWiki,
  getNeighbors,
  getNode,
  loadGraphBuilderResult,
  mergeSemanticFragment,
  queryGraph,
  resolveEntities,
  serializeGraph,
  shortestPath,
  updateGraph,
  validateGraph,
  withInferredReferences
};

export {
  createMemoryExtractor,
  createMemoryProvider,
  extractMemoryFact,
  memoryFactToTextItem
} from "./adapters/memory.js";

export type { GraphBuilderMemoryFactRecord } from "./adapters/memory.js";

export type {
  GraphBuilderAnalysis,
  GraphBuilderArtifactKind,
  GraphBuilderArtifacts,
  GraphBuilderCommunity,
  GraphBuilderConfidence,
  GraphBuilderConfig,
  GraphBuilderDiagnostics,
  GraphBuilderEdge,
  GraphBuilderExtractor,
  GraphBuilderExtraction,
  GraphBuilderGraph,
  GraphBuilderGraphStats,
  GraphBuilderGraphUpdate,
  GraphBuilderHyperedge,
  GraphBuilderIndex,
  GraphBuilderInput,
  GraphBuilderModelUsage,
  GraphBuilderNeighbor,
  GraphBuilderNode,
  GraphBuilderOptions,
  GraphBuilderPathResult,
  GraphBuilderProvider,
  GraphBuilderQueryHelpers,
  GraphBuilderQueryResult,
  GraphBuilderResult,
  GraphBuilderSemanticContext,
  GraphBuilderSemanticEnricher,
  GraphBuilderSemanticFragment,
  GraphBuilderSemanticOptions,
  GraphBuilderSourceDescriptor,
  GraphBuilderTextItem,
  SerializedGraphBuilderResult,
  StorageRef
} from "./core/types.js";