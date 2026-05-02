/* ============================================================
   AntdThemeProvider — Ant Design 5 主题配置

   功能:
   - 跟随 ThemeProvider 自动切换暗色/亮色 Algorithm
   - 将 Ant Design Token 映射到 CSS 变量，保持与自定义样式一致
   - 预设 CherryStudio 风格的组件 Token (小圆角、紧凑间距)

   用法:
     <ThemeProvider>
       <AntdThemeProvider>
         <App />
       </AntdThemeProvider>
     </ThemeProvider>
   ============================================================ */

import { ConfigProvider, theme } from 'antd'
import type { FC, PropsWithChildren } from 'react'

import { useTheme } from './ThemeProvider'

interface AntdThemeProviderProps extends PropsWithChildren {
  /** 用户自定义主题色, 默认 CherryStudio 绿 */
  colorPrimary?: string
}

export const AntdThemeProvider: FC<AntdThemeProviderProps> = ({
  children,
  colorPrimary = '#687eaf'
}) => {
  const { resolvedTheme } = useTheme()

  return (
    <ConfigProvider
      theme={{
        algorithm: resolvedTheme === 'dark'
          ? theme.darkAlgorithm
          : theme.defaultAlgorithm,
        token: {
          colorPrimary,
          borderRadius: 6,
        }
      }}>
      {children}
    </ConfigProvider>
  )
}

export default AntdThemeProvider
