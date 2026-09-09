// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/app/app-shell';

describe('AppShell', () => {
  it('marks the active destination and navigates through the product areas', () => {
    const onNavigate = vi.fn();
    render(<AppShell view="reviews" onNavigate={onNavigate} connectionReady><p>内容</p></AppShell>);

    expect(screen.getAllByRole('button', { name: /开始|知己 Agent|日志|复盘|项目|设置/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: '复盘' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('记录，分析，行动')).toBeInTheDocument();
    expect(document.querySelector('.topbar__context')).toHaveTextContent('复盘');
    expect(screen.queryByText('本地优先')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '日志' }));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'journal' });
    expect(screen.getByText('本地保存')).toBeInTheDocument();
    expect(screen.getByText('查看存储位置')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '本地保存，查看存储位置' }));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'settings', settingsSection: 'data' });
    expect(screen.getByText('AI 已配置')).toBeInTheDocument();
  });
});
