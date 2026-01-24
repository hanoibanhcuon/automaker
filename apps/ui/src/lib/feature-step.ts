import type { Feature } from '@/store/app-store';
import { resolveDependencies } from '@automaker/dependency-resolver';

export interface BacklogStepResult {
  stepMap: Record<string, number>;
  orderedFeatures: Feature[];
}

/**
 * Compute dependency-aware execution order for all features.
 * Backlog steps are numbered sequentially based on this order.
 */
export function getBacklogStepResult(features: Feature[]): BacklogStepResult {
  const { orderedFeatures } = resolveDependencies(features);
  const stepMap: Record<string, number> = {};
  let stepCounter = 0;

  orderedFeatures.forEach((feature) => {
    if (feature.status === 'backlog') {
      stepCounter += 1;
      stepMap[feature.id] = stepCounter;
    }
  });

  return { stepMap, orderedFeatures };
}
