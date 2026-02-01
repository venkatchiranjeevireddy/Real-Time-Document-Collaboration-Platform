/**
 * Supabase: multi-document support.
 * documents(id UUID, owner_id, title, content, version, ...)
 * edit_history(document_id UUID, version, content, ...)
 * Server uses admin client for document CRUD (bypasses RLS).
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client = null;
let adminClient = null;

function getClient() {
  if (!client) {
    const { url, anonKey } = config.supabase;
    if (!url || !anonKey) return null;
    client = createClient(url, anonKey);
  }
  return client;
}

function getAdminClient() {
  if (!adminClient) {
    const { url, serviceRoleKey } = config.supabase;
    if (!url || !serviceRoleKey) return null;
    adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return adminClient;
}

function isConfigured() {
  return !!(config.supabase.url && config.supabase.anonKey);
}

// --- Documents (multi-doc; use admin so we can list/create by owner_id) ---

/** List docs: owned + shared (document_members) + invited (document_invites by email). userEmail optional for invited. */
async function listDocuments(userId, userEmail) {
  const supabase = getAdminClient();
  if (!supabase || !userId) return [];

  const { data: owned, error: e1 } = await supabase
    .from('documents')
    .select('id, title, content, version, created_at, updated_at, owner_id')
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false });
  if (e1) {
    console.error('[supabase] listDocuments owned error:', e1.message);
    return [];
  }
  const ownedList = (owned || []).map((d) => ({ ...d, isOwner: true, isInvited: false }));

  const { data: shared, error: e2 } = await supabase
    .from('document_members')
    .select('document_id')
    .eq('user_id', userId);
  let sharedList = [];
  if (!e2 && shared && shared.length > 0) {
    const sharedIds = shared.map((r) => r.document_id);
    const { data: sharedDocs, error: e3 } = await supabase
      .from('documents')
      .select('id, title, content, version, created_at, updated_at, owner_id')
      .in('id', sharedIds);
    if (!e3 && sharedDocs) {
      sharedList = sharedDocs
        .filter((d) => !ownedList.some((o) => o.id === d.id))
        .map((d) => ({ ...d, isOwner: false, isInvited: false }));
    }
  }

  let invitedList = [];
  if (userEmail) {
    const invitedIds = await getInvitedDocIdsByEmail(userEmail);
    if (invitedIds.length > 0) {
      const { data: invitedDocs, error: e4 } = await supabase
        .from('documents')
        .select('id, title, content, version, created_at, updated_at, owner_id')
        .in('id', invitedIds);
      if (!e4 && invitedDocs) {
        invitedList = invitedDocs
          .filter((d) => !ownedList.some((o) => o.id === d.id) && !sharedList.some((s) => s.id === d.id))
          .map((d) => ({ ...d, isOwner: false, isInvited: true }));
      }
    }
  }

  const combined = [...ownedList, ...sharedList, ...invitedList];
  combined.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return combined;
}

async function createDocument(ownerId, title = 'Untitled') {
  const supabase = getAdminClient();
  if (!supabase || !ownerId) return { data: null, error: new Error('Not configured') };

  const { data, error } = await supabase
    .from('documents')
    .insert({ owner_id: ownerId, title: title.trim() || 'Untitled' })
    .select('id, title, version, created_at')
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

async function getDocumentById(docId) {
  const supabase = getAdminClient();
  if (!supabase || !docId) return null;

  const { data, error } = await supabase
    .from('documents')
    .select('id, owner_id, title, content, version, updated_at')
    .eq('id', docId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function loadDocument(docId) {
  const doc = await getDocumentById(docId);
  if (!doc) return null;
  return { content: doc.content || '', version: doc.version ?? 0, title: doc.title };
}

async function updateDocumentTitle(docId, title, userId) {
  const supabase = getAdminClient();
  if (!supabase || !docId || !userId) return false;
  const doc = await getDocumentById(docId);
  if (!doc || doc.owner_id !== userId) return false;
  const { error } = await supabase
    .from('documents')
    .update({ title: (title || '').trim() || 'Untitled', updated_at: new Date().toISOString() })
    .eq('id', docId);
  return !error;
}

async function deleteDocument(docId, userId) {
  const supabase = getAdminClient();
  if (!supabase || !docId || !userId) return false;
  const doc = await getDocumentById(docId);
  if (!doc || doc.owner_id !== userId) return false;
  const { error } = await supabase.from('documents').delete().eq('id', docId);
  return !error;
}

/** STEP 3: Get user's role for a document. Owner = editor; else from document_members. Returns 'editor' | 'viewer' | null (no access). */
async function getDocumentRole(docId, userId) {
  if (!docId || !userId) return null;
  const doc = await getDocumentById(docId);
  if (!doc) return null;
  if (doc.owner_id === userId) return 'editor';
  const supabase = getAdminClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('document_members')
    .select('role')
    .eq('document_id', docId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.role === 'editor' || data.role === 'viewer' ? data.role : null;
}

/** STEP 4: Get pending invite for doc + email (accepted_at is null). */
async function getPendingInvite(docId, userEmail) {
  const supabase = getAdminClient();
  if (!supabase || !docId || !userEmail) return null;
  const { data, error } = await supabase
    .from('document_invites')
    .select('id, document_id, email, role, invited_by')
    .eq('document_id', docId)
    .ilike('email', userEmail.trim().toLowerCase())
    .is('accepted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** STEP 4: Accept invite — add user to document_members, set accepted_at on invite row (by docId + inviteEmail). */
async function acceptInviteForUser(docId, userId, role, inviteEmail) {
  const supabase = getAdminClient();
  if (!supabase || !docId || !userId || !role || !inviteEmail) return false;
  const { error: insertErr } = await supabase
    .from('document_members')
    .upsert({ document_id: docId, user_id: userId, role }, { onConflict: 'document_id,user_id' });
  if (insertErr) {
    console.error('[supabase] acceptInvite members', insertErr.message);
    return false;
  }
  const { error: updateErr } = await supabase
    .from('document_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('document_id', docId)
    .ilike('email', inviteEmail.trim().toLowerCase());
  if (updateErr) console.error('[supabase] acceptInvite accepted_at', updateErr.message);
  return true;
}

/** STEP 4: Create invite (owner only). */
async function createInvite(docId, email, role, invitedByUserId) {
  const supabase = getAdminClient();
  if (!supabase || !docId || !email || !invitedByUserId) return { data: null, error: new Error('Missing params') };
  const doc = await getDocumentById(docId);
  if (!doc || doc.owner_id !== invitedByUserId) return { data: null, error: new Error('Not owner') };
  const { data, error } = await supabase
    .from('document_invites')
    .upsert(
      { document_id: docId, email: email.trim().toLowerCase(), role: role === 'editor' ? 'editor' : 'viewer', invited_by: invitedByUserId },
      { onConflict: 'document_id,email' }
    )
    .select('id, document_id, email, role, created_at')
    .single();
  if (error) return { data: null, error };
  return { data, error: null };
}

/** STEP 4: List doc IDs where user (by email) has pending invite. */
async function getInvitedDocIdsByEmail(userEmail) {
  const supabase = getAdminClient();
  if (!supabase || !userEmail) return [];
  const { data, error } = await supabase
    .from('document_invites')
    .select('document_id')
    .ilike('email', userEmail.trim().toLowerCase())
    .is('accepted_at', null);
  if (error || !data) return [];
  return [...new Set(data.map((r) => r.document_id))];
}

async function saveDocument(docId, content, version) {
  const supabase = getAdminClient();
  if (!supabase || !docId) return false;

  const { error } = await supabase
    .from('documents')
    .update({ content: content ?? '', version: version ?? 0, updated_at: new Date().toISOString() })
    .eq('id', docId);

  if (error) {
    console.error('[supabase] save error:', error.message);
    return false;
  }
  return true;
}

/** Save history entry. source: 'auto' for STEP 10 auto-snapshots; omit for user edits. */
async function saveHistoryEntry(docId, content, version, source = null) {
  const supabase = getAdminClient();
  if (!supabase || !docId) return false;

  const row = {
    document_id: docId,
    version: version ?? 0,
    content: content ?? '',
  };
  if (source != null) row.source = source;

  let result = await supabase.from('edit_history').insert(row);
  if (result.error && source != null && /source|column/i.test(result.error.message)) {
    delete row.source;
    result = await supabase.from('edit_history').insert(row);
  }
  if (result.error) {
    console.error('[supabase] history save error:', result.error.message);
    return false;
  }
  return true;
}

async function loadHistory(docId, limit = 50) {
  const supabase = getAdminClient();
  if (!supabase || !docId) return [];

  const { data, error } = await supabase
    .from('edit_history')
    .select('version, content, created_at')
    .eq('document_id', docId)
    .order('version', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[supabase] history load error:', error.message);
    return [];
  }
  return data || [];
}

/** STEP 8: Keep only last keepLast history rows per document; delete older. */
async function pruneEditHistory(docId, keepLast = 20) {
  const supabase = getAdminClient();
  if (!supabase || !docId) return;

  const { data: versions, error: selectErr } = await supabase
    .from('edit_history')
    .select('version')
    .eq('document_id', docId)
    .order('version', { ascending: false })
    .limit(keepLast + 1);

  if (selectErr || !versions || versions.length <= keepLast) return;
  const minVersionToKeep = versions[keepLast - 1].version;
  await supabase
    .from('edit_history')
    .delete()
    .eq('document_id', docId)
    .lt('version', minVersionToKeep);
}

async function getHistoryVersion(docId, version) {
  const supabase = getAdminClient();
  if (!supabase || !docId) return null;

  const { data, error } = await supabase
    .from('edit_history')
    .select('content, version')
    .eq('document_id', docId)
    .eq('version', version)
    .maybeSingle();

  if (error || !data) return null;
  return { content: data.content || '', version: data.version };
}

// --- Auth (anon client for getUser; admin for createUser, listUsers) ---

async function getUser(jwt) {
  const supabase = getClient();
  if (!supabase) return { data: { user: null }, error: new Error('Supabase not configured') };
  return supabase.auth.getUser(jwt);
}

async function getUserByEmail(email) {
  const admin = getAdminClient();
  if (!admin) return null;
  const { data: { users } } = await admin.auth.admin.listUsers(1000);
  const user = (users || []).find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase());
  return user || null;
}

async function createUserWithEmail(email, password) {
  const admin = getAdminClient();
  if (!admin) return { data: { user: null }, error: new Error('Supabase admin not configured') };
  return admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  });
}

module.exports = {
  isConfigured,
  getClient,
  getAdminClient,
  listDocuments,
  createDocument,
  getDocumentById,
  getDocumentRole,
  getPendingInvite,
  acceptInviteForUser,
  createInvite,
  getInvitedDocIdsByEmail,
  loadDocument,
  saveDocument,
  saveHistoryEntry,
  updateDocumentTitle,
  deleteDocument,
  loadHistory,
  getHistoryVersion,
  pruneEditHistory,
  getUser,
  getUserByEmail,
  createUserWithEmail,
};
