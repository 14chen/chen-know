import { useEffect, useState } from 'react'
import { fetchCurrentUser } from '@/api/auth'
import { setUnauthorizedHandler } from '@/api/client'
import type { User } from '@/api/types'
import { IconSpinner } from '@/components/Icon'
import { ToastProvider } from '@/components/Toast'
import { AppShell } from '@/shell/AppShell'
import { ConfirmProvider } from '@/shell/ConfirmProvider'
import { LoginPage } from '@/shell/LoginPage'
import { useTheme } from '@/shell/theme'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)

  // 启动探测会话：401 视为未登录 → 显示登录页
  useEffect(() => {
    let alive = true
    void fetchCurrentUser().then(
      (current) => {
        if (!alive) return
        setUser(current)
        setBooting(false)
      },
      () => {
        if (alive) setBooting(false)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  // 401 → 回登录页
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    return () => setUnauthorizedHandler(null)
  }, [])

  return (
    <ToastProvider>
      <ConfirmProvider>
        {booting ? (
          <div className="kb-boot">
            <IconSpinner size={22} />
            <span>正在检查登录状态…</span>
          </div>
        ) : user ? (
          <AppShell
            user={user}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLoggedOut={() => setUser(null)}
          />
        ) : (
          <LoginPage theme={theme} onToggleTheme={toggleTheme} onSuccess={setUser} />
        )}
      </ConfirmProvider>
    </ToastProvider>
  )
}
