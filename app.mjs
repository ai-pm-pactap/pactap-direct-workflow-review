export function mountViewer({ flows, sourceNames, handoffs, review }) {

const byId = new Map(flows.map(flow => [flow.id, flow]));
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const statusLabels = { agreed: 'Agreed requirement', draft: 'Approved specification', proposed: 'Approved design extension' };
const palette = { ink: '#202124', muted: '#666a73', line: '#b4bcc8', brand: '#0a66c2', soft: '#eaf3fd', warning: '#946200' };
let current = flows[0];
let zoom = 1;
let mode = window.matchMedia('(max-width: 820px)').matches ? 'text' : 'map';
let svg;
let geometry;
let reviewRevision = "unavailable";
const exportUrls = new Set();

function el(tag, text, attrs = {}) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
}
function s(tag, attrs = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function lines(text, maximum = 29) {
  const result = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > maximum) { result.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) result.push(line);
  return result;
}
function announce(message) { $('feedback').textContent = message; }
function branchButtons(node, onChoose) {
  const container = el('div', undefined, { class: 'branches' });
  for (const [from, to, label] of current.edges.filter(edge => edge[0] === node.id)) {
    const target = current.nodes.find(candidate => candidate.id === to);
    const button = el('button', `${label || 'Next'} → ${target.title}`, { type: 'button', class: 'branch' });
    button.addEventListener('click', () => onChoose(to));
    container.append(button);
  }
  for (const phase of handoffs[`${current.id}:${node.id}`] || []) {
    const button = el('button', 'Open flow: ' + byId.get(phase).title, { type: 'button', class: 'branch' });
    button.addEventListener('click', () => { location.hash = phase; });
    container.append(button);
  }
  return container;
}
function selectNode(id, scroll = false) {
  const node = current.nodes.find(candidate => candidate.id === id);
  if (!node) return;
  svg.querySelectorAll('.flow-node').forEach(group => {
    const selected = group.dataset.node === id;
    group.classList.toggle('selected', selected);
    group.setAttribute('aria-pressed', String(selected));
  });
  const panel = $('selection');
  panel.replaceChildren(
    el('p', `${statusLabels[node.status]} · ${node.actor}`, { class: `step-meta status-${node.status}` }),
    el('h2', node.title), el('p', node.detail), branchButtons(node, target => selectNode(target, true))
  );
  panel.hidden = mode !== 'map';
  $('step-position').textContent = `${current.nodes.indexOf(node) + 1} / ${current.nodes.length}`;
  if (scroll) {
    const position = geometry.positions.get(id);
    $('map-region').scrollTo({ left: Math.max(0, position.x * zoom - 24), top: Math.max(0, position.y * zoom - 24) });
    svg.querySelector(`[data-node="${id}"]`).focus({ preventScroll: true });
  }
}
function makeDiagram(flow) {
  const nodeWidth = 280, nodeHeight = 124, columnWidth = 380, rowHeight = 196;
  const width = 80 + (Math.max(...flow.nodes.map(node => node.col)) + 1) * columnWidth;
  const height = 72 + (Math.max(...flow.nodes.map(node => node.row)) + 1) * rowHeight;
  const positions = new Map(flow.nodes.map(node => [node.id, { x: 48 + node.col * columnWidth, y: 40 + node.row * rowHeight }]));
  const root = s('svg', { xmlns: NS, viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': `${flow.title}. ${flow.nodes.length} steps. Equivalent text view is available.` });
  root.append(s('title', {}, flow.title), s('desc', {}, `${flow.summary} Dashed boxes mark approved design extensions. All branches also appear in Text steps.`));
  const defs = s('defs');
  const marker = s('marker', { id: 'arrow', markerWidth: 10, markerHeight: 10, refX: 8, refY: 5, orient: 'auto', markerUnits: 'userSpaceOnUse' });
  marker.append(s('path', { d: 'M 1 1 L 9 5 L 1 9 z', fill: palette.muted }));
  defs.append(marker);
  root.append(defs);
  // Edges use the authored topology; positional routing never supplies business rules.
  const edgeLabels = [];
  const labelBounds = [];
  flow.edges.forEach(([from, to, label], index) => {
    const a = positions.get(from), b = positions.get(to);
    let path;
    if (a.x === b.x && b.y - a.y === rowHeight) {
      path = `M ${a.x + nodeWidth / 2} ${a.y + nodeHeight} V ${b.y - 6}`;

    } else {
      const side = b.x > a.x ? 1 : -1;
      const startX = side > 0 ? a.x + nodeWidth : a.x;
      const endX = side > 0 ? b.x : b.x + nodeWidth;
      const laneX = side > 0 ? a.x + nodeWidth + 28 + (index % 3) * 12 : Math.max(12, a.x - 20 - (index % 3) * 12);
      const ay = a.y + nodeHeight / 2, by = b.y + nodeHeight / 2;
      if (a.x === b.x) {
        const lane = a.x + nodeWidth + 28 + (index % 3) * 12;
        path = `M ${a.x + nodeWidth} ${ay} H ${lane} V ${by + (from === to ? 36 : 0)} H ${a.x + nodeWidth + 6}`;

      } else {
        path = `M ${startX} ${ay} H ${laneX} V ${by} H ${endX - side * 6}`;

      }
    }
    root.append(s('path', { d: path, fill: 'none', stroke: palette.line, 'stroke-width': 1.5, 'marker-end': 'url(#arrow)' }));
    if (label) {
      const straight = a.x === b.x && b.y - a.y === rowHeight;
      const labelLines = lines(label, straight ? 16 : 12);
      const labelWidth = Math.max(...labelLines.map(line => line.length)) * 6.4 + 10;
      const labelHeight = labelLines.length * 16 + 2;
      const bounds = (x,y) => ({ x: x - 3, y: y - 13, width: labelWidth, height: labelHeight });
      const intersects = (a,b,gap) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
      const collides = (x,y) => {
        const box = bounds(x,y);
        return [...positions.values()].some(p => intersects(box,{...p,width:nodeWidth,height:nodeHeight},5)) || labelBounds.some(prior => intersects(box,prior,4));
      };
      // Captions stay in their own outgoing corridor so a clear label cannot imply the wrong branch.
      const boxes = [];
      const ay = a.y + nodeHeight / 2, by = b.y + nodeHeight / 2;
      if (straight) {
        const x = a.x + nodeWidth / 2 + 12;
        const low = a.y + nodeHeight + 5, high = b.y - labelHeight - 5;
        const middle = (low + high) / 2;
        for (let d = 0; d < 80; d += 4) {
          for (const y of [middle + d, middle - d]) if (y >= low && y <= high) boxes.push([x,y]);
        }
      } else {
        const side = a.x === b.x || b.x > a.x ? 1 : -1;
        const lane = side > 0 ? a.x + nodeWidth + 28 + (index % 3) * 12 : Math.max(12, a.x - 20 - (index % 3) * 12);
        const lowX = side > 0 ? a.x + nodeWidth + 5 : a.x - (columnWidth - nodeWidth);
        const highX = side > 0 ? a.x + columnWidth - labelWidth : a.x - labelWidth - 5;
        if (lowX <= highX) {
          const nearLane = side > 0 ? lane + 4 : lane - labelWidth - 4;
          const xs = [Math.max(lowX, Math.min(highX, nearLane)), lowX, highX];
          for (const y of [ay - labelHeight - 8, ay + 8]) for (const x of xs) boxes.push([x,y]);
          const lowY = Math.min(ay,by), highY = Math.max(ay,by) + (from === to ? 36 : 0);
          const ys = [(lowY + highY - labelHeight) / 2];
          for (let d = 0; d <= highY - lowY; d += 12) ys.push(ay + (by >= ay ? d : -d) - labelHeight / 2);
          for (const y of ys) if (y + labelHeight >= lowY && y <= highY) for (const x of xs) boxes.push([x,y]);
        }
      }
      const candidates = boxes.map(([x,y]) => [x + 3,y + 13]);
      const position = candidates.find(([x,y]) => x >= 0 && x + labelWidth < width && y > 13 && !collides(x,y));
      if (!position) throw Error('Diagram branch labels need a new authored layout: ' + flow.id);
      const [lx,ly] = position;
      labelBounds.push(bounds(lx,ly));
      edgeLabels.push(s('rect', { class: 'edge-label-background', 'data-edge': `${from}:${to}`, x: lx - 3, y: ly - 13, width: labelWidth, height: labelLines.length * 16 + 2, rx: 3, fill: '#f6f7f9' }));
      labelLines.forEach((line, i) => edgeLabels.push(s('text', { class: 'edge-label-text', 'data-edge': `${from}:${to}`, x: lx + 2, y: ly + i * 16, fill: palette.muted, 'font-size': 11, 'font-family': 'Segoe UI, Arial, sans-serif' }, line)));
    }
  });
  flow.nodes.forEach((node, index) => {
    const { x, y } = positions.get(node.id);
    const group = s('g', { class: 'flow-node', tabindex: 0, role: 'button', 'aria-label': `${index + 1}. ${node.title}. ${statusLabels[node.status]}. ${node.actor}. ${node.detail}`, 'data-node': node.id });
    const isDecision = node.kind === 'decision';
    const attrs = { class: 'node-shape', fill: isDecision ? '#eaf3fd' : '#ffffff', stroke: node.status === 'proposed' ? palette.warning : '#c8cdd5', 'stroke-width': 1.25 };
    if (node.status === 'proposed') attrs['stroke-dasharray'] = '6 4';
    group.append(isDecision
      ? s('path', { ...attrs, d: `M ${x + 18} ${y} H ${x + nodeWidth - 18} L ${x + nodeWidth} ${y + nodeHeight / 2} L ${x + nodeWidth - 18} ${y + nodeHeight} H ${x + 18} L ${x} ${y + nodeHeight / 2} Z` })
      : s('rect', { ...attrs, x, y, width: nodeWidth, height: nodeHeight, rx: 10 }));
    group.append(s('text', { x: x + 22, y: y + 24, fill: palette.muted, 'font-family': 'Segoe UI, Arial, sans-serif', 'font-size': 11 }, `${String(index + 1).padStart(2, '0')}  ·  ${node.actor}`));
    lines(node.title).forEach((line, i) => group.append(s('text', { x: x + 22, y: y + 49 + i * 19, fill: palette.ink, 'font-family': 'Segoe UI, Arial, sans-serif', 'font-size': 14, 'font-weight': 600 }, line)));
    group.append(s('text', { x: x + 22, y: y + nodeHeight - 15, fill: node.status === 'proposed' ? palette.warning : palette.muted, 'font-family': 'Segoe UI, Arial, sans-serif', 'font-size': 11 }, statusLabels[node.status]));
    group.addEventListener('click', () => selectNode(node.id));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } });
    root.append(group);
  });
  root.append(...edgeLabels);
  return { root, positions, width, height };
}
function setZoom(value) {
  zoom = Math.max(.35, Math.min(1.75, value));
  svg.setAttribute('width', geometry.width * zoom);
  svg.setAttribute('height', geometry.height * zoom);
  $('zoom-label').value = `${Math.round(zoom * 100)}%`;
  $('zoom-out').disabled = zoom <= .35;
  $('zoom-in').disabled = zoom >= 1.75;
}
function setMode(value) {
  mode = value;
  $('map-region').hidden = mode !== 'map';
  $('map-tools').hidden = mode !== 'map';
  $('inspector').hidden = mode !== 'map';
  document.querySelector('.workbench').classList.toggle('text-mode', mode === 'text');
  $('zoom-controls').hidden = mode !== 'map';
  $('map-help').hidden = mode !== 'map';
  $('text-region').hidden = mode !== 'text';
  $('selection').hidden = mode !== 'map' || !$('selection').childElementCount;
  $('map-view').setAttribute('aria-pressed', String(mode === 'map'));
  $('text-view').setAttribute('aria-pressed', String(mode === 'text'));
}
function renderText() {
  const list = el('ol', undefined, { class: 'steps' });
  current.nodes.forEach((node, index) => {
    const item = el('li', undefined, { id: `step-${node.id}`, tabindex: '-1' });
    item.append(el('p', `${String(index + 1).padStart(2, '0')} · ${node.actor} · ${statusLabels[node.status]}`, { class: `step-meta status-${node.status}` }), el('h2', node.title), el('p', node.detail));
    item.append(branchButtons(node, target => { $(`step-${target}`).focus(); $(`step-${target}`).scrollIntoView({ block: 'start' }); }));
    list.append(item);
  });
  $('text-region').replaceChildren(list);
}
function navigate(focus = false) {
  const raw = location.hash.slice(1);
  current = byId.get(raw) || flows[0];
  if (raw && !byId.has(raw)) announce('That phase link is unavailable. Showing the complete journey.'); else announce('');
  const index = flows.indexOf(current);
  $('phase-title').textContent = current.title;
  document.title = `${current.title} · Pactap Direct`;
  $('phase-number').textContent = `${index === 0 ? 'Start here' : `Phase ${String(index).padStart(2, '0')}`} · ${current.nodes.length} steps`;
  $('phase-summary').textContent = current.summary;
  const decisions = current.nodes.filter(node => node.kind === 'decision').length;
  const proposed = current.nodes.filter(node => node.status === 'proposed').length;
  $('phase-composition').textContent = `${decisions} ${decisions === 1 ? 'decision' : 'decisions'} · ${proposed} design-extension ${proposed === 1 ? 'step' : 'steps'}`;
  $('phase-select').value = current.id;
  document.querySelectorAll('#phase-nav a').forEach(link => { if (link.hash === `#${current.id}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('previous').disabled = index === 0;
  $('next').disabled = index === flows.length - 1;
  $('phase-notes').replaceChildren(...current.notes.map(note => el('li', note)));
  $('source-label').textContent = `Source modules: ${current.sources.map(code => `${code} — ${sourceNames[code]}`).join(' · ')}. See the review record for source fingerprints and open policy decisions.`;
  geometry = makeDiagram(current);
  svg = geometry.root;
  $('map-region').replaceChildren(svg);
  $('map-region').scrollTo(0, 0);
  $('selection').replaceChildren();
  renderText();
  setMode(mode);
  setZoom(1);
  selectNode(current.nodes[0].id);
  const firstPosition = geometry.positions.get(current.nodes[0].id);
  $('map-region').scrollLeft = Math.max(0, firstPosition.x - ($('map-region').clientWidth - 280) / 2);

  if (focus) {
    $('phase-title').scrollIntoView({ block: 'start' });
    $('phase-title').focus({ preventScroll: true });
  }
}

flows.forEach((flow, index) => {
  const label = index === 0 ? 'All' : String(index).padStart(2, '0');
  const link = el('a', undefined, { href: `#${flow.id}` });
  link.append(el('span', label), el('span', flow.title));
  const groups = {1: 'Prepare & price', 5: 'Place & confirm', 9: 'Fulfil & receive', 12: 'Changes & recovery'};
  if (groups[index]) $('phase-nav').append(el('h3', groups[index], { class: 'nav-group' }));
  $('phase-nav').append(link);
  $('phase-select').append(el('option', `${label} · ${flow.title}`, { value: flow.id }));
});
$('phase-select').addEventListener('change', event => { location.hash = event.target.value; });
$('previous').addEventListener('click', () => { location.hash = flows[Math.max(0, flows.indexOf(current) - 1)].id; });
$('next').addEventListener('click', () => { location.hash = flows[Math.min(flows.length - 1, flows.indexOf(current) + 1)].id; });
$('map-view').addEventListener('click', () => setMode('map'));
$('text-view').addEventListener('click', () => setMode('text'));
$('zoom-out').addEventListener('click', () => setZoom(zoom - .15));
$('zoom-in').addEventListener('click', () => setZoom(zoom + .15));
$('actual').addEventListener('click', () => setZoom(1));
$('fit').addEventListener('click', () => { setZoom(($('map-region').clientWidth - 24) / geometry.width); announce('Fit width may reduce text size. Use 100% or Text steps for comfortable reading.'); });
$('copy-link').addEventListener('click', async () => {
  const url = new URL(location.href); url.hash = current.id;
  try { await navigator.clipboard.writeText(url.href); announce('Link copied for this phase.'); }
  catch { announce(`Copy this phase link: ${url.href}`); }
});
$('export').addEventListener('click', () => {
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', geometry.width); clone.setAttribute('height', geometry.height);
  clone.querySelectorAll('[tabindex]').forEach(node => { node.removeAttribute('tabindex'); node.removeAttribute('role'); });
  const exported = s('svg', { xmlns: NS, viewBox: `0 0 ${geometry.width} ${geometry.height + 152}`, width: geometry.width, height: geometry.height + 152 });
  exported.append(s('rect', { x: 0, y: 0, width: geometry.width, height: geometry.height + 152, fill: '#ffffff' }));
  const captions = [current.title, 'WORKFLOW REVIEW — specification approved 2026-09-25; implementation in progress.', 'Diagram revision: ' + reviewRevision + ' | Source modules: ' + current.sources.join(', '), 'Legend: Agreed requirement / Approved specification / Approved extension (dashed).'];
  captions.forEach((text, i) => exported.append(s('text', { x: 48, y: 32 + i * 28, fill: palette.ink, 'font-family': 'Segoe UI, Arial, sans-serif', 'font-size': i === 0 ? 22 : 14 }, text)));
  const diagramGroup = s('g', { transform: 'translate(0 144)' });
  diagramGroup.append(...clone.childNodes); exported.append(diagramGroup);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(exported)], { type: 'image/svg+xml;charset=utf-8' }));
  exportUrls.add(url);
  const anchor = el('a', undefined, { href: url, download: `pactap-buyer-${current.id}.svg` });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => { URL.revokeObjectURL(url); exportUrls.delete(url); }, 1000);
  announce('Diagram saved as SVG. Print provides the complete text and decision branches.');
});
$('print').addEventListener('click', () => window.print());
document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); $('main').focus(); $('main').scrollIntoView({ block: 'start' }); });
const onHashChange = () => navigate(true);
navigate();
window.addEventListener('hashchange', onHashChange);

try {
  if (!review) throw new Error('Review record unavailable');
  reviewRevision = review.revision;
  $('revision-label').textContent = `Diagram revision ${review.revision}`;
  const record = $('review-record');
  record.replaceChildren(el('p', `Content cross-check: ${review.reviewedAt}. Specification approval: ${review.productApprovedAt}.`), el('p', review.scope), el('p', review.maintenance));
  record.append(el('p', 'Operating configuration required before activation:'));
  const list = el('ul'); review.openDecisions.forEach(decision => list.append(el('li', decision))); record.append(list);
  const fingerprints = el('details');
  fingerprints.append(el('summary', 'Reviewed source fingerprints'));
  const sourceList = el('ul');
  for (const source of review.sources) sourceList.append(el('li', `${source.path} · SHA-256 ${source.sha256}`));
  fingerprints.append(sourceList); record.append(fingerprints);
} catch {
  $('review-record').textContent = 'Review record unavailable. Do not assume the diagrams are current; refresh or contact the maintainer.';
  $('revision-label').textContent = 'Review provenance unavailable';
}

return () => {
  window.removeEventListener('hashchange', onHashChange);
  for (const url of exportUrls) URL.revokeObjectURL(url);
  exportUrls.clear();
};

}
