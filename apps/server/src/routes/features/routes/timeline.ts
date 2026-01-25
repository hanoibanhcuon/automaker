/**
 * POST /timeline endpoint - get feature execution timeline
 */

import type { Request, Response } from 'express';
import { FeatureLoader } from '../../../services/feature-loader.js';
import { getErrorMessage, logError } from '../common.js';
import {
  reconcileFeaturePlanSpec,
  hasPlanSpecChanges,
  type ParsedTask,
} from '../utils/plan-reconcile.js';
import * as secureFs from '../../../lib/secure-fs.js';
import path from 'path';

interface TimelineEntry {
  id: string;
  type:
    | 'feature_started'
    | 'plan_generated'
    | 'plan_approved'
    | 'task_started'
    | 'task_completed'
    | 'file_changed';
  title: string;
  detail?: string;
  timestamp: string;
}

interface FileActivity {
  toolName: string;
  filePath: string;
}

function calculateBracketDepth(line: string): { braceChange: number; bracketChange: number } {
  let braceChange = 0;
  let bracketChange = 0;
  let inString = false;
  let escapeNext = false;

  for (const char of line) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') braceChange++;
    else if (char === '}') braceChange--;
    else if (char === '[') bracketChange++;
    else if (char === ']') bracketChange--;
  }

  return { braceChange, bracketChange };
}

function extractFileActivitiesFromOutput(output: string): FileActivity[] {
  if (!output) return [];

  const activities: FileActivity[] = [];
  const lines = output.split('\n');

  let currentTool: string | null = null;
  let jsonBuffer: string | null = null;
  let braceDepth = 0;
  let bracketDepth = 0;

  const flushJson = () => {
    if (!currentTool || jsonBuffer === null) return;
    const trimmed = jsonBuffer.trim();
    if (!trimmed) {
      jsonBuffer = null;
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const filePath =
        (typeof parsed.file_path === 'string' && parsed.file_path) ||
        (typeof parsed.path === 'string' && parsed.path) ||
        (typeof parsed.notebook_path === 'string' && parsed.notebook_path) ||
        undefined;
      if (filePath) {
        activities.push({ toolName: currentTool, filePath });
      }
    } catch {
      // Ignore malformed JSON
    }
    jsonBuffer = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    const toolMatch = trimmed.match(/Tool:\s*(\S+)/);
    if (toolMatch) {
      currentTool = toolMatch[1];
      jsonBuffer = null;
      braceDepth = 0;
      bracketDepth = 0;
      continue;
    }

    if (!currentTool) continue;

    if (trimmed.startsWith('Input:')) {
      const remainder = trimmed.replace(/^Input:\s*/, '');
      jsonBuffer = remainder ? remainder : '';
      const { braceChange, bracketChange } = calculateBracketDepth(remainder);
      braceDepth = braceChange;
      bracketDepth = bracketChange;
      if (braceDepth <= 0 && bracketDepth <= 0 && remainder) {
        flushJson();
      }
      continue;
    }

    if (jsonBuffer !== null) {
      jsonBuffer += `\n${line}`;
      const { braceChange, bracketChange } = calculateBracketDepth(trimmed);
      braceDepth += braceChange;
      bracketDepth += bracketChange;
      if (braceDepth <= 0 && bracketDepth <= 0) {
        flushJson();
      }
    }
  }

  return activities;
}

async function buildFileTimelineEntries(
  projectPath: string,
  output: string
): Promise<TimelineEntry[]> {
  const activities = extractFileActivitiesFromOutput(output);
  if (activities.length === 0) return [];

  const latestByPath = new Map<string, { toolName: string; mtime: string }>();

  for (const activity of activities) {
    const resolvedPath = path.isAbsolute(activity.filePath)
      ? activity.filePath
      : path.join(projectPath, activity.filePath);

    try {
      const stat = await secureFs.stat(resolvedPath);
      const existing = latestByPath.get(activity.filePath);
      const mtime = stat.mtime.toISOString();
      if (!existing || new Date(mtime).getTime() > new Date(existing.mtime).getTime()) {
        latestByPath.set(activity.filePath, { toolName: activity.toolName, mtime });
      }
    } catch {
      // Ignore missing files (could be deleted or not written yet)
    }
  }

  const entries: TimelineEntry[] = [];
  for (const [filePath, info] of latestByPath.entries()) {
    const toolLabel =
      info.toolName === 'Write'
        ? 'File created/updated'
        : info.toolName === 'Edit'
          ? 'File updated'
          : info.toolName === 'Delete'
            ? 'File deleted'
            : 'File activity';
    entries.push({
      id: `file-${filePath}-${info.mtime}`,
      type: 'file_changed',
      title: toolLabel,
      detail: filePath,
      timestamp: info.mtime,
    });
  }

  return entries;
}

function buildTimelineEntries(feature: any, tasks?: ParsedTask[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  if (feature.startedAt) {
    entries.push({
      id: `feature-started-${feature.startedAt}`,
      type: 'feature_started',
      title: 'Feature started',
      timestamp: feature.startedAt,
    });
  }

  if (feature.planSpec?.generatedAt) {
    entries.push({
      id: `plan-generated-${feature.planSpec.generatedAt}`,
      type: 'plan_generated',
      title: 'Execution plan generated',
      timestamp: feature.planSpec.generatedAt,
    });
  }

  if (feature.planSpec?.approvedAt) {
    entries.push({
      id: `plan-approved-${feature.planSpec.approvedAt}`,
      type: 'plan_approved',
      title: 'Execution plan approved',
      timestamp: feature.planSpec.approvedAt,
    });
  }

  if (tasks && tasks.length > 0) {
    for (const task of tasks) {
      if (task.startedAt) {
        entries.push({
          id: `task-started-${task.id}-${task.startedAt}`,
          type: 'task_started',
          title: `${task.id} started`,
          detail: task.description,
          timestamp: task.startedAt,
        });
      }

      if (task.completedAt) {
        entries.push({
          id: `task-completed-${task.id}-${task.completedAt}`,
          type: 'task_completed',
          title: `${task.id} completed`,
          detail: task.filePath ? `${task.description} (${task.filePath})` : task.description,
          timestamp: task.completedAt,
        });
      }
    }
  }

  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function createTimelineHandler(featureLoader: FeatureLoader) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId, includeFileActivity } = req.body as {
        projectPath: string;
        featureId: string;
        includeFileActivity?: boolean;
      };

      if (!projectPath || !featureId) {
        res.status(400).json({
          success: false,
          error: 'projectPath and featureId are required',
        });
        return;
      }

      const feature = await featureLoader.get(projectPath, featureId);
      if (!feature) {
        res.status(404).json({ success: false, error: 'Feature not found' });
        return;
      }

      const reconciled = await reconcileFeaturePlanSpec(projectPath, feature);
      let updatedFeature = feature;

      if (reconciled && hasPlanSpecChanges(feature.planSpec || {}, reconciled)) {
        const updatedPlanSpec = {
          ...feature.planSpec,
          tasks: reconciled.tasks,
          tasksCompleted: reconciled.tasksCompleted,
          tasksTotal: reconciled.tasksTotal,
          currentTaskId: reconciled.currentTaskId,
        };
        updatedFeature = await featureLoader.update(projectPath, featureId, {
          planSpec: updatedPlanSpec as any,
          updatedAt: new Date().toISOString(),
        });
      }

      const planTasks = (updatedFeature.planSpec as any)?.tasks as ParsedTask[] | undefined;
      const timeline = buildTimelineEntries(updatedFeature, planTasks);

      if (includeFileActivity) {
        try {
          const agentOutputPath = featureLoader.getAgentOutputPath(projectPath, featureId);
          const output = (await secureFs.readFile(agentOutputPath, 'utf-8')) as string;
          const fileEntries = await buildFileTimelineEntries(projectPath, output);
          timeline.push(...fileEntries);
        } catch {
          // No output available or unreadable, ignore
        }
      }

      timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      res.json({ success: true, timeline });
    } catch (error) {
      logError(error, 'Get timeline failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
