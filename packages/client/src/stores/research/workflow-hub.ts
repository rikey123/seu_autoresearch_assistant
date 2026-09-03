import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as templatesApi from '@/api/studio/research-workflow-templates'
import type { ResearchWorkflowTemplate, ResearchWorkflowTemplateSummary } from '@/api/studio/research-workflow-templates'
import { createWorkflow, deleteWorkflow, listWorkflows } from '@/api/studio/workflows'
import type { WorkflowRecord } from '@/api/studio/workflows'
import { templateToWorkflowCreateRequest } from '@/utils/research-workflow-template-mapping'

export type WorkflowHubNotice = { kind: 'error' | 'success'; key: string }

// Client state for the research workflows hub: template gallery, the user's
// Studio workflow list, and the template -> workflow instantiation used to
// deep-link into the Hermes canvas (/hermes/workflow?workflowId=...).
export const useWorkflowHubStore = defineStore('research-workflow-hub', () => {
  const templates = ref<ResearchWorkflowTemplateSummary[]>([])
  const templatesLoading = ref(false)
  const templatesLoadFailed = ref(false)

  const workflows = ref<WorkflowRecord[]>([])
  const workflowsLoading = ref(false)
  const workflowsLoadFailed = ref(false)

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

  function templateById(id: string): ResearchWorkflowTemplateSummary | null {
    return templates.value.find(template => template.id === id) || null
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
    creating,
    deletingIds,
    notice,
    hasWorkflows,
    refreshTemplates,
    refreshWorkflows,
    templateById,
    createFromTemplate,
    removeWorkflow,
    clearNotice,
  }
})
