import { describe, expect, it } from "vitest";
import {
  analyzeGraph,
  graphBuilder,
  loadGraphBuilderResult,
  updateGraph,
  type GraphBuilderGraph,
  type SerializedGraphBuilderResult
} from "../src/index.js";

const items = [
  {
    id: "docs/overview.md",
    title: "Overview",
    path: "docs/overview.md",
    text: "# Overview\n\nSee [Guide](guide.md) and [Reference](reference.md)."
  },
  {
    id: "docs/guide.md",
    title: "Guide",
    path: "guide.md",
    text: "# Guide\n\nThis document explains the flow. See [Reference](reference.md)."
  },
  {
    id: "docs/reference.md",
    title: "Reference",
    path: "reference.md",
    text: "# Reference\n\nDetailed API notes."
  }
];

describe("artifact control", () => {
  it("builds no artifacts when artifacts: [] is passed", async () => {
    const result = await graphBuilder.fromTexts(items, { artifacts: [] });
    expect(result.artifacts).toEqual({});
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it("honors artifacts: [] in updateGraph", async () => {
    const base = await graphBuilder.fromTexts(items, { artifacts: [] });
    const updated = await updateGraph(base, {
      upsert: [{ id: "docs/extra.md", title: "Extra", path: "extra.md", text: "# Extra\n\nMore notes." }]
    }, { artifacts: [] });
    expect(updated.artifacts).toEqual({});
    expect(updated.graph.nodes.some((node) => node.sourceItemId === "docs/extra.md")).toBe(true);
  });
});

describe("loadGraphBuilderResult", () => {
  it("keeps persisted artifacts and analysis without rebuilding", async () => {
    const built = await graphBuilder.fromTexts(items);
    const serialized = JSON.parse(JSON.stringify(built)) as SerializedGraphBuilderResult;

    const loaded = loadGraphBuilderResult(serialized);
    expect(loaded.artifacts.report).toBe(serialized.artifacts.report);
    expect(loaded.artifacts.json).toBe(serialized.artifacts.json);
    expect(loaded.analysis).toEqual(serialized.analysis);
  });

  it("loads a bare graph without building artifacts by default", async () => {
    const built = await graphBuilder.fromTexts(items);
    const loaded = loadGraphBuilderResult(built.graph);
    expect(loaded.artifacts).toEqual({});
    expect(loaded.query.getNode("Guide")?.label).toBe("Guide");
  });

  it("builds requested artifact kinds on load", async () => {
    const built = await graphBuilder.fromTexts(items, { artifacts: [] });
    const loaded = loadGraphBuilderResult(built.graph, { artifacts: ["report"] });
    expect(loaded.artifacts.report).toContain("Graph Builder Report");
    expect(loaded.artifacts.json).toBeUndefined();
  });

  it("skips the sanitize clone when sanitize: false", async () => {
    const built = await graphBuilder.fromTexts(items, { artifacts: [] });
    const serialized = built.toJSON();
    const loaded = loadGraphBuilderResult(serialized, { sanitize: false });
    expect(loaded.graph).toBe(serialized.graph);
  });

  it("exposes a lazily built index", async () => {
    const built = await graphBuilder.fromTexts(items, { artifacts: [] });
    const loaded = loadGraphBuilderResult(built.graph);
    expect(loaded.index.nodesById.size).toBe(loaded.graph.nodes.length);
    expect(loaded.index.nodesBySourceItemId.get("docs/guide.md")?.length).toBeGreaterThan(0);
  });
});

describe("analyzeGraph purity", () => {
  it("does not mutate the input graph", async () => {
    const built = await graphBuilder.fromTexts(items, { artifacts: [] });
    const graph = JSON.parse(JSON.stringify(built.graph)) as GraphBuilderGraph;
    graph.nodes = graph.nodes.map(({ community: _community, ...rest }) => rest);
    graph.stats = { ...graph.stats, communityCount: 0 };
    const before = JSON.stringify(graph);

    const analysis = analyzeGraph(graph);

    expect(JSON.stringify(graph)).toBe(before);
    expect(analysis.communities.length).toBeGreaterThan(0);
    expect(graph.stats.communityCount).toBe(0);
  });
});

describe("deterministic query ordering", () => {
  it("returns identical results when node and edge arrays are reordered", async () => {
    const built = await graphBuilder.fromTexts(items, { artifacts: [] });
    const shuffledGraph: GraphBuilderGraph = {
      ...built.graph,
      nodes: [...built.graph.nodes].reverse(),
      edges: [...built.graph.edges].reverse()
    };

    const original = loadGraphBuilderResult(built.graph);
    const shuffled = loadGraphBuilderResult(shuffledGraph);

    const originalQuery = original.query.query("guide reference", { depth: 2, maxSeeds: 4 });
    const shuffledQuery = shuffled.query.query("guide reference", { depth: 2, maxSeeds: 4 });
    expect(shuffledQuery.seeds.map((node) => node.id)).toEqual(originalQuery.seeds.map((node) => node.id));
    expect(shuffledQuery.nodes.map((node) => node.id)).toEqual(originalQuery.nodes.map((node) => node.id));
    expect(shuffledQuery.edges.map((edge) => `${edge.source}->${edge.target}:${edge.relation}`))
      .toEqual(originalQuery.edges.map((edge) => `${edge.source}->${edge.target}:${edge.relation}`));

    const originalNeighbors = original.query.neighbors("Overview").map((entry) => [entry.node.id, entry.edge.relation]);
    const shuffledNeighbors = shuffled.query.neighbors("Overview").map((entry) => [entry.node.id, entry.edge.relation]);
    expect(shuffledNeighbors).toEqual(originalNeighbors);
  });
});
