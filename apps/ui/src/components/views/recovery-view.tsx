/**
 * Recovery Center View - Surface features that need recovery actions
 */

import { useMemo, useState, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import { useRecoveryCenter, useFeatures } from '@/hooks/queries';
import { getElectronAPI } from '@/lib/electron';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import {
  RefreshCw,
  RotateCcw,
  Play,
  AlertTriangle,
  Filter,
  X,
  Link2,
  PencilLine,
} from 'lucide-react';
import { RestoreDependenciesDialog } from '@/components/views/board-view/dialogs';

type ActionState = Record<
  string,
  { reconciling?: boolean; rebuilding?: boolean; resuming?: boolean; restoring?: boolean }
>;

function formatStatus(status?: string): string {
  if (!status) return 'unknown';
  return status.replace(/_/g, ' ');
}

export function RecoveryView() {
  const currentProject = useAppStore((state) => state.currentProject);
  const useWorktrees = useAppStore((state) => state.useWorktrees);
  const projectPath = currentProject?.path ?? null;
  const [actionState, setActionState] = useState<ActionState>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [providerFilter, setProviderFilter] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState<string[]>([]);
  const [includeAll, setIncludeAll] = useState(false);
  const [bulkAction, setBulkAction] = useState<
    null | 'reconcile' | 'rebuild' | 'resume' | 'restore-deps'
  >(null);
  const [manualRestoreOpen, setManualRestoreOpen] = useState(false);
  const [manualRestoreFeatureId, setManualRestoreFeatureId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useRecoveryCenter(
    projectPath ?? undefined,
    includeAll
  );
  const { data: allFeatures = [] } = useFeatures(projectPath ?? undefined);

  const summary = useMemo(
    () =>
      data?.summary ?? {
        total: 0,
        incompletePlans: 0,
        missingFiles: 0,
        missingOutputs: 0,
        missingDependencies: 0,
        totalItems: 0,
      },
    [data]
  );

  const items = data?.items ?? [];

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(item.status || 'unknown'));
    return Array.from(set).sort();
  }, [items]);

  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(item.providerId || 'default'));
    return Array.from(set).sort();
  }, [items]);

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(item.model || 'default'));
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const searchValue = search.trim().toLowerCase();
    return items.filter((item) => {
      const statusValue = item.status || 'unknown';
      const providerValue = item.providerId || 'default';
      const modelValue = item.model || 'default';

      if (statusFilter.length > 0 && !statusFilter.includes(statusValue)) return false;
      if (providerFilter.length > 0 && !providerFilter.includes(providerValue)) return false;
      if (modelFilter.length > 0 && !modelFilter.includes(modelValue)) return false;

      if (!searchValue) return true;
      const haystack = `${item.title || ''} ${item.featureId} ${item.error || ''}`.toLowerCase();
      return haystack.includes(searchValue);
    });
  }, [items, search, statusFilter, providerFilter, modelFilter]);

  const filteredIds = useMemo(() => filteredItems.map((item) => item.featureId), [filteredItems]);

  const selectedFilteredIds = useMemo(
    () => filteredIds.filter((id) => selectedIds.has(id)),
    [filteredIds, selectedIds]
  );
  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedIds.has(item.featureId)),
    [filteredItems, selectedIds]
  );

  const selectedCount = selectedFilteredIds.length;
  const resumableSelectedCount = useMemo(
    () => selectedItems.filter((item) => item.canResume).length,
    [selectedItems]
  );
  const restorableSelectedCount = useMemo(
    () => selectedItems.filter((item) => item.dependencyRestoreCount > 0).length,
    [selectedItems]
  );
  const isAllFilteredSelected = filteredIds.length > 0 && selectedCount === filteredIds.length;
  const isSomeFilteredSelected = selectedCount > 0 && !isAllFilteredSelected;

  const setActionFlag = (featureId: string, key: keyof ActionState[string], value: boolean) => {
    setActionState((prev) => ({
      ...prev,
      [featureId]: {
        ...prev[featureId],
        [key]: value,
      },
    }));
  };

  const handleRefresh = async () => {
    await refetch();
  };

  const toggleSelection = useCallback((featureId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        filteredIds.forEach((id) => next.add(id));
      } else {
        filteredIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter([]);
    setProviderFilter([]);
    setModelFilter([]);
  };

  const handleReconcile = async (featureId: string) => {
    if (!projectPath) return;
    setActionFlag(featureId, 'reconciling', true);
    try {
      const api = getElectronAPI();
      const result = await api.features?.reconcilePlan?.(projectPath, featureId, {
        rebuildOutput: true,
      });
      if (!result?.success) {
        toast.error('Reconcile failed', { description: result?.error || 'Unknown error' });
      } else {
        toast.success('Reconciled successfully');
        await refetch();
      }
    } finally {
      setActionFlag(featureId, 'reconciling', false);
    }
  };

  const handleRebuild = async (featureId: string) => {
    if (!projectPath) return;
    setActionFlag(featureId, 'rebuilding', true);
    try {
      const api = getElectronAPI();
      const result = await api.features?.rebuildOutput?.(projectPath, featureId);
      if (!result?.success) {
        toast.error('Rebuild failed', { description: result?.error || 'Unknown error' });
      } else {
        toast.success('Output rebuilt');
        await refetch();
      }
    } finally {
      setActionFlag(featureId, 'rebuilding', false);
    }
  };

  const handleResume = async (featureId: string) => {
    if (!projectPath) return;
    setActionFlag(featureId, 'resuming', true);
    try {
      const api = getElectronAPI();
      const result = await api.features?.resumePending?.(projectPath, featureId, useWorktrees);
      if (!result?.success) {
        toast.error('Resume failed', { description: result?.error || 'Unknown error' });
      } else {
        toast.success('Resume started');
        await refetch();
      }
    } finally {
      setActionFlag(featureId, 'resuming', false);
    }
  };

  const handleRestoreDependencies = async (featureId: string) => {
    if (!projectPath) return;
    setActionFlag(featureId, 'restoring', true);
    try {
      const api = getElectronAPI();
      const result = await api.features?.restoreDependencies?.(projectPath, featureId);
      if (!result?.success) {
        toast.error('Restore dependencies failed', {
          description: result?.error || 'Unknown error',
        });
      } else {
        toast.success('Dependencies restored');
        await refetch();
      }
    } finally {
      setActionFlag(featureId, 'restoring', false);
    }
  };

  const handleOpenManualRestore = (featureId: string) => {
    setManualRestoreFeatureId(featureId);
    setManualRestoreOpen(true);
  };

  const handleManualRestoreSave = async (dependencies: string[]) => {
    if (!projectPath || !manualRestoreFeatureId) return;
    const api = getElectronAPI();
    const result = await api.features?.update?.(projectPath, manualRestoreFeatureId, {
      dependencies: dependencies.length > 0 ? dependencies : undefined,
      updatedAt: new Date().toISOString(),
    });
    if (!result?.success) {
      toast.error('Update dependencies failed', {
        description: result?.error || 'Unknown error',
      });
    } else {
      toast.success('Dependencies updated');
      await refetch();
    }
  };

  const runBulkAction = async (action: 'reconcile' | 'rebuild' | 'resume' | 'restore-deps') => {
    if (!projectPath || selectedFilteredIds.length === 0) return;
    let ids = [...selectedFilteredIds];
    if (action === 'resume') {
      ids = selectedItems.filter((item) => item.canResume).map((item) => item.featureId);
      if (ids.length === 0) {
        toast('No resumable tasks selected');
        setBulkAction(null);
        return;
      }
    }
    if (action === 'restore-deps') {
      ids = selectedItems
        .filter((item) => item.dependencyRestoreCount > 0)
        .map((item) => item.featureId);
      if (ids.length === 0) {
        toast('No restorable dependencies selected');
        setBulkAction(null);
        return;
      }
    }
    setBulkAction(action);
    const api = getElectronAPI();
    let successCount = 0;
    let failureCount = 0;

    for (const featureId of ids) {
      try {
        if (action === 'reconcile') {
          const result = await api.features?.reconcilePlan?.(projectPath, featureId, {
            rebuildOutput: true,
          });
          if (result?.success) successCount += 1;
          else failureCount += 1;
        } else if (action === 'rebuild') {
          const result = await api.features?.rebuildOutput?.(projectPath, featureId);
          if (result?.success) successCount += 1;
          else failureCount += 1;
        } else if (action === 'restore-deps') {
          const result = await api.features?.restoreDependencies?.(projectPath, featureId);
          if (result?.success) successCount += 1;
          else failureCount += 1;
        } else {
          const result = await api.features?.resumePending?.(projectPath, featureId, useWorktrees);
          if (result?.success) successCount += 1;
          else failureCount += 1;
        }
      } catch {
        failureCount += 1;
      }
    }

    setBulkAction(null);
    await refetch();
    if (failureCount > 0) {
      toast.error('Bulk action finished', {
        description: `Success: ${successCount}, Failed: ${failureCount}`,
      });
    } else {
      toast.success('Bulk action completed', {
        description: `Processed ${successCount} feature(s).`,
      });
    }
  };

  const FilterPopover = ({
    label,
    options,
    selected,
    onChange,
  }: {
    label: string;
    options: string[];
    selected: string[];
    onChange: (next: string[]) => void;
  }) => {
    const toggle = (value: string) => {
      if (selected.includes(value)) {
        onChange(selected.filter((item) => item !== value));
      } else {
        onChange([...selected, value]);
      }
    };

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <Filter className="h-3.5 w-3.5 mr-2" />
            {label}
            {selected.length > 0 && <span className="ml-2 text-xs">({selected.length})</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            {selected.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onChange([])}
              >
                Clear
              </Button>
            )}
          </div>
          {options.length === 0 ? (
            <div className="text-xs text-muted-foreground">No options</div>
          ) : (
            <div className="max-h-44 overflow-y-auto space-y-2">
              {options.map((option) => (
                <label key={option} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={selected.includes(option)}
                    onCheckedChange={() => toggle(option)}
                  />
                  <span className="truncate">{option}</span>
                </label>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  };

  if (!projectPath) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <AlertTriangle className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Select a project to open Recovery Center</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <Spinner size="xl" />
        <p className="text-muted-foreground mt-4">Loading recovery data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="text-destructive">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-6 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recovery Center</h1>
          <p className="text-muted-foreground text-sm">
            Track incomplete plans, missing outputs, and resume pending work.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Issues</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.total}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Incomplete Plans</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.incompletePlans}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Missing Files</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.missingFiles}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Missing Outputs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.missingOutputs}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Missing Dependencies</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summary.missingDependencies ?? 0}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by title, ID, or error..."
          className="h-8 w-full sm:w-64"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={includeAll} onCheckedChange={(v) => setIncludeAll(v === true)} />
          Show all tasks
        </label>
        <FilterPopover
          label="Status"
          options={statusOptions}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterPopover
          label="Provider"
          options={providerOptions}
          selected={providerFilter}
          onChange={setProviderFilter}
        />
        <FilterPopover
          label="Model"
          options={modelOptions}
          selected={modelFilter}
          onChange={setModelFilter}
        />
        {(search ||
          statusFilter.length > 0 ||
          providerFilter.length > 0 ||
          modelFilter.length > 0) && (
          <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {filteredItems.length === 0 ? (
        <Card className="flex-1">
          <CardContent className="flex flex-col items-center justify-center h-full min-h-[260px]">
            <AlertTriangle className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-lg">
              {items.length === 0 ? 'No recovery issues detected' : 'No items match the filters'}
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              {items.length === 0
                ? 'Everything looks consistent. You can refresh to re-check.'
                : 'Try adjusting filters or clear them to see all issues.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="border border-border/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={
                    isAllFilteredSelected ? true : isSomeFilteredSelected ? 'indeterminate' : false
                  }
                  onCheckedChange={(checked) => handleSelectAllFiltered(checked === true)}
                />
                <div className="text-xs text-muted-foreground">
                  Selected {selectedCount} of {filteredItems.length}
                  {includeAll && summary.totalItems !== undefined && (
                    <span className="ml-2">({summary.total} with issues)</span>
                  )}
                </div>
                {selectedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => runBulkAction('reconcile')}
                  disabled={selectedCount === 0 || bulkAction !== null}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1 ${bulkAction === 'reconcile' ? 'animate-spin' : ''}`}
                  />
                  Reconcile Selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => runBulkAction('rebuild')}
                  disabled={selectedCount === 0 || bulkAction !== null}
                >
                  <RotateCcw
                    className={`h-3.5 w-3.5 mr-1 ${bulkAction === 'rebuild' ? 'animate-spin' : ''}`}
                  />
                  Rebuild Output
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => runBulkAction('resume')}
                  disabled={resumableSelectedCount === 0 || bulkAction !== null}
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Resume Pending Tasks
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => runBulkAction('restore-deps')}
                  disabled={restorableSelectedCount === 0 || bulkAction !== null}
                >
                  <Link2
                    className={`h-3.5 w-3.5 mr-1 ${bulkAction === 'restore-deps' ? 'animate-spin' : ''}`}
                  />
                  Restore Dependencies
                </Button>
              </div>
            </CardContent>
          </Card>

          {filteredItems.map((item) => {
            const state = actionState[item.featureId] || {};
            const planText = item.plan
              ? `${item.plan.tasksCompleted}/${item.plan.tasksTotal}`
              : 'n/a';

            return (
              <Card key={item.featureId} className="border border-border/60">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2">
                      <Checkbox
                        checked={selectedIds.has(item.featureId)}
                        onCheckedChange={() => toggleSelection(item.featureId)}
                      />
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">
                          {item.title || item.featureId}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground truncate">{item.featureId}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">
                      {formatStatus(item.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Plan: {planText}</span>
                    {item.plan?.status && <span>Status: {item.plan.status}</span>}
                    {item.planningMode && <span>Planning: {item.planningMode}</span>}
                    {item.missingFiles.length > 0 && (
                      <span className="text-amber-500">
                        Missing files: {item.missingFiles.length}
                      </span>
                    )}
                    {item.dependencyRestoreCount > 0 && (
                      <span className="text-amber-500">
                        Missing dependencies: {item.dependencyRestoreCount}
                      </span>
                    )}
                    {!item.hasAgentOutput && <span className="text-amber-500">Output missing</span>}
                  </div>

                  {(item.providerId || item.model) && (
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={`${item.providerId ?? ''} ${item.model ?? ''}`.trim()}
                    >
                      Provider: {item.providerId || 'default'} / Model: {item.model || 'default'}
                    </div>
                  )}

                  {item.error && (
                    <div className="text-xs text-destructive break-words">
                      <span className="font-medium">Error:</span> {item.error}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {item.issues.map((issue) => (
                      <Badge key={issue} variant="secondary" className="text-xs">
                        {issue}
                      </Badge>
                    ))}
                  </div>

                  {item.missingFiles.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Missing files</div>
                      <div className="mt-1 space-y-1">
                        {item.missingFiles.slice(0, 4).map((file) => (
                          <div key={file} className="truncate" title={file}>
                            {file}
                          </div>
                        ))}
                        {item.missingFiles.length > 4 && (
                          <div className="text-muted-foreground">
                            +{item.missingFiles.length - 4} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {item.dependencyRestoreCount > 0 && (
                    <div className="text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Missing dependencies</div>
                      <div className="mt-1 space-y-1">
                        {item.dependencyRestoreCandidates.map((depId) => (
                          <div key={depId} className="truncate" title={depId}>
                            {depId}
                          </div>
                        ))}
                        {item.dependencyRestoreCount > item.dependencyRestoreCandidates.length && (
                          <div className="text-muted-foreground">
                            +{item.dependencyRestoreCount - item.dependencyRestoreCandidates.length}{' '}
                            more
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReconcile(item.featureId)}
                      disabled={state.reconciling}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${state.reconciling ? 'animate-spin' : ''}`}
                      />
                      Reconcile
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRebuild(item.featureId)}
                      disabled={state.rebuilding}
                    >
                      <RotateCcw
                        className={`h-4 w-4 mr-2 ${state.rebuilding ? 'animate-spin' : ''}`}
                      />
                      Rebuild Output
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleResume(item.featureId)}
                      disabled={!item.canResume || state.resuming}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Resume Pending Tasks
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestoreDependencies(item.featureId)}
                      disabled={item.dependencyRestoreCount === 0 || state.restoring}
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      Restore Dependencies
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenManualRestore(item.featureId)}
                    >
                      <PencilLine className="h-4 w-4 mr-2" />
                      Manual Dependencies
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RestoreDependenciesDialog
        open={manualRestoreOpen}
        onOpenChange={(open) => {
          setManualRestoreOpen(open);
          if (!open) {
            setManualRestoreFeatureId(null);
          }
        }}
        feature={allFeatures.find((feature) => feature.id === manualRestoreFeatureId) ?? null}
        features={allFeatures}
        projectPath={projectPath}
        onSave={handleManualRestoreSave}
      />
    </div>
  );
}
