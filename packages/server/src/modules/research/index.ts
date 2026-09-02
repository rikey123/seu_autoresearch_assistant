import Router from '@koa/router'
import { artifactsRoutes } from './artifacts'
import { latexRoutes } from './latex'
import { libraryRoutes } from './library'
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
