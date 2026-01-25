'use client';

import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '@automaker/utils/logger';
import { cn } from '@/lib/utils';

const logger = createLogger('TaskProgressPanel');
import { Check, Circle, ChevronDown, ChevronRight, FileCode } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { getElectronAPI } from '@/lib/electron';
import type { AutoModeEvent } from '@/types/electron';
import { Badge } from '@/components/ui/badge';

interface TaskInfo {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  filePath?: string;
  phase?: string;
  startedAt?: string;
  completedAt?: string;
}

interface TaskProgressPanelProps {
  featureId: string;
  projectPath?: string;
  className?: string;
  /** Optional override for the active task id */
  activeTaskIdOverride?: string | null;
  /** Whether the panel starts expanded (default: true) */
  defaultExpanded?: boolean;
  /** Optional TODOs for the active task (deduped/limited upstream) */
  activeTodos?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  /** Optional per-task TODOs keyed by task ID */
  taskTodosById?: Record<
    string,
    Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
  >;
  /** Override max height class for the task list */
  listMaxHeightClass?: string;
  /** Compact mode for tighter layouts */
  compact?: boolean;
}

export function TaskProgressPanel({
  featureId,
  projectPath,
  className,
  activeTaskIdOverride = null,
  defaultExpanded = true,
  activeTodos,
  taskTodosById,
  listMaxHeightClass = 'max-h-[200px]',
  compact = false,
}: TaskProgressPanelProps) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [showAllTodos, setShowAllTodos] = useState(false);
  const [hasTodoUpdates, setHasTodoUpdates] = useState(false);

  // Load initial tasks from feature's planSpec
  const loadInitialTasks = useCallback(async () => {
    if (!projectPath) {
      setIsLoading(false);
      return;
    }

    try {
      const api = getElectronAPI();
      if (!api?.features) {
        setIsLoading(false);
        return;
      }

      const result = await api.features.get(projectPath, featureId);
      const feature: any = (result as any).feature;
      if (result.success && feature?.planSpec?.tasks) {
        const planSpec = feature.planSpec as any;
        const planTasks = planSpec.tasks;
        const currentId = planSpec.currentTaskId;
        const completedCount = planSpec.tasksCompleted || 0;

        // Convert planSpec tasks to TaskInfo with proper status (prefer explicit status)
        const initialTasks: TaskInfo[] = planTasks.map((t: any, index: number) => {
          const fallbackStatus =
            index < completedCount
              ? ('completed' as const)
              : t.id === currentId
                ? ('in_progress' as const)
                : ('pending' as const);

          return {
            id: t.id,
            description: t.description,
            filePath: t.filePath,
            phase: t.phase,
            status: t.status || fallbackStatus,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
          };
        });

        setTasks(initialTasks);
        setCurrentTaskId(currentId || null);
      }
    } catch (error) {
      logger.error('Failed to load initial tasks:', error);
    } finally {
      setIsLoading(false);
    }
  }, [featureId, projectPath]);

  // Load initial state on mount
  useEffect(() => {
    loadInitialTasks();
  }, [loadInitialTasks]);

  // Listen to task events for real-time updates
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.autoMode) return;

    const unsubscribe = api.autoMode.onEvent((event: AutoModeEvent) => {
      // Only handle events for this feature
      if (!('featureId' in event) || event.featureId !== featureId) return;

      switch (event.type) {
        case 'auto_mode_phase':
          if ('phase' in event && event.phase) {
            setCurrentPhase(event.phase);
          }
          break;
        case 'planning_started':
        case 'plan_revision_requested':
          setCurrentPhase('planning');
          break;
        case 'plan_approved':
        case 'plan_auto_approved':
          setCurrentPhase('action');
          break;
        case 'plan_approval_required':
          setCurrentPhase('planning');
          break;
        case 'auto_mode_task_started':
          if ('taskId' in event && 'taskDescription' in event) {
            const taskEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_task_started' }>;
            setCurrentTaskId(taskEvent.taskId);

            setTasks((prev) => {
              // Check if task already exists
              const existingIndex = prev.findIndex((t) => t.id === taskEvent.taskId);

              if (existingIndex !== -1) {
                // Update status to in_progress and mark previous as completed
                return prev.map((t, idx) => {
                  if (t.id === taskEvent.taskId) {
                    return {
                      ...t,
                      status: 'in_progress' as const,
                      startedAt: t.startedAt ?? new Date().toISOString(),
                    };
                  }
                  // If we are moving to a task that is further down the list, assume previous ones are completed
                  // This is a heuristic, but usually correct for sequential execution
                  if (idx < existingIndex && t.status !== 'completed') {
                    return { ...t, status: 'completed' as const };
                  }
                  return t;
                });
              }

              // Add new task if it doesn't exist (fallback)
              return [
                ...prev,
                {
                  id: taskEvent.taskId,
                  description: taskEvent.taskDescription,
                  status: 'in_progress' as const,
                  startedAt: new Date().toISOString(),
                },
              ];
            });
          }
          break;

        case 'auto_mode_task_complete':
          if ('taskId' in event) {
            const taskEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_task_complete' }>;
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskEvent.taskId
                  ? {
                      ...t,
                      status: 'completed' as const,
                      completedAt: t.completedAt ?? new Date().toISOString(),
                    }
                  : t
              )
            );
            setCurrentTaskId(null);
          }
          break;
      }
    });

    return unsubscribe;
  }, [featureId]);

  useEffect(() => {
    setCurrentPhase(null);
    setShowAllTodos(false);
    setHasTodoUpdates(false);
  }, [featureId]);

  const hasAnyTodos = !!taskTodosById && Object.keys(taskTodosById).length > 0;

  useEffect(() => {
    if (hasAnyTodos) {
      setHasTodoUpdates(true);
    }
  }, [hasAnyTodos, taskTodosById]);

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const totalCount = tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  useEffect(() => {
    if (activeTaskIdOverride) {
      setCurrentTaskId(activeTaskIdOverride);
      return;
    }
    if (currentTaskId) {
      const stillExists = tasks.some((t) => t.id === currentTaskId && t.status === 'in_progress');
      if (!stillExists) {
        const activeTask = tasks.find((t) => t.status === 'in_progress');
        setCurrentTaskId(activeTask?.id ?? null);
      }
      return;
    }
    const activeTask = tasks.find((t) => t.status === 'in_progress');
    if (activeTask) {
      setCurrentTaskId(activeTask.id);
    }
  }, [tasks, currentTaskId, activeTaskIdOverride]);

  const formatDuration = (ms?: number | null): string => {
    if (!ms || ms <= 0) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  if (isLoading) {
    return null;
  }

  if (tasks.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border/50 bg-card/40 p-3 text-xs text-muted-foreground',
          className
        )}
      >
        No execution tasks found. The plan output may be missing the required tasks format.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group rounded-lg border bg-card/50 shadow-sm overflow-hidden transition-all duration-200 flex flex-col min-h-0',
        className
      )}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/10 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors',
              isExpanded ? 'bg-background border-border' : 'bg-muted border-transparent'
            )}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-foreground/70" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <h3 className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-base')}>
              Execution Plan
            </h3>
            <span
              className={cn(
                'text-muted-foreground uppercase tracking-wider font-medium',
                compact ? 'text-[10px]' : 'text-[11px]'
              )}
            >
              {completedCount} of {totalCount} tasks completed
            </span>
            {(currentPhase || currentTaskId) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {currentPhase && (
                  <Badge
                    variant="secondary"
                    className={cn('h-5 px-2', compact ? 'text-[10px]' : 'text-[11px]')}
                  >
                    Phase: {currentPhase}
                  </Badge>
                )}
                {currentTaskId && (
                  <Badge
                    variant="outline"
                    className={cn('h-5 px-2', compact ? 'text-[10px]' : 'text-[11px]')}
                  >
                    Active: {currentTaskId}
                  </Badge>
                )}
              </div>
            )}
            {hasTodoUpdates && !showAllTodos && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className={cn('text-[11px] font-medium text-emerald-300')}>
                  TodoWrite updated
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {hasAnyTodos && (
            <button
              type="button"
              className={cn(
                'text-[10px] font-medium px-2 py-1 rounded-md border transition-colors',
                showAllTodos
                  ? 'border-primary/40 text-primary bg-primary/10'
                  : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
              onClick={(event) => {
                event.preventDefault();
                setShowAllTodos((prev) => !prev);
                if (!showAllTodos) {
                  setHasTodoUpdates(false);
                }
              }}
            >
              {showAllTodos ? 'Show active TODOs' : 'Show all TODOs'}
            </button>
          )}
          {/* Circular Progress (Mini) */}
          <div className="relative h-8 w-8 flex items-center justify-center">
            <svg className="h-full w-full -rotate-90 text-muted/20" viewBox="0 0 24 24">
              <circle
                className="text-muted/20"
                cx="12"
                cy="12"
                r="10"
                strokeWidth="3"
                fill="none"
                stroke="currentColor"
              />
              <circle
                className="text-primary transition-all duration-500 ease-in-out"
                cx="12"
                cy="12"
                r="10"
                strokeWidth="3"
                fill="none"
                stroke="currentColor"
                strokeDasharray={63}
                strokeDashoffset={63 - (63 * progressPercent) / 100}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-[9px] font-bold">{progressPercent}%</span>
          </div>
        </div>
      </button>

      <div
        className={cn(
          'grid transition-all duration-300 ease-in-out flex-1 min-h-0',
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              'p-4 pt-3 relative overflow-y-auto overflow-x-hidden scrollbar-visible min-h-0',
              'bg-muted/5 border-t border-border/40',
              listMaxHeightClass
            )}
          >
            {/* Vertical Connector Line */}
            <div className="absolute left-[2.15rem] top-4 bottom-8 w-px bg-linear-to-b from-primary/40 via-border/40 to-transparent opacity-70" />

            <div className="space-y-3">
              {tasks.map((task, index) => {
                const effectiveActiveId = activeTaskIdOverride || currentTaskId;
                const isActive =
                  effectiveActiveId !== null
                    ? task.id === effectiveActiveId
                    : task.status === 'in_progress';
                const isCompleted = task.status === 'completed';
                const isPending = task.status === 'pending';
                const startTime = task.startedAt ? new Date(task.startedAt).getTime() : null;
                const endTime = task.completedAt
                  ? new Date(task.completedAt).getTime()
                  : isActive
                    ? Date.now()
                    : null;
                const durationMs =
                  startTime && endTime && endTime >= startTime ? endTime - startTime : null;
                const durationLabel =
                  durationMs && durationMs > 0 ? formatDuration(durationMs) : null;
                const taskTodos = taskTodosById?.[task.id];
                const todosForTask = showAllTodos ? taskTodos : isActive ? activeTodos : undefined;
                const showTodos = !!todosForTask && todosForTask.length > 0;

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'relative flex gap-4 group/item transition-all duration-300 rounded-lg px-3 py-2.5',
                      'border border-transparent hover:bg-muted/40',
                      isPending && 'opacity-60 hover:opacity-100',
                      isActive &&
                        'bg-primary/10 border-primary/40 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                    )}
                  >
                    <div
                      className={cn(
                        'absolute left-0 top-2 bottom-2 w-0.5 rounded-full',
                        isActive ? 'bg-primary/70' : 'bg-transparent'
                      )}
                    />
                    {/* Icon Status */}
                    <div
                      className={cn(
                        'relative z-10 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition-all duration-300',
                        isCompleted &&
                          'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400',
                        isActive &&
                          'bg-primary border-primary text-primary-foreground ring-4 ring-primary/15 scale-110 shadow-md shadow-primary/20',
                        isPending && 'bg-muted border-border text-muted-foreground'
                      )}
                    >
                      {isCompleted && <Check className="h-3.5 w-3.5" />}
                      {isActive && <Spinner size="xs" />}
                      {isPending && <Circle className="h-2 w-2 fill-current opacity-50" />}
                    </div>

                    {/* Task Content */}
                    <div
                      className={cn(
                        'flex-1 pt-1 min-w-0 transition-all',
                        isActive && 'translate-x-1'
                      )}
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-4">
                          <p
                            className={cn(
                              'font-medium leading-none truncate pr-4',
                              compact ? 'text-sm' : 'text-base',
                              isCompleted &&
                                'text-muted-foreground line-through decoration-border/60',
                              isActive && 'text-primary font-semibold'
                            )}
                          >
                            {task.description}
                          </p>
                          {durationLabel && (
                            <span
                              className={cn(
                                'text-muted-foreground whitespace-nowrap',
                                compact ? 'text-[10px]' : 'text-[11px]'
                              )}
                              title={
                                task.startedAt && task.completedAt
                                  ? `${new Date(task.startedAt).toLocaleString()} - ${new Date(
                                      task.completedAt
                                    ).toLocaleString()}`
                                  : undefined
                              }
                            >
                              {durationLabel}
                            </span>
                          )}
                          {isActive && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-5 px-1.5 bg-primary/5 text-primary border-primary/20 animate-pulse',
                                compact ? 'text-[10px]' : 'text-[11px]'
                              )}
                            >
                              Active
                            </Badge>
                          )}
                        </div>

                        {(task.filePath || isActive) && (
                          <div
                            className={cn(
                              'flex items-center gap-2 text-muted-foreground font-mono',
                              compact ? 'text-[11px]' : 'text-sm'
                            )}
                          >
                            {task.filePath ? (
                              <>
                                <FileCode className="h-3 w-3 opacity-70" />
                                <span className="truncate opacity-80 hover:opacity-100 transition-opacity">
                                  {task.filePath}
                                </span>
                              </>
                            ) : (
                              <span className="h-3 block" /> /* Spacer */
                            )}
                          </div>
                        )}

                        {showTodos && (
                          <div className="mt-1.5 space-y-1 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              TODO ({todosForTask?.length ?? 0})
                            </div>
                            <div
                              className={cn(
                                'space-y-1 text-muted-foreground',
                                compact ? 'text-[11px]' : 'text-[12px]'
                              )}
                            >
                              {todosForTask?.map((todo, todoIndex) => (
                                <div
                                  key={`${todo.content}-${todoIndex}`}
                                  className="flex items-start gap-2"
                                >
                                  <span
                                    className={cn(
                                      'mt-1 h-1.5 w-1.5 rounded-full',
                                      todo.status === 'completed' && 'bg-emerald-400/80',
                                      todo.status === 'in_progress' && 'bg-amber-400/80',
                                      todo.status === 'pending' && 'bg-muted-foreground/60'
                                    )}
                                  />
                                  <span
                                    className={cn(
                                      'break-words',
                                      todo.status === 'completed' &&
                                        'line-through text-muted-foreground/80',
                                      todo.status === 'in_progress' && 'text-amber-300',
                                      todo.status === 'pending' && 'text-muted-foreground'
                                    )}
                                  >
                                    {todo.content}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
