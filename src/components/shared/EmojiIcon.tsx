/* ============================================================
   EmojiIcon — Emoji 头像渲染组件

   参考 CherryStudio 实现：前景 emoji + 模糊放大背景 emoji
   创造渐变色圆形头像效果。
   ============================================================ */

import type { FC } from 'react'

interface EmojiIconProps {
  emoji: string
  size?: number
  fontSize?: number
  className?: string
}

const EmojiIcon: FC<EmojiIconProps> = ({
  emoji,
  size = 26,
  fontSize = 15,
  className = ''
}) => {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 模糊背景层 */}
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '200%',
          transform: 'scale(1.5)',
          filter: 'blur(5px)',
          opacity: 0.4,
        }}
      >
        {emoji || '⭐'}
      </div>
      {/* 前景 emoji */}
      {emoji || '⭐'}
    </div>
  )
}

export default EmojiIcon
