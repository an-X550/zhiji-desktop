import type { ReactNode } from 'react';
import { AgentIcon, HistoryIcon, ProjectsIcon, ReviewsIcon, SettingsIcon, TodayIcon } from '../components/icons';
import { APP_NAVIGATION, type AppView, type NavigationTarget } from './navigation';
const icons = { start: TodayIcon, agent: AgentIcon, journal: HistoryIcon, reviews: ReviewsIcon, projects: ProjectsIcon, settings: SettingsIcon };
export function AppShell({ view, onNavigate, connectionReady, children }: { view: AppView; onNavigate(target: NavigationTarget): void; connectionReady: boolean; children: ReactNode }) {
  return <div className="desktop-shell">
    <aside className="sidebar">
      <div className="brand" aria-label="知己"><span>知己</span><small>记录，分析，行动</small></div>
      <nav className="navigation" aria-label="主要导航">
        {APP_NAVIGATION.map((item) => {
          const Icon = icons[item.id];
          return <button key={item.id} onClick={() => onNavigate({ view: item.id })} aria-label={item.label} aria-current={item.id === view ? 'page' : undefined}><Icon aria-hidden="true"/><span>{item.label}</span></button>;
        })}
      </nav>
      <button className="local-data-status" aria-label="本地保存，查看存储位置" onClick={() => onNavigate({ view: 'settings', settingsSection: 'data' })}><strong>本地保存</strong><span>查看存储位置</span></button>
    </aside>
    <main className="workspace">
      {view !== 'journal' && <header className="topbar"><span className="topbar__context" role={view === 'agent' ? 'heading' : undefined} aria-level={view === 'agent' ? 2 : undefined}>{APP_NAVIGATION.find((item) => item.id === view)?.label ?? view}</span><div className={`local-status ${connectionReady ? 'is-ready' : ''}`}><span className="local-status__dot"/>{connectionReady ? 'AI 已配置' : '等待配置 AI'}</div></header>}
      <div className={`page-view page-view--${view}`}>{children}</div>
    </main>
  </div>;
}
