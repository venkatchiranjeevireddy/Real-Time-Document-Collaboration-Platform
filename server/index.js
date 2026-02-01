const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require('socket.io');
const { Mutex } = require('async-mutex');
const config = require('./config');
const document = require('./document');
const db = require('./db/supabase');
const logger = require('./logger');
const authRoutes = require('./auth');
const { requireAuth } = require('./auth');

// Per-document mutex (so different docs can be edited in parallel)
const docMutexes = new Map();
function getDocMutex(docId) {
  if (!docMutexes.has(docId)) docMutexes.set(docId, new Mutex());
  return docMutexes.get(docId);
}

// STEP 7: In-memory audit trail (last 500 edit events)
const AUDIT_MAX = 500;
const auditLog = [];
function pushAudit(entry) {
  auditLog.push(entry);
  if (auditLog.length > AUDIT_MAX) auditLog.shift();
}
function getAudit(limit = 50, documentId = null) {
  let list = auditLog.slice().reverse();
  if (documentId) list = list.filter((e) => e.documentId === documentId);
  return list.slice(0, limit);
}

// STEP 9: Rate limit — per user (or socket) track edit timestamps; reject if >= max in last 1s
const editTimestampsByKey = new Map();
const RATE_WINDOW_MS = 1000;
function recordEditTimestamp(key) {
  const now = Date.now();
  if (!editTimestampsByKey.has(key)) editTimestampsByKey.set(key, []);
  const list = editTimestampsByKey.get(key);
  list.push(now);
  while (list.length && list[0] < now - RATE_WINDOW_MS) list.shift();
}
function checkRateLimit(key) {
  const now = Date.now();
  if (!editTimestampsByKey.has(key)) return true;
  const list = editTimestampsByKey.get(key).filter((t) => t >= now - RATE_WINDOW_MS);
  editTimestampsByKey.set(key, list);
  return list.length < config.maxEditsPerSecond;
}

const app = express();

app.use(express.json());
app.use('/auth', authRoutes);

app.use(express.static(path.join(__dirname, '..', 'client')));

// STEP 1: Pages — login, signup, dashboard, doc (editor)
app.get('/', (req, res) => res.redirect(302, '/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'dashboard.html')));
app.get('/doc', (req, res) => res.redirect(302, '/dashboard'));
app.get('/doc/:id', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'index.html')));

// Multi-doc API (require JWT)
app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const list = await db.listDocuments(req.user.id, req.user.email);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list documents' });
  }
});

app.post('/api/documents', requireAuth, async (req, res) => {
  const title = (req.body.title || 'Untitled').trim() || 'Untitled';
  const { data, error } = await db.createDocument(req.user.id, title);
  if (error) return res.status(400).json({ error: error.message || 'Failed to create document' });
  res.status(201).json(data);
});

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  const doc = await db.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  let role = null;
  if (doc.owner_id === req.user.id) role = 'editor';
  else {
    role = await db.getDocumentRole(req.params.id, req.user.id);
    if (!role) {
      const invite = await db.getPendingInvite(req.params.id, req.user.email);
      if (invite) {
        await db.acceptInviteForUser(req.params.id, req.user.id, invite.role, invite.email);
        role = invite.role;
      }
    }
  }
  if (!role) return res.status(403).json({ error: 'Forbidden' });
  res.json({ ...doc, myRole: role, isOwner: doc.owner_id === req.user.id });
});

app.patch('/api/documents/:id', requireAuth, async (req, res) => {
  const doc = await db.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can update the title' });
  const title = (req.body.title || '').trim() || 'Untitled';
  const ok = await db.updateDocumentTitle(req.params.id, title, req.user.id);
  if (!ok) return res.status(500).json({ error: 'Failed to update title' });
  res.json({ ...doc, title });
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  const doc = await db.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete the document' });
  const ok = await db.deleteDocument(req.params.id, req.user.id);
  if (!ok) return res.status(500).json({ error: 'Failed to delete document' });
  res.status(204).send();
});

app.post('/api/documents/:id/invite', requireAuth, async (req, res) => {
  const doc = await db.getDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can invite' });
  const email = (req.body.email || '').trim().toLowerCase();
  const role = req.body.role === 'editor' ? 'editor' : 'viewer';
  if (!email) return res.status(400).json({ error: 'Email required' });
  const { data, error } = await db.createInvite(req.params.id, email, role, req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// STEP 7: GET /api/audit — recent edit audit trail (optional ?limit=50 & ?documentId=xxx)
app.get('/api/audit', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const documentId = req.query.documentId || null;
  if (documentId) {
    const role = await db.getDocumentRole(documentId, req.user.id);
    if (!role) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(getAudit(limit, documentId));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: config.corsOrigin },
});

// Track clients: socketId -> { id, joinedAt, email?, userId?, documentId? }
const clients = new Map();
const ROOM_PREFIX = 'doc:';

function getPresenceForRoom(room) {
  const list = Array.from(clients.values()).filter((c) => c.documentId && ROOM_PREFIX + c.documentId === room);
  return {
    count: list.length,
    clients: list.map((c) => ({ id: c.id, joinedAt: c.joinedAt, email: c.email, userId: c.userId })),
  };
}

function getEditedBy(socketId) {
  const c = clients.get(socketId);
  if (!c) return undefined;
  return { id: c.userId, email: c.email };
}

function broadcastPresenceToRoom(docId) {
  const room = ROOM_PREFIX + docId;
  const presence = getPresenceForRoom(room);
  io.to(room).emit('presence', presence);
  logger.info('presence', docId, presence.count, 'user(s)');
}

// --- HTTP ---
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Document collaboration server is running',
    connections: clients.size,
  });
});

// Phase 6: expose Supabase URL + anon key for client-side auth (anon key is public)
app.get('/config', (req, res) => {
  res.json({
    supabaseUrl: config.supabase?.url || '',
    supabaseAnonKey: config.supabase?.anonKey || '',
  });
});

// --- Socket.io ---
io.on('connection', async (socket) => {
  const auth = socket.handshake.auth || {};
  let email = null;
  let userId = null;
  if (auth.token && db.isConfigured()) {
    try {
      const { data: { user } } = await db.getUser(auth.token);
      if (user) {
        email = user.email || null;
        userId = user.id || null;
      }
    } catch (_) {}
  }
  clients.set(socket.id, { id: socket.id, joinedAt: Date.now(), email, userId, documentId: null });
  logger.info('connect', socket.id, email || 'anonymous', '| total:', clients.size);

  socket.on('document:join', async (docId) => {
    if (!docId) {
      socket.emit('document:error', { message: 'Document ID required' });
      return;
    }
    const docRow = await db.getDocumentById(docId);
    if (!docRow) {
      socket.emit('document:error', { message: 'Document not found' });
      return;
    }
    let role = null;
    if (docRow.owner_id === userId) {
      role = 'editor';
    } else {
      try {
        role = await db.getDocumentRole(docId, userId);
      } catch (err) {
        logger.error('getDocumentRole', err.message);
      }
      if (!role) {
        const client = clients.get(socket.id);
        const userEmail = client && client.email ? client.email : null;
        if (userEmail) {
          const invite = await db.getPendingInvite(docId, userEmail);
          if (invite) {
            await db.acceptInviteForUser(docId, userId, invite.role, invite.email);
            role = invite.role;
            logger.info('invite accepted', docId, userEmail, role);
          }
        }
      }
    }
    if (!role) {
      socket.emit('document:error', { message: 'You do not have access to this document' });
      return;
    }
    const room = ROOM_PREFIX + docId;
    socket.join(room);
    const client = clients.get(socket.id);
    if (client) client.documentId = docId;
    socket.documentId = docId;
    socket.documentRole = role;

    let state = document.get(docId);
    if (!state) {
      const loaded = await db.loadDocument(docId);
      if (loaded) document.hydrate(docId, loaded.content, loaded.version);
      else document.ensureDoc(docId);
      state = document.get(docId);
    }
    const isOwner = docRow.owner_id === userId;
    socket.emit('document', { ...state, title: docRow.title, id: docId, isOwner, myRole: role });
    broadcastPresenceToRoom(docId);
    const clientInfo = clients.get(socket.id);
    const joinLabel = (clientInfo && clientInfo.email) || 'Someone';
    socket.to(room).emit('presence:user_joined', { email: clientInfo && clientInfo.email, userId, label: joinLabel });
    logger.info('document:join', socket.id, docId, role);
  });

  socket.on('document:get', async () => {
    const docId = socket.documentId;
    if (!docId) return;
    const state = document.get(docId);
    if (!state) return;
    const docRow = await db.getDocumentById(docId);
    const role = docRow ? await db.getDocumentRole(docId, userId) : null;
    const isOwner = docRow ? docRow.owner_id === userId : false;
    socket.emit('document', { ...state, title: docRow?.title, isOwner, myRole: role || socket.documentRole });
  });

  socket.on('history:get', async () => {
    const docId = socket.documentId;
    if (!docId) return;
    const list = db.isConfigured() ? await db.loadHistory(docId, 20) : [];
    socket.emit('history', list);
  });

  socket.on('document:edit', async (payload) => {
    const docId = socket.documentId;
    if (!docId) return;
    const role = socket.documentRole;
    if (role !== 'editor') {
      const latest = document.get(docId);
      socket.emit('document:rejected', { message: role === 'viewer' ? 'You do not have permission to edit (view only)' : 'You do not have access to edit.', document: latest });
      return;
    }
    // STEP 9: rate limit (per userId or socket.id)
    const rateKey = (clients.get(socket.id) && clients.get(socket.id).userId) || socket.id;
    if (!checkRateLimit(rateKey)) {
      const latest = document.get(docId);
      socket.emit('document:rejected', { message: 'Too many edits. Please slow down.', reason: 'rate_limit', document: latest });
      return;
    }
    const content = payload && (typeof payload.content === 'string' ? payload.content : payload);
    const expectedVersion = typeof payload?.version === 'number' ? payload.version : 0;
    const mutex = getDocMutex(docId);
    const release = await mutex.acquire();
    try {
      const current = document.get(docId);
      if (current && current.version === 0 && expectedVersion === 0 && db.isConfigured()) {
        await db.saveHistoryEntry(docId, current.content, 0).catch(() => {});
      }
      const updated = document.applyEdit(docId, content, expectedVersion);
      if (!updated) {
        const latest = document.get(docId);
        socket.emit('document:rejected', { message: 'Your edit was based on an old version — document refreshed.', document: latest });
        return;
      }
      recordEditTimestamp(rateKey);
      const editedBy = getEditedBy(socket.id);
      pushAudit({
        documentId: docId,
        userId: editedBy?.id,
        userEmail: editedBy?.email || null,
        oldVersion: current ? current.version : expectedVersion,
        newVersion: updated.version,
        timestamp: new Date().toISOString(),
        action: 'edit',
      });
      const payloadWithBy = { ...updated, updatedBy: socket.id, editedBy };
      io.to(ROOM_PREFIX + docId).emit('document:updated', payloadWithBy);
      logger.info('document:edit', socket.id, docId, 'v' + updated.version);
      if (db.isConfigured()) {
        const docOk = await db.saveDocument(docId, updated.content, updated.version);
        const historyOk = await db.saveHistoryEntry(docId, updated.content, updated.version);
        if (!docOk || !historyOk) {
          logger.error('supabase save failed');
          socket.emit('document:save-failed', { message: 'Failed to save to database. Try again.' });
        } else {
          db.pruneEditHistory(docId, 20).catch((err) => logger.error('prune history', err.message));
        }
      }
    } finally {
      release();
    }
  });

  socket.on('document:undo', async () => {
    const docId = socket.documentId;
    if (!docId) return;
    const mutex = getDocMutex(docId);
    const release = await mutex.acquire();
    try {
      const current = document.get(docId);
      if (!current || current.version <= 0) {
        socket.emit('document:undo:rejected', { message: 'Nothing to undo' });
        return;
      }
      const prev = db.isConfigured() ? await db.getHistoryVersion(docId, current.version - 1) : null;
      if (!prev) {
        socket.emit('document:undo:rejected', { message: 'Previous version not in history' });
        return;
      }
      const oldVersion = current.version;
      document.restore(docId, prev.content, prev.version);
      const editedBy = getEditedBy(socket.id);
      pushAudit({
        documentId: docId,
        userId: editedBy?.id,
        userEmail: editedBy?.email || null,
        oldVersion,
        newVersion: prev.version,
        timestamp: new Date().toISOString(),
        action: 'undo',
      });
      const payloadWithBy = { ...document.get(docId), updatedBy: socket.id, editedBy };
      io.to(ROOM_PREFIX + docId).emit('document:updated', payloadWithBy);
      if (db.isConfigured()) {
        const ok = await db.saveDocument(docId, prev.content, prev.version);
        if (!ok) {
          logger.error('supabase save (undo) failed');
          socket.emit('document:save-failed', { message: 'Failed to save undo to database.' });
        } else {
          db.pruneEditHistory(docId, 20).catch((err) => logger.error('prune history', err.message));
        }
      }
    } finally {
      release();
    }
  });

  socket.on('document:restore', async (payload) => {
    const docId = socket.documentId;
    if (!docId) return;
    if (socket.documentRole !== 'editor') {
      socket.emit('document:restore:rejected', { message: 'Only editors can restore a version.' });
      return;
    }
    const version = typeof payload?.version === 'number' ? payload.version : null;
    if (version == null) {
      socket.emit('document:restore:rejected', { message: 'Version required' });
      return;
    }
    const mutex = getDocMutex(docId);
    const release = await mutex.acquire();
    try {
      const current = document.get(docId);
      if (!current) {
        socket.emit('document:restore:rejected', { message: 'Document not loaded' });
        return;
      }
      const snapshot = db.isConfigured() ? await db.getHistoryVersion(docId, version) : null;
      if (!snapshot) {
        socket.emit('document:restore:rejected', { message: 'Version not found in history' });
        return;
      }
      const oldVersion = current.version;
      document.restore(docId, snapshot.content, snapshot.version);
      const editedBy = getEditedBy(socket.id);
      pushAudit({
        documentId: docId,
        userId: editedBy?.id,
        userEmail: editedBy?.email || null,
        oldVersion,
        newVersion: snapshot.version,
        timestamp: new Date().toISOString(),
        action: 'restore',
      });
      const payloadWithBy = { ...document.get(docId), updatedBy: socket.id, editedBy };
      io.to(ROOM_PREFIX + docId).emit('document:updated', payloadWithBy);
      if (db.isConfigured()) {
        const ok = await db.saveDocument(docId, snapshot.content, snapshot.version);
        if (!ok) {
          logger.error('supabase save (restore) failed');
          socket.emit('document:save-failed', { message: 'Failed to save restored version.' });
        } else {
          db.pruneEditHistory(docId, 20).catch((err) => logger.error('prune history', err.message));
        }
      }
    } finally {
      release();
    }
  });

  socket.on('disconnect', (reason) => {
    const docId = socket.documentId;
    const leaving = clients.get(socket.id);
    const leaveLabel = (leaving && leaving.email) || 'Someone';
    clients.delete(socket.id);
    if (docId) {
      io.to(ROOM_PREFIX + docId).emit('presence:user_left', { email: leaving && leaving.email, label: leaveLabel });
      broadcastPresenceToRoom(docId);
    }
    logger.info('disconnect', socket.id, 'reason:', reason);
  });
});

// STEP 10: Auto-snapshot timer — every X min write current doc state to edit_history (source: 'auto')
const AUTO_SNAPSHOT_MS = config.autoSnapshotIntervalMinutes * 60 * 1000;
setInterval(async () => {
  if (!db.isConfigured()) return;
  const docIds = document.getAllDocIds();
  for (const docId of docIds) {
    const state = document.get(docId);
    if (!state || (state.content === '' && state.version === 0)) continue;
    try {
      await db.saveHistoryEntry(docId, state.content, state.version, 'auto');
      await db.pruneEditHistory(docId, 20);
    } catch (err) {
      logger.error('auto-snapshot', docId, err.message);
    }
  }
}, AUTO_SNAPSHOT_MS);
logger.info('auto-snapshot interval', config.autoSnapshotIntervalMinutes, 'min');

// --- Start ---
server.listen(config.port, () => {
  logger.info('Server listening on http://localhost:' + config.port);
  logger.info('Health: GET http://localhost:' + config.port + '/health');
  logger.info('Socket.io ready for connections');
  if (!db.isConfigured()) logger.info('Supabase not configured — set SUPABASE_* and run supabase-schema-multi-doc.sql');
});
