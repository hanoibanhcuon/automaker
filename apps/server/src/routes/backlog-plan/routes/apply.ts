/**
 * POST /apply endpoint - Apply a backlog plan
 */

import type { Request, Response } from 'express';
import type { BacklogPlanResult, BacklogChange, Feature } from '@automaker/types';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { clearBacklogPlan, getErrorMessage, logError, logger } from '../common.js';
import type { SettingsService } from '../../../services/settings-service.js';

const featureLoader = new FeatureLoader();

const FOUNDATION_KEYWORDS = [
  'tai lieu',
  'tài liệu',
  'dac ta',
  'đặc tả',
  'spec',
  'yeu cau',
  'yêu cầu',
  'phan tich',
  'phân tích',
  'thiet ke',
  'thiết kế',
  'kien truc',
  'kiến trúc',
  'architecture',
  'database',
  'co so du lieu',
  'cơ sở dữ liệu',
  'schema',
  'data model',
];

function normalizeText(input?: string): string {
  return (input || '').toLowerCase();
}

function isFoundationFeature(feature: Partial<Feature>): boolean {
  const text = `${normalizeText(feature.title)} ${normalizeText(feature.description)}`;
  return FOUNDATION_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function createApplyHandler(settingsService?: SettingsService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        projectPath,
        plan,
        branchName: rawBranchName,
      } = req.body as {
        projectPath: string;
        plan: BacklogPlanResult;
        branchName?: string;
      };

      // Validate branchName: must be undefined or a non-empty trimmed string
      const branchName =
        typeof rawBranchName === 'string' && rawBranchName.trim().length > 0
          ? rawBranchName.trim()
          : undefined;

      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath required' });
        return;
      }

      if (!plan || !plan.changes) {
        res.status(400).json({ success: false, error: 'plan with changes required' });
        return;
      }

      const appliedChanges: string[] = [];

      const globalSettings = settingsService ? await settingsService.getGlobalSettings() : null;
      const defaultPlanningMode = globalSettings?.defaultPlanningMode ?? 'skip';
      const defaultRequirePlanApproval = globalSettings?.defaultRequirePlanApproval ?? false;

      // Load current features for dependency validation
      const allFeatures = await featureLoader.getAll(projectPath);
      const featureMap = new Map(allFeatures.map((f) => [f.id, f]));
      const existingIds = new Set(allFeatures.map((f) => f.id));

      // Process changes in order: deletes first, then adds, then updates
      // This ensures we can remove dependencies before they cause issues

      // 1. First pass: Handle deletes
      const deletions = plan.changes.filter((c) => c.type === 'delete');
      for (const change of deletions) {
        if (!change.featureId) continue;

        try {
          // Before deleting, update any features that depend on this one
          for (const feature of allFeatures) {
            if (feature.dependencies?.includes(change.featureId)) {
              const newDeps = feature.dependencies.filter((d) => d !== change.featureId);
              await featureLoader.update(projectPath, feature.id, { dependencies: newDeps });
              logger.info(
                `[BacklogPlan] Removed dependency ${change.featureId} from ${feature.id}`
              );
            }
          }

          // Now delete the feature
          const deleted = await featureLoader.delete(projectPath, change.featureId);
          if (deleted) {
            appliedChanges.push(`deleted:${change.featureId}`);
            featureMap.delete(change.featureId);
            logger.info(`[BacklogPlan] Deleted feature ${change.featureId}`);
          }
        } catch (error) {
          logger.error(
            `[BacklogPlan] Failed to delete ${change.featureId}:`,
            getErrorMessage(error)
          );
        }
      }

      // 2. Second pass: Handle adds
      const additions = plan.changes.filter((c) => c.type === 'add');
      const additionIds = additions
        .map((change) => change.feature?.id)
        .filter((id): id is string => Boolean(id && id.trim().length > 0));
      const foundationIds = additions
        .filter((change) => change.feature && isFoundationFeature(change.feature))
        .map((change) => change.feature?.id)
        .filter((id): id is string => Boolean(id && id.trim().length > 0));
      const effectiveFoundationIds =
        foundationIds.length > 0 ? foundationIds : additionIds.slice(0, 1);

      const resolveDependencies = (feature: Partial<Feature>): string[] => {
        const rawDeps = Array.isArray(feature.dependencies) ? feature.dependencies : [];
        const validDeps = rawDeps.filter(
          (dep) => existingIds.has(dep) || additionIds.includes(dep)
        );
        if (validDeps.length > 0) return validDeps;
        if (isFoundationFeature(feature)) return [];
        return effectiveFoundationIds.filter((dep) => dep && dep !== feature.id);
      };

      for (const change of additions) {
        if (!change.feature) continue;

        try {
          const resolvedDependencies = resolveDependencies(change.feature);
          // Create the new feature - use the AI-generated ID if provided
          const newFeature = await featureLoader.create(projectPath, {
            id: change.feature.id, // Use descriptive ID from AI if provided
            title: change.feature.title,
            description: change.feature.description || '',
            category: change.feature.category || 'Uncategorized',
            dependencies: resolvedDependencies,
            priority: change.feature.priority,
            status: 'backlog',
            branchName,
            planningMode: change.feature.planningMode ?? defaultPlanningMode,
            requirePlanApproval: change.feature.requirePlanApproval ?? defaultRequirePlanApproval,
          });

          appliedChanges.push(`added:${newFeature.id}`);
          featureMap.set(newFeature.id, newFeature);
          logger.info(`[BacklogPlan] Created feature ${newFeature.id}: ${newFeature.title}`);
          if (
            (!change.feature.dependencies || change.feature.dependencies.length === 0) &&
            resolvedDependencies.length > 0
          ) {
            logger.info(
              `[BacklogPlan] Auto-enforced dependencies for ${newFeature.id}: ${resolvedDependencies.join(
                ', '
              )}`
            );
          }
        } catch (error) {
          logger.error(`[BacklogPlan] Failed to add feature:`, getErrorMessage(error));
        }
      }

      // 3. Third pass: Handle updates
      const updates = plan.changes.filter((c) => c.type === 'update');
      for (const change of updates) {
        if (!change.featureId || !change.feature) continue;

        try {
          const updated = await featureLoader.update(projectPath, change.featureId, change.feature);
          appliedChanges.push(`updated:${change.featureId}`);
          featureMap.set(change.featureId, updated);
          logger.info(`[BacklogPlan] Updated feature ${change.featureId}`);
        } catch (error) {
          logger.error(
            `[BacklogPlan] Failed to update ${change.featureId}:`,
            getErrorMessage(error)
          );
        }
      }

      // 4. Apply dependency updates from the plan
      if (plan.dependencyUpdates) {
        for (const depUpdate of plan.dependencyUpdates) {
          try {
            const feature = featureMap.get(depUpdate.featureId);
            if (feature) {
              const currentDeps = feature.dependencies || [];
              const newDeps = currentDeps
                .filter((d) => !depUpdate.removedDependencies.includes(d))
                .concat(depUpdate.addedDependencies.filter((d) => !currentDeps.includes(d)));

              await featureLoader.update(projectPath, depUpdate.featureId, {
                dependencies: newDeps,
              });
              logger.info(`[BacklogPlan] Updated dependencies for ${depUpdate.featureId}`);
            }
          } catch (error) {
            logger.error(
              `[BacklogPlan] Failed to update dependencies for ${depUpdate.featureId}:`,
              getErrorMessage(error)
            );
          }
        }
      }

      // Clear the plan before responding
      try {
        await clearBacklogPlan(projectPath);
      } catch (error) {
        logger.warn(
          `[BacklogPlan] Failed to clear backlog plan after apply:`,
          getErrorMessage(error)
        );
        // Don't throw - operation succeeded, just cleanup failed
      }

      res.json({
        success: true,
        appliedChanges,
      });
    } catch (error) {
      logError(error, 'Apply backlog plan failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
