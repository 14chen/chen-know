package com.kb.user;

import com.kb.common.ApiException;
import com.kb.common.PageResponse;
import com.kb.common.Times;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository users;
    private final SpaceRepository spaces;
    private final InviteRepository invites;
    private final PasswordEncoder passwordEncoder;

    public AdminService(UserRepository users, SpaceRepository spaces, InviteRepository invites,
            PasswordEncoder passwordEncoder) {
        this.users = users;
        this.spaces = spaces;
        this.invites = invites;
        this.passwordEncoder = passwordEncoder;
    }

    public PageResponse<AdminUserResponse> listUsers(Integer pageParam, Integer sizeParam) {
        int page = PageResponse.normalizePage(pageParam);
        int size = PageResponse.normalizeSize(sizeParam);
        List<AdminUserResponse> items = users.pageAdmin(size, PageResponse.offset(page, size));
        return PageResponse.of(items, page, size, users.count());
    }

    @Transactional
    public AdminUserResponse createUser(CreateUserRequest request) {
        String username = request.username().trim();
        String displayName = request.displayName().trim();
        if (users.existsByUsername(username)) {
            throw ApiException.conflict("用户名已存在");
        }
        String now = Times.now();
        long userId = users.insert(username, displayName, passwordEncoder.encode(request.password()),
                request.role(), now);
        spaces.insert(userId, displayName + "的空间", now);
        return new AdminUserResponse(userId, username, displayName, request.role(), false, now,
                spaces.findIdByOwner(userId).orElse(null));
    }

    public AdminUserResponse updateUser(long actorId, long targetId, UpdateUserRequest request) {
        UserAccount target = users.findById(targetId).orElseThrow(() -> ApiException.notFound("用户不存在"));
        String displayName = request.displayName() == null ? null : request.displayName().trim();
        if (displayName != null && displayName.isEmpty()) {
            throw ApiException.validation("显示名不能为空", "displayName");
        }
        boolean disabling = Boolean.TRUE.equals(request.disabled());
        boolean demoting = request.role() != null && !UserAccount.ROLE_ADMIN.equals(request.role());

        if (targetId == actorId) {
            if (disabling) {
                throw ApiException.validation("不能停用自己的账号", "disabled");
            }
            if (demoting) {
                throw ApiException.validation("不能降级自己的账号", "role");
            }
        }
        if (target.isAdmin() && (disabling || demoting) && users.countOtherEnabledAdmins(targetId) == 0) {
            throw ApiException.validation("必须保留至少一个可用的管理员", disabling ? "disabled" : "role");
        }

        String passwordHash = request.password() == null ? null : passwordEncoder.encode(request.password());
        users.update(targetId, displayName, passwordHash, request.role(), request.disabled());
        UserAccount updated = users.findById(targetId)
                .orElseThrow(() -> new IllegalStateException("更新后读不到用户: " + targetId));
        return new AdminUserResponse(updated.id(), updated.username(), updated.displayName(), updated.role(),
                updated.disabled(), updated.createdAt(), spaces.findIdByOwner(updated.id()).orElse(null));
    }

    @Transactional
    public void deleteUser(long actorId, long targetId) {
        if (actorId == targetId) {
            throw ApiException.validation("不能删除自己的账号", "id");
        }
        UserAccount target = users.findById(targetId).orElseThrow(() -> ApiException.notFound("用户不存在"));
        if (target.isAdmin() && users.countOtherEnabledAdmins(targetId) == 0) {
            throw ApiException.validation("必须保留至少一个可用的管理员", "id");
        }
        // users 删除后 spaces 由外键 ON DELETE CASCADE 级联，进而清掉该空间的全部数据
        users.deleteById(targetId);
    }

    public PageResponse<InviteResponse> listInvites(Integer pageParam, Integer sizeParam) {
        int page = PageResponse.normalizePage(pageParam);
        int size = PageResponse.normalizeSize(sizeParam);
        List<InviteResponse> items = invites.page(size, PageResponse.offset(page, size)).stream()
                .map(InviteResponse::of)
                .toList();
        return PageResponse.of(items, page, size, invites.count());
    }

    public CreateInviteResponse createInvite(long actorId, CreateInviteRequest request) {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        String code = HexFormat.of().formatHex(bytes);
        String expiresAt = null;
        if (request != null && request.expiresInHours() != null) {
            expiresAt = Times.format(Instant.now().plus(request.expiresInHours(), ChronoUnit.HOURS));
        }
        invites.insert(code, actorId, Times.now(), expiresAt);
        return new CreateInviteResponse(code, expiresAt);
    }

    public void revokeInvite(String code) {
        Invite invite = invites.findByCode(code).orElseThrow(() -> ApiException.notFound("邀请码不存在"));
        if (invite.usedBy() != null) {
            throw ApiException.conflict("邀请码已被使用，无法吊销");
        }
        if (invites.deleteUnused(code) != 1) {
            throw ApiException.conflict("邀请码已被使用，无法吊销");
        }
    }
}
