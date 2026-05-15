/* ============================================================
   EmojiPicker — Emoji 选择器

   基于 emoji-picker-element 的 Web Component 封装。
   ============================================================ */

import 'emoji-picker-element'

import type Picker from 'emoji-picker-element/picker'
import type { EmojiClickEvent } from 'emoji-picker-element/shared'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import { useTheme } from '../../providers/ThemeProvider'

interface EmojiPickerProps {
  onEmojiClick: (emoji: string) => void
  onClose?: () => void
}

const EmojiPicker: FC<EmojiPickerProps> = ({ onEmojiClick, onClose }) => {
  const { resolvedTheme } = useTheme()
  const ref = useRef<Picker>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const picker = ref.current
    if (!picker) return

    const handleEmojiClick = (event: EmojiClickEvent) => {
      event.stopPropagation()
      const { detail } = event
      const emoji = detail.unicode || ('unicode' in detail.emoji ? detail.emoji.unicode : '')
      if (emoji) {
        onEmojiClick(emoji)
      }
    }

    picker.addEventListener('emoji-click', handleEmojiClick)

    return () => {
      picker.removeEventListener('emoji-click', handleEmojiClick)
    }
  }, [onEmojiClick])

  // 点击外部关闭
  useEffect(() => {
    if (!onClose) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // 延迟添加监听，避免立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      <emoji-picker
        ref={ref}
        class={resolvedTheme === 'dark' ? 'dark' : 'light'}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  )
}

export default EmojiPicker
