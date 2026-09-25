import { unseal, MAX_ENVELOPE_BYTES } from './crypto.mjs';
import { mountViewer } from './app.mjs';
const $ = id => document.getElementById(id);
let generation = 0;
let request;
let busy = false;
let dispose;
const emptyViewer = $('viewer').cloneNode(true);
function reset() {
  generation++;
  request?.abort();
  $('passphrase').value = '';
  $('passphrase').type = 'password';
  $('show-passphrase').textContent = 'Show';
  $('show-passphrase').setAttribute('aria-pressed', 'false');
  $('unlock-submit').disabled = false;
  $('cancel-unlock').hidden = true;
  $('unlock-status').textContent = '';
  busy = false;
}
function lock() {
  reset();
  dispose?.(); dispose = undefined;
  $('viewer').replaceChildren();
  $('viewer').hidden = true;
  $('unlock-screen').hidden = false;
  document.title = 'Protected workflow review · Pactap Direct';
}
async function fetchEnvelope(signal) {
  const response = await fetch('./payload.json', { cache: 'no-store', credentials: 'omit', signal });
  if (!response.ok || !response.body) throw Error('Unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ENVELOPE_BYTES) { await reader.cancel(); throw Error('Too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
// Authenticated content stays data; it is never interpreted as JavaScript or HTML.
function validateContent(data) {
  if (!data || !Array.isArray(data.flows) || !data.flows.length || data.flows.length > 40 || !data.review || !data.sourceNames || !data.handoffs) throw Error('Invalid review');
  let total = 0;
  for (const flow of data.flows) {
    if (!/^[a-z-]{1,64}$/.test(flow.id) || !Array.isArray(flow.nodes) || !flow.nodes.length || flow.nodes.length > 80 || !Array.isArray(flow.edges) || flow.edges.length > 200) throw Error('Invalid review');
    total += flow.nodes.length;
    const ids = new Set();
    for (const node of flow.nodes) {
      if (!/^[a-z-]{1,64}$/.test(node.id) || ids.has(node.id) || !Number.isInteger(node.row) || node.row < 0 || node.row > 80 || !Number.isInteger(node.col) || node.col < 0 || node.col > 2 || typeof node.title !== 'string' || typeof node.detail !== 'string' || !['agreed','draft','proposed'].includes(node.status)) throw Error('Invalid review');
      ids.add(node.id);
    }
    if (flow.edges.some(edge => !Array.isArray(edge) || !ids.has(edge[0]) || !ids.has(edge[1]))) throw Error('Invalid review');
  }
  if (total > 1000) throw Error('Invalid review');
  return data;
}
$('show-passphrase').addEventListener('click', () => {
  const show = $('passphrase').type === 'password';
  $('passphrase').type = show ? 'text' : 'password';
  $('show-passphrase').textContent = show ? 'Hide' : 'Show';
  $('show-passphrase').setAttribute('aria-pressed', String(show));
});
$('cancel-unlock').addEventListener('click', () => { reset(); $('passphrase').focus(); });
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || window.top !== window.self || !crypto?.subtle) return;
  busy = true;
  const attempt = ++generation;
  let passphrase = $('passphrase').value;
  $('passphrase').value = '';
  $('unlock-error').textContent = '';
  $('unlock-submit').disabled = true;
  $('cancel-unlock').hidden = false;
  $('unlock-status').textContent = 'Opening the encrypted review…';
  request = new AbortController();
  const activeRequest = request;
  const timeout = setTimeout(() => activeRequest.abort(), 15000);
  try {
    const envelope = await fetchEnvelope(activeRequest.signal);
    if (attempt !== generation) return;
    const data = validateContent(await unseal(envelope, passphrase));
    passphrase = '';
    if (attempt !== generation) return;
    $('viewer').hidden = false;
    dispose = mountViewer(data);
    const button = document.createElement('button');
    button.id = 'lock-workspace'; button.type = 'button'; button.textContent = 'Lock';
    button.addEventListener('click', () => { lock(); location.reload(); });
    document.querySelector('#viewer .masthead').append(button);
    $('unlock-screen').hidden = true;
    $('phase-title').focus();
  } catch {
    if (attempt === generation) {
      dispose?.(); dispose = undefined;
      $('viewer').replaceChildren(...emptyViewer.cloneNode(true).childNodes);
      $('viewer').hidden = true;
      $('unlock-error').textContent = 'Unable to unlock. Check your passphrase and try again. If it still fails, refresh or ask the maintainer for the current passphrase.';
      $('passphrase').focus();
    }
  } finally {
    passphrase = '';
    clearTimeout(timeout);
    if (attempt === generation) { busy = false; $('unlock-submit').disabled = false; $('cancel-unlock').hidden = true; $('unlock-status').textContent = ''; }
  }
});
window.addEventListener('pagehide', lock);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); else $('passphrase').value = ''; });
if (window.top !== window.self || !crypto?.subtle) {
  $('unlock-submit').disabled = true;
  $('passphrase').disabled = true;
  $('unlock-error').textContent = 'Open this page directly over HTTPS in a current browser to unlock the review.';
}
