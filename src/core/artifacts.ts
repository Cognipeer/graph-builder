import type {
  GraphBuilderAnalysis,
  GraphBuilderArtifactKind,
  GraphBuilderArtifacts,
  GraphBuilderGraph
} from "./types.js";

export function buildArtifacts(
  graph: GraphBuilderGraph,
  analysis: GraphBuilderAnalysis,
  artifacts: GraphBuilderArtifactKind[] = ["json", "report"]
): GraphBuilderArtifacts {
  const nextArtifacts: GraphBuilderArtifacts = {};

  if (artifacts.includes("json")) {
    nextArtifacts.json = serializeGraph(graph);
  }
  if (artifacts.includes("report")) {
    nextArtifacts.report = generateReport(graph, analysis);
  }
  if (artifacts.includes("wiki")) {
    nextArtifacts.wiki = generateWiki(graph, analysis);
  }
  if (artifacts.includes("html")) {
    nextArtifacts.html = generateHtml(graph, analysis);
  }
  if (artifacts.includes("timeline")) {
    nextArtifacts.timeline = generateTimeline(graph);
  }
  if (artifacts.includes("manifest")) {
    nextArtifacts.manifest = generateManifest(graph);
  }
  if (artifacts.includes("dot")) {
    nextArtifacts.dot = generateDot(graph);
  }
  if (artifacts.includes("graphml")) {
    nextArtifacts.graphml = generateGraphML(graph);
  }
  if (artifacts.includes("cypher")) {
    nextArtifacts.cypher = generateCypher(graph);
  }

  return nextArtifacts;
}

export function serializeGraph(graph: GraphBuilderGraph, spaces = 2): string {
  return JSON.stringify(graph, null, spaces);
}

export function generateReport(graph: GraphBuilderGraph, analysis: GraphBuilderAnalysis): string {
  const lines = [
    `# Graph Builder Report`,
    "",
    `- ${graph.stats.nodeCount} nodes`,
    `- ${graph.stats.edgeCount} edges`,
    `- ${analysis.communities.length} communities`,
    `- ${(graph.timeline ?? []).length} timeline events`,
    "",
    "## God Nodes"
  ];

  for (const node of analysis.godNodes) {
    lines.push(`- ${node.label} (${node.degree})`);
  }

  lines.push("", "## Confidence Breakdown");
  for (const [confidence, count] of Object.entries(analysis.confidenceBreakdown)) {
    lines.push(`- ${confidence}: ${count}`);
  }

  lines.push("", "## Surprising Connections");
  if (analysis.surprisingConnections.length === 0) {
    lines.push("- None");
  } else {
    for (const connection of analysis.surprisingConnections) {
      lines.push(`- ${connection.source} --${connection.relation}--> ${connection.target} [${connection.confidence}]`);
      lines.push(`  ${connection.reason}`);
    }
  }

  lines.push("", "## Communities");
  for (const community of analysis.communities) {
    lines.push(`- ${community.label} (${community.size} nodes)`);
  }

  if (graph.changes) {
    lines.push("", "## Latest Change Set");
    lines.push(`- Added nodes: ${graph.changes.summary.addedNodeCount}`);
    lines.push(`- Removed nodes: ${graph.changes.summary.removedNodeCount}`);
    lines.push(`- Changed nodes: ${graph.changes.summary.changedNodeCount}`);
    lines.push(`- Added edges: ${graph.changes.summary.addedEdgeCount}`);
    lines.push(`- Removed edges: ${graph.changes.summary.removedEdgeCount}`);
    lines.push(`- Changed sources: ${graph.changes.summary.changedSourceCount}`);
  }

  return lines.join("\n");
}

export function generateTimeline(graph: GraphBuilderGraph): string {
  return JSON.stringify({
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    snapshots: graph.snapshots ?? [],
    timeline: graph.timeline ?? [],
    latestChanges: graph.changes
  }, null, 2);
}

export function generateManifest(graph: GraphBuilderGraph): string {
  const sources = new Map<string, { sourceItemId: string; nodeCount: number; labels: string[]; hash?: string; updatedAt?: string }>();

  for (const node of graph.nodes) {
    if (!node.sourceItemId) {
      continue;
    }
    const current = sources.get(node.sourceItemId) ?? {
      sourceItemId: node.sourceItemId,
      nodeCount: 0,
      labels: [],
      hash: typeof node.metadata?.hash === "string" ? node.metadata.hash : undefined,
      updatedAt: typeof node.metadata?.updatedAt === "string" ? node.metadata.updatedAt : undefined
    };
    current.nodeCount += 1;
    if (current.labels.length < 8) {
      current.labels.push(node.label);
    }
    sources.set(node.sourceItemId, current);
  }

  return JSON.stringify({
    version: graph.version,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    stats: graph.stats,
    sources: [...sources.values()].sort((left, right) => left.sourceItemId.localeCompare(right.sourceItemId))
  }, null, 2);
}

export function generateDot(graph: GraphBuilderGraph): string {
  const lines = ["digraph GraphBuilder {", "  graph [rankdir=LR];", "  node [shape=box];"];
  for (const node of graph.nodes) {
    lines.push(`  ${dotId(node.id)} [label=${JSON.stringify(node.label)}];`);
  }
  for (const edge of graph.edges) {
    lines.push(`  ${dotId(edge.source)} -> ${dotId(edge.target)} [label=${JSON.stringify(edge.relation)}];`);
  }
  lines.push("}");
  return lines.join("\n");
}

export function generateGraphML(graph: GraphBuilderGraph): string {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<graphml xmlns="http://graphml.graphdrawing.org/xmlns">`,
    `  <graph id="GraphBuilder" edgedefault="directed">`
  ];
  for (const node of graph.nodes) {
    lines.push(`    <node id="${escapeXml(node.id)}"><data key="label">${escapeXml(node.label)}</data><data key="type">${escapeXml(node.type)}</data></node>`);
  }
  graph.edges.forEach((edge, index) => {
    lines.push(`    <edge id="e${index}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}"><data key="relation">${escapeXml(edge.relation)}</data><data key="confidence">${escapeXml(edge.confidence)}</data></edge>`);
  });
  lines.push("  </graph>", "</graphml>");
  return lines.join("\n");
}

export function generateCypher(graph: GraphBuilderGraph): string {
  const lines = ["// Graph Builder Cypher export"];
  for (const node of graph.nodes) {
    lines.push(`MERGE (n:GraphBuilderNode {id: ${cypherString(node.id)}}) SET n.label = ${cypherString(node.label)}, n.type = ${cypherString(node.type)};`);
  }
  for (const edge of graph.edges) {
    const relation = edge.relation.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase() || "RELATED_TO";
    lines.push(`MATCH (a:GraphBuilderNode {id: ${cypherString(edge.source)}}), (b:GraphBuilderNode {id: ${cypherString(edge.target)}}) MERGE (a)-[:${relation} {confidence: ${cypherString(edge.confidence)}}]->(b);`);
  }
  return lines.join("\n");
}

export function generateWiki(graph: GraphBuilderGraph, analysis: GraphBuilderAnalysis): Record<string, string> {
  const wiki: Record<string, string> = {
    "index.md": [
      "# Graph Builder Wiki",
      "",
      `- Nodes: ${graph.stats.nodeCount}`,
      `- Edges: ${graph.stats.edgeCount}`,
      "",
      "## Communities",
      ...analysis.communities.map((community) => `- [[community-${community.id}.md|${community.label}]]`)
    ].join("\n")
  };

  for (const community of analysis.communities) {
    const members = graph.nodes.filter((node) => community.nodeIds.includes(node.id));
    wiki[`community-${community.id}.md`] = [
      `# ${community.label}`,
      "",
      ...members.slice(0, 25).map((member) => `- ${member.label} (${member.type})`)
    ].join("\n");
  }

  return wiki;
}

export function generateHtml(graph: GraphBuilderGraph, analysis?: GraphBuilderAnalysis): string {
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    community: node.community,
    sourceItemId: node.sourceItemId,
    mergedFrom: node.mergedFrom
  }));

  const edges = graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    confidence: edge.confidence,
    confidenceScore: edge.confidenceScore ?? 0.5
  }));

  const pageRankData = analysis?.pageRank ?? {};
  const betweennessData = analysis?.betweenness ?? {};

  const safeJson = (value: unknown) => JSON.stringify(value).replace(/<\/script>/gi, "<\\/script>");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Graph Builder</title>
  <script src="https://d3js.org/d3.v7.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #07111f; color: #e5edf8; overflow: hidden; }
    #app { display: flex; height: 100vh; }
    #sidebar { width: 280px; flex-shrink: 0; border-right: 1px solid #1f3550; display: flex; flex-direction: column; background: #0b1727; }
    #sidebar-header { padding: 14px 16px 10px; border-bottom: 1px solid #1f3550; }
    #sidebar-header h1 { margin: 0 0 3px; font-size: 15px; font-weight: 700; }
    #stats-line { font-size: 11px; color: #9ab0c9; margin: 0; }
    #search-wrap { padding: 9px 12px; border-bottom: 1px solid #1f3550; }
    #search { width: 100%; padding: 7px 10px; border-radius: 7px; border: 1px solid #29476a; background: #08111d; color: #e5edf8; font-size: 12px; outline: none; }
    #search:focus { border-color: #4da3ff; }
    #node-list { flex: 1; overflow-y: auto; }
    .node-item { padding: 7px 12px; cursor: pointer; border-bottom: 1px solid #0e1e2e; }
    .node-item:hover, .node-item.active { background: #1a2f48; }
    .n-label { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .n-meta { font-size: 10px; color: #9ab0c9; margin-top: 2px; }
    #detail-panel { border-top: 1px solid #1f3550; padding: 10px 12px; max-height: 190px; overflow-y: auto; flex-shrink: 0; }
    #detail-panel h3 { margin: 0 0 7px; font-size: 13px; font-weight: 600; }
    .dr { display: flex; gap: 6px; font-size: 11px; margin-bottom: 3px; }
    .dk { color: #9ab0c9; min-width: 72px; }
    .dv { color: #e5edf8; word-break: break-all; }
    #graph-wrap { flex: 1; position: relative; overflow: hidden; }
    svg { width: 100%; height: 100%; }
    .edge-line { stroke: #2d4f6f; stroke-opacity: 0.55; fill: none; }
    .edge-line.inferred { stroke-dasharray: 5,3; stroke-opacity: 0.35; }
    .edge-line.ambiguous { stroke-dasharray: 2,4; stroke-opacity: 0.25; }
    .edge-line.hi { stroke: #4da3ff; stroke-opacity: 0.9; stroke-width: 2; }
    .edge-line.dim { opacity: 0.06; }
    .node-g circle { cursor: pointer; stroke: #1f3550; stroke-width: 1.5; }
    .node-g circle:hover { stroke: #fff; stroke-width: 2; }
    .node-g circle.hi { stroke: #4da3ff; stroke-width: 2.5; }
    .node-g circle.dim { opacity: 0.18; }
    .node-lbl { pointer-events: none; font-size: 10px; fill: #b8cfe8; font-family: ui-sans-serif, sans-serif; }
    #tooltip { position: absolute; background: #0e1e30; border: 1px solid #29476a; border-radius: 7px; padding: 7px 11px; font-size: 11px; pointer-events: none; opacity: 0; transition: opacity 0.12s; z-index: 10; max-width: 220px; line-height: 1.5; }
    #ctrl { position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 5px; }
    .cbtn { background: #0b1727cc; border: 1px solid #1f3550; color: #9ab0c9; border-radius: 6px; padding: 5px 9px; cursor: pointer; font-size: 11px; backdrop-filter: blur(4px); }
    .cbtn:hover { border-color: #4da3ff; color: #e5edf8; }
  </style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div id="sidebar-header">
      <h1>Graph Builder</h1>
      <p id="stats-line"></p>
    </div>
    <div id="search-wrap"><input id="search" type="search" placeholder="Search nodes…" autocomplete="off"/></div>
    <div id="node-list"></div>
    <div id="detail-panel"><p style="color:#9ab0c9;font-size:11px;margin:0">Click a node to inspect</p></div>
  </aside>
  <div id="graph-wrap">
    <svg id="graph"></svg>
    <div id="tooltip"></div>
    <div id="ctrl">
      <button class="cbtn" id="btn-lbl">Labels: Off</button>
      <button class="cbtn" id="btn-reset">Reset View</button>
    </div>
  </div>
</div>
<script>
(function () {
  const GN = ${safeJson(nodes)};
  const GE = ${safeJson(edges)};
  const PR = ${safeJson(pageRankData)};
  const BC = ${safeJson(betweennessData)};

  const PALETTE = ["#4da3ff","#7ecb6f","#f7b955","#e06383","#9b8eee","#4db8b8","#e0884d","#a0d8a0","#c8a0e0","#78b0d0"];
  const TYPE_CLR = { document:"#4da3ff", code_file:"#7ecb6f", function:"#7ecb6f", class:"#9b8eee", interface:"#c8a0e0", method:"#a0d8a0", heading:"#78b0d0", resource:"#4d5e70", tag:"#4d5260", package:"#c8a060", schema_object:"#e0884d", schema_field:"#f7b955", memory_fact:"#e06383", symbol:"#9ab0c9", type:"#c8a0e0", enum:"#f7b955" };

  const degMap = {};
  for (const e of GE) { degMap[e.source] = (degMap[e.source]||0)+1; degMap[e.target] = (degMap[e.target]||0)+1; }
  const nodesD = GN.map(n => ({ ...n, degree: degMap[n.id]||0 }));
  const nodeById = new Map(nodesD.map(n => [n.id, n]));
  const edgesD = GE.map((e,i) => ({ ...e, _id: i }));

  const nodeColor = n => n.community != null ? PALETTE[n.community % PALETTE.length] : (TYPE_CLR[n.type] || "#9ab0c9");
  const nodeR = n => { const pr = PR[n.id]; return pr != null ? Math.max(5, Math.min(22, 5 + Math.sqrt(pr * nodesD.length) * 18)) : Math.max(5, Math.min(18, 5 + Math.sqrt(n.degree) * 2)); };
  nodesD.forEach(n => { n.r = nodeR(n); });

  const svg = d3.select("#graph");
  const wrap = document.getElementById("graph-wrap");
  let W = wrap.clientWidth, H = wrap.clientHeight;
  const g = svg.append("g");

  svg.append("defs").append("marker").attr("id","arr").attr("viewBox","0 -4 8 8").attr("refX",14).attr("refY",0).attr("markerWidth",5).attr("markerHeight",5).attr("orient","auto").append("path").attr("d","M0,-4L8,0L0,4").attr("fill","#2d4f6f");

  const zoom = d3.zoom().scaleExtent([0.05, 10]).on("zoom", ev => g.attr("transform", ev.transform));
  svg.call(zoom);

  const sim = d3.forceSimulation(nodesD)
    .force("link", d3.forceLink(edgesD).id(d => d.id).distance(100).strength(0.35))
    .force("charge", d3.forceManyBody().strength(n => -Math.max(80, n.r * 14)))
    .force("center", d3.forceCenter(W/2, H/2))
    .force("collide", d3.forceCollide().radius(d => d.r + 6))
    .alphaDecay(0.028);

  const edgeEls = g.append("g").selectAll("line").data(edgesD).join("line")
    .attr("class", e => "edge-line" + (e.confidence==="INFERRED"?" inferred":e.confidence==="AMBIGUOUS"?" ambiguous":""))
    .attr("stroke-width", e => 0.8 + e.confidenceScore)
    .attr("marker-end","url(#arr)");

  const drag = d3.drag()
    .on("start", (ev,d) => { if(!ev.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
    .on("drag",  (ev,d) => { d.fx=ev.x; d.fy=ev.y; })
    .on("end",   (ev,d) => { if(!ev.active) sim.alphaTarget(0); d.fx=null; d.fy=null; });

  const nodeGs = g.append("g").selectAll("g.node-g").data(nodesD).join("g").attr("class","node-g").call(drag);
  nodeGs.append("circle").attr("r", d => d.r).attr("fill", nodeColor);

  const lblEls = g.append("g").selectAll("text.node-lbl").data(nodesD).join("text")
    .attr("class","node-lbl hidden").attr("dy", d => -d.r-3).attr("text-anchor","middle")
    .text(d => d.label.length > 22 ? d.label.slice(0,20)+"…" : d.label);

  let labelsOn = false;

  const tt = document.getElementById("tooltip");
  nodeGs.on("mouseover", (ev,d) => {
    const pr = PR[d.id]; const bt = BC[d.id];
    tt.innerHTML = "<strong>"+esc(d.label)+"</strong><br/>"
      +"<span style='color:#9ab0c9'>type:</span> "+esc(d.type)+" &nbsp; <span style='color:#9ab0c9'>deg:</span> "+d.degree
      +(pr!=null?"<br/><span style='color:#9ab0c9'>pagerank:</span> "+pr.toFixed(4):"")
      +(bt!=null?"<br/><span style='color:#9ab0c9'>centrality:</span> "+bt.toFixed(4):"")
      +(d.sourceItemId?"<br/><span style='color:#9ab0c9'>source:</span> "+esc(d.sourceItemId):"")
      +(d.mergedFrom?"<br/><span style='color:#9ab0c9'>merged:</span> "+d.mergedFrom.length+" sources":"");
    tt.style.opacity="1";
    const sr = document.getElementById("sidebar");
    tt.style.left=(ev.clientX-sr.offsetWidth+14)+"px"; tt.style.top=(ev.clientY-8)+"px";
  }).on("mousemove", ev => {
    const sr = document.getElementById("sidebar");
    tt.style.left=(ev.clientX-sr.offsetWidth+14)+"px"; tt.style.top=(ev.clientY-8)+"px";
  }).on("mouseleave", () => { tt.style.opacity="0"; });

  let sel = null;
  nodeGs.on("click", (ev,d) => { ev.stopPropagation(); selectNode(d); });
  svg.on("click", () => clearSel());

  function selectNode(d) {
    sel = d.id;
    const nbrs = new Set([d.id]);
    edgesD.forEach(e => {
      const s=typeof e.source==="object"?e.source.id:e.source;
      const t=typeof e.target==="object"?e.target.id:e.target;
      if(s===d.id) nbrs.add(t); if(t===d.id) nbrs.add(s);
    });
    nodeGs.selectAll("circle").classed("hi", n=>n.id===d.id).classed("dim", n=>!nbrs.has(n.id));
    edgeEls.classed("dim", e=>{ const s=typeof e.source==="object"?e.source.id:e.source; const t=typeof e.target==="object"?e.target.id:e.target; return !nbrs.has(s)||!nbrs.has(t); })
           .classed("hi",  e=>{ const s=typeof e.source==="object"?e.source.id:e.source; const t=typeof e.target==="object"?e.target.id:e.target; return s===d.id||t===d.id; });
    lblEls.classed("hidden", n => labelsOn ? false : !nbrs.has(n.id));
    showDetail(d, nbrs);
    document.querySelectorAll(".node-item").forEach(el=>el.classList.toggle("active", el.dataset.id===d.id));
  }

  function clearSel() {
    sel=null;
    nodeGs.selectAll("circle").classed("hi",false).classed("dim",false);
    edgeEls.classed("dim",false).classed("hi",false);
    lblEls.classed("hidden", !labelsOn);
    document.getElementById("detail-panel").innerHTML="<p style='color:#9ab0c9;font-size:11px;margin:0'>Click a node to inspect</p>";
    document.querySelectorAll(".node-item").forEach(el=>el.classList.remove("active"));
  }

  function showDetail(d, nbrs) {
    const pr=PR[d.id]; const bt=BC[d.id];
    document.getElementById("detail-panel").innerHTML="<h3>"+esc(d.label)+"</h3>"
      +"<div class='dr'><span class='dk'>type</span><span class='dv'>"+esc(d.type)+"</span></div>"
      +"<div class='dr'><span class='dk'>degree</span><span class='dv'>"+d.degree+"</span></div>"
      +(pr!=null?"<div class='dr'><span class='dk'>pagerank</span><span class='dv'>"+pr.toFixed(5)+"</span></div>":"")
      +(bt!=null?"<div class='dr'><span class='dk'>centrality</span><span class='dv'>"+bt.toFixed(5)+"</span></div>":"")
      +(d.community!=null?"<div class='dr'><span class='dk'>community</span><span class='dv'>"+d.community+"</span></div>":"")
      +(d.sourceItemId?"<div class='dr'><span class='dk'>source</span><span class='dv'>"+esc(d.sourceItemId)+"</span></div>":"")
      +(d.mergedFrom?"<div class='dr'><span class='dk'>merged</span><span class='dv'>"+d.mergedFrom.length+" sources</span></div>":"")
      +"<div class='dr'><span class='dk'>neighbors</span><span class='dv'>"+(nbrs.size-1)+"</span></div>";
  }

  sim.on("tick", () => {
    edgeEls
      .attr("x1", e=>e.source.x).attr("y1", e=>e.source.y)
      .attr("x2", e=>{ const dx=e.target.x-e.source.x, dy=e.target.y-e.source.y, d=Math.sqrt(dx*dx+dy*dy)||1; return e.target.x-(dx/d)*(e.target.r+6); })
      .attr("y2", e=>{ const dx=e.target.x-e.source.x, dy=e.target.y-e.source.y, d=Math.sqrt(dx*dx+dy*dy)||1; return e.target.y-(dy/d)*(e.target.r+6); });
    nodeGs.attr("transform", d=>"translate("+d.x+","+d.y+")");
    lblEls.attr("transform", d=>"translate("+d.x+","+d.y+")");
  });

  const nl = document.getElementById("node-list");
  function renderList(q) {
    const norm = q.toLowerCase();
    const list = q ? nodesD.filter(n=>n.label.toLowerCase().includes(norm)).slice(0,60)
                   : [...nodesD].sort((a,b)=>b.degree-a.degree).slice(0,60);
    nl.innerHTML = list.map(n =>
      "<div class='node-item"+(sel===n.id?" active":"")+"' data-id='"+esc(n.id)+"'>"
        +"<div class='n-label'>"+esc(n.label)+"</div>"
        +"<div class='n-meta'>"+esc(n.type)+" · deg "+n.degree+(PR[n.id]!=null?" · pr "+PR[n.id].toFixed(3):"")+"</div>"
      +"</div>"
    ).join("");
    nl.querySelectorAll(".node-item").forEach(el=>{
      el.addEventListener("click",()=>{
        const nd=nodeById.get(el.dataset.id);
        if(nd){ selectNode(nd); svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(W/2-nd.x,H/2-nd.y).scale(Math.min(2,8/nd.r))); }
      });
    });
  }
  document.getElementById("search").addEventListener("input", ev=>renderList(ev.target.value));
  renderList("");

  document.getElementById("stats-line").textContent = nodesD.length+" nodes · "+edgesD.length+" edges · "+${graph.stats.communityCount}+" communities";

  document.getElementById("btn-lbl").addEventListener("click", function(){ labelsOn=!labelsOn; this.textContent="Labels: "+(labelsOn?"On":"Off"); lblEls.classed("hidden",!labelsOn); if(sel){ const nd=nodeById.get(sel); if(nd){ const nbrs=new Set([sel]); edgesD.forEach(e=>{ const s=typeof e.source==="object"?e.source.id:e.source; const t=typeof e.target==="object"?e.target.id:e.target; if(s===sel)nbrs.add(t); if(t===sel)nbrs.add(s); }); lblEls.classed("hidden",n=>labelsOn?false:!nbrs.has(n.id)); }}});
  document.getElementById("btn-reset").addEventListener("click",()=>svg.transition().duration(500).call(zoom.transform,d3.zoomIdentity));

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  window.addEventListener("resize",()=>{ W=wrap.clientWidth; H=wrap.clientHeight; sim.force("center",d3.forceCenter(W/2,H/2)).alpha(0.1).restart(); });
})();
<\/script>
</body>
</html>`;
}

function dotId(value: string): string {
  return JSON.stringify(value.replace(/[^A-Za-z0-9_]/g, "_"));
}

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cypherString(value: string): string {
  return JSON.stringify(value);
}