/* ============================================================
   ThemeToggle — 主题切换按钮组件

   一个轻量的主题切换按钮, 点击在 dark/light/system 之间循环
   ============================================================ */

import { Button, Tooltip } from 'antd'
import { Moon, Sun, Monitor } from 'lucide-react'

import { useTheme, type ThemeMode } from '../../providers/ThemeProvider'

const iconMap: Record<ThemeMode, typeof Sun> = {
  dark: Moon,
  light: Sun,
  system: Monitor
}

const labelMap: Record<ThemeMode, string> = {
  dark: '暗色模式',
  light: '亮色模式',
  system: '跟随系统'
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const Icon = iconMap[theme]

  return (
    <Tooltip title={`当前: ${labelMap[theme]} — 点击切换`}>
      <Button
        type="text"
        icon={<Icon size={18} />}
        onClick={toggleTheme}
      />
    </Tooltip>
  )
}

export default ThemeToggle
