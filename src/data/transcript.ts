import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem, SessionTokenUsage } from './types.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { sanitizeTranscriptModel } from './model-source.js';
import {
  isDetectedPromptCacheTtl,
  PROMPT_CACHE_TTL_1H_SECONDS,
  PROMPT_CACHE_TTL_5M_SECONDS,
} from './constants.js';

const debug = createDebug('transcript');

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  subtype?: string;
  operation?: string;
  content?: string;
  slug?: string;
  customTitle?: string;
  // True on subagent (Task tool) records. These are interleaved into the main
  // session's transcript but belong to a separate conversation with its own
  // prompt cache.
  isSidechain?: boolean;
  // Shared by every record that came out of one API request. A single request
  // usually writes several assistant records, so this is what groups them back
  // together when locating the request's start.
  requestId?: string;
  // Top-level field stamped onto every assistant record after `/advisor` is
  // set. Holds the canonical advisor model ID (e.g. "claude-opus-4-7").
  advisorModel?: string;
  message?: {
    id?: unknown;
    // Usually an array of content blocks, but slash-command records (e.g.
    // `/effort`) store their output as a raw string.
    content?: ContentBlock[] | string;
    model?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      // Per-tier breakdown of the cache write, reporting which TTL the request
      // actually used. A request that only reads the cache writes nothing and
      // leaves both counters at zero.
      cache_creation?: {
        ephemeral_1h_input_tokens?: number;
        ephemeral_5m_input_tokens?: number;
      };
    };
  };
  // Result payload the harness stamps onto the record carrying a tool_result
  // block. For Agent calls it reports `resolvedModel`, the model the subagent
  // actually runs on — the only source when the caller inherits the session
  // model instead of passing `model` explicitly.
  toolUseResult?: {
    resolvedModel?: unknown;
    isAsync?: unknown;
    status?: unknown;
  };
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
  };
  // Harness state markers; `ultra_effort_enter` / `ultra_effort_exit` track
  // entering / leaving ultracode effort.
  attachment?: {
    type?: string;
  };
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface TranscriptFileState {
  mtimeMs: number;
  size: number;
  /** claude-super-statusline: file identity, so an incremental parse never resumes into a different file. */
  dev?: number;
  ino?: number;
}

interface SerializedToolEntry extends Omit<ToolEntry, 'startTime' | 'endTime'> {
  startTime: string;
  endTime?: string;
}

interface SerializedAgentEntry extends Omit<AgentEntry, 'startTime' | 'endTime'> {
  startTime: string;
  endTime?: string;
}

interface SerializedTranscriptData {
  tools: SerializedToolEntry[];
  skills: string[];
  mcpServers: string[];
  mcpErrors: string[];
  agents: SerializedAgentEntry[];
  todos: TodoItem[];
  sessionStart?: string;
  sessionName?: string;
  lastAssistantResponseAt?: string;
  promptCacheAnchorAt?: string;
  promptCacheTtlSeconds?: number;
  sessionTokens?: SessionTokenUsage;
  lastCompactBoundaryAt?: string;
  lastCompactPostTokens?: number;
  compactionCount?: number;
  advisorModel?: string;
  ultracodeActive?: boolean;
  lastAssistantModel?: string;
}

/**
 * claude-super-statusline: the parser's full working state at a line boundary.
 *
 * A live session appends to its transcript on every message, so the mtime+size cache above missed
 * on every render and the whole file was re-read: ~75 ms at 18 MB, ~235 ms at 110 MB — far over the
 * statusline budget. With this snapshot the next parse seeks to `offset` and only reads what was
 * appended. Maps are stored as entry lists (insertion order matters: the newest tools/agents win).
 * Everything the loop can grow is capped when saved (see RESUME_*_MAX) to keep the cache small.
 */
interface SerializedResumeState {
  /** Byte offset just past the last newline-terminated line that was consumed. */
  offset: number;
  dev: number;
  ino: number;
  tools: SerializedToolEntry[];
  agents: SerializedAgentEntry[];
  skills: string[];
  mcpServers: string[];
  mcpErrors: string[];
  todos: TodoItem[];
  taskIdToIndex: Array<[string, number]>;
  queueCompletions: Array<[string, string]>;
  customTitle?: string;
  advisorModel?: string;
  ultracodeActive?: boolean;
  lastCompactBoundaryAt?: string;
  lastCompactPostTokens?: number;
  compactionCount: number;
  sessionTokens: SessionTokenUsage;
  usageByMessageId: Array<[string, SessionTokenUsage]>;
  lastUsageKey?: string;
  prevMainChainAt?: string;
  promptCacheAnchorAt?: string;
  promptCacheTtlSeconds?: number;
  promptCacheRequestId?: string;
  promptCacheRequestAnchorAt?: string;
  promptCachePendingRequestAt?: string;
  sessionStart?: string;
  lastAssistantResponseAt?: string;
  lastAssistantModel?: string;
}

/** claude-super-statusline: SerializedResumeState with Dates, Maps and Sets restored, ready to seed the parse loop. */
interface ResumeState {
  offset: number;
  toolMap: Map<string, ToolEntry>;
  agentMap: Map<string, AgentEntry>;
  skillSet: Set<string>;
  mcpServerSet: Set<string>;
  mcpErrorSet: Set<string>;
  latestTodos: TodoItem[];
  taskIdToIndex: Map<string, number>;
  queueCompletionMap: Map<string, Date>;
  customTitle?: string;
  latestAdvisorModel?: string;
  latestUltracodeActive?: boolean;
  lastCompactBoundaryAt?: Date;
  lastCompactPostTokens?: number;
  compactionCount: number;
  sessionTokens: SessionTokenUsage;
  usageByMessageId: Map<string, SessionTokenUsage>;
  lastUsageKey?: string;
  prevMainChainAt?: Date;
  promptCacheAnchorAt?: Date;
  promptCacheTtlSeconds?: number;
  promptCacheRequestId?: string;
  promptCacheRequestAnchorAt?: Date;
  promptCachePendingRequestAt?: Date;
  sessionStart?: Date;
  lastAssistantResponseAt?: Date;
  lastAssistantModel?: string;
}

interface TranscriptCacheFile {
  version?: number;
  transcriptPath: string;
  transcriptState: TranscriptFileState;
  data: SerializedTranscriptData;
  /** claude-super-statusline: absent when the parse could not end on a clean line boundary. */
  resume?: SerializedResumeState;
}

// claude-super-statusline: 19 adds `resume` (incremental parsing); older caches are simply re-parsed once.
const TRANSCRIPT_CACHE_VERSION = 19;
/*
  claude-super-statusline: caps for what the resume snapshot keeps. Only the newest 20 tools and 10 agents
  are ever shown, so older entries only matter if a late tool_result refers to them — which would
  update an entry that is no longer displayed anyway. Message-id dedup only has to bridge the few
  duplicate records Claude Code writes next to each other, not the whole session.
*/
const RESUME_TOOLS_MAX = 200;
const RESUME_AGENTS_MAX = 100;
const RESUME_USAGE_IDS_MAX = 512;
const RESUME_QUEUE_COMPLETIONS_MAX = 500;
const MCP_TOOL_NAME_PATTERN = /^mcp__(.+?)__(.+)$/;
const ACTIVITY_NAME_MAX_LEN = 64;
const MESSAGE_ID_MAX_LEN = 128;
const REQUEST_ID_MAX_LEN = 128;
const MESSAGE_USAGE_MAX = 4096;
const MCP_ERROR_SERVERS_MAX = 64;

// Hard cap on the advisor model ID captured from the transcript. Real Claude
// model IDs (e.g. "claude-haiku-4-5-20251001") fit comfortably under this; the
// cap exists to prevent a malformed transcript from persisting an oversized
// string through the JSON cache and onto every statusline refresh.
const ADVISOR_MODEL_MAX_LEN = 64;

// Openers of user text that never leaves the machine. Client-side slash
// commands write their invocation, their output, and their caveat as user
// records, and an interrupt writes a marker; none of them sends a request.
const LOCAL_ONLY_USER_TEXT_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<local-command-',
  '[Request interrupted by user',
];

let createReadStreamImpl: typeof fs.createReadStream = fs.createReadStream;

function normalizeTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

/**
 * Reads the TTL a request actually used from its per-tier cache-write counters,
 * so the cache clock does not depend on the user naming the right tier.
 *
 * Returns undefined when the request wrote nothing — a pure cache read leaves
 * both counters at zero — which keeps the tier detected earlier in the session.
 * Mixed tiers are representable, since one request may carry several cache
 * breakpoints, and take the shortest: that is the first part of the prefix to
 * lapse, so it is when the cached prompt stops being whole.
 */
function detectPromptCacheTtlSeconds(
  cacheCreation: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } | undefined,
): number | undefined {
  if (!cacheCreation) {
    return undefined;
  }

  if (normalizeTokenCount(cacheCreation.ephemeral_5m_input_tokens) > 0) {
    return PROMPT_CACHE_TTL_5M_SECONDS;
  }

  if (normalizeTokenCount(cacheCreation.ephemeral_1h_input_tokens) > 0) {
    return PROMPT_CACHE_TTL_1H_SECONDS;
  }

  return undefined;
}

/**
 * True for user text that Claude Code produced locally rather than sending. A
 * slash command that runs in the client writes its invocation and its output as
 * user records without any request going out, and an interrupted request leaves
 * a marker record behind for the same reason. None of them refreshes the cache.
 */
function isLocalOnlyUserText(text: string): boolean {
  return LOCAL_ONLY_USER_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/**
 * True when a user record is the start of a request rather than a local note.
 *
 * Claude Code sends a request as soon as a prompt is submitted or a tool result
 * comes back, so the record itself marks the request start. Unknown shapes are
 * treated as prompts: a record the harness writes without recognizable content
 * is far more likely to be a message than a client-side aside.
 */
function isPromptCacheRequestStart(entry: TranscriptLine): boolean {
  const content = entry.message?.content;

  if (typeof content === 'string') {
    return !isLocalOnlyUserText(content);
  }

  if (Array.isArray(content)) {
    // Tool results always trigger the follow-up request that carries them.
    return content.some((block) => block?.type === 'tool_result')
      || !content.some((block) => block?.type === 'text' && isLocalOnlyUserText(block.text ?? ''));
  }

  return true;
}

function normalizeMessageId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MESSAGE_ID_MAX_LEN
    ? value
    : null;
}

function normalizeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= REQUEST_ID_MAX_LEN
    ? value
    : undefined;
}

function accumulateMessageUsage(
  usageByMessageId: Map<string, SessionTokenUsage>,
  messageId: string,
  current: SessionTokenUsage,
  total: SessionTokenUsage,
): void {
  const previous = usageByMessageId.get(messageId);
  if (!previous && usageByMessageId.size >= MESSAGE_USAGE_MAX) {
    const oldest = usageByMessageId.keys().next().value;
    if (oldest !== undefined) {
      usageByMessageId.delete(oldest);
    }
  }

  const prior = previous ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  if (!previous) total.apiCalls = (total.apiCalls ?? 0) + 1;

  total.inputTokens += Math.max(0, current.inputTokens - prior.inputTokens);
  total.outputTokens += Math.max(0, current.outputTokens - prior.outputTokens);
  total.cacheCreationTokens += Math.max(0, current.cacheCreationTokens - prior.cacheCreationTokens);
  total.cacheReadTokens += Math.max(0, current.cacheReadTokens - prior.cacheReadTokens);

  usageByMessageId.set(messageId, {
    inputTokens: Math.max(prior.inputTokens, current.inputTokens),
    outputTokens: Math.max(prior.outputTokens, current.outputTokens),
    cacheCreationTokens: Math.max(prior.cacheCreationTokens, current.cacheCreationTokens),
    cacheReadTokens: Math.max(prior.cacheReadTokens, current.cacheReadTokens),
  });
}

function normalizeSessionTokens(tokens: unknown): SessionTokenUsage | undefined {
  if (!tokens || typeof tokens !== 'object') {
    return undefined;
  }

  const raw = tokens as Record<string, unknown>;
  return {
    inputTokens: normalizeTokenCount(raw.inputTokens),
    outputTokens: normalizeTokenCount(raw.outputTokens),
    cacheCreationTokens: normalizeTokenCount(raw.cacheCreationTokens),
    cacheReadTokens: normalizeTokenCount(raw.cacheReadTokens),
    apiCalls: normalizeTokenCount(raw.apiCalls),
  };
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    const name = normalizeActivityName(item);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

function normalizeActivityName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const sanitized = sanitizeDisplayText(value).trim();

  if (!sanitized) {
    return undefined;
  }

  if (sanitized.length <= ACTIVITY_NAME_MAX_LEN) {
    return sanitized;
  }

  return `${sanitized.slice(0, ACTIVITY_NAME_MAX_LEN - 1)}…`;
}

function getTranscriptCachePath(transcriptPath: string, homeDir: string): string {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudPluginDir(homeDir), 'transcript-cache', `${hash}.json`);
}

function canonicalizeTranscriptPath(transcriptPath: string): string | null {
  try {
    return fs.realpathSync(transcriptPath);
  } catch (err) {
    debug('Failed to resolve transcript path %s:', transcriptPath, err instanceof Error ? err.message : err);
    return null;
  }
}

function readTranscriptFileState(transcriptPath: string): TranscriptFileState | null {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) {
      debug('Transcript path is not a file: %s', transcriptPath);
      return null;
    }
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      dev: stat.dev,
      ino: stat.ino,
    };
  } catch (err) {
    debug('Failed to stat transcript file %s:', transcriptPath, err instanceof Error ? err.message : err);
    return null;
  }
}

function serializeTranscriptData(data: TranscriptData): SerializedTranscriptData {
  return {
    tools: data.tools.map((tool) => ({
      ...tool,
      startTime: tool.startTime.toISOString(),
      endTime: tool.endTime?.toISOString(),
    })),
    skills: [...data.skills],
    mcpServers: [...data.mcpServers],
    mcpErrors: [...data.mcpErrors],
    agents: data.agents.map((agent) => ({
      ...agent,
      startTime: agent.startTime.toISOString(),
      endTime: agent.endTime?.toISOString(),
    })),
    todos: data.todos.map((todo) => ({ ...todo })),
    sessionStart: data.sessionStart?.toISOString(),
    sessionName: data.sessionName,
    lastAssistantResponseAt: data.lastAssistantResponseAt?.toISOString(),
    promptCacheAnchorAt: data.promptCacheAnchorAt?.toISOString(),
    promptCacheTtlSeconds: data.promptCacheTtlSeconds,
    sessionTokens: data.sessionTokens,
    lastCompactBoundaryAt: data.lastCompactBoundaryAt?.toISOString(),
    lastCompactPostTokens: data.lastCompactPostTokens,
    compactionCount: data.compactionCount,
    advisorModel: data.advisorModel,
    ultracodeActive: data.ultracodeActive,
    lastAssistantModel: sanitizeTranscriptModel(data.lastAssistantModel),
  };
}

function deserializeTranscriptData(data: SerializedTranscriptData): TranscriptData {
  return {
    tools: data.tools.map((tool) => ({
      ...tool,
      startTime: new Date(tool.startTime),
      endTime: tool.endTime ? new Date(tool.endTime) : undefined,
    })),
    skills: normalizeNameList(data.skills),
    mcpServers: normalizeNameList(data.mcpServers),
    mcpErrors: normalizeNameList(data.mcpErrors).slice(0, MCP_ERROR_SERVERS_MAX),
    agents: data.agents.map((agent) => ({
      ...agent,
      model: sanitizeTranscriptModel(agent.model),
      startTime: new Date(agent.startTime),
      endTime: agent.endTime ? new Date(agent.endTime) : undefined,
    })),
    todos: data.todos.map((todo) => ({ ...todo })),
    sessionStart: data.sessionStart ? new Date(data.sessionStart) : undefined,
    sessionName: data.sessionName,
    lastAssistantResponseAt: data.lastAssistantResponseAt ? new Date(data.lastAssistantResponseAt) : undefined,
    promptCacheAnchorAt: data.promptCacheAnchorAt ? new Date(data.promptCacheAnchorAt) : undefined,
    // Only a real tier is accepted back. Detection can produce nothing else, so
    // any other value means a corrupt snapshot, and dropping it falls back to
    // the default TTL instead of counting down against a fabricated one.
    promptCacheTtlSeconds: isDetectedPromptCacheTtl(data.promptCacheTtlSeconds)
      ? data.promptCacheTtlSeconds
      : undefined,
    sessionTokens: normalizeSessionTokens(data.sessionTokens),
    lastCompactBoundaryAt: data.lastCompactBoundaryAt ? new Date(data.lastCompactBoundaryAt) : undefined,
    lastCompactPostTokens: typeof data.lastCompactPostTokens === 'number' ? data.lastCompactPostTokens : undefined,
    compactionCount: typeof data.compactionCount === 'number' && Number.isFinite(data.compactionCount) && data.compactionCount >= 0
      ? Math.trunc(data.compactionCount)
      : undefined,
    advisorModel: typeof data.advisorModel === 'string' && data.advisorModel.length > 0
      ? data.advisorModel.slice(0, ADVISOR_MODEL_MAX_LEN)
      : undefined,
    ultracodeActive: typeof data.ultracodeActive === 'boolean' ? data.ultracodeActive : undefined,
    lastAssistantModel: sanitizeTranscriptModel(data.lastAssistantModel),
  };
}

/**
 * claude-super-statusline: read the cache file once and answer both questions from it — "is the transcript
 * unchanged?" (return the cached data) and "was it only appended to?" (return the resume state).
 */
function readTranscriptCache(
  transcriptPath: string,
  state: TranscriptFileState,
): { data: TranscriptData | null; resume: ResumeState | null } {
  try {
    const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as TranscriptCacheFile;
    if (
      parsed.version !== TRANSCRIPT_CACHE_VERSION
      || !parsed.data
      || !parsed.transcriptPath
      || parsed.transcriptPath !== path.resolve(transcriptPath)
    ) {
      return { data: null, resume: null };
    }
    if (parsed.transcriptState?.mtimeMs === state.mtimeMs && parsed.transcriptState?.size === state.size) {
      return { data: deserializeTranscriptData(parsed.data), resume: null };
    }

    return { data: null, resume: resumableState(transcriptPath, state, parsed.resume) };
  } catch (err) {
    debug('Failed to read transcript cache:', err instanceof Error ? err.message : err);
    return { data: null, resume: null };
  }
}

/**
 * claude-super-statusline: accept a saved resume point only if the file is provably the same file with bytes
 * appended: same device+inode, not shorter than the offset, and the byte before the offset is still
 * the newline that ended the last consumed line. Anything else (rotation, rewrite, truncation, a
 * corrupt snapshot) returns null and the caller does a full parse.
 */
function resumableState(
  transcriptPath: string,
  state: TranscriptFileState,
  saved: SerializedResumeState | undefined,
): ResumeState | null {
  if (!saved || typeof saved.offset !== 'number' || saved.offset < 0) return null;
  if (saved.dev !== state.dev || saved.ino !== state.ino || state.size < saved.offset) return null;
  if (saved.offset > 0 && readByteAt(transcriptPath, saved.offset - 1) !== 0x0a) return null;
  try {
    return deserializeResumeState(saved);
  } catch (err) {
    debug('Ignoring unreadable resume state:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** claude-super-statusline: one byte of a file, or null when it cannot be read. */
function readByteAt(file: string, position: number): number | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(1);
    return fs.readSync(fd, buf, 0, 1, position) === 1 ? buf[0]! : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const isoOrUndefined = (d: Date | undefined): string | undefined => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined);
const dateOrUndefined = (s: string | undefined): Date | undefined => (typeof s === 'string' ? new Date(s) : undefined);
const lastEntries = <K, V>(m: Map<K, V>, max: number): Array<[K, V]> => Array.from(m.entries()).slice(-max);

function serializeTool(tool: ToolEntry): SerializedToolEntry {
  return { ...tool, startTime: tool.startTime.toISOString(), endTime: tool.endTime?.toISOString() };
}

function serializeAgent(agent: AgentEntry): SerializedAgentEntry {
  return { ...agent, startTime: agent.startTime.toISOString(), endTime: agent.endTime?.toISOString() };
}

function deserializeResumeState(s: SerializedResumeState): ResumeState {
  // Structural checks only: the snapshot is our own 0600 file, but a torn write must not crash rendering.
  const lists = [s.tools, s.agents, s.skills, s.mcpServers, s.mcpErrors, s.todos, s.taskIdToIndex, s.queueCompletions, s.usageByMessageId];
  if (!lists.every(Array.isArray) || typeof s.sessionTokens !== 'object' || s.sessionTokens === null) {
    throw new Error('malformed resume state');
  }
  return {
    offset: s.offset,
    toolMap: new Map(s.tools.map((t) => [t.id, { ...t, startTime: new Date(t.startTime), endTime: dateOrUndefined(t.endTime) }])),
    agentMap: new Map(s.agents.map((a) => [a.id, { ...a, startTime: new Date(a.startTime), endTime: dateOrUndefined(a.endTime) }])),
    skillSet: new Set(s.skills),
    mcpServerSet: new Set(s.mcpServers),
    mcpErrorSet: new Set(s.mcpErrors),
    latestTodos: s.todos.map((todo) => ({ ...todo })),
    taskIdToIndex: new Map(s.taskIdToIndex),
    queueCompletionMap: new Map(s.queueCompletions.map(([id, at]) => [id, new Date(at)])),
    customTitle: s.customTitle,
    latestAdvisorModel: s.advisorModel,
    latestUltracodeActive: s.ultracodeActive,
    lastCompactBoundaryAt: dateOrUndefined(s.lastCompactBoundaryAt),
    lastCompactPostTokens: s.lastCompactPostTokens,
    compactionCount: typeof s.compactionCount === 'number' ? s.compactionCount : 0,
    sessionTokens: { ...s.sessionTokens },
    usageByMessageId: new Map(s.usageByMessageId),
    lastUsageKey: s.lastUsageKey,
    prevMainChainAt: dateOrUndefined(s.prevMainChainAt),
    promptCacheAnchorAt: dateOrUndefined(s.promptCacheAnchorAt),
    promptCacheTtlSeconds: s.promptCacheTtlSeconds,
    promptCacheRequestId: s.promptCacheRequestId,
    promptCacheRequestAnchorAt: dateOrUndefined(s.promptCacheRequestAnchorAt),
    promptCachePendingRequestAt: dateOrUndefined(s.promptCachePendingRequestAt),
    sessionStart: dateOrUndefined(s.sessionStart),
    lastAssistantResponseAt: dateOrUndefined(s.lastAssistantResponseAt),
    lastAssistantModel: s.lastAssistantModel,
  };
}

function serializeResumeState(r: ResumeState, state: TranscriptFileState): SerializedResumeState | undefined {
  if (state.dev === undefined || state.ino === undefined) return undefined;
  return {
    offset: r.offset,
    dev: state.dev,
    ino: state.ino,
    tools: Array.from(r.toolMap.values()).slice(-RESUME_TOOLS_MAX).map(serializeTool),
    agents: Array.from(r.agentMap.values()).slice(-RESUME_AGENTS_MAX).map(serializeAgent),
    skills: [...r.skillSet],
    mcpServers: [...r.mcpServerSet],
    mcpErrors: [...r.mcpErrorSet],
    todos: r.latestTodos.map((todo) => ({ ...todo })),
    taskIdToIndex: [...r.taskIdToIndex.entries()],
    queueCompletions: lastEntries(r.queueCompletionMap, RESUME_QUEUE_COMPLETIONS_MAX).map(([id, at]) => [id, at.toISOString()]),
    customTitle: r.customTitle,
    advisorModel: r.latestAdvisorModel,
    ultracodeActive: r.latestUltracodeActive,
    lastCompactBoundaryAt: isoOrUndefined(r.lastCompactBoundaryAt),
    lastCompactPostTokens: r.lastCompactPostTokens,
    compactionCount: r.compactionCount,
    sessionTokens: { ...r.sessionTokens },
    usageByMessageId: lastEntries(r.usageByMessageId, RESUME_USAGE_IDS_MAX),
    lastUsageKey: r.lastUsageKey,
    prevMainChainAt: isoOrUndefined(r.prevMainChainAt),
    promptCacheAnchorAt: isoOrUndefined(r.promptCacheAnchorAt),
    promptCacheTtlSeconds: r.promptCacheTtlSeconds,
    promptCacheRequestId: r.promptCacheRequestId,
    promptCacheRequestAnchorAt: isoOrUndefined(r.promptCacheRequestAnchorAt),
    promptCachePendingRequestAt: isoOrUndefined(r.promptCachePendingRequestAt),
    sessionStart: isoOrUndefined(r.sessionStart),
    lastAssistantResponseAt: isoOrUndefined(r.lastAssistantResponseAt),
    lastAssistantModel: r.lastAssistantModel,
  };
}

/**
 * claude-super-statusline: yield only newline-terminated lines. While Claude Code is writing, the final line
 * can be half a JSON record; consuming it would lose that record (it fails to parse now, and the
 * resume offset would then point into its middle). Instead its byte length goes to `onTail` so the
 * offset stops before it and the next parse reads the finished line.
 */
async function* completeLines(
  lines: AsyncIterable<string> | Iterable<string>,
  lastLineTerminated: boolean,
  onTail: (bytes: number) => void,
): AsyncGenerator<string> {
  let pending: string | undefined;
  for await (const line of lines) {
    if (pending !== undefined) yield pending;
    pending = line;
  }
  if (pending === undefined) return;
  if (lastLineTerminated) yield pending;
  else onTail(Buffer.byteLength(pending));
}

function writeTranscriptCache(
  transcriptPath: string,
  state: TranscriptFileState,
  data: TranscriptData,
  resume?: SerializedResumeState,
): void {
  try {
    const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
    const cacheDir = path.dirname(cachePath);
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(cacheDir, 0o700);
    } catch {
      // Best-effort: some filesystems do not support POSIX modes.
    }
    const payload: TranscriptCacheFile = {
      version: TRANSCRIPT_CACHE_VERSION,
      transcriptPath: path.resolve(transcriptPath),
      transcriptState: state,
      data: serializeTranscriptData(data),
      resume,
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(cachePath, 0o600);
    } catch {
      // Best-effort: cache permissions should not break rendering.
    }
  } catch (err) {
    debug('Failed to write transcript cache:', err instanceof Error ? err.message : err);
  }
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    skills: [],
    mcpServers: [],
    mcpErrors: [],
    agents: [],
    todos: [],
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  const canonicalTranscriptPath = canonicalizeTranscriptPath(transcriptPath);
  if (!canonicalTranscriptPath) {
    return result;
  }

  const transcriptState = readTranscriptFileState(canonicalTranscriptPath);
  if (!transcriptState) {
    return result;
  }

  const { data: cached, resume } = readTranscriptCache(canonicalTranscriptPath, transcriptState);
  if (cached) {
    return cached;
  }

  // claude-super-statusline: every piece of parser state below starts from the resume snapshot when the file
  // was only appended to (see SerializedResumeState), and from empty otherwise — so the loop body is
  // unchanged and an incremental parse ends in exactly the state a full parse would.
  const r = resume;
  const toolMap = r?.toolMap ?? new Map<string, ToolEntry>();
  const skillSet = r?.skillSet ?? new Set<string>();
  const mcpServerSet = r?.mcpServerSet ?? new Set<string>();
  const mcpErrorSet = r?.mcpErrorSet ?? new Set<string>();
  const agentMap = r?.agentMap ?? new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = r?.latestTodos ?? [];
  const taskIdToIndex = r?.taskIdToIndex ?? new Map<string, number>();
  const queueCompletionMap = r?.queueCompletionMap ?? new Map<string, Date>();
  let customTitle: string | undefined = r?.customTitle;
  let latestAdvisorModel: string | undefined = r?.latestAdvisorModel;
  let latestUltracodeActive: boolean | undefined = r?.latestUltracodeActive;
  let lastCompactBoundaryAt: Date | undefined = r?.lastCompactBoundaryAt;
  let lastCompactPostTokens: number | undefined = r?.lastCompactPostTokens;
  let compactionCount = r?.compactionCount ?? 0;
  const sessionTokens: SessionTokenUsage = r?.sessionTokens ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    apiCalls: 0,
  };
  const usageByMessageId = r?.usageByMessageId ?? new Map<string, SessionTokenUsage>();
  let lastUsageKey: string | undefined = r?.lastUsageKey;
  // Prompt-cache clock state. `prevMainChainAt` trails the main conversation so
  // a response can be anchored to the record it answers; the request fields hold
  // the anchor for the request currently being read.
  let prevMainChainAt: Date | undefined = r?.prevMainChainAt;
  let promptCacheAnchorAt: Date | undefined = r?.promptCacheAnchorAt;
  let promptCacheTtlSeconds: number | undefined = r?.promptCacheTtlSeconds;
  let promptCacheRequestId: string | undefined = r?.promptCacheRequestId;
  let promptCacheRequestAnchorAt: Date | undefined = r?.promptCacheRequestAnchorAt;
  let promptCachePendingRequestAt: Date | undefined = r?.promptCachePendingRequestAt;
  // processEntry writes these straight onto `result`; carry them across a resume too.
  result.sessionStart = r?.sessionStart;
  result.lastAssistantResponseAt = r?.lastAssistantResponseAt;
  result.lastAssistantModel = r?.lastAssistantModel;

  let parsedCleanly = false;
  // claude-super-statusline: read [startOffset, size) of the stat snapshot only. Bytes appended while we read
  // belong to the next parse; stopping at `size` keeps the saved offset consistent with the state.
  const startOffset = r?.offset ?? 0;
  let unterminatedTailBytes = 0;

  try {
    const hasNewBytes = transcriptState.size > startOffset;
    const fileStream = hasNewBytes
      ? createReadStreamImpl(canonicalTranscriptPath, { start: startOffset, end: transcriptState.size - 1 })
      : null;
    const rl = fileStream
      ? readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      })
      : [];
    const lastLineTerminated = !hasNewBytes || readByteAt(canonicalTranscriptPath, transcriptState.size - 1) === 0x0a;

    for await (const line of completeLines(rl, lastLineTerminated, (bytes) => { unterminatedTailBytes = bytes; })) {
      if (!line.trim()) {
        lastUsageKey = undefined;
        continue;
      }

      try {
        const entry = JSON.parse(line) as TranscriptLine;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
          customTitle = entry.customTitle;
        }
        // Capture the advisor model from the top-level `advisorModel` field.
        // Claude Code stamps this onto every *assistant* record after `/advisor`
        // is set, so we restrict to that record type (matching the documented
        // source) and the most recent occurrence reflects the current choice.
        // Length is hard-capped so a malformed transcript cannot persist an
        // unbounded value through the cache layer.
        if (
          entry.type === 'assistant'
          && typeof entry.advisorModel === 'string'
          && entry.advisorModel.length > 0
        ) {
          latestAdvisorModel = entry.advisorModel.slice(0, ADVISOR_MODEL_MAX_LEN);
        }
        // Current ultracode state, distinguishable only from the transcript
        // (stdin reports it as plain `xhigh`). Two signals update this in file
        // order, last wins: the self-correcting ultra_effort_enter/exit
        // attachment (can lag a turn) and the immediate `/effort` command output.
        if (entry.type === 'attachment') {
          const attachmentType = entry.attachment?.type;
          if (attachmentType === 'ultra_effort_enter') {
            latestUltracodeActive = true;
          } else if (attachmentType === 'ultra_effort_exit') {
            latestUltracodeActive = false;
          }
        }
        // The `/effort` command-output signal. Anchored at the start of a *user*
        // record's string content, so prose quoting the phrase can't flip state.
        // Brittle by necessity — couples to Claude Code's /effort wording; if that
        // changes, the label falls back to the (laggier) attachments.
        if (entry.type === 'user' && typeof entry.message?.content === 'string') {
          const effortCommandMatch = entry.message.content.match(
            /^<local-command-stdout>Set effort level to (\w+)/,
          );
          if (effortCommandMatch) {
            latestUltracodeActive = effortCommandMatch[1].toLowerCase() === 'ultracode';
          }
        }
        // Capture the actual model from the assistant message's `model` field.
        // This reflects what the API actually served, which may differ from the
        // model Claude Code thinks it's using (e.g. proxy redirect via cc-switch).
        if (entry.type === 'assistant') {
          const transcriptModel = sanitizeTranscriptModel(entry.message?.model);
          if (transcriptModel) {
            result.lastAssistantModel = transcriptModel;
          }
        }
        // Accumulate token usage from assistant messages.
        // Claude Code can write the same API response to the transcript 2-3 times
        // (dual-logging). Prefer the API-response-level message.id so duplicates
        // can be removed even when another record appears between them. Only
        // bounded string IDs are retained, and the set is capped to keep a
        // malformed transcript from growing memory without limit. Records with
        // missing or invalid IDs keep the previous consecutive usage-fingerprint
        // fallback.
        if (entry.type === 'assistant' && entry.message?.usage) {
          const usage = entry.message.usage;
          const msgId = normalizeMessageId(entry.message.id);
          const normalizedUsage: SessionTokenUsage = {
            inputTokens: normalizeTokenCount(usage.input_tokens),
            outputTokens: normalizeTokenCount(usage.output_tokens),
            cacheCreationTokens: normalizeTokenCount(usage.cache_creation_input_tokens),
            cacheReadTokens: normalizeTokenCount(usage.cache_read_input_tokens),
          };

          if (msgId !== null) {
            lastUsageKey = undefined;
            accumulateMessageUsage(usageByMessageId, msgId, normalizedUsage, sessionTokens);
          } else {
            const usageKey = `${usage.input_tokens}|${usage.output_tokens}|${usage.cache_creation_input_tokens}|${usage.cache_read_input_tokens}`;
            const shouldCount = usageKey !== lastUsageKey;
            lastUsageKey = usageKey;
            if (shouldCount) {
              sessionTokens.apiCalls = (sessionTokens.apiCalls ?? 0) + 1;
              sessionTokens.inputTokens += normalizedUsage.inputTokens;
              sessionTokens.outputTokens += normalizedUsage.outputTokens;
              sessionTokens.cacheCreationTokens += normalizedUsage.cacheCreationTokens;
              sessionTokens.cacheReadTokens += normalizedUsage.cacheReadTokens;
            }
          }
        } else {
          lastUsageKey = undefined;
        }
        // Track Claude Code's compact_boundary marker. Both manual (/compact)
        // and auto compaction emit this system entry with compactMetadata; we
        // take the most recent one's timestamp so callers can distinguish a
        // legitimate post-compact zero frame from a transient stdin glitch.
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          const ts = entry.timestamp ? new Date(entry.timestamp) : null;
          if (ts && !Number.isNaN(ts.getTime())) {
            compactionCount += 1;
            if (!lastCompactBoundaryAt || ts.getTime() > lastCompactBoundaryAt.getTime()) {
              lastCompactBoundaryAt = ts;
              const post = entry.compactMetadata?.postTokens;
              lastCompactPostTokens = typeof post === 'number' && Number.isFinite(post) && post >= 0
                ? Math.trunc(post)
                : undefined;
            }
          }
        }
        // Capture accurate background-agent completion timestamps from queue-operation entries.
        // The tool_result timestamp in the parent transcript is written at launch time, not
        // when the agent actually finishes, so we override with the enqueue timestamp.
        if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && entry.content) {
          const taskIdMatch = entry.content.match(/<task-id>([^<]+)<\/task-id>/);
          const toolUseIdMatch = entry.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
          if (taskIdMatch && toolUseIdMatch && entry.timestamp) {
            const ts = new Date(entry.timestamp);
            if (!Number.isNaN(ts.getTime())) {
              queueCompletionMap.set(toolUseIdMatch[1], ts);
            }
          }
        }
        // Prompt-cache clock, tracked apart from lastAssistantResponseAt so the
        // last-response element keeps its current subagent-inclusive meaning.
        //
        // Two corrections live here. Subagent records are skipped, because a
        // subagent runs against its own cache and does not refresh the main
        // session's. And a response is anchored to the record it answers rather
        // than to itself, because the cache lifetime starts with the request that
        // reads or writes the cache — anchoring on the response would hand the
        // session however long that response took to generate. Records sharing a
        // requestId came from one request and so share one anchor.
        if (entry.isSidechain !== true) {
          const entryAt = entry.timestamp ? new Date(entry.timestamp) : null;
          const entryHasTime = entryAt !== null && !Number.isNaN(entryAt.getTime());

          if (entry.type === 'assistant' && entryHasTime) {
            const requestId = normalizeRequestId(entry.requestId);
            // An absent requestId (very old transcripts) makes every record its
            // own request, which anchors to the preceding record — later than the
            // true request start, but never later than the response itself.
            if (requestId === undefined || requestId !== promptCacheRequestId) {
              promptCacheRequestId = requestId;
              promptCacheRequestAnchorAt = prevMainChainAt;
            }
            // No preceding record, or one stamped after the response it triggered:
            // fall back to the response, which is the latest defensible anchor.
            promptCacheAnchorAt = (
              promptCacheRequestAnchorAt
              && promptCacheRequestAnchorAt.getTime() <= entryAt.getTime()
            )
              ? promptCacheRequestAnchorAt
              : entryAt;

            const detectedTtl = detectPromptCacheTtlSeconds(entry.message?.usage?.cache_creation);
            if (detectedTtl !== undefined) {
              promptCacheTtlSeconds = detectedTtl;
            }
            // A response closes the request the pending anchor was holding.
            promptCachePendingRequestAt = undefined;
          }

          // A request whose response has not been written yet has still already
          // refreshed the cache, so the record that opened it is the live anchor.
          // Only a record with no assistant record after it can be that opener,
          // which is what keeps a user record carrying a skewed future timestamp
          // from displacing the response it precedes in the file.
          if (entry.type === 'user' && entryHasTime && isPromptCacheRequestStart(entry)) {
            promptCachePendingRequestAt = entryAt;
          }

          if (entryHasTime) {
            prevMainChainAt = entryAt;
          }
        }
        processEntry(entry, toolMap, skillSet, mcpServerSet, mcpErrorSet, agentMap, taskIdToIndex, latestTodos, result);
      } catch (err) {
        lastUsageKey = undefined;
        debug('Skipping malformed transcript line:', err instanceof Error ? err.message : err);
      }
    }

    parsedCleanly = true;
  } catch (err) {
    debug('Transcript stream read error, returning partial results:', err instanceof Error ? err.message : err);
  }

  // Resolve agent completion: prefer queue-operation timestamps (accurate for
  // background agents), fall back to tool_result timestamps (inline agents).
  // Status is deferred so background agents show ◐ until they truly finish.
  for (const [toolUseId, endTime] of queueCompletionMap) {
    const agent = agentMap.get(toolUseId);
    if (agent?.background) {
      agent.endTime = endTime;
      agent.status = 'completed';
    }
  }
  for (const agent of agentMap.values()) {
    if (agent.status === 'running' && agent.endTime) {
      agent.status = 'completed';
    }
  }
  result.tools = Array.from(toolMap.values()).slice(-20);
  result.skills = Array.from(skillSet.values());
  result.mcpServers = Array.from(mcpServerSet.values());
  result.mcpErrors = Array.from(mcpErrorSet.values());
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;
  // Only a title the user set (/rename) is a session name; the slug is Claude Code's rolling summary.
  result.sessionName = customTitle;
  result.sessionTokens = sessionTokens;
  result.lastCompactBoundaryAt = lastCompactBoundaryAt;
  result.lastCompactPostTokens = lastCompactPostTokens;
  result.compactionCount = compactionCount;
  result.advisorModel = latestAdvisorModel;
  result.ultracodeActive = latestUltracodeActive;
  // Promote the pending request only when it moves the clock forward. A record
  // stamped before the response it follows is skew, and the earlier anchor is
  // the one that cannot overstate how much cache lifetime is left.
  result.promptCacheAnchorAt = (
    promptCachePendingRequestAt
    && (
      !promptCacheAnchorAt
      || promptCachePendingRequestAt.getTime() > promptCacheAnchorAt.getTime()
    )
  )
    ? promptCachePendingRequestAt
    : promptCacheAnchorAt;
  result.promptCacheTtlSeconds = promptCacheTtlSeconds;
  if (parsedCleanly) {
    // claude-super-statusline: snapshot the full parser state (not the display slices above) so the next
    // parse can resume right after the last complete line.
    const snapshot = serializeResumeState({
      offset: transcriptState.size - unterminatedTailBytes,
      toolMap,
      agentMap,
      skillSet,
      mcpServerSet,
      mcpErrorSet,
      latestTodos,
      taskIdToIndex,
      queueCompletionMap,
      customTitle,
      latestAdvisorModel,
      latestUltracodeActive,
      lastCompactBoundaryAt,
      lastCompactPostTokens,
      compactionCount,
      sessionTokens,
      usageByMessageId,
      lastUsageKey,
      prevMainChainAt,
      promptCacheAnchorAt,
      promptCacheTtlSeconds,
      promptCacheRequestId,
      promptCacheRequestAnchorAt,
      promptCachePendingRequestAt,
      sessionStart: result.sessionStart,
      lastAssistantResponseAt: result.lastAssistantResponseAt,
      lastAssistantModel: result.lastAssistantModel,
    }, transcriptState);
    writeTranscriptCache(canonicalTranscriptPath, transcriptState, result, snapshot);
  }

  return result;
}

export function _setCreateReadStreamForTests(impl: typeof fs.createReadStream | null): void {
  createReadStreamImpl = impl ?? fs.createReadStream;
}

function processEntry(
  entry: TranscriptLine,
  toolMap: Map<string, ToolEntry>,
  skillSet: Set<string>,
  mcpServerSet: Set<string>,
  mcpErrorSet: Set<string>,
  agentMap: Map<string, AgentEntry>,
  taskIdToIndex: Map<string, number>,
  latestTodos: TodoItem[],
  result: TranscriptData
): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  const hasValidTimestamp = !Number.isNaN(timestamp.getTime());

  if (!result.sessionStart && entry.timestamp && hasValidTimestamp) {
    result.sessionStart = timestamp;
  }

  if (entry.type === 'assistant' && entry.timestamp && hasValidTimestamp) {
    result.lastAssistantResponseAt = timestamp;
  }

  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const skillName = block.name === 'Skill'
        ? normalizeSkillName(block.input?.skill)
        : undefined;
      if (skillName) {
        skillSet.add(skillName);
      }

      const mcpServerName = extractMcpServerName(block.name);
      if (mcpServerName) {
        mcpServerSet.add(mcpServerName);
      }

      const toolEntry: ToolEntry = {
        id: block.id,
        name: block.name,
        target: extractTarget(block.name, block.input),
        status: 'running',
        startTime: timestamp,
      };

      if (block.name === 'Task' || block.name === 'Agent') {
        const input = block.input as Record<string, unknown>;
        const agentEntry: AgentEntry = {
          id: block.id,
          type: (input?.subagent_type as string) ?? 'agent',
          model: sanitizeTranscriptModel(input?.model),
          description: (input?.description as string) ?? undefined,
          status: 'running',
          startTime: timestamp,
          background: (input?.run_in_background as boolean) === true,
        };
        agentMap.set(block.id, agentEntry);
      } else if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: TodoItem[] };
        if (input?.todos && Array.isArray(input.todos)) {
          // Build a FIFO queue of taskIds per content string, ordered by the
          // old array position. Two todos that share the same content must
          // each get their own taskId back after the rebuild, so we cannot
          // collapse duplicates to one index.
          const contentToTaskIds = new Map<string, string[]>();
          const taskIdsByOldIndex: Array<[number, string]> = [];
          for (const [taskId, idx] of taskIdToIndex) {
            if (idx < latestTodos.length) {
              taskIdsByOldIndex.push([idx, taskId]);
            }
          }
          taskIdsByOldIndex.sort((a, b) => a[0] - b[0]);
          for (const [idx, taskId] of taskIdsByOldIndex) {
            const content = latestTodos[idx].content;
            const ids = contentToTaskIds.get(content) ?? [];
            ids.push(taskId);
            contentToTaskIds.set(content, ids);
          }

          latestTodos.length = 0;
          taskIdToIndex.clear();
          latestTodos.push(...input.todos);

          // Consume one queued taskId per new todo that matches by content,
          // so duplicate-content items still each get their own taskId.
          for (let i = 0; i < latestTodos.length; i++) {
            const ids = contentToTaskIds.get(latestTodos[i].content);
            if (ids && ids.length > 0) {
              const taskId = ids.shift() as string;
              taskIdToIndex.set(taskId, i);
              if (ids.length === 0) {
                contentToTaskIds.delete(latestTodos[i].content);
              }
            }
          }
        }
      } else if (block.name === 'TaskCreate') {
        const input = block.input as Record<string, unknown>;
        const subject = typeof input?.subject === 'string' ? input.subject : '';
        const description = typeof input?.description === 'string' ? input.description : '';
        const content = subject || description || 'Untitled task';
        const status = normalizeTaskStatus(input?.status) ?? 'pending';
        latestTodos.push({ content, status });

        const rawTaskId = input?.taskId;
        const taskId = typeof rawTaskId === 'string' || typeof rawTaskId === 'number'
          ? String(rawTaskId)
          : block.id;
        if (taskId) {
          taskIdToIndex.set(taskId, latestTodos.length - 1);
        }
      } else if (block.name === 'TaskUpdate') {
        const input = block.input as Record<string, unknown>;
        const index = resolveTaskIndex(input?.taskId, taskIdToIndex, latestTodos);
        if (index !== null) {
          const status = normalizeTaskStatus(input?.status);
          if (status) {
            latestTodos[index].status = status;
          }

          const subject = typeof input?.subject === 'string' ? input.subject : '';
          const description = typeof input?.description === 'string' ? input.description : '';
          const content = subject || description;
          if (content) {
            latestTodos[index].content = content;
          }
        }
      } else {
        toolMap.set(block.id, toolEntry);
      }
    }

    if (block.type === 'tool_result' && block.tool_use_id) {
      const tool = toolMap.get(block.tool_use_id);
      if (tool) {
        tool.status = block.is_error ? 'error' : 'completed';
        tool.endTime = timestamp;

        // Track each server's latest observed result. Tool names are untrusted
        // transcript data, so reuse the bounded terminal-safe extractor.
        const mcpServerName = extractMcpServerName(tool.name);
        if (mcpServerName) {
          if (block.is_error) {
            if (!mcpErrorSet.has(mcpServerName) && mcpErrorSet.size >= MCP_ERROR_SERVERS_MAX) {
              const oldest = mcpErrorSet.values().next().value;
              if (oldest !== undefined) mcpErrorSet.delete(oldest);
            }
            mcpErrorSet.add(mcpServerName);
          } else {
            mcpErrorSet.delete(mcpServerName);
          }
        }
      }

      const agent = agentMap.get(block.tool_use_id);
      if (agent) {
        // `resolvedModel` is the model the subagent actually ran on, so it wins
        // over the caller's `model` input (an alias like "opus", and absent
        // entirely whenever the subagent inherits the session model).
        const resolvedModel = sanitizeTranscriptModel(entry.toolUseResult?.resolvedModel);
        if (resolvedModel) {
          agent.model = resolvedModel;
        }
        if (
          entry.toolUseResult?.isAsync === true
          || entry.toolUseResult?.status === 'async_launched'
        ) {
          agent.background = true;
        }
        if (!agent.background) {
          agent.endTime = timestamp;
        }
      }
    }
  }
}

function extractTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path as string) ?? (input.path as string);
    case 'Glob':
      return input.pattern as string;
    case 'Grep':
      return input.pattern as string;
    case 'Skill':
      return normalizeSkillName(input.skill);
    case 'Bash':
      if (typeof input.command !== 'string') {
        return undefined;
      }
      const cmd = input.command.replace(/\s+/g, ' ').trim();
      return cmd
        ? cmd.length > 30
          ? `${cmd.slice(0, 30).trimEnd()}...`
          : cmd
        : undefined;
  }
  return undefined;
}

function normalizeSkillName(value: unknown): string | undefined {
  return normalizeActivityName(value);
}

function extractMcpServerName(toolName: string): string | undefined {
  const match = MCP_TOOL_NAME_PATTERN.exec(toolName);
  if (!match) {
    return undefined;
  }

  return normalizeActivityName(match[1]);
}

function resolveTaskIndex(
  taskId: unknown,
  taskIdToIndex: Map<string, number>,
  latestTodos: TodoItem[]
): number | null {
  if (typeof taskId === 'string' || typeof taskId === 'number') {
    const key = String(taskId);
    const mapped = taskIdToIndex.get(key);
    if (typeof mapped === 'number') {
      return mapped;
    }

    if (/^\d+$/.test(key)) {
      const numericIndex = Number.parseInt(key, 10) - 1;
      if (numericIndex >= 0 && numericIndex < latestTodos.length) {
        return numericIndex;
      }
    }
  }

  return null;
}

function normalizeTaskStatus(status: unknown): TodoItem['status'] | null {
  if (typeof status !== 'string') return null;

  switch (status) {
    case 'pending':
    case 'not_started':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'in_progress';
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed';
    default:
      return null;
  }
}
