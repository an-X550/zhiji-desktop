import type { StructuredOutputDiagnostics } from '../../shared/errors/app-error';

const KIND_LABELS: Record<StructuredOutputDiagnostics['kind'], string> = {
  empty_content: '空正文',
  truncated: '输出被截断',
  invalid_json: 'JSON 无效',
  schema_mismatch: '字段校验失败',
};

export function StructuredDiagnostics({ diagnostics }: { diagnostics: StructuredOutputDiagnostics }) {
  return <details>
    <summary>查看技术信息</summary>
    <dl className="diagnostic-list">
      <div><dt>失败类型</dt><dd>{KIND_LABELS[diagnostics.kind] ?? diagnostics.kind}</dd></div>
      <div><dt>结束原因</dt><dd>{diagnostics.finishReason ?? '未提供'}</dd></div>
      <div><dt>输出长度</dt><dd>{diagnostics.outputLength}</dd></div>
      {diagnostics.maxTokens !== undefined && <div><dt>请求上限</dt><dd>{diagnostics.maxTokens}</dd></div>}
      {diagnostics.attempt !== undefined && <div><dt>请求次数</dt><dd>{diagnostics.attempt}</dd></div>}
      {diagnostics.retryOf && <div><dt>首次失败</dt><dd>{KIND_LABELS[diagnostics.retryOf] ?? diagnostics.retryOf}</dd></div>}
      {diagnostics.providerId && <div><dt>服务商</dt><dd>{diagnostics.providerId}</dd></div>}
      {diagnostics.model && <div><dt>模型</dt><dd>{diagnostics.model}</dd></div>}
      {diagnostics.inputTokens !== undefined && <div><dt>输入 token</dt><dd>{diagnostics.inputTokens ?? '未提供'}</dd></div>}
      {diagnostics.outputTokens !== undefined && <div><dt>输出 token</dt><dd>{diagnostics.outputTokens ?? '未提供'}</dd></div>}
      {diagnostics.cachedInputTokens !== undefined && <div><dt>缓存输入 token</dt><dd>{diagnostics.cachedInputTokens ?? '未提供'}</dd></div>}
      {diagnostics.reasoningPresent !== undefined && <div><dt>存在 reasoning</dt><dd>{diagnostics.reasoningPresent ? '是' : '否'}</dd></div>}
      {diagnostics.refusalPresent !== undefined && <div><dt>存在拒答</dt><dd>{diagnostics.refusalPresent ? '是' : '否'}</dd></div>}
      {diagnostics.schemaPaths.length > 0 && <div><dt>字段位置</dt><dd>{diagnostics.schemaPaths.join('、')}</dd></div>}
    </dl>
  </details>;
}
