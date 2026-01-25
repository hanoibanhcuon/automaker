import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  List,
  FileText,
  GitBranch,
  ClipboardList,
  History,
  RefreshCw,
  RotateCcw,
  Play,
  StopCircle,
  AlertTriangle,
  Columns,
  PanelLeft,
  PanelRight,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { getElectronAPI } from '@/lib/electron';
import { LogViewer } from '@/components/ui/log-viewer';
import { GitDiffPanel } from '@/components/ui/git-diff-panel';
import { TaskProgressPanel } from '@/components/ui/task-progress-panel';
import { Markdown } from '@/components/ui/markdown';
import { Switch } from '@/components/ui/switch';
import { useAppStore } from '@/store/app-store';
import { extractSummary } from '@/lib/log-parser';
import { parseAgentContext, extractTodoWritesByTask } from '@/lib/agent-context-parser';
import { useAgentOutput, useFeature, useFeatureTimeline, useRunningAgents } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import type { AutoModeEvent } from '@/types/electron';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface AgentOutputModalProps {
  open: boolean;
  onClose: () => void;
  featureDescription: string;
  featureId: string;
  /** The status of the feature - used to determine if spinner should be shown */
  featureStatus?: string;
  /** Called when a number key (0-9) is pressed while the modal is open */
  onNumberKeyPress?: (key: string) => void;
  /** Project path - if not provided, falls back to window.__currentProject for backward compatibility */
  projectPath?: string;
  /** Branch name for the feature worktree - used when viewing changes */
  branchName?: string;
}

type ViewMode = 'summary' | 'parsed' | 'raw' | 'changes' | 'timeline' | 'plan';
type PanelMode = 'split' | 'plan' | 'output';

export function AgentOutputModal({
  open,
  onClose,
  featureDescription,
  featureId,
  featureStatus,
  onNumberKeyPress,
  projectPath: projectPathProp,
  branchName,
}: AgentOutputModalProps) {
  const isBacklogPlan = featureId.startsWith('backlog-plan:');

  // Resolve project path - prefer prop, fallback to window.__currentProject
  const resolvedProjectPath = projectPathProp || (window as any).__currentProject?.path || '';

  // Track additional content from WebSocket events (appended to query data)
  const [streamedContent, setStreamedContent] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isReplanning, setIsReplanning] = useState(false);
  const [showFileActivity, setShowFileActivity] = useState(false);
  const fileActivityTouchedRef = useRef(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('split');
  const [leftPanelRatio, setLeftPanelRatio] = useState(0.36);
  const isDraggingRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [reconcileInfo, setReconcileInfo] = useState<{
    tasksCompleted: number;
    tasksTotal: number;
    currentTaskId?: string;
    missingFiles: string[];
    statusAdjusted?: boolean;
  } | null>(null);
  const lastAutoReconcileRef = useRef<string>('');
  const useWorktrees = useAppStore((state) => state.useWorktrees);
  const queryClient = useQueryClient();
  const { data: runningAgentsData } = useRunningAgents();
  const isFeatureRunning = useMemo(() => {
    if (!resolvedProjectPath || !runningAgentsData?.agents) return false;
    return runningAgentsData.agents.some(
      (agent) => agent.featureId === featureId && agent.projectPath === resolvedProjectPath
    );
  }, [runningAgentsData?.agents, featureId, resolvedProjectPath]);
  const isAgentActive = isFeatureRunning || featureStatus === 'running';
  const shouldPollOutput = Boolean(open && (isBacklogPlan || isAgentActive));
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const minWidth = 280;
      const maxWidth = rect.width * 0.7;
      const nextWidth = Math.min(Math.max(x, minWidth), maxWidth);
      setLeftPanelRatio(nextWidth / rect.width);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Use React Query for initial output loading
  const {
    data: initialOutput = '',
    isLoading,
    isFetching: isOutputFetching,
  } = useAgentOutput(resolvedProjectPath, featureId, {
    enabled: open && !!resolvedProjectPath,
    pollingInterval: shouldPollOutput ? 3000 : false,
  });
  const { data: featureData } = useFeature(resolvedProjectPath, featureId, {
    enabled: open && !!resolvedProjectPath && !isBacklogPlan,
    pollingInterval: open && !isBacklogPlan ? 5000 : false,
  });
  const planSpecData = (featureData as any)?.planSpec;
  const planTaskCount = planSpecData?.tasks?.length ?? 0;
  const hasPlanTasks = planTaskCount > 0;
  const planContentAvailable = Boolean(planSpecData?.content);
  const planMissingTasks = planContentAvailable && !hasPlanTasks;
  const derivedPlanHealth = planSpecData
    ? {
        tasksCompleted: planSpecData.tasksCompleted ?? 0,
        tasksTotal: planSpecData.tasksTotal ?? planTaskCount ?? 0,
        currentTaskId: planSpecData.currentTaskId,
      }
    : null;
  const effectivePlanHealth = reconcileInfo ?? derivedPlanHealth;
  const isPlanComplete = Boolean(
    effectivePlanHealth &&
    effectivePlanHealth.tasksTotal > 0 &&
    effectivePlanHealth.tasksCompleted >= effectivePlanHealth.tasksTotal
  );

  useEffect(() => {
    setReconcileInfo(null);
    lastAutoReconcileRef.current = '';
    fileActivityTouchedRef.current = false;
  }, [featureId, resolvedProjectPath]);

  useEffect(() => {
    if (!open) {
      setReconcileInfo(null);
      lastAutoReconcileRef.current = '';
    }
  }, [open]);

  // Reset streamed content when modal opens or featureId changes
  useEffect(() => {
    if (open) {
      setStreamedContent('');
    }
  }, [open, featureId]);

  useEffect(() => {
    if (!open) return;
    if (fileActivityTouchedRef.current) return;
    setShowFileActivity(!hasPlanTasks);
  }, [open, hasPlanTasks]);

  const handleReconcile = useCallback(
    async (source: 'auto' | 'manual' = 'manual', rebuildOutput = source === 'manual') => {
      if (!resolvedProjectPath || !featureId || isBacklogPlan) return;
      if (isReconciling) return;

      try {
        setIsReconciling(true);
        const api = getElectronAPI();
        const result = await api.features?.reconcilePlan?.(resolvedProjectPath, featureId, {
          rebuildOutput,
        });
        if (result?.success) {
          setReconcileInfo(result.reconciled || null);
          await queryClient.invalidateQueries({
            queryKey: ['features', resolvedProjectPath],
          });
          await queryClient.invalidateQueries({
            queryKey: ['features', resolvedProjectPath, featureId],
          });
          await queryClient.invalidateQueries({
            queryKey: ['features', resolvedProjectPath, featureId, 'output'],
          });
          if (source === 'manual') {
            await queryClient.invalidateQueries({
              queryKey: ['features', resolvedProjectPath, featureId, 'timeline'],
            });
            const warnings: string[] = [];
            if (result.reconciled?.tasksTotal === 0) {
              warnings.push('No tasks found in plan output');
            }
            if (result.reconciled?.missingFiles?.length) {
              warnings.push(`Missing files: ${result.reconciled.missingFiles.length}`);
            }
            if (warnings.length > 0) {
              toast.warning('Reconcile completed with issues', {
                description: `${warnings.join('. ')}. Consider Replan Full or Rebuild Output.`,
              });
            } else {
              toast.success('Reconciled successfully');
            }
          }
        } else if (source === 'manual') {
          toast.error('Reconcile failed', { description: result?.error || 'Unknown error' });
        }
      } finally {
        setIsReconciling(false);
      }
    },
    [resolvedProjectPath, featureId, isBacklogPlan, isReconciling, queryClient]
  );

  const handleRebuildOutput = useCallback(async () => {
    if (!resolvedProjectPath || !featureId || isBacklogPlan) return;
    if (isRebuilding) return;
    try {
      setIsRebuilding(true);
      const api = getElectronAPI();
      const result = await api.features?.rebuildOutput?.(resolvedProjectPath, featureId);
      if (result?.success) {
        await handleReconcile('auto');
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId, 'output'],
        });
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId, 'timeline'],
        });
        const warnings: string[] = [];
        if (!result.content || result.content.trim().length === 0) {
          warnings.push('Agent output is empty');
        }
        if (result.missingFiles?.length) {
          warnings.push(`Missing files: ${result.missingFiles.length}`);
        }
        if (warnings.length > 0) {
          toast.warning('Output rebuilt with warnings', {
            description: warnings.join('. '),
          });
        } else {
          toast.success('Output rebuilt');
        }
      } else {
        toast.error('Rebuild failed', { description: result?.error || 'Unknown error' });
      }
    } finally {
      setIsRebuilding(false);
    }
  }, [resolvedProjectPath, featureId, isBacklogPlan, isRebuilding, queryClient]);

  const handleResumePending = useCallback(async () => {
    if (!resolvedProjectPath || !featureId || isBacklogPlan) return;
    if (isResuming) return;
    try {
      setIsResuming(true);
      const api = getElectronAPI();
      const result = await api.features?.resumePending?.(
        resolvedProjectPath,
        featureId,
        useWorktrees
      );
      if (result?.success) {
        await handleReconcile('auto');
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId],
        });
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId, 'output'],
        });
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId, 'timeline'],
        });
        if (result.reconciled?.tasksTotal === 0) {
          toast.warning('No pending tasks to resume', {
            description: 'Plan has no tasks. Try Replan Full or Rebuild Output.',
          });
        } else {
          toast.success('Resume started');
        }
      } else {
        toast.error('Resume failed', { description: result?.error || 'Unknown error' });
      }
    } finally {
      setIsResuming(false);
    }
  }, [resolvedProjectPath, featureId, isBacklogPlan, isResuming, useWorktrees, queryClient]);

  const handleReplanFull = useCallback(async () => {
    if (!resolvedProjectPath || !featureId || isBacklogPlan) return;
    if (isReplanning) return;
    try {
      setIsReplanning(true);
      const api = getElectronAPI();
      const result = await api.autoMode?.replanFeature?.(
        resolvedProjectPath,
        featureId,
        useWorktrees
      );
      if (result?.success) {
        setReconcileInfo(null);
        fileActivityTouchedRef.current = false;
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath],
        });
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId],
        });
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId, 'output'],
        });
        await queryClient.invalidateQueries({
          queryKey: ['features', resolvedProjectPath, featureId, 'timeline'],
        });
        toast.success('Replan requested', {
          description: 'Check the Plan tab. If tasks are still missing, try Rebuild Output.',
        });
      } else {
        toast.error('Replan failed', { description: result?.error || 'Unknown error' });
      }
    } finally {
      setIsReplanning(false);
    }
  }, [resolvedProjectPath, featureId, isBacklogPlan, isReplanning, useWorktrees, queryClient]);

  const handleForceStop = useCallback(async () => {
    if (!featureId || isBacklogPlan) return;
    if (isStopping) return;
    const confirmed = window.confirm('Force stop this task? This will abort the running agent.');
    if (!confirmed) return;
    try {
      setIsStopping(true);
      const api = getElectronAPI();
      const result = await api.autoMode?.stopFeature?.(featureId);
      if (result?.success) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.runningAgents.all() });
      }
    } finally {
      setIsStopping(false);
    }
  }, [featureId, isBacklogPlan, isStopping, queryClient]);

  useEffect(() => {
    if (!open || !resolvedProjectPath || !featureId || isBacklogPlan) return;
    const key = `${resolvedProjectPath}:${featureId}`;
    if (lastAutoReconcileRef.current === key) return;
    lastAutoReconcileRef.current = key;
    handleReconcile('auto', false);
  }, [open, resolvedProjectPath, featureId, isBacklogPlan, handleReconcile]);

  useEffect(() => {
    if (!open || !resolvedProjectPath || !featureId || isBacklogPlan) return;
    const intervalMs = isFeatureRunning ? 10000 : 30000;
    const intervalId = window.setInterval(() => {
      if (!isReconciling) {
        handleReconcile('auto', false);
      }
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    open,
    resolvedProjectPath,
    featureId,
    isBacklogPlan,
    isFeatureRunning,
    isReconciling,
    handleReconcile,
  ]);

  // Combine initial output from query with streamed content from WebSocket
  const output = initialOutput + streamedContent;

  // Extract summary from output
  const summary = useMemo(() => extractSummary(output), [output]);
  const currentTaskId = effectivePlanHealth?.currentTaskId ?? planSpecData?.currentTaskId ?? null;
  const taskTodosById = useMemo(() => {
    if (!output) return {};
    return extractTodoWritesByTask(output, currentTaskId);
  }, [output, currentTaskId]);
  const activeTodos = useMemo(() => {
    if (!currentTaskId) return [];
    const todos = taskTodosById[currentTaskId] ?? parseAgentContext(output).todos;
    const seen = new Set<string>();
    const deduped: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> = [];
    for (const todo of todos) {
      const key = `${todo.status}:${todo.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(todo);
    }
    return deduped.slice(0, 10);
  }, [currentTaskId, taskTodosById, output]);
  const todoStats = useMemo(() => {
    const allTodos = Object.values(taskTodosById || {}).flat();
    const source = allTodos.length > 0 ? allTodos : activeTodos;
    const pending = source.filter((todo) => todo.status !== 'completed').length;
    const inProgress = source.filter((todo) => todo.status === 'in_progress').length;
    return {
      total: source.length,
      pending,
      inProgress,
      hasUnfinished: pending > 0,
    };
  }, [taskTodosById, activeTodos]);
  const completionState = useMemo(() => {
    if (isPlanComplete && !isFeatureRunning && !todoStats.hasUnfinished) return 'completed';
    if (isPlanComplete && (isFeatureRunning || todoStats.hasUnfinished)) return 'finishing';
    return 'in_progress';
  }, [isPlanComplete, isFeatureRunning, todoStats.hasUnfinished]);

  // Determine the effective view mode - default to summary if available, otherwise parsed
  const effectiveViewMode = viewMode ?? (summary ? 'summary' : 'parsed');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const { data: timelineEntries = [], isLoading: isTimelineLoading } = useFeatureTimeline(
    resolvedProjectPath,
    featureId,
    {
      enabled: open && effectiveViewMode === 'timeline' && !!resolvedProjectPath && !isBacklogPlan,
      includeFileActivity: showFileActivity,
      pollingInterval: false,
    }
  );

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  // Listen to auto mode events and update output
  useEffect(() => {
    if (!open) return;

    const api = getElectronAPI();
    if (!api?.autoMode || isBacklogPlan) return;

    console.log('[AgentOutputModal] Subscribing to events for featureId:', featureId);

    const unsubscribe = api.autoMode.onEvent((event) => {
      console.log(
        '[AgentOutputModal] Received event:',
        event.type,
        'featureId:',
        'featureId' in event ? event.featureId : 'none',
        'modalFeatureId:',
        featureId
      );

      // Filter events for this specific feature only (skip events without featureId)
      if ('featureId' in event && event.featureId !== featureId) {
        console.log('[AgentOutputModal] Skipping event - featureId mismatch');
        return;
      }

      let newContent = '';

      switch (event.type) {
        case 'auto_mode_progress':
          newContent = event.content || '';
          break;
        case 'auto_mode_tool': {
          const toolName = event.tool || 'Unknown Tool';
          const toolInput = event.input ? JSON.stringify(event.input, null, 2) : '';
          newContent = `\n🔧 Tool: ${toolName}\n${toolInput ? `Input: ${toolInput}\n` : ''}`;
          break;
        }
        case 'auto_mode_phase': {
          const phaseEmoji =
            event.phase === 'planning' ? '📋' : event.phase === 'action' ? '⚡' : '✅';
          newContent = `\n${phaseEmoji} ${event.message}\n`;
          break;
        }
        case 'auto_mode_error':
          newContent = `\n❌ Error: ${event.error}\n`;
          break;
        case 'auto_mode_ultrathink_preparation': {
          // Format thinking level preparation information
          let prepContent = `\n🧠 Ultrathink Preparation\n`;

          if (event.warnings && event.warnings.length > 0) {
            prepContent += `\n⚠️ Warnings:\n`;
            event.warnings.forEach((warning: string) => {
              prepContent += `  • ${warning}\n`;
            });
          }

          if (event.recommendations && event.recommendations.length > 0) {
            prepContent += `\n💡 Recommendations:\n`;
            event.recommendations.forEach((rec: string) => {
              prepContent += `  • ${rec}\n`;
            });
          }

          if (event.estimatedCost !== undefined) {
            prepContent += `\n💰 Estimated Cost: ~$${event.estimatedCost.toFixed(
              2
            )} per execution\n`;
          }

          if (event.estimatedTime) {
            prepContent += `\n⏱️ Estimated Time: ${event.estimatedTime}\n`;
          }

          newContent = prepContent;
          break;
        }
        case 'planning_started': {
          // Show when planning mode begins
          if ('mode' in event && 'message' in event) {
            const modeLabel =
              event.mode === 'lite' ? 'Lite' : event.mode === 'spec' ? 'Spec' : 'Full';
            newContent = `\n📋 Planning Mode: ${modeLabel}\n${event.message}\n`;
          }
          break;
        }
        case 'plan_approval_required':
          // Show when plan requires approval
          if ('planningMode' in event) {
            newContent = `\n⏸️ Plan generated - waiting for your approval...\n`;
          }
          break;
        case 'plan_approved':
          // Show when plan is manually approved
          if ('hasEdits' in event) {
            newContent = event.hasEdits
              ? `\n✅ Plan approved (with edits) - continuing to implementation...\n`
              : `\n✅ Plan approved - continuing to implementation...\n`;
          }
          break;
        case 'plan_auto_approved':
          // Show when plan is auto-approved
          newContent = `\n✅ Plan auto-approved - continuing to implementation...\n`;
          break;
        case 'plan_revision_requested': {
          // Show when user requests plan revision
          if ('planVersion' in event) {
            const revisionEvent = event as Extract<
              AutoModeEvent,
              { type: 'plan_revision_requested' }
            >;
            newContent = `\n🔄 Revising plan based on your feedback (v${revisionEvent.planVersion})...\n`;
          }
          break;
        }
        case 'auto_mode_task_started': {
          // Show when a task starts
          if ('taskId' in event && 'taskDescription' in event) {
            const taskEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_task_started' }>;
            newContent = `\n▶ Starting ${taskEvent.taskId}: ${taskEvent.taskDescription}\n`;
          }
          break;
        }
        case 'auto_mode_task_complete': {
          // Show task completion progress
          if ('taskId' in event && 'tasksCompleted' in event && 'tasksTotal' in event) {
            const taskEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_task_complete' }>;
            newContent = `\n✓ ${taskEvent.taskId} completed (${taskEvent.tasksCompleted}/${taskEvent.tasksTotal})\n`;
          }
          break;
        }
        case 'auto_mode_phase_complete': {
          // Show phase completion for full mode
          if ('phaseNumber' in event) {
            const phaseEvent = event as Extract<
              AutoModeEvent,
              { type: 'auto_mode_phase_complete' }
            >;
            newContent = `\n🏁 Phase ${phaseEvent.phaseNumber} complete\n`;
          }
          break;
        }
        case 'auto_mode_feature_complete': {
          const emoji = event.passes ? '✅' : '⚠️';
          newContent = `\n${emoji} Task completed: ${event.message}\n`;

          // Close the modal when the feature is verified (passes = true)
          if (event.passes) {
            // Small delay to show the completion message before closing
            setTimeout(() => {
              onClose();
            }, 1500);
          }
          break;
        }
      }

      if (newContent) {
        // Append new content from WebSocket to streamed content
        setStreamedContent((prev) => prev + newContent);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [open, featureId, isBacklogPlan]);

  // Listen to backlog plan events and update output
  useEffect(() => {
    if (!open || !isBacklogPlan) return;

    const api = getElectronAPI();
    if (!api?.backlogPlan) return;

    const unsubscribe = api.backlogPlan.onEvent((event: any) => {
      if (!event?.type) return;

      let newContent = '';
      switch (event.type) {
        case 'backlog_plan_progress':
          newContent = `\n🧭 ${event.content || 'Backlog plan progress update'}\n`;
          break;
        case 'backlog_plan_error':
          newContent = `\n❌ Backlog plan error: ${event.error || 'Unknown error'}\n`;
          break;
        case 'backlog_plan_complete':
          newContent = `\n✅ Backlog plan completed\n`;
          break;
        default:
          newContent = `\nℹ️ ${event.type}\n`;
          break;
      }

      if (newContent) {
        setStreamedContent((prev) => prev + newContent);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [open, isBacklogPlan]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    autoScrollRef.current = isAtBottom;
  };

  // Handle number key presses while modal is open
  useEffect(() => {
    if (!open || !onNumberKeyPress) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if a number key (0-9) was pressed without modifiers
      if (!event.ctrlKey && !event.altKey && !event.metaKey && /^[0-9]$/.test(event.key)) {
        event.preventDefault();
        onNumberKeyPress(event.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onNumberKeyPress]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          'w-full h-full max-w-full max-h-full rounded-none flex flex-col',
          isFullscreen
            ? 'sm:w-screen sm:max-w-none sm:max-h-none sm:h-screen sm:rounded-none'
            : 'sm:w-[90vw] sm:max-w-[90vw] sm:min-w-[90vw] sm:h-[90vh] sm:max-h-[90vh] sm:min-h-[90vh] sm:rounded-xl'
        )}
        data-testid="agent-output-modal"
      >
        <DialogHeader className="shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pr-8">
            <DialogTitle className="flex items-center gap-2">
              {featureStatus !== 'verified' && featureStatus !== 'waiting_approval' && (
                <Spinner size="md" />
              )}
              Agent Output
            </DialogTitle>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1 rounded-md bg-muted/60 p-1">
                <Button
                  type="button"
                  variant={panelMode === 'split' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPanelMode('split')}
                  title="Split view"
                  data-testid="layout-split"
                >
                  <Columns className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={panelMode === 'plan' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPanelMode('plan')}
                  title="Focus plan"
                  data-testid="layout-plan"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={panelMode === 'output' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPanelMode('output')}
                  title="Focus output"
                  data-testid="layout-output"
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsFullscreen((prev) => !prev)}
                title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                data-testid="toggle-fullscreen"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <DialogDescription
            className="mt-1 max-h-24 overflow-y-auto break-words"
            data-testid="agent-output-description"
          >
            {featureDescription}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={layoutRef}
          className={cn(
            'flex-1 min-h-0 min-w-0 px-3 pb-3 mt-3',
            panelMode === 'split' ? 'flex flex-col lg:flex-row gap-3' : 'flex flex-col gap-2'
          )}
        >
          <div
            className={cn(
              'flex flex-col gap-2 min-h-0 min-w-0',
              panelMode === 'output' ? 'hidden' : 'flex',
              panelMode === 'split' ? 'lg:flex-shrink-0' : 'flex-1'
            )}
            style={
              panelMode === 'split'
                ? {
                    flexBasis: `${Math.round(leftPanelRatio * 100)}%`,
                    maxWidth: `${Math.round(leftPanelRatio * 100)}%`,
                    minWidth: 280,
                  }
                : undefined
            }
          >
            {!isBacklogPlan && (
              <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                  {effectivePlanHealth ? (
                    <>
                      <span className="truncate font-semibold text-foreground">
                        Plan health: {effectivePlanHealth.tasksCompleted}/
                        {effectivePlanHealth.tasksTotal} completed
                      </span>
                      {reconcileInfo?.missingFiles?.length ? (
                        <span className="text-amber-500 font-semibold">
                          Missing files: {reconcileInfo.missingFiles.length}
                        </span>
                      ) : null}
                      {planMissingTasks && (
                        <span className="text-amber-500 font-semibold">
                          Plan missing tasks (invalid format)
                        </span>
                      )}
                      {reconcileInfo?.statusAdjusted && (
                        <span className="text-amber-500 font-semibold">Moved back to backlog</span>
                      )}
                      {isPlanComplete && (isFeatureRunning || todoStats.hasUnfinished) && (
                        <span className="flex items-center gap-1 text-amber-500 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Plan complete but work still active
                          {todoStats.hasUnfinished ? ` (${todoStats.pending} TODO pending)` : ''}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="truncate font-semibold text-foreground">
                        Plan health: not available
                      </span>
                      {planMissingTasks && (
                        <span className="text-amber-500 font-semibold">
                          Plan missing tasks (invalid format)
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleReconcile('manual')}
                    disabled={isReconciling}
                    data-testid="reconcile-plan"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 mr-1 ${isReconciling ? 'animate-spin' : ''}`}
                    />
                    Reconcile
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleRebuildOutput}
                    disabled={isRebuilding}
                    data-testid="rebuild-output"
                  >
                    <RotateCcw
                      className={`w-3.5 h-3.5 mr-1 ${isRebuilding ? 'animate-spin' : ''}`}
                    />
                    Rebuild Output
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleReplanFull}
                    disabled={isReplanning || isFeatureRunning}
                    data-testid="replan-full"
                  >
                    <RotateCcw
                      className={`w-3.5 h-3.5 mr-1 ${isReplanning ? 'animate-spin' : ''}`}
                    />
                    Replan Full
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleResumePending}
                    disabled={
                      isResuming ||
                      isFeatureRunning ||
                      !reconcileInfo ||
                      reconcileInfo.tasksTotal === 0 ||
                      reconcileInfo.tasksCompleted >= reconcileInfo.tasksTotal
                    }
                    data-testid="resume-pending"
                  >
                    <Play className="w-3.5 h-3.5 mr-1" />
                    Resume Pending Tasks
                  </Button>
                  {isFeatureRunning && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleForceStop}
                      disabled={isStopping}
                      data-testid="force-stop"
                    >
                      <StopCircle className="w-3.5 h-3.5 mr-1" />
                      Force Stop
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!isBacklogPlan ? (
              <TaskProgressPanel
                featureId={featureId}
                projectPath={resolvedProjectPath}
                className="flex-1 min-h-0"
                compact
                activeTodos={activeTodos}
                taskTodosById={taskTodosById}
                activeTaskIdOverride={currentTaskId}
                listMaxHeightClass="h-full max-h-none"
              />
            ) : (
              <div className="rounded-lg border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
                Execution plan is not available for backlog planning sessions.
              </div>
            )}
          </div>

          {panelMode === 'split' && (
            <div
              className="hidden lg:flex w-1 cursor-col-resize rounded-full bg-border/60 hover:bg-brand-500/70 transition-colors"
              onMouseDown={(event) => {
                event.preventDefault();
                isDraggingRef.current = true;
              }}
              title="Drag to resize"
              data-testid="layout-resize-handle"
            />
          )}

          <div
            className={cn(
              'flex flex-col min-h-0 min-w-0 gap-2',
              panelMode === 'plan' ? 'hidden' : 'flex-1'
            )}
          >
            <div className="flex flex-wrap items-center gap-2 px-1">
              {effectivePlanHealth && (
                <Badge variant="secondary" className="text-[10px]">
                  Tasks {effectivePlanHealth.tasksCompleted}/{effectivePlanHealth.tasksTotal}
                </Badge>
              )}
              {todoStats.total > 0 && (
                <Badge
                  variant={todoStats.hasUnfinished ? 'outline' : 'secondary'}
                  className={cn(
                    'text-[10px]',
                    todoStats.hasUnfinished ? 'text-amber-500 border-amber-500/40' : ''
                  )}
                >
                  TODO {todoStats.pending}/{todoStats.total}
                </Badge>
              )}
              <Badge
                variant={completionState === 'completed' ? 'secondary' : 'outline'}
                className={cn(
                  'text-[10px]',
                  completionState === 'finishing' && 'text-amber-500 border-amber-500/40',
                  completionState === 'in_progress' && 'text-muted-foreground border-border/60'
                )}
              >
                {completionState === 'completed'
                  ? 'Completed'
                  : completionState === 'finishing'
                    ? 'Finishing'
                    : 'In progress'}
              </Badge>
            </div>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
              {summary && (
                <button
                  onClick={() => setViewMode('summary')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    effectiveViewMode === 'summary'
                      ? 'bg-primary/20 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  data-testid="view-mode-summary"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  Summary
                </button>
              )}
              {!isBacklogPlan && (
                <button
                  onClick={() => setViewMode('plan')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    effectiveViewMode === 'plan'
                      ? 'bg-primary/20 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  data-testid="view-mode-plan"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Plan
                </button>
              )}
              <button
                onClick={() => setViewMode('parsed')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  effectiveViewMode === 'parsed'
                    ? 'bg-primary/20 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
                data-testid="view-mode-parsed"
              >
                <List className="w-3.5 h-3.5" />
                Logs
              </button>
              {!isBacklogPlan && (
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    effectiveViewMode === 'timeline'
                      ? 'bg-primary/20 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                  data-testid="view-mode-timeline"
                >
                  <History className="w-3.5 h-3.5" />
                  Timeline
                </button>
              )}
              <button
                onClick={() => setViewMode('changes')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  effectiveViewMode === 'changes'
                    ? 'bg-primary/20 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
                data-testid="view-mode-changes"
              >
                <GitBranch className="w-3.5 h-3.5" />
                Changes
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  effectiveViewMode === 'raw'
                    ? 'bg-primary/20 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
                data-testid="view-mode-raw"
              >
                <FileText className="w-3.5 h-3.5" />
                Raw
              </button>
            </div>

            {effectiveViewMode === 'changes' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-y-auto scrollbar-visible">
                {resolvedProjectPath ? (
                  <GitDiffPanel
                    projectPath={resolvedProjectPath}
                    featureId={branchName || featureId}
                    compact={false}
                    useWorktrees={useWorktrees}
                    className="border-0 rounded-lg"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Spinner size="lg" className="mr-2" />
                    Loading...
                  </div>
                )}
              </div>
            ) : effectiveViewMode === 'summary' && summary ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-card border border-border/50 rounded-lg p-4 scrollbar-visible">
                <Markdown className="break-words">{summary}</Markdown>
              </div>
            ) : effectiveViewMode === 'timeline' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-card border border-border/50 rounded-lg p-4 scrollbar-visible">
                <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground mb-3">
                  <span>File activity</span>
                  <Switch
                    checked={showFileActivity}
                    onCheckedChange={(checked) => {
                      fileActivityTouchedRef.current = true;
                      setShowFileActivity(checked);
                    }}
                  />
                </div>
                {isTimelineLoading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Spinner size="lg" className="mr-2" />
                    Loading timeline...
                  </div>
                ) : timelineEntries.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    No timeline entries available.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {timelineEntries.map((entry) => (
                      <div key={entry.id} className="flex gap-3">
                        <div
                          className={cn(
                            'mt-1 h-2.5 w-2.5 rounded-full shrink-0',
                            entry.type === 'file_changed' ? 'bg-emerald-500/60' : 'bg-primary/60'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{entry.title}</span>
                            <span className="whitespace-nowrap">
                              {new Date(entry.timestamp).toLocaleString()}
                            </span>
                          </div>
                          {entry.detail && (
                            <div className="text-xs text-muted-foreground break-words mt-1">
                              {entry.detail}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : effectiveViewMode === 'plan' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-card border border-border/50 rounded-lg p-4 scrollbar-visible">
                {featureData?.planSpec?.content ? (
                  <Markdown className="break-words text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-[11px] [&_pre]:text-[11px] [&_pre]:whitespace-pre-wrap [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-xs">
                    {featureData.planSpec.content}
                  </Markdown>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Plan content is not available.
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  className="flex-1 min-h-0 overflow-y-auto bg-popover border border-border/50 rounded-lg p-4 font-mono text-xs scrollbar-visible"
                >
                  {isLoading && !output ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Spinner size="lg" className="mr-2" />
                      Loading output...
                    </div>
                  ) : !output ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            isAgentActive
                              ? 'bg-emerald-400 animate-pulse'
                              : 'bg-muted-foreground/60'
                          )}
                        />
                        <span>
                          {isAgentActive ? 'Agent is running' : 'No running agent detected'}
                        </span>
                        {isOutputFetching && <Spinner size="xs" className="ml-1" />}
                      </div>
                      <div className="max-w-md text-center text-xs text-muted-foreground">
                        {isBacklogPlan
                          ? 'Backlog planning may not stream output immediately. Output will appear after the first planning step.'
                          : 'No output yet. The agent will stream output here as it works.'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            queryClient.invalidateQueries({
                              queryKey: queryKeys.features.agentOutput(
                                resolvedProjectPath,
                                featureId
                              ),
                            })
                          }
                          disabled={!resolvedProjectPath || !featureId}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          Refresh output
                        </Button>
                      </div>
                    </div>
                  ) : effectiveViewMode === 'parsed' ? (
                    <LogViewer output={output} />
                  ) : (
                    <div className="whitespace-pre-wrap wrap-break-word text-foreground/80">
                      {output}
                    </div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground text-center shrink-0">
                  {autoScrollRef.current
                    ? 'Auto-scrolling enabled'
                    : 'Scroll to bottom to enable auto-scroll'}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
