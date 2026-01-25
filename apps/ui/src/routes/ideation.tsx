import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingState } from '@/components/ui/loading-state';

const IdeationView = lazy(() =>
  import('@/components/views/ideation-view').then((mod) => ({
    default: mod.IdeationView,
  }))
);

export const Route = createFileRoute('/ideation')({
  component: () => (
    <Suspense fallback={<LoadingState message="Loading ideation..." />}>
      <IdeationView />
    </Suspense>
  ),
});
