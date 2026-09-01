import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DB_INDEX_MODULE = '../../packages/server/src/modules/studio/infrastructure/database/index'
const SCHEMAS_MODULE = '../../packages/server/src/modules/studio/infrastructure/database/schemas'
const RUN_STORE_MODULE = '../../packages/server/src/modules/studio/repositories/workflow-run-store'

type DbIndexModule = typeof import('../../packages/server/src/modules/studio/infrastructure/database/index')
type RunStoreModule = typeof import('../../packages/server/src/modules/studio/repositories/workflow-run-store')

const originalTestDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR

function restoreTestDbDir(): void {
  if (originalTestDbDir === undefined) delete process.env.HERMES_WEB_UI_TEST_DB_DIR
  else process.env.HERMES_WEB_UI_TEST_DB_DIR = originalTestDbDir
}

async function rmTempDirWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch {
      // Windows file handles can linger briefly after closeDb; retry shortly.
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

afterAll(restoreTestDbDir)

describe('workflow run node session output_json column (fresh database)', () => {
  let testRoot = ''
  let dbModule: DbIndexModule
  let runStore: RunStoreModule

  beforeEach(async () => {
    vi.resetModules()
    testRoot = mkdtempSync(join(tmpdir(), 'workflow-run-output-column-'))
    process.env.HERMES_WEB_UI_TEST_DB_DIR = join(testRoot, 'db')
    dbModule = await import(DB_INDEX_MODULE)
    runStore = await import(RUN_STORE_MODULE)
    const schemas = await import(SCHEMAS_MODULE)
    schemas.initAllHermesTables()
  })

  afterEach(async () => {
    dbModule.closeDb()
    restoreTestDbDir()
    await rmTempDirWithRetry(testRoot)
    testRoot = ''
    vi.resetModules()
  })

  function createIsolatedRunSession(nodeId: string) {
    const run = runStore.createWorkflowRun({ workflow_id: 'wf-output-column' })
    return {
      run,
      session: runStore.createWorkflowRunNodeSession({
        run_id: run.id,
        workflow_id: run.workflow_id,
        node_id: nodeId,
        session_id: '',
      }),
    }
  }

  it('creates the output_json column with an empty-string default on new databases', () => {
    const db = dbModule.getDb()
    expect(db).not.toBeNull()

    const columns = db!.prepare('PRAGMA table_info(workflow_run_node_sessions)').all() as Array<{ name: string; dflt_value: unknown }>
    const outputColumn = columns.find(column => column.name === 'output_json')
    expect(outputColumn).toBeDefined()
    expect(outputColumn!.dflt_value).toBe("''")
  })

  it('reads back an empty output_json right after create', () => {
    const { run, session } = createIsolatedRunSession('node-create')

    expect(session.output_json).toBe('')

    const readBack = runStore.getWorkflowRunNodeSession(session.id)
    expect(readBack).not.toBeNull()
    expect(readBack!.run_id).toBe(run.id)
    expect(readBack!.output_json).toBe('')
  })

  it('persists output_json when the optional update parameter is provided', () => {
    const { session } = createIsolatedRunSession('node-update')

    const updated = runStore.updateWorkflowRunNodeSession(session.id, { outputJson: '{"stdout":"ok"}' })
    expect(updated).not.toBeNull()
    expect(updated!.output_json).toBe('{"stdout":"ok"}')
    expect(runStore.getWorkflowRunNodeSession(session.id)!.output_json).toBe('{"stdout":"ok"}')
  })

  it('leaves output_json and non-timestamp fields untouched when the update parameter is omitted', () => {
    const { session } = createIsolatedRunSession('node-noop')

    runStore.updateWorkflowRunNodeSession(session.id, { outputJson: '{"result":1}' })
    const before = runStore.getWorkflowRunNodeSession(session.id)!

    const after = runStore.updateWorkflowRunNodeSession(session.id, {
      status: 'completed',
      finished_at: 2000,
      error: null,
    })!

    expect(after.output_json).toBe('{"result":1}')
    expect(after.status).toBe('completed')
    expect(after.finished_at).toBe(2000)
    // Everything except updated_at keeps its previous value.
    expect(after.started_at).toBe(before.started_at)
    expect(after.run_id).toBe(before.run_id)
    expect(after.workflow_id).toBe(before.workflow_id)
    expect(after.node_id).toBe(before.node_id)
    expect(after.session_id).toBe(before.session_id)
    expect(after.error).toBe(before.error)

    const row = dbModule.getDb()!
      .prepare('SELECT output_json FROM workflow_run_node_sessions WHERE id = ?')
      .get(session.id) as { output_json: string }
    expect(row.output_json).toBe('{"result":1}')
  })
})

describe('workflow run node session output_json column (legacy database upgrade)', () => {
  // Mirror of WORKFLOW_RUN_NODE_SESSIONS_SCHEMA before output_json existed,
  // already carrying the post-migration run_execution unique index.
  let db: import('node:sqlite').DatabaseSync | null = null

  afterEach(() => {
    db?.close()
    db = null
    vi.doUnmock(DB_INDEX_MODULE)
    vi.resetModules()
  })

  it('adds output_json via migration while preserving existing rows', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE workflow_run_node_sessions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        execution_id TEXT NOT NULL DEFAULT '',
        iteration_path_json TEXT NOT NULL DEFAULT '[]',
        consumed_edge_evaluation_ids_json TEXT NOT NULL DEFAULT '[]',
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT 'default',
        agent TEXT NOT NULL DEFAULT '',
        agent_mode TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        sequence INTEGER NOT NULL DEFAULT 0,
        remaining_timeout_ms_at_start INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error TEXT
      );
      INSERT INTO workflow_run_node_sessions (
        id, run_id, workflow_id, node_id, execution_id, session_id, agent, status, sequence, created_at, updated_at
      ) VALUES ('legacy-node', 'legacy-run', 'legacy-wf', 'node-a', 'node-a', 'sess-legacy', 'hermes', 'completed', 1, 1000, 2000);
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_workflow_run_node_sessions_run_execution
        ON workflow_run_node_sessions(run_id, execution_id);
    `)
    vi.doMock(DB_INDEX_MODULE, () => ({
      getDb: () => db,
      getStoragePath: () => ':memory:',
      isSqliteAvailable: () => true,
      jsonGet: () => undefined,
      jsonGetAll: () => ({}),
      jsonSet: () => {},
      jsonDelete: () => {},
      closeDb: () => {},
    }))

    const runStore: RunStoreModule = await import(RUN_STORE_MODULE)
    const { initAllHermesTables } = await import(SCHEMAS_MODULE)
    initAllHermesTables()

    const columnNames = (db.prepare('PRAGMA table_info(workflow_run_node_sessions)').all() as Array<{ name: string }>)
      .map(column => column.name)
    expect(columnNames).toContain('output_json')

    const legacyRow = db.prepare('SELECT output_json FROM workflow_run_node_sessions WHERE id = ?').get('legacy-node') as { output_json: string }
    expect(legacyRow.output_json).toBe('')

    const legacy = runStore.getWorkflowRunNodeSession('legacy-node')
    expect(legacy).toMatchObject({
      id: 'legacy-node',
      run_id: 'legacy-run',
      workflow_id: 'legacy-wf',
      node_id: 'node-a',
      session_id: 'sess-legacy',
      agent: 'hermes',
      status: 'completed',
      sequence: 1,
      created_at: 1000,
      updated_at: 2000,
      output_json: '',
    })

    const updated = runStore.updateWorkflowRunNodeSession('legacy-node', { outputJson: '{"render":"done"}' })
    expect(updated).not.toBeNull()
    expect(updated!.output_json).toBe('{"render":"done"}')
    expect(runStore.getWorkflowRunNodeSession('legacy-node')!.output_json).toBe('{"render":"done"}')
  })
})
