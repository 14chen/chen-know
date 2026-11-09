package com.kb.autotag;

import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 手动触发自动标签（默认关闭时返回 scanned=0）。 */
@RestController
@RequestMapping("/api/autotag")
public class AutoTagController {

    private final AutoTagService autoTagService;

    public AutoTagController(AutoTagService autoTagService) {
        this.autoTagService = autoTagService;
    }

    @PostMapping("/run")
    public AutoTagService.Result run(@AuthenticationPrincipal KbPrincipal principal) {
        return autoTagService.run(principal.spaceId());
    }
}
