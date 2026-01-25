/**
 * POST /replan-feature endpoint - Replan a feature from scratch (Full planning)
 */

import type { Request, Response } from 'express';
import type { AutoModeService } from '../../../services/auto-mode-service.js';
import { createLogger } from '@automaker/utils';
import { getErrorMessage, logError } from '../common.js';

const logger = createLogger('AutoMode');

export function createReplanFeatureHandler(autoModeService: AutoModeService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId, useWorktrees } = req.body as {
        projectPath: string;
        featureId: string;
        useWorktrees?: boolean;
      };

      if (!projectPath || !featureId) {
        res.status(400).json({
          success: false,
          error: 'projectPath and featureId are required',
        });
        return;
      }

      // Check per-worktree capacity before starting
      const capacity = await autoModeService.checkWorktreeCapacity(projectPath, featureId);
      if (!capacity.hasCapacity) {
        const worktreeDesc = capacity.branchName
          ? `worktree "${capacity.branchName}"`
          : 'main worktree';
        res.status(429).json({
          success: false,
          error: `Agent limit reached for ${worktreeDesc} (${capacity.currentAgents}/${capacity.maxAgents}). Wait for running tasks to complete or increase the limit.`,
          details: {
            currentAgents: capacity.currentAgents,
            maxAgents: capacity.maxAgents,
            branchName: capacity.branchName,
          },
        });
        return;
      }

      // Start execution in background
      autoModeService
        .replanFeature(projectPath, featureId, useWorktrees ?? false)
        .catch((error) => {
          logger.error(`Replan feature ${featureId} error:`, error);
        });

      res.json({ success: true });
    } catch (error) {
      logError(error, 'Replan feature failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
