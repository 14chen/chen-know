import type { ViewProps } from '@/views/types'

/** FS-PROBE：故意在渲染期抛错，用于验收「视图抛错不白屏」（验收后会删除） */
export default function FsProbeThrow(_props: ViewProps) {
  throw new Error('FS-PROBE 故意抛错')
}
