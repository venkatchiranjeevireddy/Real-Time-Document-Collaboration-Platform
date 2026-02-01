/**
 * Per-document in-memory state (multi-doc).
 * Map<docId, { content, version }>
 */

const store = new Map();

function get(docId) {
  const state = store.get(docId);
  if (!state) return null;
  return { ...state };
}

function hydrate(docId, content, version) {
  if (!docId) return null;
  store.set(docId, {
    content: typeof content === 'string' ? content : '',
    version: typeof version === 'number' ? version : 0,
  });
  return get(docId);
}

function restore(docId, content, version) {
  if (!docId) return null;
  const state = store.get(docId);
  if (!state) return null;
  if (typeof content === 'string') state.content = content;
  if (typeof version === 'number') state.version = version;
  return get(docId);
}

function applyEdit(docId, content, expectedVersion) {
  if (!docId || typeof content !== 'string') return null;
  const state = store.get(docId);
  if (!state) return null;
  if (expectedVersion !== state.version) return null;
  state.content = content;
  state.version += 1;
  return get(docId);
}

function ensureDoc(docId) {
  if (!store.has(docId)) {
    store.set(docId, { content: '', version: 0 });
  }
  return store.get(docId);
}

/** STEP 10: Return all doc IDs currently in memory (for auto-snapshot timer). */
function getAllDocIds() {
  return Array.from(store.keys());
}

module.exports = { get, hydrate, restore, applyEdit, ensureDoc, getAllDocIds };
