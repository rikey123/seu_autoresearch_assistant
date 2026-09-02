import Router from '@koa/router'
import { artifactsRoutes } from './artifacts'
import { latexRoutes } from './latex'
import { closeLatexDb } from './latex/latex-store'
import { libraryRoutes } from './library'
import { closePapersDb } from './library/paper-store'
import { stopTranslationQueueWorker } from './library/translation-queue-service'
import { ragRoutes } from './rag'
import { skillpacksRoutes } from './skillpacks'
import { workflowsRoutes } from './workflows'

// Unified HTTP surface for the Research Workbench; every subdomain router
// serves absolute paths under /api/studio/research/<subdomain>.
export const researchRoutes = new Router()

researchRoutes.use(workflowsRoutes.routes())
researchRoutes.use(libraryRoutes.routes())
researchRoutes.use(ragRoutes.routes())
researchRoutes.use(latexRoutes.routes())
researchRoutes.use(artifactsRoutes.routes())
researchRoutes.use(skillpacksRoutes.routes())

/**
 * Graceful shutdown for all Research-owned resources, registered by bootstrap
 * as one AdditionalShutdownStep. Order is significant: the serial pdf2zh
 * worker is stopped first (kills the in-flight child process tree through the
 * studio process-tree facade and closes the queue database it holds), and
 * only then are the remaining research-owned databases closed, so the worker
 * can never touch a closed handle. The stores are lazy; closing databases that
 * were never opened is a no-op.
 */
export function shutdownResearchResources(): void {
  stopTranslationQueueWorker()
  closePapersDb()
  closeLatexDb()
}
