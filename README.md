# Graph Builder

**API-first TypeScript library for turning text sources into a queryable graph, built to be embedded inside your own apps.**

[![npm](https://img.shields.io/npm/v/@cognipeer/graph-builder)](https://www.npmjs.com/package/@cognipeer/graph-builder)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![stars](https://img.shields.io/github/stars/Cognipeer/graph-builder?style=social)](https://github.com/Cognipeer/graph-builder)
[![docs](https://img.shields.io/badge/docs-docs.cognipeer.com-0A7CFF)](https://docs.cognipeer.com/graph-builder/)

[Docs](https://docs.cognipeer.com/graph-builder/) · [Quick start](#quick-start) · [Examples](./examples) · [Changelog](./CHANGELOG.md)

`@cognipeer/graph-builder` is built to be embedded inside other apps first. CLI and external adapters can be added later without changing the core API.

## Install

```bash
npm install @cognipeer/graph-builder
```

## Quick Start

```ts
import { graphBuilder } from "@cognipeer/graph-builder";

const result = await graphBuilder.fromTexts([
  {
    id: "docs/overview.md",
    path: "docs/overview.md",
    title: "Overview",
    text: "# Overview\n\nSee [Guide](guide.md)."
  },
  {
    id: "docs/guide.md",
    path: "guide.md",
    title: "Guide",
    text: "# Guide\n\nThis document explains the flow."
  }
]);

console.log(result.analysis.godNodes);
console.log(result.query.path("Overview", "Guide"));
console.log(result.artifacts.report);
```

## Main API

- `graphBuilder(input, options?)`
- `graphBuilder.build(input, options?)`
- `graphBuilder.fromTexts(records, options?)`
- `graphBuilder.fromProvider(provider, options?)`
- `graphBuilder.fromChanges(previous, provider, cursor?, options?)`
- `graphBuilder.updateGraph(previous, update, options?)`
- `graphBuilder.loadGraph(jsonOrObject)`
- `createGraphBuilder(config)`

## Provider Contract

Providers are the main extension surface.

```ts
import type { GraphBuilderProvider } from "@cognipeer/graph-builder";

const provider: GraphBuilderProvider<{ id: string }> = {
  name: "my-provider",
  async *list() {
    yield { id: "1" };
    yield { id: "2" };
  },
  async read(item) {
    return {
      id: item.id,
      title: `Record ${item.id}`,
      text: `# Record ${item.id}\n\nHello world.`
    };
  }
};
```

Providers can also expose `changes(cursor)` for cursor-based incremental updates:

```ts
const updated = await graphBuilder.fromChanges(previousResult, provider, "cursor-123");

console.log(updated.query.timeline());
console.log(updated.query.changes());
```

## Local Path Shorthand

In Node runtimes, you can pass a path directly:

```ts
import { graphBuilder } from "@cognipeer/graph-builder";

const result = await graphBuilder("./docs");
```

This delegates to the local file provider from the `./node` subpath.

## Timeline and Change Tracking

Every graph now carries time-aware metadata:

- `graph.timeline` records source-level `added`, `updated`, and `removed` events.
- `graph.snapshots` records node, edge, source, and community counts over time.
- `graph.changes` stores the latest diff when using `updateGraph` or `fromChanges`.

```ts
const updated = await graphBuilder.updateGraph(previous, {
  upsert: [{ id: "docs/guide.md", path: "docs/guide.md", text: "# Guide v2" }]
});

console.log(updated.query.timeline("docs/guide.md"));
console.log(updated.query.changes()?.summary);
```

## Extraction Coverage

Graph Builder extracts Markdown structure, JS/TS script structure, imports, local calls, class/interface heritage, JSON schema fields, YAML schema fields, tags, links, and optional semantic LLM relationships.

Structured files such as `.json`, `.yaml`, and `.yml` produce `schema_object`, `schema_array`, and `schema_field` nodes so configuration and API-like documents can be queried alongside prose and code.

## Artifacts and Node Output

Available artifact kinds:

```ts
["json", "report", "html", "wiki", "timeline", "manifest", "dot", "graphml", "cypher"]
```

In Node runtimes, the `./node` subpath can write a full output directory:

```ts
import { buildGraphBuilderOutput } from "@cognipeer/graph-builder/node";

const { files } = await buildGraphBuilderOutput("./docs", {
  outDir: "graph-builder-out"
});
```

This writes `graph.json`, `GRAPH_REPORT.md`, `graph.html`, `timeline.json`, `manifest.json`, `graph.dot`, `graph.graphml`, `graph.cypher`, and `wiki/*.md` when those artifacts are requested.

## Examples

- `npm run examples:from-texts`
- `npm run examples:provider`
- `npm run examples:path`
- `npm run examples:llm`
- `npm run examples:llm-mock`

## LLM Enrichment

Graph Builder can keep the deterministic extraction pipeline and then add an optional semantic LLM pass.

```ts
import { graphBuilder } from "@cognipeer/graph-builder";
import { createOpenAICompatibleEnricher } from "@cognipeer/graph-builder/adapters/openai-compatible";

const result = await graphBuilder.fromTexts(records, {
  semantic: {
    enricher: createOpenAICompatibleEnricher({
      apiKey: process.env.OPENAI_API_KEY!,
      model: "gpt-4.1-mini"
    })
  }
});
```

If you omit `semantic`, Graph Builder stays fully deterministic.

`examples:llm` expects a real OpenAI-compatible API key. `examples:llm-mock` uses a fake response so you can test the enrichment flow locally without network access.

## Notes

- Results are returned in memory by default.
- File or cloud output should be an explicit caller decision.
- The `adapters/to-markdown` subpath provides a wrapper for plugging in `@cognipeer/to-markdown` style converters.
- The `adapters/openai-compatible` subpath provides an optional semantic enricher for OpenAI-compatible chat-completions APIs.
- `graph.html` and other exports can be generated through the artifact API or the `./node` output helpers.

## Cognipeer open-source projects

| Project | What it does |
| --- | --- |
| [Cognipeer Console](https://github.com/Cognipeer/console) | Self-hosted AI gateway and control plane: OpenAI-compatible routing, RAG, MCP hub, guardrails and agent tracing |
| [console-sdk](https://github.com/Cognipeer/console-sdk) | TypeScript SDK for the Cognipeer Console API |
| [agent-sdk](https://github.com/Cognipeer/agent-sdk) | Lightweight, message-first agent runtime |
| [agent-server](https://github.com/Cognipeer/agent-server) | Ready-made REST API layer for AI agents |
| [chat-ui](https://github.com/Cognipeer/chat-ui) | React chat UI components for AI agents |
| [to-markdown](https://github.com/Cognipeer/to-markdown) | Convert PDF, Office, HTML and more to Markdown for LLM pipelines |
| [cognipeer-observability](https://github.com/Cognipeer/cognipeer-observability) | Drop-in agent tracing for LangChain, LangGraph, OpenAI Agents and OpenTelemetry |

If this project is useful to you, a ⭐ on GitHub helps other developers find it.
