import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, describeApiError } from '@/api/client'
import { login, register } from '@/api/auth'
import type { User } from '@/api/types'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toast'
import { IconAlert, IconBook, IconEye, IconEyeOff, IconMoon, IconSun } from '@/components/Icon'
import { TextField } from '@/components/TextField'
import { nextTheme, themeOption } from './theme'
import type { Theme } from './theme'

export interface LoginPageProps {
  theme: Theme
  onToggleTheme: () => void
  onSuccess: (user: User) => void
}

type Mode = 'login' | 'register'

/** 服务端错误里的出错字段名 → 表单里的字段名（API.md §1：inviteCode） */
function invalidFieldOf(caught: unknown): string | null {
  if (!(caught instanceof ApiError) || !caught.field) return null
  return caught.field === 'inviteCode' ? 'invite' : caught.field
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

export function LoginPage({ theme, onToggleTheme, onSuccess }: LoginPageProps) {
  const toast = useToast()

  const [mode, setMode] = useState<Mode>('login')

  // 登录
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [revealPassword, setRevealPassword] = useState(false)

  // 注册
  const [regUsername, setRegUsername] = useState('')
  const [regDisplayName, setRegDisplayName] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regInvite, setRegInvite] = useState('')
  const [revealRegPassword, setRevealRegPassword] = useState(false)

  const [error, setError] = useState<string | null>(null)
  /** 高亮哪个输入框（注册表单用；登录沿用「整表标红」的既有行为） */
  const [errorField, setErrorField] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const regUsernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'login') usernameRef.current?.focus()
    else regUsernameRef.current?.focus()
  }, [mode])

  const clearError = () => {
    setError(null)
    setErrorField(null)
  }

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    clearError()
    setPassword('')
    setRegPassword('')
  }

  /* ---- 登录 ------------------------------------------------------------ */
  const canLogin = username.trim().length > 0 && password.length > 0 && !submitting

  const onLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canLogin) return

    setSubmitting(true)
    clearError()
    try {
      const user = await login(username.trim(), password)
      onSuccess(user)
    } catch (caught) {
      // 错误内联在表单里（验收项 4），不弹 toast
      setError(describeApiError(caught))
      setErrorField(invalidFieldOf(caught))
      setSubmitting(false)
      setPassword('')
    }
  }

  /* ---- 注册 ------------------------------------------------------------
     契约 API.md §1：register 只建账号、不下发会话，成功后必须再 login 一次。
     自动登录失败时不能把人踢回空表单 —— 切到登录页签、预填用户名、提示原因。 */
  const canRegister =
    regUsername.trim().length > 0 &&
    regDisplayName.trim().length > 0 &&
    regPassword.length > 0 &&
    !submitting

  const onRegisterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canRegister) return

    const name = regUsername.trim()
    const displayName = regDisplayName.trim()
    const inviteCode = regInvite.trim()

    if (!USERNAME_PATTERN.test(name)) {
      setError('用户名需 3–32 位字母、数字、下划线或短横线')
      setErrorField('username')
      return
    }
    if (displayName.length > 32) {
      setError('显示名最长 32 个字符')
      setErrorField('displayName')
      return
    }
    if (regPassword.length < 8) {
      setError('密码至少 8 位')
      setErrorField('password')
      return
    }

    setSubmitting(true)
    clearError()

    try {
      await register({
        username: name,
        displayName,
        password: regPassword,
        // 留空时**不带** inviteCode 字段（首位用户免邀请码）
        ...(inviteCode ? { inviteCode } : {}),
      })
    } catch (caught) {
      setError(describeApiError(caught))
      setErrorField(invalidFieldOf(caught))
      setSubmitting(false)
      return
    }

    try {
      const user = await login(name, regPassword)
      toast.success('注册成功，已登录')
      onSuccess(user)
    } catch (caught) {
      setMode('login')
      setUsername(name)
      setPassword('')
      setError(`注册成功，请手动登录（自动登录失败：${describeApiError(caught)}）。用户名已填好，请补填密码。`)
      setErrorField(null)
      setSubmitting(false)
      passwordRef.current?.focus()
    }
  }

  const passwordToggle = (revealed: boolean, onToggle: () => void) => (
    <button
      type="button"
      className="kb-btn kb-btn--icon"
      onClick={onToggle}
      aria-label={revealed ? '隐藏密码' : '显示密码'}
      tabIndex={-1}
    >
      {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
    </button>
  )

  return (
    <div className="kb-login">
      <button
        type="button"
        className="kb-theme-fab"
        onClick={onToggleTheme}
        aria-label={`切换主题（当前：${themeOption(theme).label}，下一套：${themeOption(nextTheme(theme)).label}）`}
        title={`切换主题（当前：${themeOption(theme).label}）`}
      >
        {themeOption(theme).dark ? <IconSun size={17} /> : <IconMoon size={17} />}
      </button>

      <div className="kb-login__card">
        <div className="kb-login__brand">
          <span className="kb-login__logo">
            <IconBook size={22} />
          </span>
          <div>
            <h1 className="kb-login__title">知识库</h1>
            <p className="kb-login__subtitle">{mode === 'login' ? '登录后开始书写' : '创建一个账号开始记录'}</p>
          </div>
        </div>

        <div className="kb-login__tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            id="kb-tab-login"
            aria-selected={mode === 'login'}
            aria-controls="kb-panel-login"
            className={['kb-login__tab', mode === 'login' ? 'kb-login__tab--active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            id="kb-tab-register"
            aria-selected={mode === 'register'}
            aria-controls="kb-panel-register"
            className={['kb-login__tab', mode === 'register' ? 'kb-login__tab--active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        {mode === 'login' ? (
          <form
            id="kb-panel-login"
            role="tabpanel"
            aria-labelledby="kb-tab-login"
            className="kb-login__form"
            onSubmit={onLoginSubmit}
            noValidate
          >
            <TextField
              ref={usernameRef}
              label="用户名"
              name="username"
              value={username}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="例如 demo"
              invalid={error !== null}
              onChange={(event) => {
                setUsername(event.target.value)
                clearError()
              }}
            />

            <TextField
              ref={passwordRef}
              label="密码"
              name="password"
              type={revealPassword ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              placeholder="请输入密码"
              invalid={error !== null}
              onChange={(event) => {
                setPassword(event.target.value)
                clearError()
              }}
              action={passwordToggle(revealPassword, () => setRevealPassword((prev) => !prev))}
            />

            {error ? (
              <p className="kb-login__error" role="alert">
                <IconAlert size={15} />
                <span>{error}</span>
              </p>
            ) : null}

            <Button type="submit" variant="primary" block loading={submitting} disabled={!canLogin}>
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>
        ) : (
          <form
            id="kb-panel-register"
            role="tabpanel"
            aria-labelledby="kb-tab-register"
            className="kb-login__form"
            onSubmit={onRegisterSubmit}
            noValidate
          >
            <TextField
              ref={regUsernameRef}
              label="用户名"
              name="username"
              value={regUsername}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="3–32 位字母、数字、_ 或 -"
              invalid={errorField === 'username'}
              onChange={(event) => {
                setRegUsername(event.target.value)
                clearError()
              }}
            />

            <TextField
              label="显示名"
              name="displayName"
              value={regDisplayName}
              autoComplete="nickname"
              placeholder="例如 演示账号"
              invalid={errorField === 'displayName'}
              onChange={(event) => {
                setRegDisplayName(event.target.value)
                clearError()
              }}
            />

            <TextField
              label="密码"
              name="password"
              type={revealRegPassword ? 'text' : 'password'}
              value={regPassword}
              autoComplete="new-password"
              placeholder="至少 8 位"
              invalid={errorField === 'password'}
              onChange={(event) => {
                setRegPassword(event.target.value)
                clearError()
              }}
              action={passwordToggle(revealRegPassword, () => setRevealRegPassword((prev) => !prev))}
            />

            <TextField
              label="邀请码（选填）"
              name="inviteCode"
              value={regInvite}
              autoCapitalize="off"
              spellCheck={false}
              placeholder="首位用户可留空"
              hint="库中已有用户时必须填写；首位注册者免邀请码并自动成为管理员"
              invalid={errorField === 'invite'}
              onChange={(event) => {
                setRegInvite(event.target.value)
                clearError()
              }}
            />

            {error ? (
              <p className="kb-login__error" role="alert">
                <IconAlert size={15} />
                <span>{error}</span>
              </p>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              block
              loading={submitting}
              disabled={!canRegister}
            >
              {submitting ? '注册中…' : '注册并登录'}
            </Button>
          </form>
        )}

        <p className="kb-login__foot">
          {mode === 'login'
            ? '登录状态通过 KB_SESSION Cookie 保持，有效期 7 天'
            : '注册成功后会自动登录；邀请码由管理员在「成员管理」中生成'}
        </p>
      </div>
    </div>
  )
}
