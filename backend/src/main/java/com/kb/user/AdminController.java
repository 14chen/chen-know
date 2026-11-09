package com.kb.user;

import com.kb.common.PageResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** API.md §2 管理员接口，访问控制由 SecurityConfig 的 {@code hasRole("ADMIN")} 负责。 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final AdminService adminService;

    public AdminController(AdminService adminService) {
        this.adminService = adminService;
    }

    @GetMapping("/users")
    public PageResponse<AdminUserResponse> listUsers(
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return adminService.listUsers(page, size);
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminUserResponse createUser(@Valid @RequestBody CreateUserRequest request) {
        return adminService.createUser(request);
    }

    @PatchMapping("/users/{id}")
    public AdminUserResponse updateUser(@AuthenticationPrincipal KbPrincipal actor, @PathVariable long id,
            @Valid @RequestBody UpdateUserRequest request) {
        return adminService.updateUser(actor.id(), id, request);
    }

    @DeleteMapping("/users/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteUser(@AuthenticationPrincipal KbPrincipal actor, @PathVariable long id) {
        adminService.deleteUser(actor.id(), id);
    }

    @GetMapping("/invites")
    public PageResponse<InviteResponse> listInvites(
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return adminService.listInvites(page, size);
    }

    @PostMapping("/invites")
    @ResponseStatus(HttpStatus.CREATED)
    public CreateInviteResponse createInvite(@AuthenticationPrincipal KbPrincipal actor,
            @Valid @RequestBody(required = false) CreateInviteRequest request) {
        return adminService.createInvite(actor.id(), request);
    }

    @DeleteMapping("/invites/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeInvite(@PathVariable String code) {
        adminService.revokeInvite(code);
    }
}
