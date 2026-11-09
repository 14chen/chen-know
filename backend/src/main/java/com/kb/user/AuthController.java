package com.kb.user;

import com.kb.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** API.md §1 认证接口。 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final SessionAuthenticator sessionAuthenticator;

    public AuthController(AuthService authService, SessionAuthenticator sessionAuthenticator) {
        this.authService = authService;
        this.sessionAuthenticator = sessionAuthenticator;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse register(@Valid @RequestBody RegisterRequest request) {
        return UserResponse.of(authService.register(request));
    }

    @PostMapping("/login")
    public UserResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {
        UserAccount user = authService.authenticate(request.username(), request.password());
        KbPrincipal principal = authService.toPrincipal(user);
        // 防会话固定：登录前存在的会话一律作废，随后由 saveContext 建立新会话
        if (httpRequest.getSession(false) != null) {
            httpRequest.getSession(false).invalidate();
        }
        sessionAuthenticator.establish(principal, httpRequest, httpResponse);
        return UserResponse.of(principal);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest httpRequest) {
        sessionAuthenticator.invalidateSession(httpRequest);
    }

    @GetMapping("/me")
    public UserResponse me(@AuthenticationPrincipal KbPrincipal principal) {
        if (principal == null) {
            throw ApiException.unauthorized("未登录或会话已过期");
        }
        return UserResponse.of(principal);
    }
}
