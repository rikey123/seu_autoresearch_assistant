import { expect, test } from '@playwright/test'
import { authenticate, mockHermesApi, TEST_ACCESS_KEY } from './fixtures'

const now = Math.floor(Date.now() / 1000)

test('paper library lists imported PDFs and opens the preview route', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockHermesApi(page)

  await page.route(/\/api\/studio\/research\/library\/papers(?:\/|\?|$)/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET' && /\/papers$/.test(pathname)) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          papers: [{
            id: 'paper-1', title: 'Attention Is All You Need', original_name: 'attention.pdf',
            file_size: 1234567, created_at: now, tags: ['nlp'],
          }],
        }),
      })
      return
    }
    if (pathname === '/api/studio/research/library/papers/paper-1') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          paper: { id: 'paper-1', title: 'Attention Is All You Need', original_name: 'attention.pdf', file_size: 1234567, created_at: now, tags: ['nlp'] },
        }),
      })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'not found' }), status: 404 })
  })

  await page.goto('/#/research/papers')
  await expect(page.getByText('Attention Is All You Need', { exact: true })).toBeVisible()
  await expect(page.getByText('attention.pdf', { exact: true })).toBeVisible()
  await expect(page.getByText('nlp', { exact: true })).toBeVisible()

  await page.getByText('Attention Is All You Need', { exact: true }).click()
  await expect(page).toHaveURL(/#\/research\/papers\/paper-1/)
  const previewFrame = page.locator('iframe')
  await expect(previewFrame).toHaveAttribute(
    'src',
    /\/api\/studio\/research\/library\/papers\/paper-1\/file/,
  )
  expect(api.unexpectedRequests).toEqual([])
})

test('latex editor surfaces compile errors on the panel and jumps to the line', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockHermesApi(page)

  const source = '\\documentclass{article}\n\\begin{document}\n\\brokenmacro\n\\end{document}\n'
  await page.route(/\/api\/studio\/research\/latex(?:\/|\?|$)/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/studio/research/latex/engine') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ engine: { available: true, source: 'path', bin: 'tectonic' } }),
      })
      return
    }
    if (pathname === '/api/studio/research/latex/documents') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ documents: [{ id: 'doc-1', title: 'Intro', project_id: null, created_at: now, updated_at: now }] }),
      })
      return
    }
    if (pathname === '/api/studio/research/latex/documents/doc-1') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ document: { id: 'doc-1', title: 'Intro', project_id: null, created_at: now, updated_at: now, source } }),
      })
      return
    }
    if (pathname === '/api/studio/research/latex/documents/doc-1/compilations/latest') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          compilation: {
            id: 'comp-1', document_id: 'doc-1', status: 'failed', engine: 'tectonic', exit_code: 1,
            artifact_id: null, errors: [{ file: 'doc-1.tex', line: 3, message: 'Undefined control sequence.' }],
            log: 'error: doc-1.tex:3', created_at: now, updated_at: now, started_at: now, finished_at: now,
          },
        }),
      })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'not found' }), status: 404 })
  })

  await page.goto('/#/research/latex')
  await page.getByText('Intro', { exact: true }).click()
  await page.getByText('Undefined control sequence.', { exact: true }).click()

  await expect(page.locator('.error-item.active')).toBeVisible()
  const selectionStart = await page.locator('textarea').evaluate((el: HTMLTextAreaElement) => {
    if (el.selectionStart === el.selectionEnd) return { start: el.selectionStart, end: el.selectionEnd }
    return { start: el.selectionStart, end: el.selectionEnd }
  })
  expect(selectionStart.start).toBeGreaterThan(0)
  expect(selectionStart.end).toBeGreaterThan(selectionStart.start)
  expect(api.unexpectedRequests).toEqual([])
})

test('knowledge base ask returns an answer with citations and navigates to the paper', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockHermesApi(page)
  let asked = false

  const collection = {
    id: 'kb-1', name: 'Deep Learning', description: 'Transformer era', index_status: 'indexed',
    paper_count: 1, chunks: 120, engine: 'paper-qa', indexed_at: now, updated_at: now,
  }
  await page.route(/\/api\/studio\/research\/rag(?:\/|\?|$)/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/studio/research/rag/collections' && request.method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collections: [collection] }) })
      return
    }
    if (pathname === '/api/studio/research/rag/collections/kb-1/papers') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ members: [{ paper_id: 'paper-1', title: 'Attention Is All You Need', original_name: 'attention.pdf', file_exists: true }] }),
      })
      return
    }
    if (pathname === '/api/studio/research/rag/collections/kb-1/history') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ history: [] }) })
      return
    }
    if (pathname === '/api/studio/research/rag/collections/kb-1/index') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ latest_index_job: null }) })
      return
    }
    if (pathname === '/api/studio/research/rag/collections/kb-1') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collection }) })
      return
    }
    if (pathname === '/api/studio/research/rag/collections/kb-1/ask' && request.method() === 'POST') {
      asked = true
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ question: { id: 'q-1', status: 'queued', question: 'What is a transformer?', answer: '', citations: [] } }),
      })
      return
    }
    if (pathname === '/api/studio/research/rag/questions/q-1') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          question: {
            id: 'q-1', status: 'answered', question: 'What is a transformer?',
            answer: 'The transformer is a sequence model that relies on self-attention.',
            citations: [{ paperId: 'paper-1', page: 3, snippet: 'we propose the Transformer' }],
          },
        }),
      })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'not found' }), status: 404 })
  })
  await page.route(/\/api\/studio\/research\/library\/papers(?:\/|\?|$)/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/studio/research/library/papers' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ papers: [{ id: 'paper-1', title: 'Attention Is All You Need', original_name: 'attention.pdf', file_size: 123, created_at: now, tags: [] }] }),
      })
      return
    }
    if (pathname === '/api/studio/research/library/papers/paper-1/file') {
      await route.fulfill({ contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n') })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'not found' }), status: 404 })
  })

  await page.goto('/#/research/knowledge')
  await expect(page.getByText('Deep Learning', { exact: true })).toBeVisible()
  await page.locator('.collection-main').first().click()
  await expect(page.getByText('Attention Is All You Need', { exact: true })).toBeVisible()

  await page.locator('textarea').fill('What is a transformer?')
  await page.getByRole('button', { name: 'Ask' }).click()
  expect(asked).toBe(true)

  await expect(page.getByText('The transformer is a sequence model that relies on self-attention.')).toBeVisible()
  await expect(page.getByText(/p\.\s*3/)).toBeVisible()
  await expect(page.getByText('we propose the Transformer')).toBeVisible()

  await page.locator('.citation-item').first().click()
  await expect(page).toHaveURL(/#\/research\/papers\/paper-1/)
  expect(api.unexpectedRequests).toEqual([])
})

test('workflow run completion fires a system notification with the workflow name', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockHermesApi(page, {
    workflows: [{
      id: 'wf-1', name: 'Nightly Review', profile: 'research', workspace: null,
      nodes: [{
        id: 'agent', type: 'agent', position: { x: 80, y: 80 },
        data: { title: 'Agent', agent: 'hermes', input: 'Run', skills: [], images: [], approvalRequired: false },
      }],
      edges: [], viewport: { x: 80, y: 80, zoom: 0.75 }, created_at: now, updated_at: now,
    }],
    workflowRuns: [],
  })
  // The body below is plain JavaScript: Playwright serializes this function
  // source into the page, so TS syntax (casts, annotations) is not allowed.
  const stubNotification = (() => {
    const w = window as unknown as Record<string, unknown>
    const notifications: Array<{ title: string; body?: string; tag?: string }> = []
    w.__notifications = notifications
    class FakeNotification {
      static get permission() { return 'granted' }
      static requestPermission() { return Promise.resolve('granted') }
      constructor(title, options) {
        notifications.push({ title, body: options && options.body, tag: options && options.tag })
      }
      close() {}
    }
    w.Notification = FakeNotification
  }) as unknown as () => void
  await page.addInitScript(stubNotification)

  let runsCall = 0
  await page.route(/\/api\/studio\/workflows\/[^/]+\/runs(?:\?|$)/, async (route) => {
    runsCall += 1
    const status = runsCall === 1 ? 'running' : 'completed'
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        runs: [{
          id: 'run-1', workflow_id: 'wf-1', profile: 'research', workspace: null, start_node_ids: ['agent'],
          status, snapshot_nodes: [], snapshot_edges: [], compiled_loops: [],
          started_at: now, finished_at: status === 'completed' ? now : null, created_at: now,
          error: null, trigger_source: 'manual',
        }],
      }),
    })
  })

  await page.goto('/#/hermes/workflow')
  // The runs panel auto-opens when a running run is present; refresh it to
  // observe the running -> completed transition.
  const runsRefresh = page.getByRole('button', { name: 'Refresh' })
  await expect(runsRefresh).toBeVisible()
  await runsRefresh.click()

  await expect.poll(() => page.evaluate(() => ((window as any).__notifications ?? []).length)).toBeGreaterThan(0)
  const first = await page.evaluate(() => (window as any).__notifications[0])
  expect(first.title).toContain('Nightly Review')
  expect(first.tag).toBe('workflow-run-complete-run-1')
  expect(api.unexpectedRequests).toEqual([])
})
