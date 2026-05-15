// 设置区域入口 — 全屏覆盖，左导航 + 右内容区
import { useState, useEffect } from 'react';
import type { Provider, Model } from '../types';
import { providersApi, modelsApi } from '../services/api';
import SettingsShell, { type SettingsTab } from './settings/SettingsShell';
import ModelSettings from './settings/ModelSettings';
import MemorySettings from './settings/MemorySettings';
import ToolsSettings from './settings/ToolsSettings';

interface SettingsAreaProps {
  activeTab: SettingsTab;
  onClose: () => void;
}

export default function SettingsArea({ activeTab, onClose }: SettingsAreaProps) {
  const [active, setActive] = useState<SettingsTab>(activeTab);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);

  // 同步外部 tab 变化
  useEffect(() => { setActive(activeTab); }, [activeTab]);

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {});
    modelsApi.list().then(setModels).catch(() => {});
  }, []);

  const renderTab = () => {
    switch (active) {
      case 'model':
        return <ModelSettings />;
      case 'memory':
        return <MemorySettings />;
      case 'tools':
        return <ToolsSettings providers={providers} models={models} />;
    }
  };

  return (
    <SettingsShell activeTab={active} onTabChange={setActive} onClose={onClose}>
      {renderTab()}
    </SettingsShell>
  );
}
