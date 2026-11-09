package com.kb.user;

import com.kb.common.ApiException;
import com.kb.common.Times;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserRepository users;
    private final SpaceRepository spaces;
    private final InviteRepository invites;
    private final PasswordEncoder passwordEncoder;
    private final LoginAttemptService loginAttempts;

    /** 用于「用户不存在」时也做一次 BCrypt 比对，抹平响应时间差（防用户名枚举）。 */
    private final String timingEqualizerHash;

    public AuthService(UserRepository users, SpaceRepository spaces, InviteRepository invites,
            PasswordEncoder passwordEncoder, LoginAttemptService loginAttempts) {
        this.users = users;
        this.spaces = spaces;
        this.invites = invites;
        this.passwordEncoder = passwordEncoder;
        this.loginAttempts = loginAttempts;
        this.timingEqualizerHash = passwordEncoder.encode("kb-timing-equalizer");
    }

    /**
     * 注册。库里没有任何用户时，首个用户免邀请码并成为 admin（API.md §1）。
     * 用户、空间、邀请码占用在同一事务内完成。
     */
    @Transactional
    public UserAccount register(RegisterRequest request) {
        String username = request.username().trim();
        String displayName = request.displayName().trim();
        if (users.existsByUsername(username)) {
            throw ApiException.conflict("用户名已存在");
        }
        boolean firstUser = users.count() == 0;
        String inviteCode = request.inviteCode() == null ? null : request.inviteCode().trim();

        if (!firstUser) {
            if (inviteCode == null || inviteCode.isEmpty()) {
                throw ApiException.validation("需要邀请码才能注册", "inviteCode");
            }
            Invite invite = invites.findByCode(inviteCode)
                    .orElseThrow(() -> ApiException.validation("邀请码无效", "inviteCode"));
            if (invite.usedBy() != null) {
                throw ApiException.conflict("邀请码已被使用");
            }
            if (InviteResponse.isExpired(invite.expiresAt())) {
                throw ApiException.validation("邀请码已过期", "inviteCode");
            }
        }

        String now = Times.now();
        String role = firstUser ? UserAccount.ROLE_ADMIN : UserAccount.ROLE_MEMBER;
        long userId = users.insert(username, displayName, passwordEncoder.encode(request.password()), role, now);
        spaces.insert(userId, displayName + "的空间", now);

        if (!firstUser) {
            int claimed = invites.claim(inviteCode, userId, Times.now());
            if (claimed != 1) {
                throw ApiException.conflict("邀请码已被使用");
            }
        }
        return users.findById(userId)
                .orElseThrow(() -> new IllegalStateException("注册后读不到用户: " + userId));
    }

    /** 校验凭据；失败按用户名计数限流，锁定期间抛 429。 */
    public UserAccount authenticate(String username, String rawPassword) {
        String key = username == null ? "" : username.trim();
        if (loginAttempts.isLocked(key)) {
            long minutes = Math.max(1, (loginAttempts.remainingLockSeconds(key) + 59) / 60);
            throw ApiException.tooManyRequests("登录失败次数过多，请 " + minutes + " 分钟后重试");
        }
        UserAccount user = users.findByUsername(key).orElse(null);
        String hash = user == null ? timingEqualizerHash : user.passwordHash();
        boolean passwordMatches = passwordEncoder.matches(rawPassword, hash);
        if (user == null || !passwordMatches) {
            loginAttempts.recordFailure(key);
            throw ApiException.unauthorized("用户名或密码错误");
        }
        if (user.disabled()) {
            throw ApiException.forbidden("账号已被停用");
        }
        loginAttempts.recordSuccess(key);
        return user;
    }

    public KbPrincipal toPrincipal(UserAccount user) {
        long spaceId = spaces.findIdByOwner(user.id())
                .orElseThrow(() -> new IllegalStateException("用户缺少空间: " + user.id()));
        return new KbPrincipal(user.id(), user.username(), user.displayName(), user.role(), spaceId);
    }
}
