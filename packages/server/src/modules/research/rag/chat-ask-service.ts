// Chat knowledge base ask bindings: the glue between the cited Q&A pipeline
// (rag questions) and the studio chat session history. The studio message
// model has no metadata field, so the binding rows ARE the persisted citation
// traceability: question id ↔ session id ↔ server message row ids. The client
// hydrates citations onto assistant messages through these rows.
//
// Session history writes go through the Studio public facade only
// (`studio/public/sessions`), the same narrow surface the coding-agents
// domain uses — never the run-chat pipeline or Studio repositories directly.
import {
  addMessage,
  createSession,
  getSession,
  updateSessionStats,
} from '../../studio/public/sessions'
import { getQuestion, type RagQuestionRecord } from './rag-store'
import {
  getChatAsk,
  insertChatAsk,
  listSessionChatAsks,
  updateChatAskIfPending,
  type RagChatAskRecord,
} from './chat-ask-store'

export interface RagChatAskView {
  questionId: string
  sessionId: string
  status: RagChatAskRecord['status']
  userMessageId: string
  assistantMessageId: string | null
  error: string | null
  /** Hydrated from the rag question record so the client can render immediately. */
  question: string
  answer: string | null
  citations: RagQuestionRecord['citations']
  collectionId: string
}

function toSecondsTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Persist the user-side half of a chat ask: make sure the server session row
 * exists (client-created sessions only reach the database on first use),
 * append the question as a user message, and refresh the session stats so the
 * session list reflects the new activity. Returns the server message row id,
 * or null when persistence is unavailable (no SQLite).
 */
export function beginChatAsk(input: {
  sessionId: string
  profile: string
  question: string
}): { userMessageId: number | null } {
  ensureChatAskSession(input.sessionId, input.profile, input.question)
  const inserted = addMessage({
    session_id: input.sessionId,
    role: 'user',
    content: input.question,
    timestamp: toSecondsTimestamp(),
  })
  if (inserted == null) return { userMessageId: null }
  updateSessionStats(input.sessionId)
  return { userMessageId: inserted }
}

/** Record the session linkage for a freshly enqueued chat ask. */
export function recordChatAsk(input: {
  questionId: string
  sessionId: string
  userMessageId: number | string
}): RagChatAskRecord {
  return insertChatAsk({
    question_id: input.questionId,
    session_id: input.sessionId,
    user_message_id: input.userMessageId,
  })
}

/**
 * Persist the assistant-side outcome of a chat ask into the session history.
 * Called from the serial ask worker after the question reaches a terminal
 * state; the `updateChatAskIfPending` guard makes a repeated call (worker
 * retry, read-path heal) a no-op instead of a duplicated answer message.
 *
 * Failure semantics mirror the pre-persistence behavior: a failed ask is NOT
 * written into the chat history as a message — the client keeps rendering the
 * transient in-chat error and the question stays unanswered after a reload.
 */
export function finalizeChatAsk(questionId: string): RagChatAskRecord | null {
  const ask = getChatAsk(questionId)
  if (!ask || ask.status !== 'pending') return ask
  const question = getQuestion(questionId)
  if (!question) return ask
  if (question.status !== 'answered' && question.status !== 'failed') return ask

  let assistantMessageId: string | null = null
  if (question.status === 'answered') {
    const answer = (question.answer || '').trim()
    if (answer) {
      const inserted = addMessage({
        session_id: ask.session_id,
        role: 'assistant',
        content: answer,
        timestamp: toSecondsTimestamp(),
      })
      assistantMessageId = inserted == null ? null : String(inserted)
      updateSessionStats(ask.session_id)
    }
  }
  return updateChatAskIfPending(questionId, {
    status: question.status,
    assistant_message_id: assistantMessageId,
    error: question.error,
  })
}

function toChatAskView(ask: RagChatAskRecord, question: RagQuestionRecord | null): RagChatAskView {
  return {
    questionId: ask.question_id,
    sessionId: ask.session_id,
    status: ask.status,
    userMessageId: ask.user_message_id,
    assistantMessageId: ask.assistant_message_id,
    error: ask.error,
    question: question?.question || '',
    answer: question?.answer ?? null,
    citations: question?.citations ?? [],
    collectionId: question?.collection_id || '',
  }
}

/**
 * Read one chat ask with its question hydrated. A binding left 'pending'
 * while its question already failed (e.g. the server restarted mid-ask and
 * the startup cleanup failed the question) is healed here: no message side
 * effects are needed for failures, so marking the row failed is idempotent
 * and safe even if the worker never got the chance.
 */
export function getChatAskView(questionId: string): RagChatAskView | null {
  const ask = getChatAsk(questionId)
  if (!ask) return null
  const question = getQuestion(questionId)
  if (ask.status === 'pending' && question?.status === 'failed') {
    const healed = updateChatAskIfPending(questionId, {
      status: 'failed',
      assistant_message_id: null,
      error: question.error,
    })
    return toChatAskView(healed ?? ask, question)
  }
  return toChatAskView(ask, question)
}

/** All chat ask bindings for a session, oldest first — the hydrate feed. */
export function listSessionChatAskViews(sessionId: string): RagChatAskView[] {
  return listSessionChatAsks(sessionId).map(ask => toChatAskView(ask, getQuestion(ask.question_id)))
}

/**
 * Make sure the server-side session row exists before messages are appended.
 * A brand-new chat session is created client-side (isLocalOnly) and only
 * reaches the database on first use — the run pipeline does exactly this in
 * handle-bridge-run; the chat ask orchestration follows the same precedent.
 */
export function ensureChatAskSession(sessionId: string, profile: string, question: string): { existed: boolean } {
  if (getSession(sessionId)) return { existed: true }
  const preview = question.replace(/\s+/g, ' ').trim()
  const title = preview.length > 40 ? `${preview.slice(0, 40)}...` : preview
  createSession({ id: sessionId, profile: profile || 'default', title, source: 'api_server' })
  return { existed: false }
}
