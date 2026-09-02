// Research-owned persistence that links a chat-side knowledge base ask to the
// chat session history it belongs to. The studio `messages` table has no
// metadata column, so instead of extending the base message model the
// research domain keeps its own binding rows in rag.db: question id ↔ session
// id ↔ the server message row ids. The client hydrates citations (stored with
// the rag question) onto the assistant message through these bindings.
import { getRagDb } from './rag-store'

export const CHAT_ASKS_TABLE = 'rag_chat_asks'

export const CHAT_ASK_STATUSES = ['pending', 'answered', 'failed'] as const
export type ChatAskStatus = (typeof CHAT_ASK_STATUSES)[number]

export interface RagChatAskRecord {
  question_id: string
  session_id: string
  /** Server message row id (as string) of the persisted user question. */
  user_message_id: string
  /** Server message row id (as string) of the persisted assistant answer; null until answered or when the ask failed. */
  assistant_message_id: string | null
  status: ChatAskStatus
  error: string | null
  created_at: number
  updated_at: number
}

export interface RagChatAskCreateInput {
  question_id: string
  session_id: string
  user_message_id: string | number
}

export interface RagChatAskPatch {
  status?: ChatAskStatus
  assistant_message_id?: string | null
  error?: string | null
}

interface ChatAskRow {
  question_id: string
  session_id: string
  user_message_id: string
  assistant_message_id: string | null
  status: string
  error: string | null
  created_at: number
  updated_at: number
}

let tableReady = false

function ensureChatAsksTable(): void {
  if (tableReady) return
  getRagDb().exec(`CREATE TABLE IF NOT EXISTS ${CHAT_ASKS_TABLE} (
    question_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_message_id TEXT NOT NULL,
    assistant_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  getRagDb().exec(`CREATE INDEX IF NOT EXISTS idx_rag_chat_asks_session ON ${CHAT_ASKS_TABLE}(session_id, created_at)`)
  tableReady = true
}

function rowToChatAsk(row: ChatAskRow): RagChatAskRecord {
  const status = String(row.status || 'pending') as ChatAskStatus
  return {
    question_id: String(row.question_id || ''),
    session_id: String(row.session_id || ''),
    user_message_id: String(row.user_message_id || ''),
    assistant_message_id: row.assistant_message_id == null || row.assistant_message_id === ''
      ? null
      : String(row.assistant_message_id),
    status: CHAT_ASK_STATUSES.includes(status) ? status : 'pending',
    error: row.error == null || row.error === '' ? null : String(row.error),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }
}

export function insertChatAsk(input: RagChatAskCreateInput): RagChatAskRecord {
  ensureChatAsksTable()
  const now = Date.now()
  const record: RagChatAskRecord = {
    question_id: input.question_id,
    session_id: input.session_id,
    user_message_id: String(input.user_message_id),
    assistant_message_id: null,
    status: 'pending',
    error: null,
    created_at: now,
    updated_at: now,
  }
  getRagDb().prepare(`
    INSERT INTO ${CHAT_ASKS_TABLE} (
      question_id, session_id, user_message_id, assistant_message_id, status, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.question_id,
    record.session_id,
    record.user_message_id,
    record.assistant_message_id,
    record.status,
    record.error,
    record.created_at,
    record.updated_at,
  )
  return record
}

export function getChatAsk(questionId: string): RagChatAskRecord | null {
  ensureChatAsksTable()
  const row = getRagDb()
    .prepare(`SELECT * FROM ${CHAT_ASKS_TABLE} WHERE question_id = ?`)
    .get(questionId) as ChatAskRow | undefined
  return row ? rowToChatAsk(row) : null
}

export function listSessionChatAsks(sessionId: string): RagChatAskRecord[] {
  ensureChatAsksTable()
  const rows = getRagDb()
    .prepare(`SELECT * FROM ${CHAT_ASKS_TABLE} WHERE session_id = ? ORDER BY created_at ASC, question_id ASC`)
    .all(sessionId) as unknown as ChatAskRow[]
  return rows.map(rowToChatAsk)
}

/**
 * Conditional patch used as an idempotency guard for finalization: only the
 * first caller that transitions the row out of 'pending' may append messages.
 * Returns the updated record, or null when the guard did not match.
 */
export function updateChatAskIfPending(
  questionId: string,
  patch: RagChatAskPatch,
): RagChatAskRecord | null {
  ensureChatAsksTable()
  const now = Date.now()
  const result = getRagDb()
    .prepare(`
      UPDATE ${CHAT_ASKS_TABLE}
      SET status = ?,
          assistant_message_id = ?,
          error = ?,
          updated_at = ?
      WHERE question_id = ? AND status = 'pending'
    `)
    .run(
      patch.status ?? 'pending',
      patch.assistant_message_id ?? null,
      patch.error ?? null,
      now,
      questionId,
    )
  if (Number(result.changes) === 0) return null
  return getChatAsk(questionId)
}
