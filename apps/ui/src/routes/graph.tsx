import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingState } from '@/components/ui/loading-state';

const GraphViewPage = lazy(() =>
  import('@/components/views/graph-view-page').then((mod) => ({
    default: mod.GraphViewPage,
  }))
);

export const Route = createFileRoute('/graph')({
  component: () => (
    <Suspense fallback={<LoadingState message="Loading graph..." />}>
      <GraphViewPage />
    </Suspense>
  ),
});
