import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataDirectoryInfo, Journal, Project, PublicProviderConfig, Review } from '../../shared/schemas/domain';

export type AppDataResource = 'journals' | 'projects' | 'reviews' | 'settings' | 'dataDirectory';
export interface AppDataLoadError { resource: AppDataResource; message: string }

const RESOURCE_LABELS: Record<AppDataResource, string> = {
  journals: '日志',
  projects: '项目',
  reviews: '复盘',
  settings: 'AI 设置',
  dataDirectory: '数据位置',
};

function errorMessage(reason: unknown, resource: AppDataResource): string {
  const detail = reason instanceof Error ? reason.message : '暂时无法读取';
  return `${RESOURCE_LABELS[resource]}：${detail}`;
}

export function useAppData() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettings] = useState<PublicProviderConfig | null>(null);
  const [dataDirectory, setDataDirectory] = useState<DataDirectoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadErrors, setLoadErrors] = useState<AppDataLoadError[]>([]);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setRefreshing(true);
    const resources: Array<[AppDataResource, () => Promise<unknown>]> = [
      ['journals', () => window.zhiji.journals.list()],
      ['projects', () => window.zhiji.projects.list()],
      ['reviews', () => window.zhiji.reviews.list()],
      ['settings', () => window.zhiji.settings.getPublicConfig()],
      ['dataDirectory', () => window.zhiji.dataDirectory.getInfo()],
    ];
    const results = await Promise.allSettled(resources.map(([, load]) => load()));
    if (currentRequest !== requestId.current) return;
    const errors: AppDataLoadError[] = [];
    results.forEach((result, index) => {
      const resource = resources[index][0];
      if (result.status === 'rejected') { errors.push({ resource, message: errorMessage(result.reason, resource) }); return; }
      if (resource === 'journals') setJournals(result.value as Journal[]);
      if (resource === 'projects') setProjects(result.value as Project[]);
      if (resource === 'reviews') setReviews(result.value as Review[]);
      if (resource === 'settings') setSettings(result.value as PublicProviderConfig);
      if (resource === 'dataDirectory') setDataDirectory(result.value as DataDirectoryInfo);
    });
    setLoadErrors(errors);
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // hasApiKey 在此派生一次，页面直接使用，不再各自重复计算
  return { journals, projects, reviews, settings, dataDirectory, loading, refreshing, loadErrors, error: loadErrors.map((item) => item.message).join('；'), refresh, hasApiKey: Boolean(settings?.hasApiKey) };
}
