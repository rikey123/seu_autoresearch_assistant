import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as templatesApi from '@/api/studio/research-workflow-templates'
import type { ResearchWorkflowTemplate, ResearchWorkflowTemplateSummary } from '@/api/studio/research-workflow-templates'
import { createWorkflow, deleteWorkflow, listWorkflows } from '@/api/studio/workflows'
import type { WorkflowRecord } from '@/api/studio/workflows'
import * as skillpacksApi from '@/api/studio/research-skillpacks'
import type { ResearchSkillInstallStatus, ResearchSkillPackStatus } from '@/api/studio/research-skillpacks'
import { templateToWorkflowCreateRequest } from '@/utils/research-workflow-template-mapping'

export type WorkflowHubNotice = {
  kind: 'error' | 'success' | 'warning'
  key: string
  params?: Record<string, unknown>
}

// Statuses the auto-loader may fix; modified/conflict are NEVER auto-loaded —
// they mean the installed copy carries user edits (or a foreign skill), and
// overwriting them requires an explicit force reload (see the manual's skill
// pack section).
const AUTO_LOADABLE_STATUSES: readonly ResearchSkillInstallStatus[] = ['missing', 'outdated']
const PROTECTED_STATUSES: readonly ResearchSkillInstallStatus[] = ['modified', 'conflict']

// Client state for the research workflows hub: template gallery, the user's
// Studio workflow list, the template -> workflow instantiation used to
// deep-link into the Hermes canvas (/hermes/workflow?workflowId=...), and the
// research skill pack statuses that decorate template cards with per-skill
// load-state tags and drive the create-time auto-load.
export const useWorkflowHubStore = defineStore('research-workflow-hub', () => {
  const templates = ref<ResearchWorkflowTemplateSummary[]>([])
  const templatesLoading = ref(false)
  const templatesLoadFailed = ref(false)

  const workflows = ref<WorkflowRecord[]>([])
  const workflowsLoading = ref(false)
  const workflowsLoadFailed = ref(false)

  const skillPacks = ref<ResearchSkillPackStatus[]>([])
  const skillStatusLoading = ref(false)
  const skillStatusFailed = ref(false)

  const creating = ref(false)
  const deletingIds = ref<string[]>([])
  const notice = ref<WorkflowHubNotice | null>(null)

  const hasWorkflows = computed(() => workflows.value.length > 0)

  async function refreshTemplates(): Promise<void> {
    templatesLoading.value = true
    templatesLoadFailed.value = false
    try {
      templates.value = await templatesApi.listResearchWorkflowTemplates()
    } catch {
      templatesLoadFailed.value = true
    } finally {
      templatesLoading.value = false
    }
  }

  async function refreshWorkflows(): Promise<void> {
    workflowsLoading.value = true
    workflowsLoadFailed.value = false
    try {
      workflows.value = await listWorkflows()
    } catch {
      workflowsLoadFailed.value = true
    } finally {
      workflowsLoading.value = false
    }
  }

  // Five-state load status for the skill packs the templates bind. Failure is
  // non-fatal: cards fall back to an "unknown" tag and auto-load becomes a
  // no-op instead of guessing.
  async function refreshSkillStatuses(): Promise<void> {
    skillStatusLoading.value = true
    skillStatusFailed.value = false
    try {
      skillPacks.value = (await skillpacksApi.listSkillPacks()).packs
    } catch {
      skillStatusFailed.value = true
    } finally {
      skillStatusLoading.value = false
    }
  }

  /** Load status of one bound skill, or 'unknown' when no pack reports it. */
  function skillStatusFor(skillName: string): ResearchSkillInstallStatus | 'unknown' {
    for (const pack of skillPacks.value) {
      const skill = pack.skills.find(entry => entry.name === skillName)
      if (skill) return skill.status
    }
    return 'unknown'
  }

  /** Display title of one bound skill, falling back to its folder name. */
  function skillTitleFor(skillName: string): string {
    for (const pack of skillPacks.value) {
      const skill = pack.skills.find(entry => entry.name === skillName)
      if (skill) return skill.title || skill.name
    }
    return skillName
  }

  function templateById(id: string): ResearchWorkflowTemplateSummary | null {
    return templates.value.find(template => template.id === id) || null
  }

  /**
   * Bound skill names of a full template definition: nodes[].data.skills,
   * deduped in first-seen order — the same computation the server applies for
   * the summary's `skills` field.
   */
  function requiredSkillsOf(template: ResearchWorkflowTemplate): string[] {
    const skills: string[] = []
    for (const node of template.nodes as Array<{ data?: { skills?: unknown } } | null>) {
      const bound = node?.data?.skills
      if (!Array.isArray(bound)) continue
      for (const skill of bound) {
        const name = typeof skill === 'string' ? skill.trim() : ''
        if (name && !skills.includes(name)) skills.push(name)
      }
    }
    return skills
  }

  /**
   * Create-time auto-load for a template's bound skills: missing/outdated
   * packs are re-loaded, modified/conflict copies are reported and left
   * untouched (user-edit protection). Runs in the background after the
   * workflow was created — it never blocks creation and its outcome is
   * reported through the hub notice and the refreshed card tags.
   */
  async function autoLoadTemplateSkills(template: ResearchWorkflowTemplate): Promise<void> {
    const required = requiredSkillsOf(template)
    if (!required.length) return
    // Re-fetch statuses at decision time: the protection decision (never
    // overwrite modified/conflict copies) must not run on stale mount-time
    // data. A failed fetch leaves every status unknown, which auto-load
    // treats as "never guess" — creation itself is unaffected either way.
    await refreshSkillStatuses()

    const statusBySkill = new Map<string, ResearchSkillInstallStatus>()
    const packIdBySkill = new Map<string, string>()
    for (const pack of skillPacks.value) {
      for (const skill of pack.skills) {
        statusBySkill.set(skill.name, skill.status)
        packIdBySkill.set(skill.name, pack.id)
      }
    }
    const packIdsToLoad = new Set<string>()
    const protectedSkills: string[] = []
    for (const name of required) {
      const status = statusBySkill.get(name)
      const packId = packIdBySkill.get(name)
      if (!status || !packId) continue // status unknown: never guess, never load
      if (AUTO_LOADABLE_STATUSES.includes(status)) packIdsToLoad.add(packId)
      else if (PROTECTED_STATUSES.includes(status)) protectedSkills.push(name)
    }
    if (!packIdsToLoad.size && !protectedSkills.length) return

    const loadedSkills: string[] = []
    let loadFailed = false
    for (const packId of packIdsToLoad) {
      try {
        const { result } = await skillpacksApi.loadSkillPack(packId)
        loadedSkills.push(...result.installed, ...result.updated)
      } catch {
        loadFailed = true
      }
    }
    await refreshSkillStatuses()
    if (loadFailed) {
      notice.value = { kind: 'error', key: 'research.workflows.skillAutoLoadFailed' }
    } else if (protectedSkills.length) {
      notice.value = {
        kind: 'warning',
        key: 'research.workflows.skillAutoLoadProtected',
        params: { skills: protectedSkills.map(skillTitleFor).join(', ') },
      }
    } else if (loadedSkills.length) {
      notice.value = {
        kind: 'success',
        key: 'research.workflows.skillAutoLoadSuccess',
        params: { skills: loadedSkills.map(skillTitleFor).join(', ') },
      }
    }
  }

  // Instantiates a template as a Studio workflow: fetches the full template
  // definition, maps it onto the createWorkflow payload (nodes/edges pass
  // through; name/profile per the pure mapper), and returns the created
  // record so the view can deep-link into the canvas.
  async function createFromTemplate(templateId: string, name: string): Promise<WorkflowRecord | null> {
    creating.value = true
    try {
      const template: ResearchWorkflowTemplate = await templatesApi.fetchResearchWorkflowTemplate(templateId)
      const workflow = await createWorkflow(templateToWorkflowCreateRequest(template, name))
      workflows.value = [workflow, ...workflows.value]
      notice.value = { kind: 'success', key: 'research.workflows.createSuccess' }
      // Skill auto-load happens strictly after the workflow exists and is not
      // awaited: the creation flow (dialog close + canvas deep-link) must not
      // wait on skill pack I/O.
      void autoLoadTemplateSkills(template).catch(() => {})
      return workflow
    } catch {
      notice.value = { kind: 'error', key: 'research.workflows.createFailed' }
      return null
    } finally {
      creating.value = false
    }
  }

  async function removeWorkflow(id: string): Promise<boolean> {
    deletingIds.value = [...deletingIds.value, id]
    try {
      await deleteWorkflow(id)
      workflows.value = workflows.value.filter(workflow => workflow.id !== id)
      notice.value = { kind: 'success', key: 'research.workflows.deleteSuccess' }
      return true
    } catch {
      notice.value = { kind: 'error', key: 'research.workflows.deleteFailed' }
      return false
    } finally {
      deletingIds.value = deletingIds.value.filter(entry => entry !== id)
    }
  }

  function clearNotice(): void {
    notice.value = null
  }

  return {
    templates,
    templatesLoading,
    templatesLoadFailed,
    workflows,
    workflowsLoading,
    workflowsLoadFailed,
    skillPacks,
    skillStatusLoading,
    skillStatusFailed,
    creating,
    deletingIds,
    notice,
    hasWorkflows,
    refreshTemplates,
    refreshWorkflows,
    refreshSkillStatuses,
    skillStatusFor,
    skillTitleFor,
    templateById,
    createFromTemplate,
    removeWorkflow,
    clearNotice,
  }
})
