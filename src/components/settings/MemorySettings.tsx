// 记忆设置：按 UI spec 重构 — 记忆系统开关 + 统计 + 个人信息
import { useState, useEffect } from 'react';
import { memoryApi, profileApi } from '../../services/api';
import type { MemorySettings as MemorySettingsType } from '../../types';
import { Toggle, BtnPrimary } from '../shared/Primitives';

export default function MemorySettings() {
  const [settings, setSettings] = useState<MemorySettingsType | null>(null);
  const [memStats, setMemStats] = useState<{ total: number; active: number }>({ total: 0, active: 0 });
  const [profileText, setProfileText] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [s, mems, profile] = await Promise.all([
        memoryApi.getSettings(),
        memoryApi.list(),
        profileApi.list(),
      ]);
      setSettings(s);
      setMemStats({
        total: mems.length,
        active: mems.filter((m: any) => m.status === 'active').length,
      });
      if (profile && profile.length > 0) {
        setProfileText(profile.map((e: any) => `${e.key}: ${e.value}`).join('\n'));
      }
    } catch (e) { console.error('加载记忆数据失败:', e); }
  };

  const handleToggle = async () => {
    if (!settings) return;
    const newEnabled = settings.enabled === 1 ? 0 : 1;
    try {
      const s = await memoryApi.updateSettings({ enabled: newEnabled });
      setSettings(s);
    } catch (e) { console.error(e); }
  };

  const handleSaveProfile = async () => {
    try {
      const kv: Record<string, string> = {};
      const lines = profileText.split('\n').filter(Boolean);
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      await profileApi.update(kv);
      await loadData();
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="w-full py-8 px-6 space-y-10">
      <PageTitle title="长期记忆" desc="管理全局记忆开关与您的个人背景信息" />

      {/* 记忆系统 */}
      <div style={{ marginBottom: 28 }}>
        <div className="setting-group-label">记忆系统</div>
        <div className="setting-row">
          <div>
            <div className="setting-row-label">自动提取记忆</div>
            <div className="setting-row-desc">
              {settings?.enabled ? '已开启 — 对话空闲后自动提取候选记忆' : '已关闭 — 不会自动提取新记忆'}
            </div>
          </div>
          <Toggle checked={settings?.enabled === 1} onChange={handleToggle} />
        </div>
      </div>

      {/* 记忆统计 */}
      <div style={{ marginBottom: 28 }}>
        <div className="setting-group-label">记忆统计</div>
        <div className="stats-grid">
          <StatCard label="活跃记忆" value={memStats.active} />
          <StatCard label="记忆总数" value={memStats.total} accent="var(--fg)" />
        </div>
      </div>

      {/* 个人信息 */}
      <div style={{ marginBottom: 28 }}>
        <div className="setting-group-label">个人信息</div>
        <textarea
          value={profileText}
          onChange={e => setProfileText(e.target.value)}
          rows={6}
          placeholder={"昵称: 小明\n位置: 北京\n职业: 软件工程师\n技术栈: React, TypeScript, Python\n爱好: 骑行, 摄影"}
          className="w-full px-4 py-3 rounded-lg border outline-none resize-y leading-relaxed"
          style={{
            backgroundColor: 'var(--chat-bg)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
          }}
          onFocus={e => {
            (e.target as HTMLElement).style.borderColor = 'var(--accent)';
            (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
          }}
          onBlur={e => {
            (e.target as HTMLElement).style.borderColor = 'var(--border)';
            (e.target as HTMLElement).style.boxShadow = 'none';
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, alignItems: 'center', gap: 12 }}>
          {profileSaved && <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-body)' }}>已保存</span>}
          <BtnPrimary onClick={handleSaveProfile}>保存个人简介</BtnPrimary>
        </div>
      </div>
    </div>
  );
}

// ===== 内联组件 =====

function PageTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      <p className="mt-1" style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>{desc}</p>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border px-4 py-4 text-center" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--chat-bg)' }}>
      <div className="font-bold tabular-nums" style={{ color: accent || 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-soft)', letterSpacing: '0.03em', fontWeight: 500, marginTop: 4 }}>{label}</div>
    </div>
  );
}
