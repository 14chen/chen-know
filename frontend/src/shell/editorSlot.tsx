import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/**
 * 笔记视图（= Typora 编辑器）的注入点。
 *
 * 编辑器需要 `useNotes` 的控制器（content / changeContent / uploadImage …），
 * 这些能力不在冻结的 `ViewContext` 里；而注册表要求每个视图都有 component。
 * 因此外壳把「笔记视图」这段 JSX 通过本 slot 注入，
 * 注册表只需引用 `NotesSlotView` 即可保持 11 个视图全部登记、路由可达。
 */
const EditorSlotContext = createContext<ReactNode>(null)

export function EditorSlotProvider({
  value,
  children,
}: {
  value: ReactNode
  children: ReactNode
}) {
  return <EditorSlotContext.Provider value={value}>{children}</EditorSlotContext.Provider>
}

export function NotesSlotView() {
  return <>{useContext(EditorSlotContext)}</>
}
