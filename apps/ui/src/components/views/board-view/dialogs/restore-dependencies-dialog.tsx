'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DependencySelector } from '@/components/ui/dependency-selector';
import type { Feature } from '@/store/app-store';
import { Link2 } from 'lucide-react';
import { getElectronAPI } from '@/lib/electron';

interface RestoreDependenciesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: Feature | null;
  features: Feature[];
  projectPath?: string | null;
  onSave: (dependencies: string[]) => Promise<void> | void;
}

export function RestoreDependenciesDialog({
  open,
  onOpenChange,
  feature,
  features,
  projectPath,
  onSave,
}: RestoreDependenciesDialogProps) {
  const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{ id: string; label: string; source: 'plan' | 'timeline' | 'history' }>
  >([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useEffect(() => {
    if (!feature) return;
    setSelectedDependencies(feature.dependencies ?? []);
  }, [feature?.id]);

  const getFeatureLabel = (item: Feature): string => {
    if (item.title && item.title.trim()) {
      return item.title;
    }
    const desc = item.description || '';
    return desc.length > 60 ? `${desc.slice(0, 57)}...` : desc;
  };

  useEffect(() => {
    if (!open || !feature || !projectPath) {
      setSuggestions([]);
      return;
    }

    let isActive = true;
    const loadSuggestions = async () => {
      setIsLoadingSuggestions(true);
      const api = getElectronAPI();
      const suggestionMap = new Map<
        string,
        { id: string; label: string; source: 'plan' | 'timeline' | 'history' }
      >();
      const availableIds = new Set(features.map((item) => item.id));

      const addSuggestion = (
        id: string,
        source: 'plan' | 'timeline' | 'history',
        labelOverride?: string
      ) => {
        if (id === feature.id || !availableIds.has(id)) return;
        if (suggestionMap.has(id)) return;
        const target = features.find((item) => item.id === id);
        if (!target) return;
        suggestionMap.set(id, {
          id,
          label: labelOverride ?? getFeatureLabel(target),
          source,
        });
      };

      if (feature.planSpec?.content) {
        const content = feature.planSpec.content.toLowerCase();
        features.forEach((item) => {
          if (item.id === feature.id) return;
          if (content.includes(item.id.toLowerCase())) {
            addSuggestion(item.id, 'plan');
            return;
          }
          if (item.title) {
            const titleValue = item.title.trim().toLowerCase();
            if (titleValue.length > 4 && content.includes(titleValue)) {
              addSuggestion(item.id, 'plan');
            }
          }
        });
      }

      try {
        const restoreResult = await api.features?.restoreDependencies?.(projectPath, feature.id, {
          dryRun: true,
        });
        const restoreEntry = restoreResult?.results?.[0];
        if (restoreEntry?.restoredDependencies) {
          restoreEntry.restoredDependencies.forEach((depId) => addSuggestion(depId, 'history'));
        }
        if (restoreEntry?.candidates) {
          restoreEntry.candidates.forEach((depId) => addSuggestion(depId, 'plan'));
        }
      } catch {
        // Ignore suggestion errors
      }

      try {
        const timeline = await api.features?.getTimeline?.(projectPath, feature.id);
        const timelineEntries = timeline?.timeline ?? [];
        const idRegex = /feature-\d+-[a-z0-9]+/gi;
        timelineEntries.forEach((entry) => {
          const haystack = `${entry.title ?? ''} ${entry.detail ?? ''}`.toLowerCase();
          const matches = haystack.match(idRegex);
          if (matches) {
            matches.forEach((match) => addSuggestion(match, 'timeline'));
          }
        });
      } catch {
        // Ignore timeline errors
      }

      const existingDeps = new Set(feature.dependencies ?? []);
      const orderedSuggestions = Array.from(suggestionMap.values()).filter(
        (item) => !existingDeps.has(item.id)
      );
      if (isActive) {
        setSuggestions(orderedSuggestions.slice(0, 8));
      }
      setIsLoadingSuggestions(false);
    };

    loadSuggestions();
    return () => {
      isActive = false;
    };
  }, [open, feature?.id, projectPath, features]);

  const title = useMemo(() => feature?.title || feature?.id || 'Feature', [feature]);

  if (!feature) return null;

  const handleAddSuggestion = (id: string) => {
    if (!selectedDependencies.includes(id)) {
      setSelectedDependencies((prev) => [...prev, id]);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(selectedDependencies);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="restore-dependencies-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Restore Dependencies
          </DialogTitle>
          <DialogDescription>
            Manually select dependencies for <span className="font-medium">{title}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {(isLoadingSuggestions || suggestions.length > 0) && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Suggested dependencies
              </div>
              {isLoadingSuggestions ? (
                <div className="text-xs text-muted-foreground">Loading suggestions...</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((item) => (
                    <Button
                      key={item.id}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleAddSuggestion(item.id)}
                      title={`Suggested from ${item.source}`}
                    >
                      + {item.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          <DependencySelector
            currentFeatureId={feature.id}
            value={selectedDependencies}
            onChange={setSelectedDependencies}
            features={features}
            type="parent"
            placeholder="Select dependencies..."
            data-testid="restore-dependencies-selector"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            Save Dependencies
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
