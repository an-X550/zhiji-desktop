import type { AiConnectionTestResult } from '../../shared/schemas/domain';

function tokenValue(value: number | null | undefined): string {
  return value === null ? '未提供' : String(value);
}

/** 展示可安全复核的连接结果，不显示响应正文、提示词或凭据。 */
export function AiConnectionDiagnostics({ result }: { result: AiConnectionTestResult }) {
  return <section className="connection-diagnostics" aria-label="AI 连接诊断">
    <div className="connection-diagnostics__heading">
      <div><strong>结构化连接已验证</strong><span>实际收到了可解析的 JSON 响应</span></div>
      <span className="connection-diagnostics__badge">通过</span>
    </div>
    <dl className="diagnostic-list">
      <div><dt>服务商</dt><dd>{result.providerId}</dd></div>
      <div><dt>模型</dt><dd>{result.model}</dd></div>
      <div><dt>结束原因</dt><dd>{result.finishReason ?? '未提供'}</dd></div>
      <div><dt>JSON 校验</dt><dd>{result.jsonValid ? '通过' : '未通过'}</dd></div>
      <div><dt>输出长度</dt><dd>{result.outputLength}</dd></div>
      <div><dt>输入 token</dt><dd>{tokenValue(result.usage?.inputTokens)}</dd></div>
      <div><dt>输出 token</dt><dd>{tokenValue(result.usage?.outputTokens)}</dd></div>
      <div><dt>缓存输入 token</dt><dd>{tokenValue(result.usage?.cachedInputTokens)}</dd></div>
      <div><dt>存在 reasoning</dt><dd>{result.reasoningPresent ? '是' : '否'}</dd></div>
      <div><dt>存在拒答</dt><dd>{result.refusalPresent ? '是' : '否'}</dd></div>
    </dl>
  </section>;
}
