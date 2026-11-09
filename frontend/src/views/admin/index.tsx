/**
 * 成员管理视图 —— 路由 `#/admin`（契约 docs/API.md §2，仅管理员）
 *
 * 服务端硬约束必须在 UI 上同步体现：
 *   不得停用 / 降级 / 删除**自己**；不得停用**最后一名管理员**。
 * 非管理员**不发任何请求**（结构性保证：AdminPanel 根本不挂载）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, describeApiError, request } from '@/api/client'
import type {
  AdminUser,
  CreateUserRequest,
  Invite,
  Page,
  UpdateUserRequest,
} from '@/api/types'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { Skeleton } from '@/components/Skeleton'
import { TextField } from '@/components/TextField'
import type { ViewProps } from '@/views/types'

type Status = 'loading' | 'ready' | 'error'
type UserModal = { mode: 'create' } | { mode: 'edit'; user: AdminUser }

const ROLE_OPTIONS = [
  { value: 'member', label: '成员' },
  { value: 'admin', label: '管理员' },
]

export default function AdminView({ ctx }: ViewProps) {
  // 非管理员：直接给无权提示。这里不调用任何 hook，也不会发出请求。
  if (!ctx.isAdmin) {
    return (
      <div className="kb-adm kb-adm--admin">
        <div className="kb-adm__body">
          <EmptyState
            title="无权访问"
            desc="成员管理仅对管理员开放。如需权限，请联系库的管理员调整你的角色。"
          />
        </div>
      </div>
    )
  }
  return <AdminPanel ctx={ctx} />
}

function AdminPanel({ ctx }: ViewProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [userModal, setUserModal] = useState<UserModal | null>(null)
  const [inviteModal, setInviteModal] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    try {
      const [userPage, invitePage] = await Promise.all([
        request<Page<AdminUser>>('/api/admin/users', { signal: controller.signal }),
        request<Page<Invite>>('/api/admin/invites', { signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      setUsers(userPage.items)
      setInvites(invitePage.items)
      setStatus('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusyKey(key)
      try {
        await action()
        await load()
      } catch (err) {
        ctx.toast.error(describeApiError(err))
      } finally {
        busyRef.current = false
        setBusyKey(null)
      }
    },
    [ctx, load],
  )

  const activeAdmins = users.filter((user) => user.role === 'admin' && !user.disabled).length

  const guardsFor = useCallback(
    (user: AdminUser) => {
      const isSelf = user.id === ctx.user.id
      const isLastAdmin = user.role === 'admin' && !user.disabled && activeAdmins <= 1
      return { isSelf, isLastAdmin }
    },
    [activeAdmins, ctx.user.id],
  )

  /* ------------------------------------------------------------ 写操作 */
  const toggleUser = useCallback(
    async (user: AdminUser) => {
      const { isSelf, isLastAdmin } = guardsFor(user)
      if (isSelf || isLastAdmin) return
      const name = user.displayName || user.username
      const next = !user.disabled
      const ok = await ctx.confirm({
        title: next ? '停用用户' : '启用用户',
        message: next
          ? `停用后「${name}」将无法登录，其笔记与数据仍然保留。确定停用吗？`
          : `恢复「${name}」的登录权限？`,
        confirmText: next ? '停用' : '启用',
        danger: next,
      })
      if (!ok) return
      await runAction(`toggle-${user.id}`, async () => {
        await request(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { disabled: next } })
        ctx.toast.success(next ? `已停用「${name}」` : `已启用「${name}」`)
      })
    },
    [ctx, guardsFor, runAction],
  )

  const deleteUser = useCallback(
    async (user: AdminUser) => {
      const { isSelf } = guardsFor(user)
      if (isSelf) return
      const name = user.displayName || user.username
      const ok = await ctx.confirm({
        title: '删除用户',
        message: `删除「${name}」会连带删除其空间、全部笔记、附件与版本历史，且不可恢复。确定继续吗？`,
        confirmText: '删除用户及其数据',
        danger: true,
      })
      if (!ok) return
      await runAction(`delete-${user.id}`, async () => {
        await request(`/api/admin/users/${user.id}`, { method: 'DELETE' })
        ctx.toast.success(`已删除「${name}」及其全部数据`)
      })
    },
    [ctx, guardsFor, runAction],
  )

  const revokeInvite = useCallback(
    async (invite: Invite) => {
      if (invite.used) return
      const ok = await ctx.confirm({
        title: '吊销邀请码',
        message: `吊销后邀请码「${invite.code}」立即失效，别人将无法再用它注册。确定吊销吗？`,
        confirmText: '吊销',
        danger: true,
      })
      if (!ok) return
      await runAction(`revoke-${invite.code}`, async () => {
        await request(`/api/admin/invites/${encodeURIComponent(invite.code)}`, { method: 'DELETE' })
        ctx.toast.success('邀请码已吊销')
      })
    },
    [ctx, runAction],
  )

  const copyCode = useCallback(
    async (code: string) => {
      const ok = await copyText(code)
      if (ok) ctx.toast.success('邀请码已复制到剪贴板')
      else ctx.toast.error('复制失败，请手动选中复制')
    },
    [ctx],
  )

  const total = users.length + invites.length

  return (
    <div className="kb-adm kb-adm--admin">
      <header className="kb-adm__head">
        <div className="kb-adm__heading">
          <h1 className="kb-adm__title">成员管理</h1>
          <p className="kb-adm__sub">用户与邀请码；管理员不能停用、降级或删除自己，也不能停用最后一名管理员</p>
        </div>
        <div className="kb-adm__actions">
          <Button size="sm" onClick={() => void load()} disabled={status === 'loading'}>
            刷新
          </Button>
          <Button size="sm" variant="primary" onClick={() => setUserModal({ mode: 'create' })} disabled={status !== 'ready'}>
            创建用户
          </Button>
        </div>
      </header>

      <div className="kb-adm__body">
        {status === 'loading' ? (
          <div className="kb-adm__stack" aria-busy="true">
            <div className="kb-adm-card">
              <div className="kb-adm-card__body">
                <Skeleton width="30%" height={14} />
                <Skeleton width="90%" height={12} />
                <Skeleton width="80%" height={12} />
                <Skeleton width="85%" height={12} />
              </div>
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <EmptyState
            title="成员数据加载失败"
            desc={error}
            action={
              <Button size="sm" onClick={() => void load()}>
                重试
              </Button>
            }
          />
        ) : null}

        {status === 'ready' ? (
          <div className="kb-adm__stack">
            {/* ------------------------------ 用户 ------------------------------ */}
            <section className="kb-adm-card">
              <div className="kb-adm-card__head">
                <h2 className="kb-adm-card__title">
                  用户 <span className="kb-adm-count">{users.length}</span>
                </h2>
                <p className="kb-adm-card__sub">删除用户会连带删除其全部笔记；停用后无法登录但数据保留</p>
              </div>
              <div className="kb-adm-card__body">
                {users.length === 0 ? (
                  <p className="kb-adm-faint">还没有用户。</p>
                ) : (
                  <TableScroll label="用户列表">
                    <table className="kb-adm-table">
                      <thead>
                        <tr>
                          <th>用户名</th>
                          <th>显示名</th>
                          <th>角色</th>
                          <th>状态</th>
                          <th>创建时间</th>
                          <th className="kb-adm-table__actions">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <UserRow
                            key={user.id}
                            user={user}
                            guards={guardsFor(user)}
                            meId={ctx.user.id}
                            busyKey={busyKey}
                            formatDate={ctx.formatDate}
                            onEdit={() => setUserModal({ mode: 'edit', user })}
                            onToggle={() => void toggleUser(user)}
                            onDelete={() => void deleteUser(user)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                )}
              </div>
            </section>

            {/* ----------------------------- 邀请码 ----------------------------- */}
            <section className="kb-adm-card">
              <div className="kb-adm-card__head">
                <h2 className="kb-adm-card__title">
                  邀请码 <span className="kb-adm-count">{invites.length}</span>
                </h2>
                <p className="kb-adm-card__sub">把邀请码发给新成员，注册时填写即可加入；已使用的邀请码不能吊销</p>
              </div>
              <div className="kb-adm-card__body">
                <div className="kb-adm-btnrow">
                  <Button size="sm" onClick={() => setInviteModal(true)}>
                    生成邀请码
                  </Button>
                </div>
                {invites.length === 0 ? (
                  <p className="kb-adm-faint">还没有邀请码。</p>
                ) : (
                  <TableScroll label="邀请码列表">
                    <table className="kb-adm-table">
                      <thead>
                        <tr>
                          <th>邀请码</th>
                          <th>状态</th>
                          <th>创建时间</th>
                          <th>过期时间</th>
                          <th className="kb-adm-table__actions">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((invite) => (
                          <tr key={invite.code}>
                            <td>
                              <span className="kb-adm-code">{invite.code}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="kb-adm-copy"
                                title="复制邀请码"
                                aria-label={`复制邀请码 ${invite.code}`}
                                onClick={() => void copyCode(invite.code)}
                              >
                                复制
                              </Button>
                            </td>
                            <td>
                              {invite.used ? (
                                <Badge tone="neutral">已使用</Badge>
                              ) : invite.expired ? (
                                <Badge tone="warning">已过期</Badge>
                              ) : (
                                <Badge tone="success">有效</Badge>
                              )}
                            </td>
                            <td className="kb-adm-faint">{ctx.formatDate(invite.createdAt)}</td>
                            <td className="kb-adm-faint">
                              {invite.expiresAt ? ctx.formatDate(invite.expiresAt) : '永不过期'}
                            </td>
                            <td className="kb-adm-table__actions">
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={invite.used}
                                title={invite.used ? '已使用的邀请码不能吊销' : '吊销后该邀请码立即失效'}
                                loading={busyKey === `revoke-${invite.code}`}
                                onClick={() => void revokeInvite(invite)}
                              >
                                吊销
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                )}
              </div>
            </section>
            <p className="kb-adm-faint">
              共 {total} 条记录 · {activeAdmins} 名可用管理员
            </p>
          </div>
        ) : null}
      </div>

      {userModal ? (
        <UserFormModal
          modal={userModal}
          meId={ctx.user.id}
          activeAdmins={activeAdmins}
          onClose={() => setUserModal(null)}
          onSaved={async (message) => {
            setUserModal(null)
            ctx.toast.success(message)
            await load()
          }}
        />
      ) : null}

      {inviteModal ? (
        <InviteFormModal
          onClose={() => setInviteModal(false)}
          onCreated={async (code) => {
            setInviteModal(false)
            ctx.toast.success(`邀请码已生成：${code}`)
            await load()
          }}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------ 表格滚动提示 */

/**
 * 窄屏下表格会横向滚动（FULL.md §4 允许），但用户看不到还有列被藏起来 ——
 * 这里给容器加「右缘渐隐 + 首次短暂提示」，滚到末尾或超时后自动消失。
 */
function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const hintedRef = useRef(false)
  const [overflowing, setOverflowing] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const armHint = () => {
      setShowHint(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        setShowHint(false)
        timerRef.current = null
      }, 4000)
    }

    const measure = () => {
      const over = el.scrollWidth - el.clientWidth > 4
      const reachedEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4
      setOverflowing(over)
      setAtEnd(reachedEnd)
      if (!over || reachedEnd) setShowHint(false)
      else if (!hintedRef.current) {
        hintedRef.current = true
        armHint()
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
      hintedRef.current = false
      observer.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [])

  return (
    <div className="kb-adm-table-scroll" role="group" aria-label={label}>
      <div className="kb-adm-table-wrap" ref={wrapRef}>
        {children}
      </div>
      {overflowing && !atEnd ? <span className="kb-adm-table-fade" aria-hidden="true" /> : null}
      {showHint ? <span className="kb-adm-table-hint">← 左右滑动查看全部列 →</span> : null}
    </div>
  )
}

/* ------------------------------------------------------------ 用户行 */

function UserRow({
  user,
  guards,
  meId,
  busyKey,
  formatDate,
  onEdit,
  onToggle,
  onDelete,
}: {
  user: AdminUser
  guards: { isSelf: boolean; isLastAdmin: boolean }
  meId: number
  busyKey: string | null
  formatDate: (iso: string) => string
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const name = user.displayName || user.username
  const toggleBlocked = guards.isSelf || guards.isLastAdmin
  const toggleReason = guards.isSelf
    ? '不能停用自己（会把自己锁在门外）'
    : guards.isLastAdmin
      ? '这是最后一名管理员，停用后将无人能管理系统'
      : user.disabled
        ? `恢复「${name}」的登录权限`
        : `停用「${name}」，其笔记与数据保留`
  const deleteReason = guards.isSelf ? '不能删除自己' : `删除「${name}」并连带删除其全部笔记（不可恢复）`

  return (
    <tr className={user.id === meId ? 'is-self' : undefined}>
      <td>
        <span className="kb-adm-code">{user.username}</span>
        {guards.isSelf ? (
          <span className="kb-adm-selfmark">本人</span>
        ) : null}
      </td>
      <td>{name}</td>
      <td>
        <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>
          {user.role === 'admin' ? '管理员' : '成员'}
        </Badge>
      </td>
      <td>{user.disabled ? <Badge tone="neutral">已停用</Badge> : <Badge tone="success">正常</Badge>}</td>
      <td className="kb-adm-faint">{formatDate(user.createdAt)}</td>
      <td className="kb-adm-table__actions">
        <div className="kb-adm-rowbtns">
          <Button size="sm" onClick={onEdit} title={`编辑「${name}」的显示名与密码`}>
            编辑
          </Button>
          <Button
            size="sm"
            disabled={toggleBlocked}
            title={toggleReason}
            aria-disabled={toggleBlocked}
            loading={busyKey === `toggle-${user.id}`}
            onClick={onToggle}
          >
            {user.disabled ? '启用' : '停用'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={guards.isSelf}
            title={deleteReason}
            aria-disabled={guards.isSelf}
            loading={busyKey === `delete-${user.id}`}
            onClick={onDelete}
          >
            删除
          </Button>
        </div>
        {toggleBlocked || guards.isSelf ? (
          <p className="kb-adm-rowhint">
            {guards.isSelf ? '本人：不能停用或删除自己' : '最后一名管理员：不能停用'}
          </p>
        ) : null}
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------ 用户表单 */

function UserFormModal({
  modal,
  meId,
  activeAdmins,
  onClose,
  onSaved,
}: {
  modal: UserModal
  meId: number
  activeAdmins: number
  onClose: () => void
  onSaved: (message: string) => Promise<void>
}) {
  const editing = modal.mode === 'edit' ? modal.user : null
  const isSelf = editing !== null && editing.id === meId
  const isLastAdmin =
    editing !== null && editing.role === 'admin' && !editing.disabled && activeAdmins <= 1
  const canEditRole = !isSelf && !isLastAdmin

  const [username, setUsername] = useState(editing?.username ?? '')
  const [displayName, setDisplayName] = useState(editing?.displayName ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>(editing?.role ?? 'member')
  const [disabled, setDisabled] = useState(editing?.disabled ? 'true' : 'false')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const submit = useCallback(async () => {
    const errors: Record<string, string> = {}
    if (editing === null && !/^[A-Za-z0-9_-]{3,32}$/.test(username.trim())) {
      errors.username = '用户名需为 3–32 位字母、数字、下划线或短横线'
    }
    if (!displayName.trim()) errors.displayName = '显示名不能为空'
    if (editing === null && password.length < 8) errors.password = '初始密码至少 8 位'
    if (editing !== null && password && password.length < 8) errors.password = '新密码至少 8 位'
    setFieldErrors(errors)
    setFormError('')
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      if (editing === null) {
        const body: CreateUserRequest = {
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          role,
        }
        await request<AdminUser>('/api/admin/users', { method: 'POST', body })
        await onSaved(`已创建用户「${body.displayName}」`)
      } else {
        const body: UpdateUserRequest = { displayName: displayName.trim() }
        if (password) body.password = password
        // 自己与最后一名管理员：不下发 role / disabled，避免服务端 400
        if (canEditRole) {
          body.role = role
          body.disabled = disabled === 'true'
        }
        await request<AdminUser>(`/api/admin/users/${editing.id}`, { method: 'PATCH', body })
        await onSaved(`已保存「${body.displayName}」`)
      }
    } catch (err) {
      const message = describeApiError(err)
      if (err instanceof ApiError && (err.code === 'CONFLICT' || err.status === 400 || err.status === 409)) {
        const field = err.field ?? (editing === null ? 'username' : 'displayName')
        setFieldErrors({ [field]: message })
        setFormError(message)
      } else {
        setFormError(message)
      }
    } finally {
      setSaving(false)
    }
  }, [canEditRole, disabled, displayName, editing, onSaved, password, role, username])

  const hint = editing === null ? '创建后用户名不可修改' : undefined

  return (
    <Modal
      open
      title={editing === null ? '创建用户' : `编辑用户「${editing.displayName || editing.username}」`}
      onClose={() => {
        if (!saving) onClose()
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {editing === null ? '创建' : '保存'}
          </Button>
        </>
      }
    >
      <div className="kb-adm-form">
        {editing === null ? (
          <TextField
            label="用户名"
            value={username}
            hint={fieldErrors.username ?? hint}
            invalid={Boolean(fieldErrors.username)}
            autoComplete="off"
            onChange={(event) => setUsername(event.target.value)}
          />
        ) : null}
        <TextField
          label="显示名"
          value={displayName}
          hint={fieldErrors.displayName}
          invalid={Boolean(fieldErrors.displayName)}
          autoComplete="off"
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label={editing === null ? '初始密码' : '新密码'}
          type="password"
          value={password}
          placeholder={editing === null ? '至少 8 位' : '留空则不修改'}
          hint={fieldErrors.password ?? (editing === null ? undefined : '至少 8 位，留空表示不改密码')}
          invalid={Boolean(fieldErrors.password)}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
        />
        {canEditRole ? (
          <>
            <Select
              label="角色"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'member')}
            />
            <Select
              label="状态"
              options={[
                { value: 'false', label: '正常' },
                { value: 'true', label: '停用（无法登录）' },
              ]}
              value={disabled}
              onChange={(event) => setDisabled(event.target.value)}
            />
          </>
        ) : (
          <p className="kb-adm-note">
            {isSelf
              ? '不能修改自己的角色，也不能停用自己。'
              : '这是最后一名管理员，不能降级或停用。'}
          </p>
        )}
        {formError ? <p className="kb-adm-formerror">{formError}</p> : null}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ 邀请码表单 */

function InviteFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (code: string) => Promise<void>
}) {
  const [hours, setHours] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [formError, setFormError] = useState('')

  const submit = useCallback(async () => {
    const raw = hours.trim()
    let expiresInHours: number | undefined
    if (raw) {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setFieldError('有效小时数需为正整数，或留空表示长期有效')
        return
      }
      expiresInHours = parsed
    }
    setFieldError('')
    setFormError('')
    setSaving(true)
    try {
      const created = await request<{ code: string }>('/api/admin/invites', {
        method: 'POST',
        body: expiresInHours === undefined ? {} : { expiresInHours },
      })
      await onCreated(created.code)
    } catch (err) {
      const message = describeApiError(err)
      if (err instanceof ApiError && (err.status === 400 || err.field === 'expiresInHours')) setFieldError(message)
      else setFormError(message)
    } finally {
      setSaving(false)
    }
  }, [hours, onCreated])

  return (
    <Modal
      open
      title="生成邀请码"
      onClose={() => {
        if (!saving) onClose()
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            生成
          </Button>
        </>
      }
    >
      <div className="kb-adm-form">
        <TextField
          label="有效小时数"
          type="number"
          min={1}
          value={hours}
          placeholder="留空 = 长期有效"
          hint={fieldError || '例如 24 表示一天后过期'}
          invalid={Boolean(fieldError)}
          onChange={(event) => setHours(event.target.value)}
        />
        {formError ? <p className="kb-adm-formerror">{formError}</p> : null}
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- 工具 */

/** 复制到剪贴板：优先 async clipboard，失败回退 execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 回退到 execCommand */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
