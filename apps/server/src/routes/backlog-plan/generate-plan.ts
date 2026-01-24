/**
 * Generate backlog plan using Claude AI
 *
 * Model is configurable via phaseModels.backlogPlanningModel in settings
 * (defaults to Sonnet). Can be overridden per-call via model parameter.
 */

import type { EventEmitter } from '../../lib/events.js';
import type { Feature, BacklogPlanResult, BacklogChange, DependencyUpdate } from '@automaker/types';
import {
  DEFAULT_PHASE_MODELS,
  isCursorModel,
  stripProviderPrefix,
  type ThinkingLevel,
} from '@automaker/types';
import { resolvePhaseModel } from '@automaker/model-resolver';
import { FeatureLoader } from '../../services/feature-loader.js';
import { ProviderFactory } from '../../providers/provider-factory.js';
import { extractJsonWithArray } from '../../lib/json-extractor.js';
import {
  logger,
  setRunningState,
  setRunningDetails,
  getErrorMessage,
  saveBacklogPlan,
} from './common.js';
import type { SettingsService } from '../../services/settings-service.js';
import {
  getAutoLoadClaudeMdSetting,
  getPromptCustomization,
  getPhaseModelWithOverrides,
  getProviderById,
  getProviderByModelId,
} from '../../lib/settings-helpers.js';

const featureLoader = new FeatureLoader();

/**
 * Format features for the AI prompt
 */
function formatFeaturesForPrompt(features: Feature[]): string {
  if (features.length === 0) {
    return 'No features in backlog yet.';
  }

  return features
    .map((f) => {
      const deps = f.dependencies?.length ? `Dependencies: [${f.dependencies.join(', ')}]` : '';
      const priority = f.priority !== undefined ? `Priority: ${f.priority}` : '';
      return `- ID: ${f.id}
  Title: ${f.title || 'Untitled'}
  Description: ${f.description}
  Category: ${f.category}
  Status: ${f.status || 'backlog'}
  ${priority}
  ${deps}`.trim();
    })
    .join('\n\n');
}

/**
 * Parse the AI response into a BacklogPlanResult
 */
function parsePlanResponse(response: string): BacklogPlanResult {
  // Use shared JSON extraction utility for robust parsing
  // extractJsonWithArray validates that 'changes' exists AND is an array
  const parsed = extractJsonWithArray<BacklogPlanResult>(response, 'changes', {
    logger,
  });

  if (parsed) {
    return parsed;
  }

  // If parsing fails, log details and return an empty result
  logger.warn('[BacklogPlan] Failed to parse AI response as JSON');
  logger.warn('[BacklogPlan] Response text length:', response.length);
  logger.warn('[BacklogPlan] Response preview:', response.slice(0, 500));
  if (response.length === 0) {
    logger.error('[BacklogPlan] Response text is EMPTY! No content was extracted from stream.');
  }
  return {
    changes: [],
    summary: 'Failed to parse AI response',
    dependencyUpdates: [],
  };
}

/**
 * Generate a backlog modification plan based on user prompt
 */
export async function generateBacklogPlan(
  projectPath: string,
  prompt: string,
  events: EventEmitter,
  abortController: AbortController,
  settingsService?: SettingsService,
  model?: string,
  providerId?: string
): Promise<BacklogPlanResult> {
  try {
    // Load current features
    const features = await featureLoader.getAll(projectPath);

    events.emit('backlog-plan:event', {
      type: 'backlog_plan_progress',
      content: `Loaded ${features.length} features from backlog`,
    });

    // Load prompts from settings
    const prompts = await getPromptCustomization(settingsService, '[BacklogPlan]');

    // Build the system prompt
    const systemPrompt = prompts.backlogPlan.systemPrompt;

    // Build the user prompt from template
    const currentFeatures = formatFeaturesForPrompt(features);
    const userPrompt = prompts.backlogPlan.userPromptTemplate
      .replace('{{currentFeatures}}', currentFeatures)
      .replace('{{userRequest}}', prompt);

    events.emit('backlog-plan:event', {
      type: 'backlog_plan_progress',
      content: 'Generating plan with AI...',
    });

    // Get the model to use from settings or provided override with provider info
    let effectiveModel = model;
    let thinkingLevel: ThinkingLevel | undefined;
    let claudeCompatibleProvider: import('@automaker/types').ClaudeCompatibleProvider | undefined;
    let credentials: import('@automaker/types').Credentials | undefined;

    if (effectiveModel) {
      // Use explicit override - resolve provider if provided
      credentials = await settingsService?.getCredentials();

      if (settingsService) {
        if (providerId) {
          const providerResult = await getProviderById(
            providerId,
            settingsService,
            '[BacklogPlan]'
          );
          if (providerResult.provider) {
            claudeCompatibleProvider = providerResult.provider;
            credentials = providerResult.credentials ?? credentials;
            logger.info(
              `[BacklogPlan] Using provider "${providerResult.provider.name}" (id: ${providerId})`
            );
          } else {
            logger.warn(
              `[BacklogPlan] Provider id "${providerId}" not found or disabled; falling back to model lookup`
            );
          }
        }

        if (!claudeCompatibleProvider) {
          const providerResult = await getProviderByModelId(
            effectiveModel,
            settingsService,
            '[BacklogPlan]'
          );
          if (providerResult.provider) {
            claudeCompatibleProvider = providerResult.provider;
            credentials = providerResult.credentials ?? credentials;
            logger.info(
              `[BacklogPlan] Using provider "${providerResult.provider.name}" for model "${effectiveModel}"`
            );
          }
        }
      }
    } else if (settingsService) {
      // Use settings-based model with provider info
      const phaseResult = await getPhaseModelWithOverrides(
        'backlogPlanningModel',
        settingsService,
        projectPath,
        '[BacklogPlan]'
      );
      const resolved = resolvePhaseModel(phaseResult.phaseModel);
      effectiveModel = resolved.model;
      thinkingLevel = resolved.thinkingLevel;
      claudeCompatibleProvider = phaseResult.provider;
      credentials = phaseResult.credentials;
    } else {
      // Fallback to defaults
      const resolved = resolvePhaseModel(DEFAULT_PHASE_MODELS.backlogPlanningModel);
      effectiveModel = resolved.model;
      thinkingLevel = resolved.thinkingLevel;
    }
    logger.info(
      '[BacklogPlan] Using model:',
      effectiveModel,
      claudeCompatibleProvider ? `via provider: ${claudeCompatibleProvider.name}` : 'direct API'
    );

    const provider = ProviderFactory.getProviderForModel(effectiveModel);
    // Strip provider prefix - providers expect bare model IDs
    const bareModel = stripProviderPrefix(effectiveModel);

    // Get autoLoadClaudeMd setting
    const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(
      projectPath,
      settingsService,
      '[BacklogPlan]'
    );

    // For Cursor and Claude-compatible proxy models, embed the system prompt
    // because some providers do not respect a separate system prompt channel.
    let finalPrompt = userPrompt;
    let finalSystemPrompt: string | undefined = systemPrompt;

    const embedSystemPrompt = isCursorModel(effectiveModel) || Boolean(claudeCompatibleProvider);
    if (embedSystemPrompt) {
      const providerLabel = isCursorModel(effectiveModel) ? 'Cursor' : 'Claude-compatible provider';
      logger.info(
        `[BacklogPlan] Using ${providerLabel} - embedding system prompt with strict JSON instructions`
      );
      finalPrompt = `${systemPrompt}

CRITICAL INSTRUCTIONS:
1. DO NOT write any files. Return the JSON in your response only.
2. DO NOT use Write, Edit, or any file modification tools.
3. Respond with ONLY a JSON object - no explanations, no markdown, just raw JSON.
4. Your entire response should be valid JSON starting with { and ending with }.
5. No text before or after the JSON object.

${userPrompt}`;
      finalSystemPrompt = undefined; // System prompt is now embedded in the user prompt
    }

    // Execute the query
    const stream = provider.executeQuery({
      prompt: finalPrompt,
      model: bareModel,
      cwd: projectPath,
      systemPrompt: finalSystemPrompt,
      maxTurns: 1,
      allowedTools: [], // No tools needed for this
      abortController,
      settingSources: autoLoadClaudeMd ? ['user', 'project'] : undefined,
      readOnly: true, // Plan generation only generates text, doesn't write files
      thinkingLevel, // Pass thinking level for extended thinking
      claudeCompatibleProvider, // Pass provider for alternative endpoint configuration
      credentials, // Pass credentials for resolving 'credentials' apiKeySource
    });

    let responseText = '';

    for await (const msg of stream) {
      if (abortController.signal.aborted) {
        throw new Error('Generation aborted');
      }

      if (msg.type === 'assistant') {
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              responseText += block.text;
            }
          }
        }
      } else if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
        // Use result if it's a final accumulated message
        logger.info('[BacklogPlan] Received result, length:', msg.result.length);
        logger.info('[BacklogPlan] Previous responseText length:', responseText.length);
        if (msg.result.length > responseText.length) {
          logger.info('[BacklogPlan] Using result (longer than accumulated text)');
          responseText = msg.result;
        } else {
          logger.info('[BacklogPlan] Keeping accumulated text (longer than result)');
        }
      }
    }

    if (!responseText.trim()) {
      throw new Error('Empty response from provider');
    }

    // Parse the response
    const result = parsePlanResponse(responseText);
    if (result.summary === 'Failed to parse AI response') {
      throw new Error('Failed to parse AI response');
    }

    await saveBacklogPlan(projectPath, {
      savedAt: new Date().toISOString(),
      prompt,
      model: effectiveModel,
      result,
    });

    events.emit('backlog-plan:event', {
      type: 'backlog_plan_complete',
      result,
    });

    return result;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BacklogPlan] Generation failed:', errorMessage);

    events.emit('backlog-plan:event', {
      type: 'backlog_plan_error',
      error: errorMessage,
    });

    throw error;
  } finally {
    setRunningState(false, null);
    setRunningDetails(null);
  }
}
