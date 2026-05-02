/* ============================================================
   ThemeProvider — 主题模式管理

   支持三种模式: dark | light | system
   - 在 <body> 上设置 theme-mode 属性和 .dark/.light 类
   - 监听系统主题变化 (system 模式下)
   - 通过 React Context 向下传递当前主题

   用法:
     <ThemeProvider>
       <App />
     </ThemeProvider>

     const { theme, setTheme, toggleTheme } = useTheme()
   ============================================================ */

import { createContext, useContext, useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'

interface ThemeContextType {
  /** 用户设置的主题模式 */
  theme: ThemeMode
  /** 实际生效的主题 (system 模式下解析为 dark 或 light) */
  resolvedTheme: 'dark' | 'light'
  /** 切换主题: dark → light → system → dark */
  toggleTheme: () => void
  /** 直接设置主题 */
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolvedTheme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {}
})

/** 从 localStorage 读取用户偏好 */
function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem('app-theme')
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored
    }
  } catch { /* localStorage 不可用 */ }
  return 'system'
}

/** 保存到 localStorage */
function storeTheme(theme: ThemeMode) {
  try {
    localStorage.setItem('app-theme', theme)
  } catch { /* 忽略 */ }
}

/** 解析 system 模式到具体值 */
function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/** 更新 DOM 上的主题属性 */
function applyThemeToDOM(resolved: 'dark' | 'light') {
  const body = document.body
  body.setAttribute('theme-mode', resolved)
  if (resolved === 'dark') {
    body.classList.remove('light')
    body.classList.add('dark')
  } else {
    body.classList.remove('dark')
    body.classList.add('light')
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => resolveTheme(getStoredTheme()))

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode)
    storeTheme(mode)
    const resolved = resolveTheme(mode)
    setResolvedTheme(resolved)
    applyThemeToDOM(resolved)
  }, [])

  const toggleTheme = useCallback(() => {
    const next: Record<ThemeMode, ThemeMode> = {
      dark: 'light',
      light: 'system',
      system: 'dark'
    }
    setTheme(next[theme])
  }, [theme, setTheme])

  // 监听系统主题变化 (仅在 system 模式下生效)
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        const resolved = resolveTheme('system')
        setResolvedTheme(resolved)
        applyThemeToDOM(resolved)
      }
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  // 初始化时应用主题
  useEffect(() => {
    applyThemeToDOM(resolvedTheme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

/** 获取主题上下文 */
export function useTheme() {
  return useContext(ThemeContext)
}
