export type AppError =
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'NOT_FOUND'; entity: string }
  | { code: 'INVALID_API_KEY' }
  | { code: 'MODEL_NOT_FOUND'; model: string }
  | { code: 'RATE_LIMITED'; retryAfter?: number }
  | { code: 'NETWORK_TIMEOUT' }
  | { code: 'INVALID_MODEL_OUTPUT'; message?: string; diagnostics?: StructuredOutputDiagnostics }
  | { code: 'FILE_CONFLICT'; path: string }
  | { code: 'DATA_CORRUPTED'; path: string }
  | { code: 'IMPORT_REJECTED'; reason: string }
  | { code: 'TASK_ALREADY_RUNNING' }
  | { code: 'CANCELLED' }
  | { code: 'SEARCH_UNAVAILABLE' }
  | { code: 'SEARCH_TIMEOUT' }
  | { code: 'SEARCH_RATE_LIMITED'; retryAfterSeconds?: number }
  | { code: 'SEARCH_EMPTY' }
  | { code: 'SOURCE_UNAVAILABLE' }
  | { code: 'SEARCH_NOT_CONFIGURED' }
  | { code: 'WEB_SEARCH_FAILED'; message: string }
  | { code: 'WEB_SOURCE_FAILED'; message: string }
  | { code: 'UNKNOWN'; message: string };

export type StructuredOutputFailureKind = 'empty_content' | 'truncated' | 'invalid_json' | 'schema_mismatch';

/** 只包含可安全展示的结构化输出元数据，不包含模型原文、日志、个人背景或凭据。 */
export interface StructuredOutputDiagnostics {
  kind: StructuredOutputFailureKind;
  finishReason: string | null;
  outputLength: number;
  schemaPaths: string[];
  at: string;
  /** 仅记录安全的请求/响应元数据，不包含提示词、日志或模型原文。 */
  maxTokens?: number;
  attempt?: number;
  retryOf?: StructuredOutputFailureKind;
  providerId?: string;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningPresent?: boolean;
  refusalPresent?: boolean;
}

export function isStructuredOutputError(error: unknown): error is Error & { code: 'INVALID_MODEL_OUTPUT'; diagnostics: StructuredOutputDiagnostics } {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { code?: unknown; diagnostics?: unknown };
  return candidate.code === 'INVALID_MODEL_OUTPUT' && Boolean(candidate.diagnostics);
}

function defaultMessage(error: AppError): string {
  switch (error.code) {
    case 'INVALID_INPUT': return '输入不合法，请检查后重试。';
    case 'NOT_FOUND': return `未找到「${error.entity}」，可能已被移动或删除。`;
    case 'INVALID_API_KEY': return 'API Key 无效或已失效，请在设置中重新填写。';
    case 'MODEL_NOT_FOUND': return `模型「${error.model}」不存在，请在设置中更换模型。`;
    case 'RATE_LIMITED': return '请求过于频繁被限流，请稍后重试。';
    case 'NETWORK_TIMEOUT': return '网络请求失败或超时，请检查网络后重试。';
    case 'INVALID_MODEL_OUTPUT': return 'AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。';
    case 'FILE_CONFLICT': return `文件冲突：${error.path}，请刷新后重试。`;
    case 'DATA_CORRUPTED': return `数据文件损坏：${error.path}，请从备份恢复。`;
    case 'IMPORT_REJECTED': return `导入被拒绝：${error.reason}`;
    case 'TASK_ALREADY_RUNNING': return '已有任务正在运行，请等待完成或取消后再试。';
    case 'CANCELLED': return '已取消本次生成。';
    case 'SEARCH_UNAVAILABLE': return '搜索服务暂时不可用，请稍后再试。';
    case 'SEARCH_TIMEOUT': return '搜索公开来源响应超时，可以稍后重试一次。';
    case 'SEARCH_RATE_LIMITED': return '搜索服务共享额度已用尽，请稍后再试。';
    case 'SEARCH_EMPTY': return '没有找到相关公开来源，可以修改关键词后再搜索。';
    case 'SOURCE_UNAVAILABLE': return '该公开来源暂时无法读取，可以尝试本次搜索会话中的其他来源。';
    case 'SEARCH_NOT_CONFIGURED': return '搜索服务尚未配置，请稍后再试。';
    case 'WEB_SEARCH_FAILED': return '联网搜索失败，请稍后重试。';
    case 'WEB_SOURCE_FAILED': return '读取网页来源失败，请稍后重试。';
    case 'UNKNOWN': return '发生未知错误，请重试。';
  }
}

export function appError(error: AppError): AppError & Error {
  const message = 'message' in error && error.message ? error.message : defaultMessage(error);
  return Object.assign(new Error(message), error, { message });
}
