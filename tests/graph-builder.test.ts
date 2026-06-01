import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createMemoryExtractor,
  graphBuilder,
  memoryFactToTextItem,
  type GraphBuilderProvider,
  type GraphBuilderSemanticEnricher
} from "../src/index.js";
import { writeGraphBuilderArtifacts } from "../src/node.js";

describe("graph-builder", () => {
  it("builds a graph from text records", async () => {
    const result = await graphBuilder.fromTexts([
      {
        id: "docs/overview.md",
        title: "Overview",
        path: "docs/overview.md",
        text: "# Overview\n\nSee [Guide](guide.md)."
      },
      {
        id: "docs/guide.md",
        title: "Guide",
        path: "guide.md",
        text: "# Guide\n\nThis document explains the flow."
      }
    ]);

    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.artifacts.report).toContain("Graph Builder Report");
    expect(result.query.path("Overview", "Guide")?.nodes.length).toBeGreaterThan(1);
  });

  it("supports custom providers", async () => {
    const provider: GraphBuilderProvider<{ id: string }> = {
      async *list() {
        yield { id: "row-1" };
      },
      async read() {
        return {
          id: "row-1",
          title: "Provider Row",
          text: "# Provider Row\n\nCustom providers work."
        };
      }
    };

    const result = await graphBuilder(provider);
    expect(result.analysis.godNodes[0]?.label).toBe("Provider Row");
  });

  it("supports local path shorthand", async () => {
    const dir = await mkdtemp(join(tmpdir(), "graph-builder-"));
    await writeFile(join(dir, "one.md"), "# One\n\nHello world.", "utf8");
    await writeFile(join(dir, "two.md"), "# Two\n\nSee [One](one.md).", "utf8");

    const result = await graphBuilder(dir);
    expect(result.graph.stats.sourceCount).toBe(2);
    expect(result.query.path("Two", "One")?.nodes.length).toBeGreaterThan(1);
  });

  it("supports optional semantic enrichment", async () => {
    const mockEnricher: GraphBuilderSemanticEnricher = {
      async enrich() {
        return {
          edges: [
            {
              source: "doc:docs/overview.md",
              target: "doc:docs/guide.md",
              relation: "semantically_similar_to",
              confidence: "INFERRED",
              confidenceScore: 0.85,
              context: "semantic_llm",
              metadata: {
                reason: "Both documents describe the same workflow from different angles."
              }
            }
          ],
          usage: {
            provider: "mock",
            model: "mock-model",
            inputTokens: 10,
            outputTokens: 4
          }
        };
      }
    };

    const result = await graphBuilder.fromTexts([
      {
        id: "docs/overview.md",
        title: "Overview",
        path: "docs/overview.md",
        text: "# Overview\n\nAuthentication and billing both pass through a workflow layer."
      },
      {
        id: "docs/guide.md",
        title: "Guide",
        path: "docs/guide.md",
        text: "# Guide\n\nThe workflow layer coordinates the same set of steps."
      }
    ], {
      semantic: {
        enricher: mockEnricher
      }
    });

    expect(result.graph.edges.some((edge) => edge.relation === "semantically_similar_to")).toBe(true);
    expect(result.diagnostics.modelUsage[0]?.model).toBe("mock-model");
  });

  it("supports custom extractors", async () => {
    const result = await graphBuilder.fromTexts([
      { id: "item-1", title: "Item One", text: "custom" }
    ], {
      extractor: {
        extract(item) {
          return {
            item,
            nodes: [
              {
                id: "custom:item-1",
                label: "Custom Item",
                type: "custom",
                sourceItemId: item.id
              }
            ],
            edges: []
          };
        }
      }
    });

    expect(result.query.getNode("Custom Item")?.type).toBe("custom");
  });

  it("updates graphs incrementally by source item", async () => {
    const initial = await graphBuilder.fromTexts([
      {
        id: "docs/alpha.md",
        title: "Alpha",
        path: "docs/alpha.md",
        text: "# Alpha\n\nSee [Beta](beta.md)."
      },
      {
        id: "docs/beta.md",
        title: "Beta",
        path: "docs/beta.md",
        text: "# Beta\n\nStable content."
      }
    ]);

    const updated = await graphBuilder.updateGraph(initial, {
      upsert: [
        {
          id: "docs/beta.md",
          title: "Beta Prime",
          path: "docs/beta.md",
          text: "# Beta Prime\n\nStable content."
        }
      ]
    });

    expect(updated.graph.nodes.some((node) => node.label === "Beta" && node.sourceItemId === "docs/beta.md")).toBe(false);
    expect(updated.query.getNode("Beta Prime")?.sourceItemId).toBe("docs/beta.md");
    expect(updated.query.path("Alpha", "Beta Prime")?.nodes.length).toBeGreaterThan(1);

    const removed = await graphBuilder.updateGraph(updated, {
      deleteSourceItemIds: ["docs/alpha.md"]
    });

    expect(removed.query.getNode("Alpha")).toBeUndefined();
  });

  it("extracts memory facts into relation graph nodes", async () => {
    const result = await graphBuilder.fromTexts([
      memoryFactToTextItem({
        id: "memory-1",
        scope: "workspace:acme",
        key: "Weekly report recipient",
        value: "Send weekly report to ada@example.com and save it under /workspace/reports.",
        factKind: "preference",
        tags: ["Reporting", "Stakeholder"],
        confidence: 0.9
      })
    ], {
      extractor: createMemoryExtractor()
    });

    expect(result.query.getNode("Weekly report recipient")?.type).toBe("memory_fact");
    expect(result.query.getNode("reporting")?.type).toBe("tag");
    expect(result.graph.edges.some((edge) => edge.relation === "references_file")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === "mentions")).toBe(true);
  });

  it("removes unpaired surrogates from serialized graph output", async () => {
    const result = await graphBuilder.fromTexts([
      {
        id: "docs/flight.md",
        title: "Flight",
        path: "docs/flight.md",
        text: "# Flight\n\nSurname: Hussain ✈️ Flight ID: N/A \ud83d"
      }
    ]);

    expect(JSON.stringify(result.toJSON())).not.toContain("\\ud83d");
  });

  it("extracts structured data and generates expanded artifacts", async () => {
    const result = await graphBuilder.fromTexts([
      {
        id: "config/app.json",
        title: "App Config",
        path: "config/app.json",
        hash: "hash-1",
        updatedAt: "2026-05-05T00:00:00.000Z",
        text: JSON.stringify({
          service: {
            url: "https://api.example.com",
            retries: 3
          },
          features: [
            {
              name: "search",
              enabled: true
            }
          ]
        })
      }
    ], {
      artifacts: ["json", "timeline", "manifest", "dot", "graphml", "cypher"]
    });

    expect(result.query.getNode("service")?.type).toBe("schema_object");
    expect(result.query.getNode("url")?.type).toBe("schema_field");
    expect(result.graph.edges.some((edge) => edge.relation === "references" && edge.context === "schema_value")).toBe(true);
    expect(result.artifacts.timeline).toContain("config/app.json");
    expect(result.artifacts.manifest).toContain("hash-1");
    expect(result.artifacts.dot).toContain("digraph GraphBuilder");
    expect(result.artifacts.graphml).toContain("<graphml");
    expect(result.artifacts.cypher).toContain("MERGE (n:GraphBuilderNode");
  });

  it("extracts script calls with structural parsing", async () => {
    const result = await graphBuilder.fromTexts([
      {
        id: "src/flow.ts",
        title: "Flow",
        path: "src/flow.ts",
        text: `interface Runner {}
class JobRunner implements Runner {
  run() { schedule(); }
}
export function schedule() { return true; }
export function start() { schedule(); }
`
      }
    ]);

    expect(result.query.getNode("JobRunner")?.type).toBe("class");
    expect(result.graph.edges.some((edge) => edge.relation === "calls" && result.graph.nodes.find((node) => node.id === edge.target)?.label === "schedule")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === "implements")).toBe(true);
  });

  it("tracks timeline snapshots and update diffs", async () => {
    const initial = await graphBuilder.fromTexts([
      {
        id: "docs/alpha.md",
        title: "Alpha",
        path: "docs/alpha.md",
        hash: "hash-alpha-1",
        text: "# Alpha\n\nSee [Beta](beta.md)."
      }
    ], {
      artifacts: ["timeline", "report"]
    });

    const updated = await graphBuilder.updateGraph(initial, {
      upsert: [
        {
          id: "docs/alpha.md",
          title: "Alpha",
          path: "docs/alpha.md",
          hash: "hash-alpha-2",
          text: "# Alpha Prime\n\nSee [Beta](beta.md)."
        }
      ]
    }, {
      artifacts: ["timeline", "report"]
    });

    expect(updated.query.timeline("docs/alpha.md").map((entry) => entry.event)).toEqual(["added", "updated"]);
    expect(updated.graph.snapshots?.length).toBe(2);
    expect(updated.query.changes()?.changedSourceItemIds).toContain("docs/alpha.md");
    expect(updated.artifacts.report).toContain("Latest Change Set");
  });

  it("updates from provider changes", async () => {
    const initial = await graphBuilder.fromTexts([
      {
        id: "docs/alpha.md",
        title: "Alpha",
        path: "docs/alpha.md",
        text: "# Alpha\n\nInitial."
      }
    ]);
    const provider: GraphBuilderProvider<{ id: string }> = {
      async *list() {
        yield { id: "docs/alpha.md" };
      },
      async *changes(cursor?: string) {
        if (cursor === "cursor-1") {
          yield { id: "docs/beta.md" };
        }
      },
      async read(item) {
        return {
          id: item.id,
          title: "Beta",
          path: item.id,
          text: "# Beta\n\nChanged provider item."
        };
      }
    };

    const updated = await graphBuilder.fromChanges(initial, provider, "cursor-1");
    expect(updated.query.getNode("Beta")?.sourceItemId).toBe("docs/beta.md");
    expect(updated.query.timeline("docs/beta.md")[0]?.event).toBe("added");
  });

  it("writes expanded artifacts to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "graph-builder-out-"));
    const result = await graphBuilder.fromTexts([
      {
        id: "docs/out.md",
        title: "Output",
        path: "docs/out.md",
        text: "# Output\n\nArtifact writing."
      }
    ], {
      artifacts: ["json", "report", "html", "wiki", "timeline", "manifest", "dot", "graphml", "cypher"]
    });

    const files = await writeGraphBuilderArtifacts(result, { outDir: dir });
    expect(files.some((file) => file.endsWith("graph.json"))).toBe(true);
    expect(files.some((file) => file.endsWith("timeline.json"))).toBe(true);
    expect(files.some((file) => file.endsWith("graph.graphml"))).toBe(true);
    await expect(readFile(join(dir, "GRAPH_REPORT.md"), "utf8")).resolves.toContain("Graph Builder Report");
  });

  it("computes pageRank, betweenness centrality and bridge nodes", async () => {
    const result = await graphBuilder.fromTexts([
      {
        id: "docs/a.md",
        title: "A",
        path: "docs/a.md",
        text: "# A\n\nSee [B](b.md) and [C](c.md)."
      },
      {
        id: "docs/b.md",
        title: "B",
        path: "docs/b.md",
        text: "# B\n\nSee [C](c.md)."
      },
      {
        id: "docs/c.md",
        title: "C",
        path: "docs/c.md",
        text: "# C\n\nFinal document."
      }
    ]);

    expect(result.analysis.pageRank).toBeDefined();
    expect(Object.keys(result.analysis.pageRank!).length).toBeGreaterThan(0);
    expect(result.analysis.betweenness).toBeDefined();
    expect(result.analysis.bridgeNodes).toBeDefined();
  });

  it("merges cross-document entities with entityResolution", async () => {
    const result = await graphBuilder.fromTexts([
      {
        id: "src/auth.ts",
        title: "Auth",
        path: "src/auth.ts",
        text: "export class TokenService { validate() {} }\nexport function authenticate() {}"
      },
      {
        id: "src/gateway.ts",
        title: "Gateway",
        path: "src/gateway.ts",
        text: "export class TokenService { refresh() {} }\nexport function route() {}"
      }
    ], { entityResolution: true });

    const tokenNodes = result.graph.nodes.filter((n) => n.label === "TokenService");
    expect(tokenNodes.length).toBe(1);
    expect(tokenNodes[0]?.mergedFrom?.length).toBe(2);
  });

  it("respects concurrency limit during extraction", async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `docs/doc-${i}.md`,
      title: `Doc ${i}`,
      path: `docs/doc-${i}.md`,
      text: `# Doc ${i}\n\nContent of document ${i}.`
    }));

    const result = await graphBuilder.fromTexts(items, { concurrency: 3 });
    expect(result.graph.stats.sourceCount).toBe(8);
  });

  it("weighted shortest path prefers high-confidence edges", async () => {
    const result = await graphBuilder.fromTexts([
      { id: "docs/x.md", title: "X", path: "docs/x.md", text: "# X\n\nSee [Y](y.md)." },
      { id: "docs/y.md", title: "Y", path: "docs/y.md", text: "# Y\n\nSee [Z](z.md)." },
      { id: "docs/z.md", title: "Z", path: "docs/z.md", text: "# Z\n\nEnd." }
    ]);

    const path = result.query.path("X", "Z");
    expect(path).not.toBeNull();
    expect(path!.nodes.length).toBeGreaterThan(1);
    expect(path!.totalWeight).toBeGreaterThan(0);
  });

  it("generates D3.js interactive HTML", async () => {
    const result = await graphBuilder.fromTexts([
      { id: "docs/viz.md", title: "Viz", path: "docs/viz.md", text: "# Viz\n\nVisualization test." }
    ], { artifacts: ["html"] });

    expect(result.artifacts.html).toContain("d3js.org");
    expect(result.artifacts.html).toContain("forceSimulation");
    expect(result.artifacts.html).toContain("Graph Builder");
  });
});