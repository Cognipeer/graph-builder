import { analyzeGraph } from "./analyze.js";
import { buildArtifacts } from "./artifacts.js";
import { buildGraph, resolveEntities, validateGraph } from "./build.js";
import { collectChangedTextItems, collectTextItems } from "./provider.js";
import { createGraphBuilderResult, loadGraphBuilderResult } from "./result.js";
import { mergeSemanticFragment } from "./semantic.js";
import { updateGraph } from "./incremental.js";
import type {
  GraphBuilderConfig,
  GraphBuilderExtraction,
  GraphBuilderGraph,
  GraphBuilderInput,
  GraphBuilderOptions,
  GraphBuilderProvider,
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

export async function extractGraphBuilderItem(
  item: GraphBuilderTextItem,
  options: GraphBuilderOptions = {}
): Promise<GraphBuilderExtraction> {
  if (typeof options.extractor === "function") {
    return options.extractor(item);
  }

  if (options.extractor) {
    return options.extractor.extract(item);
  }

  const extractText = await loadDefaultExtractText();
  return extractText(item);
}

export function createGraphBuilder(config: GraphBuilderConfig = {}) {
  const defaults: Required<Pick<GraphBuilderConfig, "defaultArtifacts">> = {
    defaultArtifacts: config.defaultArtifacts ?? ["json", "report"]
  };

  async function build(input: GraphBuilderInput, options: GraphBuilderOptions = {}): Promise<GraphBuilderResult> {
    const timings: Record<string, number> = {};
    const startedAt = Date.now();
    const items = await collectTextItems(input, options);
    timings.collect = Date.now() - startedAt;

    const extractStartedAt = Date.now();
    const concurrency = options.concurrency ?? 0;
    const extractions = concurrency > 0
      ? await extractWithConcurrency(items, options, concurrency)
      : await Promise.all(items.map((item) => extractGraphBuilderItem(item, options)));
    timings.extract = Date.now() - extractStartedAt;

    const buildStartedAt = Date.now();
    let graph = buildGraph(extractions);
    timings.build = Date.now() - buildStartedAt;

    if (options.entityResolution) {
      graph = resolveEntities(graph);
    }

    const warnings: string[] = [];
    const modelUsage = [];

    if (options.semantic?.enricher) {
      const semanticStartedAt = Date.now();
      const fragment = await options.semantic.enricher.enrich({
        items,
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
    const artifacts = buildArtifacts(graph, analysis, options.artifacts ?? defaults.defaultArtifacts);

    return createGraphBuilderResult(graph, {
      warnings,
      skippedItems: [],
      errors: [],
      timings,
      modelUsage
    }, artifacts);
  }

  return {
    build,
    fromTexts(items: GraphBuilderTextItem[], options?: GraphBuilderOptions) {
      return build(items, options);
    },
    fromProvider(input: GraphBuilderInput, options?: GraphBuilderOptions) {
      return build(input, options);
    },
    async fromChanges(
      previous: GraphBuilderGraph | GraphBuilderResult | SerializedGraphBuilderResult,
      provider: GraphBuilderProvider,
      cursor?: string,
      options?: GraphBuilderOptions
    ) {
      const items = await collectChangedTextItems(provider, cursor, options);
      return updateGraph(previous, { upsert: items, cursor }, options);
    },
    updateGraph,
    loadGraph: loadGraphBuilderResult
  };
}

async function extractWithConcurrency(
  items: GraphBuilderTextItem[],
  options: GraphBuilderOptions,
  concurrency: number
): Promise<GraphBuilderExtraction[]> {
  const results: GraphBuilderExtraction[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await extractGraphBuilderItem(items[i]!, options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}