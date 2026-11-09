import { useCallback, useEffect, useRef, useState } from 'react'
import { describeApiError } from '@/api/client'
import { createFolder, deleteFolder, listFolders, patchFolder } from '@/api/folders'
import type { FolderNode } from '@/api/types'
import { useToast } from '@/components/Toast'

/* ---------------------------------------------------------------- 纯函数 */

export function findFolder(nodes: FolderNode[], id: number): FolderNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = findFolder(node.children, id)
    if (hit) return hit
  }
  return null
}

/** 某目录的全部子孙 id（不含自身）——删除确认框要说清连带的子目录数量 */
export function collectDescendantIds(node: FolderNode): number[] {
  const ids: number[] = []
  const walk = (list: FolderNode[]) => {
    for (const child of list) {
      ids.push(child.id)
      walk(child.children)
    }
  }
  walk(node.children)
  return ids
}

/** 整棵子树的笔记数（含子孙目录），用于「删除会影响多少篇笔记」的确认文案 */
export function countSubtreeNotes(node: FolderNode): number {
  return node.children.reduce((sum, child) => sum + countSubtreeNotes(child), node.noteCount)
}

function detachNode(
  nodes: FolderNode[],
  id: number,
): { tree: FolderNode[]; removed: FolderNode | null } {
  let removed: FolderNode | null = null
  const walk = (list: FolderNode[]): FolderNode[] => {
    const next: FolderNode[] = []
    for (const node of list) {
      if (node.id === id) {
        removed = node
        continue
      }
      next.push({ ...node, children: walk(node.children) })
    }
    return next
  }
  const tree = walk(nodes)
  return { tree, removed }
}

function attachNode(nodes: FolderNode[], parentId: number | null, node: FolderNode): FolderNode[] {
  if (parentId === null) return [...nodes, node]
  return nodes.map((item) =>
    item.id === parentId
      ? { ...item, children: [...item.children, node] }
      : { ...item, children: attachNode(item.children, parentId, node) },
  )
}

/** 目录树内移动的乐观变更（拖拽用） */
function applyMove(nodes: FolderNode[], id: number, parentId: number | null): FolderNode[] {
  const { tree, removed } = detachNode(nodes, id)
  if (!removed) return nodes
  return attachNode(tree, parentId, removed)
}

/* ---------------------------------------------------------------- hook */

export interface TreeController {
  tree: FolderNode[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  /** 新建目录：parentId=null 建在根；返回新目录 id（失败返回 null） */
  create: (parentId: number | null, name: string) => Promise<number | null>
  rename: (id: number, name: string) => Promise<boolean>
  /**
   * 移动目录：乐观更新 + **失败回滚**。
   * 不做本地父子校验——「不能移进自己的子孙」由后端返回 400，前端按回滚处理。
   */
  move: (id: number, parentId: number | null) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
}

export function useTree(): TreeController {
  const toast = useToast()
  const [tree, setTree] = useState<FolderNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = seqRef.current + 1
    seqRef.current = seq
    setLoading(true)
    try {
      const nodes = await listFolders()
      if (seqRef.current !== seq) return
      setTree(nodes)
      setError(null)
    } catch (cause) {
      if (seqRef.current !== seq) return
      setError(describeApiError(cause))
    } finally {
      if (seqRef.current === seq) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = useCallback(
    async (parentId: number | null, name: string): Promise<number | null> => {
      try {
        const created = await createFolder({ parentId, name })
        await reload()
        toast.success(`已新建目录「${created.name}」`)
        return created.id
      } catch (cause) {
        toast.error(`新建目录失败：${describeApiError(cause)}`)
        return null
      }
    },
    [reload, toast],
  )

  const rename = useCallback(
    async (id: number, name: string): Promise<boolean> => {
      try {
        await patchFolder(id, { name })
        await reload()
        toast.success('目录已重命名')
        return true
      } catch (cause) {
        toast.error(`重命名失败：${describeApiError(cause)}`)
        return false
      }
    },
    [reload, toast],
  )

  const move = useCallback(
    async (id: number, parentId: number | null): Promise<boolean> => {
      const snapshot = tree
      setTree(applyMove(tree, id, parentId))

      try {
        await patchFolder(id, { parentId })
        await reload()
        return true
      } catch (cause) {
        // 硬要求：失败必须回滚 UI，不能留下与服务端不一致的树
        setTree(snapshot)
        toast.error(`移动目录失败，已还原：${describeApiError(cause)}`)
        return false
      }
    },
    [tree, reload, toast],
  )

  const remove = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        await deleteFolder(id)
        await reload()
        return true
      } catch (cause) {
        toast.error(`删除目录失败：${describeApiError(cause)}`)
        return false
      }
    },
    [reload, toast],
  )

  return { tree, loading, error, reload, create, rename, move, remove }
}
