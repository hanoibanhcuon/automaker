/**
 * Agent Context Parser
 * Extracts useful information from agent context files for display in kanban cards
 */

export interface AgentTaskInfo {
  // Task list extracted from TodoWrite tool calls
  todos: {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }[];

  // Progress stats
  toolCallCount: number;
  lastToolUsed?: string;

  // Phase info
  currentPhase?: 'planning' | 'action' | 'verification';

  // Summary (if feature is completed)
  summary?: string;

  // Estimated progress percentage based on phase and tool calls
  progressPercentage: number;
}

/**
 * Default model used by the feature executor
 */
export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

/**
 * Formats a model name for display
 */
export function formatModelName(model: string): string {
  // Claude models
  if (model.includes('opus')) return 'Opus 4.5';
  if (model.includes('sonnet')) return 'Sonnet 4.5';
  if (model.includes('haiku')) return 'Haiku 4.5';

  // Codex/GPT models - specific formatting
  if (model === 'codex-gpt-5.2-codex') return 'GPT-5.2 Codex';
  if (model === 'codex-gpt-5.2') return 'GPT-5.2';
  if (model === 'codex-gpt-5.1-codex-max') return 'GPT-5.1 Max';
  if (model === 'codex-gpt-5.1-codex-mini') return 'GPT-5.1 Mini';
  if (model === 'codex-gpt-5.1') return 'GPT-5.1';
  // Generic fallbacks for other GPT models
  if (model.startsWith('gpt-')) return model.toUpperCase();
  if (model.match(/^o\d/)) return model.toUpperCase(); // o1, o3, etc.

  // Cursor models
  if (model === 'cursor-auto' || model === 'auto') return 'Cursor Auto';
  if (model === 'cursor-composer-1' || model === 'composer-1') return 'Composer 1';
  if (model.startsWith('cursor-sonnet')) return 'Cursor Sonnet';
  if (model.startsWith('cursor-opus')) return 'Cursor Opus';
  if (model.startsWith('cursor-gpt')) return model.replace('cursor-', '').replace('gpt-', 'GPT-');
  if (model.startsWith('cursor-gemini'))
    return model.replace('cursor-', 'Cursor ').replace('gemini', 'Gemini');
  if (model.startsWith('cursor-grok')) return 'Cursor Grok';

  // Default: split by dash and capitalize
  return model.split('-').slice(1, 3).join(' ');
}

/**
 * Helper to extract a balanced JSON object from a string starting at a given position
 */
function extractJsonObject(str: string, startIdx: number): string | null {
  if (str[startIdx] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < str.length; i++) {
    const char = str[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extracts todos from the context content
 * Looks for TodoWrite tool calls in the format:
 * 🔧 Tool: TodoWrite
 * Input: {"todos": [{"content": "...", "status": "..."}]}
 */
function extractTodos(content: string): AgentTaskInfo['todos'] {
  const todos: AgentTaskInfo['todos'] = [];

  // Find all occurrences of TodoWrite tool calls
  const todoWriteMarker = '🔧 Tool: TodoWrite';
  let searchStart = 0;

  while (true) {
    const markerIdx = content.indexOf(todoWriteMarker, searchStart);
    if (markerIdx === -1) break;

    // Look for "Input:" after the marker
    const inputIdx = content.indexOf('Input:', markerIdx);
    if (inputIdx === -1 || inputIdx > markerIdx + 100) {
      searchStart = markerIdx + 1;
      continue;
    }

    // Find the start of the JSON object
    const jsonStart = content.indexOf('{', inputIdx);
    if (jsonStart === -1) {
      searchStart = markerIdx + 1;
      continue;
    }

    // Extract the complete JSON object
    const jsonStr = extractJsonObject(content, jsonStart);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr) as {
          todos?: Array<{ content: string; status: string }>;
        };
        if (parsed.todos && Array.isArray(parsed.todos)) {
          // Clear previous todos - we want the latest state
          todos.length = 0;
          for (const item of parsed.todos) {
            if (item.content && item.status) {
              todos.push({
                content: item.content,
                status: item.status as 'pending' | 'in_progress' | 'completed',
              });
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    searchStart = markerIdx + 1;
  }

  // Also try to extract from markdown task lists as fallback
  if (todos.length === 0) {
    const markdownTodos = content.matchAll(/- \[([ xX])\] (.+)/g);
    for (const match of markdownTodos) {
      const isCompleted = match[1].toLowerCase() === 'x';
      const todoContent = match[2].trim();
      if (!todos.some((t) => t.content === todoContent)) {
        todos.push({
          content: todoContent,
          status: isCompleted ? 'completed' : 'pending',
        });
      }
    }
  }

  return todos;
}

/**
 * Extracts TodoWrite entries and maps them to the most recent task ID found in the log.
 * Falls back to the provided task ID when no task markers are present.
 */
export function extractTodoWritesByTask(
  content: string,
  fallbackTaskId?: string | null
): Record<string, AgentTaskInfo['todos']> {
  const taskTodoMap: Record<string, AgentTaskInfo['todos']> = {};

  if (!content) return taskTodoMap;

  const taskMatches: Array<{ index: number; taskId: string }> = [];
  const taskRegex = /Starting\s+(T\d{3})/gi;
  let taskMatch = taskRegex.exec(content);
  while (taskMatch) {
    if (typeof taskMatch.index === 'number') {
      taskMatches.push({ index: taskMatch.index, taskId: taskMatch[1] });
    }
    taskMatch = taskRegex.exec(content);
  }

  const getTaskIdForPosition = (pos: number): string | null => {
    let chosen: string | null = fallbackTaskId || null;
    for (const task of taskMatches) {
      if (task.index <= pos) {
        chosen = task.taskId;
      } else {
        break;
      }
    }
    return chosen;
  };

  const todoMarkerRegex = /(Tool:\s*TodoWrite|Tool Call:\s*TodoWrite)/gi;
  let markerMatch = todoMarkerRegex.exec(content);

  while (markerMatch) {
    const markerIndex = markerMatch.index ?? -1;
    const taskId = markerIndex >= 0 ? getTaskIdForPosition(markerIndex) : fallbackTaskId || null;

    const inputIdx = content.indexOf('Input:', markerIndex);
    if (inputIdx !== -1 && inputIdx - markerIndex < 2000) {
      const jsonStart = content.indexOf('{', inputIdx);
      if (jsonStart !== -1) {
        const jsonStr = extractJsonObject(content, jsonStart);
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr) as {
              todos?: Array<{ content: string; status: string }>;
            };
            if (parsed.todos && Array.isArray(parsed.todos)) {
              const todos = parsed.todos
                .filter((item) => item.content && item.status)
                .map((item) => ({
                  content: item.content,
                  status: item.status as 'pending' | 'in_progress' | 'completed',
                }));
              if (taskId) {
                taskTodoMap[taskId] = todos;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    markerMatch = todoMarkerRegex.exec(content);
  }

  // If no task-specific todos found, fallback to last known todo state
  if (Object.keys(taskTodoMap).length === 0) {
    const fallbackTodos = extractTodos(content);
    if (fallbackTaskId && fallbackTodos.length > 0) {
      taskTodoMap[fallbackTaskId] = fallbackTodos;
    }
  }

  return taskTodoMap;
}

/**
 * Counts tool calls in the content
 */
function countToolCalls(content: string): number {
  const matches = content.match(/🔧\s*Tool:/g);
  return matches?.length || 0;
}

/**
 * Gets the last tool used
 */
function getLastToolUsed(content: string): string | undefined {
  const matches = [...content.matchAll(/🔧\s*Tool:\s*(\S+)/g)];
  if (matches.length > 0) {
    return matches[matches.length - 1][1];
  }
  return undefined;
}

/**
 * Determines the current phase from the content
 */
function getCurrentPhase(content: string): 'planning' | 'action' | 'verification' | undefined {
  // Find the last phase marker
  const planningIndex = content.lastIndexOf('📋');
  const actionIndex = content.lastIndexOf('⚡');
  const verificationIndex = content.lastIndexOf('✅');

  const maxIndex = Math.max(planningIndex, actionIndex, verificationIndex);

  if (maxIndex === -1) return undefined;
  if (maxIndex === verificationIndex) return 'verification';
  if (maxIndex === actionIndex) return 'action';
  return 'planning';
}

/**
 * Cleans up fragmented streaming text by removing spurious newlines
 * This handles cases where streaming providers send partial text chunks
 * that got separated by newlines during accumulation
 */
function cleanFragmentedText(content: string): string {
  // Remove newlines that break up words (newline between letters)
  // e.g., "sum\n\nmary" -> "summary"
  let cleaned = content.replace(/([a-zA-Z])\n+([a-zA-Z])/g, '$1$2');

  // Also clean up fragmented XML-like tags
  // e.g., "<sum\n\nmary>" -> "<summary>"
  cleaned = cleaned.replace(/<([a-zA-Z]+)\n*([a-zA-Z]*)\n*>/g, '<$1$2>');
  cleaned = cleaned.replace(/<\/([a-zA-Z]+)\n*([a-zA-Z]*)\n*>/g, '</$1$2>');

  return cleaned;
}

/**
 * Extracts a summary from completed feature context
 * Looks for content between <summary> and </summary> tags
 */
function extractSummary(content: string): string | undefined {
  // First, clean up any fragmented text from streaming
  const cleanedContent = cleanFragmentedText(content);

  // Look for <summary> tags - capture everything between opening and closing tags
  const summaryTagMatch = cleanedContent.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryTagMatch) {
    // Clean up the extracted summary content as well
    return cleanFragmentedText(summaryTagMatch[1]).trim();
  }

  // Fallback: Look for summary sections - capture everything including subsections (###)
  // Stop at same-level ## sections (but not ###), or tool markers, or end
  const summaryMatch = cleanedContent.match(/## Summary[^\n]*\n([\s\S]*?)(?=\n## [^#]|\n🔧|$)/i);
  if (summaryMatch) {
    return cleanFragmentedText(summaryMatch[1]).trim();
  }

  // Look for completion markers and extract surrounding text
  const completionMatch = cleanedContent.match(
    /✓ (?:Feature|Verification|Task) (?:successfully|completed|verified)[^\n]*(?:\n[^\n]{1,200})?/i
  );
  if (completionMatch) {
    return cleanFragmentedText(completionMatch[0]).trim();
  }

  // Look for "What was done" type sections
  const whatWasDoneMatch = cleanedContent.match(
    /(?:What was done|Changes made|Implemented)[^\n]*\n([\s\S]*?)(?=\n## [^#]|\n🔧|$)/i
  );
  if (whatWasDoneMatch) {
    return cleanFragmentedText(whatWasDoneMatch[1]).trim();
  }

  return undefined;
}

/**
 * Calculates progress percentage based on phase and context
 * Uses a more dynamic approach that better reflects actual progress
 */
function calculateProgress(
  phase: AgentTaskInfo['currentPhase'],
  toolCallCount: number,
  todos: AgentTaskInfo['todos']
): number {
  // If we have todos, primarily use them for progress calculation
  if (todos.length > 0) {
    const completedCount = todos.filter((t) => t.status === 'completed').length;
    const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;

    // Weight: completed = 1, in_progress = 0.5, pending = 0
    const progress = ((completedCount + inProgressCount * 0.5) / todos.length) * 90;

    // Add a small base amount and cap at 95%
    return Math.min(5 + progress, 95);
  }

  // Fallback: use phase-based progress with tool call scaling
  let phaseProgress = 0;
  switch (phase) {
    case 'planning':
      // Planning phase: 5-25%
      phaseProgress = 5 + Math.min(toolCallCount * 1, 20);
      break;
    case 'action':
      // Action phase: 25-75% based on tool calls (logarithmic scaling)
      phaseProgress = 25 + Math.min(Math.log2(toolCallCount + 1) * 10, 50);
      break;
    case 'verification':
      // Verification phase: 75-95%
      phaseProgress = 75 + Math.min(toolCallCount * 0.5, 20);
      break;
    default:
      // Starting: just use tool calls
      phaseProgress = Math.min(toolCallCount * 0.5, 10);
  }

  return Math.min(Math.round(phaseProgress), 95);
}

/**
 * Parses agent context content and extracts useful information
 */
export function parseAgentContext(content: string): AgentTaskInfo {
  if (!content || !content.trim()) {
    return {
      todos: [],
      toolCallCount: 0,
      progressPercentage: 0,
    };
  }

  const todos = extractTodos(content);
  const toolCallCount = countToolCalls(content);
  const lastToolUsed = getLastToolUsed(content);
  const currentPhase = getCurrentPhase(content);
  const summary = extractSummary(content);
  const progressPercentage = calculateProgress(currentPhase, toolCallCount, todos);

  return {
    todos,
    toolCallCount,
    lastToolUsed,
    currentPhase,
    summary,
    progressPercentage,
  };
}

/**
 * Quick stats for display in card badges
 */
export interface QuickStats {
  toolCalls: number;
  completedTasks: number;
  totalTasks: number;
  phase?: string;
}

/**
 * Extracts quick stats from context for compact display
 */
export function getQuickStats(content: string): QuickStats {
  const info = parseAgentContext(content);
  return {
    toolCalls: info.toolCallCount,
    completedTasks: info.todos.filter((t) => t.status === 'completed').length,
    totalTasks: info.todos.length,
    phase: info.currentPhase,
  };
}
