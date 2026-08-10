# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

## [0.2.0] - 2026-08-10

### Added
- Added graph timelines, snapshots, latest change sets, and provider `changes(cursor)` incremental updates.
- Added structured JSON/YAML schema extraction and JS/TS structural call and heritage extraction.
- Added timeline, manifest, DOT, GraphML, and Cypher artifacts.
- Added Node output helpers for writing `graph-builder-out` style directories and rebuilding on file changes.
- Added `loadGraphBuilderResult(input, options)` load options: `artifacts` selects artifact kinds to (re)build while loading (default none), and `sanitize: false` skips the sanitize deep-clone for already-sanitized graphs.
- Added `applyCommunityAssignments(graph, analysis)` for annotating nodes with community ids now that `analyzeGraph` no longer mutates its input.
- Added `createQueryContext(graph)`; query helpers (`getNode`, `queryGraph`, `shortestPath`, `getNeighbors`) accept either a graph or a prebuilt context so adjacency is built once and reused.

### Changed
- Added dual ESM and CJS outputs for root and subpath exports.
- Added VitePress documentation scaffolding, GitHub workflows, and open source project templates.
- `analyzeGraph` is now pure: it no longer assigns `node.community` or `stats.communityCount` on the input graph. Build/update pipelines apply community assignments explicitly.
- Query traversal order is now deterministic: adjacency lists are sorted by neighbor id/relation/source, node scoring ties break on node id, and ordering no longer depends on host locale or node/edge array order.
- `result.index` is built lazily and adjacency construction is linear instead of quadratic in node degree.
- Self-loop edges now appear once (not twice) in adjacency and neighbor listings.

### Fixed
- `createGraphBuilderResult` no longer runs `analyzeGraph` and `buildArtifacts` twice per result. Passing `artifacts: []` to build/update now genuinely disables artifact generation, and every build/update/load no longer serializes the graph to JSON twice.
- Loading a serialized result now reuses its persisted `analysis` and `artifacts` instead of recomputing them.

## [0.1.0] - 2026-05-05

### Added
- API-first graph building from text arrays, custom providers, and local filesystem paths.
- Query helpers for node lookup, path finding, neighbors, communities, and seeded graph queries.
- Optional semantic enrichment through an OpenAI-compatible chat-completions adapter.
- Incremental graph updates, graph loading, and JSON/report/wiki/HTML artifact generation.
- Memory-fact and to-markdown adapters for integrating non-file content into the graph pipeline.
