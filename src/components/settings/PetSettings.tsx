// 桌宠设置页 — 已安装列表 + 导入 + 偏好设置
import { useState, useEffect, useRef } from 'react';

const eApi = () => (window as any).electronAPI;

interface InstalledPet {
  id: string;
  name: string;
  description: string;
  version: string;
  installedAt: string;
  spritesheetUrl?: string;
}

export default function PetSettings() {
  const [subTab, setSubTab] = useState<'installed' | 'import'>('installed');
  const [pets, setPets] = useState<InstalledPet[]>([]);
  const [activePetId, setActivePetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left' | 'custom'>('bottom-right');
  const [autoWake, setAutoWake] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [electronOk, setElectronOk] = useState(true);
  const [electronDebug, setElectronDebug] = useState('');

  useEffect(() => {
    loadPets();
    loadConfig();
  }, []);

  async function loadConfig() {
    const api = eApi();
    if (!api?.petGetConfig) return;
    try {
      const config = await api.petGetConfig();
      if (config) {
        setActivePetId(config.defaultPetId || null);
        setZoom(config.zoom || 1.0);
        setPosition(config.position || 'bottom-right');
        setAutoWake(config.autoWakeOnStartup !== false);
      }
    } catch (err: any) {
      console.error('[PetSettings] 加载配置失败:', err);
    }
  }

  async function loadPets() {
    const api = eApi();
    // Electron IPC 模式
    if (api?.petListInstalled) {
      try {
        const list = await api.petListInstalled();
        setPets(list);
        return;
      } catch (err: any) {
        console.error('[PetSettings] IPC 加载失败:', err);
      }
    }
    // 浏览器 dev 模式：走 REST API
    try {
      const res = await fetch('/api/pets');
      if (res.ok) {
        const list = await res.json();
        setPets(list);
      } else {
        setElectronOk(false);
        setElectronDebug('REST API 返回错误');
      }
    } catch (err: any) {
      setElectronOk(false);
      setElectronDebug(`无法加载 (IPC 与 REST 均不可用): ${err.message}`);
    }
  }

  async function activatePet(pet: InstalledPet) {
    if (activePetId === pet.id) {
      setActivePetId(null);
      eApi()?.petDeactivate();
    } else {
      setActivePetId(pet.id);
      eApi()?.petActivate({ id: pet.id, zoom });
    }
  }

  async function deletePet(petId: string) {
    if (!confirm('确定要删除这只桌宠吗？此操作不可撤销。')) return;
    const api = eApi();
    if (api) {
      if (activePetId === petId) { api.petDeactivate(); setActivePetId(null); }
    }
    setPets(prev => prev.filter(p => p.id !== petId));
  }

  const handleZoomChange = (value: number) => {
    setZoom(value);
    eApi()?.petUpdateConfig({ zoom: value, position, autoWakeOnStartup: autoWake });
  };

  const handlePositionChange = (pos: typeof position) => {
    setPosition(pos);
    eApi()?.petUpdateConfig({ zoom, position: pos, autoWakeOnStartup: autoWake });
  };

  const handleAutoWakeChange = (val: boolean) => {
    setAutoWake(val);
    eApi()?.petUpdateConfig({ zoom, position, autoWakeOnStartup: val });
  };

  async function handleFileImport(files: FileList | null) {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      const api = eApi();
      if (api) await api.petImportLocal((files[0] as any).path || files[0].name);
      await loadPets();
    } catch (err) { console.error('导入失败:', err); }
    finally { setLoading(false); }
  }


  return (
    <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
      {/* 子标签 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexShrink: 0 }}>
        <button onClick={() => setSubTab('installed')} style={subTabBtnStyle(subTab === 'installed')}>
          已安装桌宠
        </button>
        <button onClick={() => setSubTab('import')} style={subTabBtnStyle(subTab === 'import')}>
          导入桌宠
        </button>
      </div>

      {/* 已安装页 */}
      {subTab === 'installed' && (
        <div>
          <div style={sectionLabelStyle}>已安装的桌宠</div>

          {pets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {electronOk ? (
                <>
                  <div style={{ fontSize: 13, color: 'var(--muted-soft)' }}>尚未安装桌宠</div>
                  <div style={{ fontSize: 12, color: 'var(--muted-soft)', marginTop: 4 }}>
                    切换到「导入桌宠」页签添加社区宠物
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--warn)' }}>
                  {electronDebug || '桌宠功能需要 Electron 桌面环境'}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {pets.map((pet) => (
                <div key={pet.id} onClick={() => activatePet(pet)}
                  style={{
                    background: pet.id === activePetId ? 'rgba(85,112,184,0.04)' : 'var(--chat-bg)',
                    border: `1px solid ${pet.id === activePetId ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-lg)', padding: '18px 14px 14px', cursor: 'pointer',
                    transition: 'all 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 10, position: 'relative', overflow: 'hidden',
                    boxShadow: pet.id === activePetId ? '0 0 0 2px var(--accent)' : undefined,
                  }}
                >
                  {pet.id === activePetId && (
                    <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--accent)', color: '#fff' }}>
                      ✓ 已启用
                    </span>
                  )}
                  <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-xl)', background: 'linear-gradient(135deg, var(--sidebar-bg), #e8ecf6)', overflow: 'hidden', flexShrink: 0 }}>
                    {pet.spritesheetUrl ? (
                      <img src={pet.spritesheetUrl}
                        alt={pet.name}
                        style={{ width: 576, height: 702, display: 'block', maxWidth: 'none' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🐾</div>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--fg)' }}>
                    {pet.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-soft)', textAlign: 'center', lineHeight: 1.5 }}>
                    {pet.description || `v${pet.version}`}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 偏好设置 — 仅在已安装页显示 */}
          <div style={{ marginTop: 32 }}>
            <div style={sectionLabelStyle}>偏好设置</div>

            <div style={settingRowStyle}>
              <div>
                <div style={settingLabelStyle}>宠物缩放</div>
                <div style={settingDescStyle}>{zoom.toFixed(1)}x</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200 }}>
                <span style={{ fontSize: 11, color: 'var(--muted-soft)' }}>0.5x</span>
                <input type="range" min="0.5" max="2.0" step="0.1" value={zoom}
                  onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                  style={{ flex: 1, height: 4, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, color: 'var(--muted-soft)' }}>2.0x</span>
              </div>
            </div>

            <div style={settingRowStyle}>
              <div>
                <div style={settingLabelStyle}>默认位置</div>
                <div style={settingDescStyle}>
                  {position === 'bottom-right' ? '屏幕右下角' : position === 'bottom-left' ? '屏幕左下角' : '自定义（拖拽调整）'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['bottom-right', 'bottom-left', 'custom'] as const).map((pos) => (
                  <button key={pos} onClick={() => handlePositionChange(pos)} style={posBtnStyle(position === pos)}>
                    {pos === 'bottom-right' ? '右下' : pos === 'bottom-left' ? '左下' : '自定义'}
                  </button>
                ))}
              </div>
            </div>

            <div style={settingRowStyle}>
              <div>
                <div style={settingLabelStyle}>启动时自动唤醒</div>
                <div style={settingDescStyle}>
                  {autoWake ? '启动 aichat 时自动显示桌宠' : '需手动在设置中激活桌宠'}
                </div>
              </div>
              <div onClick={() => handleAutoWakeChange(!autoWake)}
                style={{
                  width: 42, height: 24, borderRadius: 12, cursor: 'pointer',
                  background: autoWake ? 'var(--accent)' : 'var(--border)',
                  position: 'relative', transition: 'background 0.25s', flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: 2, width: 20, height: 20,
                  borderRadius: '50%', background: '#fff',
                  transition: 'transform 0.25s',
                  transform: autoWake ? 'translateX(18px)' : 'translateX(0)',
                  boxShadow: '0 1px 3px rgba(60,65,100,0.15)',
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 导入页 */}
      {subTab === 'import' && (
        <div>
          <div style={sectionLabelStyle}>导入桌宠</div>

          <input ref={fileInputRef} type="file" accept=".json,.webp,.png"
            style={{ display: 'none' }}
            onChange={(e) => handleFileImport(e.target.files)}
          />

          <div onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileImport(e.dataTransfer.files); }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-lg)', padding: '40px 20px', textAlign: 'center',
              cursor: 'pointer', transition: 'all 0.2s',
              background: dragOver ? 'rgba(85,112,184,0.03)' : 'var(--chat-bg)',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)', marginBottom: 4 }}>拖拽文件到此处导入</div>
            <div style={{ fontSize: 12, color: 'var(--muted-soft)' }}>或点击此区域选择文件</div>
            <div style={{ fontSize: 11, color: 'var(--muted-soft)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
              支持 pet.json + spritesheet.webp 格式
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 样式函数 =====

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--muted-soft)', marginBottom: 14,
};

const settingRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 0', borderBottom: '1px solid var(--border-soft)',
};

const settingLabelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--fg)',
};

const settingDescStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--muted-soft)', letterSpacing: '0.01em',
};

function subTabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '7px 18px', borderRadius: 'var(--radius-full)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'transparent',
    fontSize: 13, fontWeight: 500, letterSpacing: '0.01em',
    color: active ? '#fff' : 'var(--muted)', cursor: 'pointer',
    transition: 'all 0.2s', fontFamily: 'var(--font-body)',
  };
}

function posBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 'var(--radius-full)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--muted)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-body)',
  };
}
