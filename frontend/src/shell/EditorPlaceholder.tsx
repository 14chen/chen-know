import { useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'

/**
 * 临时占位编辑器（仅用于 p-shell 在 p-editor 落地前自测）。
 *
 * 它严格照抄 PROTOTYPE.md §4 的接口形状，因此 AppShell 的调用点在编译期就能被校验。
 * 真实的 `@/editor/MarkdownEditor` 就绪后，AppShell 直接换回真实导入即可，
 * 本文件与 `@/editor/**` 无关，不会与 p-editor 的任何文件冲突。
 */

export interface MarkdownEditorProps {
  value: string
  onChange: (next: string) => void
  noteTitle?: string
  knownTitles?: string[]
  onWikiLinkClick?: (title: string) => void
  onUploadImage?: (file: File) => Promise<string>
  onSave?: () => void
  readOnly?: boolean
  className?: string
}

export function MarkdownEditor({
  value,
  onChange,
  onUploadImage,
  onSave,
  readOnly = false,
  className,
}: MarkdownEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSave?.()
      }
    },
    [onSave],
  )

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const file = Array.from(event.clipboardData.files)[0]
      if (!file) return
      event.preventDefault()
      void (async () => {
        try {
          const uploaded = await onUploadImage?.(file)
          if (uploaded) onChange(`${value}\n![${file.name}](${uploaded})\n`)
        } catch {
          /* 真实编辑器会在这里 toast；占位组件仅忽略 */
        }
      })()
    },
    [onUploadImage, onChange, value],
  )

  useEffect(() => {
    if (areaRef.current) areaRef.current.style.height = '100%'
  }, [])

  return (
    <textarea
      ref={areaRef}
      className={className}
      data-editor-placeholder="true"
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={handlePaste}
      style={{
        width: '100%',
        minHeight: '100%',
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--r-lg)',
        padding: 'var(--sp-5)',
        background: 'var(--surface)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-base)',
        lineHeight: 'var(--lh-relaxed)',
        resize: 'none',
        outline: 'none',
      }}
    />
  )
}
