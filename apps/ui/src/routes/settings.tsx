import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingState } from '@/components/ui/loading-state';
import type { SettingsViewId } from '@/components/views/settings-view/hooks';

const SettingsView = lazy(() =>
  import('@/components/views/settings-view').then((mod) => ({
    default: mod.SettingsView,
  }))
);

interface SettingsSearchParams {
  view?: SettingsViewId;
}

export const Route = createFileRoute('/settings')({
  component: () => (
    <Suspense fallback={<LoadingState message="Loading settings..." />}>
      <SettingsView />
    </Suspense>
  ),
  validateSearch: (search: Record<string, unknown>): SettingsSearchParams => {
    return {
      view: search.view as SettingsViewId | undefined,
    };
  },
});
