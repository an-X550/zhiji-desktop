export function safeGenerationError(reason: unknown): string {
  if (reason instanceof Error) {
    const message = reason.message.replace(/^Error invoking remote method '[^']+':\s*/, '').trim();
    if (message && message.length <= 140 && !/[\\/]|https?:\/\//i.test(message)) return `生成失败：${message}`;
  }
  return '生成失败：请检查 AI 设置或稍后重试。';
}
